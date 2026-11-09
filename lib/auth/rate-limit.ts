/**
 * B2.1 — Rate limiting that works across instances.
 *
 * Two implementations of one async contract:
 * - Memory (per-process; tests + local dev), optionally over a shared backing
 *   so two limiter instances behave like two servers against one store.
 * - Drizzle/Neon fixed-window counters: one row per (key, window). The atomic
 *   INSERT ... ON CONFLICT DO UPDATE ... RETURNING makes concurrent increments
 *   exact, and rows are pruned to the current window so the table cannot grow
 *   without bound (at most ~2 rows per active key).
 *
 * Limits (documented, unchanged from B2 behavior):
 * - auth challenge / verify: 10 requests / 60 s per client key.
 * - session-authenticated recipient endpoints: 60 requests / 60 s per key.
 * Rejection carries only a generic code + Retry-After; no endpoint state leaks.
 */

import { and, eq, lt, sql } from "drizzle-orm";
import { authRateCounters } from "@/lib/db/schema";
import type { DbClient } from "@/lib/db";

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export type AsyncRateLimiter = {
  check(key: string, nowMs: number): Promise<RateLimitDecision>;
};

export type RateLimiterOptions = {
  windowMs: number;
  maxRequests: number;
  maxKeys?: number;
};

/* -------------------------------------------------------------------------- */
/* Memory                                                                     */
/* -------------------------------------------------------------------------- */

export type MemoryRateLimitBacking = Map<string, number[]>;

export function createMemoryRateLimiter(
  options: RateLimiterOptions,
  shared: MemoryRateLimitBacking = new Map(),
): AsyncRateLimiter {
  const maxKeys = options.maxKeys ?? 512;
  return {
    async check(key: string, nowMs: number): Promise<RateLimitDecision> {
      if (shared.size > maxKeys) {
        for (const [k, ts] of shared) {
          const fresh = ts.filter((t) => nowMs - t < options.windowMs);
          if (fresh.length === 0) shared.delete(k);
          else shared.set(k, fresh);
        }
      }
      const recent = (shared.get(key) ?? []).filter((t) => nowMs - t < options.windowMs);
      if (recent.length >= options.maxRequests) {
        shared.set(key, recent);
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((options.windowMs - (nowMs - recent[0])) / 1000)),
        };
      }
      recent.push(nowMs);
      shared.set(key, recent);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Drizzle / Neon (shared across instances)                                   */
/* -------------------------------------------------------------------------- */

export function createDrizzleRateLimiter(
  db: DbClient,
  options: RateLimiterOptions,
  keyPrefix = "",
): AsyncRateLimiter {
  return {
    async check(key: string, nowMs: number): Promise<RateLimitDecision> {
      const namespaced = `${keyPrefix}${key}`;
      const windowStart = Math.floor(nowMs / options.windowMs) * options.windowMs;
      // Atomic increment: exactly one count per request even under concurrency.
      const rows = await db
        .insert(authRateCounters)
        .values({ key: namespaced, windowStart, count: 1 })
        .onConflictDoUpdate({
          target: [authRateCounters.key, authRateCounters.windowStart],
          set: { count: sql`${authRateCounters.count} + 1` },
        })
        .returning({ count: authRateCounters.count });
      const count = rows[0]?.count ?? options.maxRequests + 1;
      // Bounded growth: drop this key's older windows on every decision.
      await db
        .delete(authRateCounters)
        .where(
          and(
            eq(authRateCounters.key, namespaced),
            lt(authRateCounters.windowStart, windowStart),
          ),
        );
      if (count > options.maxRequests) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((windowStart + options.windowMs - nowMs) / 1000),
        );
        return { allowed: false, retryAfterSeconds };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
