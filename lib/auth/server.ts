/**
 * B2.1 — Server glue for wallet-authenticated routes (framework-free).
 *
 * Authority rules:
 * - SIWE origins come ONLY from APP_ORIGINS (allowlist of full origins) or the
 *   legacy single APP_DOMAIN. Request Host / X-Forwarded-Host headers are NEVER
 *   trusted as authentication authority — a forged Host cannot mint or widen
 *   sign-in authority.
 * - SESSION_SECRET must be >= 32 bytes of high-entropy material; anything
 *   shorter (or absent) disables auth endpoints (503), it never weakens them.
 * - Persistence: DATABASE_URL → shared Drizzle/Neon store (multi-instance
 *   safe). No DATABASE_URL in production → fail closed (503). Local dev falls
 *   back to a process-local memory store, clearly marked non-production.
 *
 * Nothing here logs tokens, signatures, nonces, or recipient associations.
 */

import { getDb } from "@/lib/db";
import {
  createDrizzleAuthPersistence,
  createMemoryAuthPersistence,
  type AuthPersistence,
} from "@/lib/auth/persistence";
import {
  createDrizzleRateLimiter,
  createMemoryRateLimiter,
  type AsyncRateLimiter,
} from "@/lib/auth/rate-limit";
import {
  extractSessionToken,
  isSufficientSecret,
  verifySessionToken,
  type SessionClaims,
  type WalletAuthConfig,
} from "@/lib/auth/wallet-auth";

function parseOrigins(): string[] | null {
  const rawList = process.env.APP_ORIGINS;
  if (rawList && rawList.trim()) {
    const origins = rawList.split(",").map((s) => s.trim()).filter(Boolean);
    if (origins.length === 0) return null;
    for (const origin of origins) {
      try {
        const url = new URL(origin);
        if (!url.host) return null;
        if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
          return null;
        }
      } catch {
        return null;
      }
    }
    return origins;
  }
  const domain = process.env.APP_DOMAIN?.trim().toLowerCase();
  if (domain) {
    if (!/^[a-z0-9][a-z0-9.\-]*[a-z0-9]$/.test(domain)) return null;
    return [`https://${domain}`];
  }
  return null;
}

/** Trusted origins, or null when none is configured. Exported for tests. */
export function getTrustedOrigins(): string[] | null {
  return parseOrigins();
}

/** Auth config from env only — never from request headers. Null = misconfigured. */
export function authConfigFromEnv(): WalletAuthConfig | null {
  const secret = process.env.SESSION_SECRET;
  if (!isSufficientSecret(secret)) return null;
  const origins = getTrustedOrigins();
  if (!origins) return null;
  return { origins, sessionSecret: secret };
}

let memoryPersistence: AuthPersistence | null = null;

/**
 * Shared persistence for routes. Production REQUIRES a database: without one
 * this returns null and routes fail closed (503). Dev/test may use memory.
 */
export function getRequestPersistence(): AuthPersistence | null {
  const db = getDb();
  if (db) return createDrizzleAuthPersistence(db);
  if (process.env.NODE_ENV === "production") return null;
  if (!memoryPersistence) memoryPersistence = createMemoryAuthPersistence();
  return memoryPersistence;
}

/** Returns verified claims, or null when no usable session is presented. */
export async function authenticateRequest(
  request: Request,
  config: WalletAuthConfig,
  persistence: AuthPersistence,
): Promise<SessionClaims | null> {
  const token = extractSessionToken(request.headers.get("cookie"));
  if (!token) return null;
  try {
    return await verifySessionToken(config, persistence, { token });
  } catch {
    return null;
  }
}

/**
 * CSRF guard for cookie-authenticated mutations: when the client sends
 * Origin/Referer (browsers always do), it must match the request host.
 * Non-browser clients send neither and are allowed through.
 */
export function isSameOriginRequest(request: Request): boolean {
  const host = requestHost(request);
  if (!host) return false;
  for (const header of ["origin", "referer"]) {
    const value = request.headers.get(header);
    if (!value) continue;
    try {
      if (new URL(value).host.toLowerCase() !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function requestHost(request: Request): string {
  try {
    return new URL(request.url).host.toLowerCase();
  } catch {
    return "";
  }
}

/** Bounded JSON body read. Rejects oversized or malformed payloads. */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; reason: "TOO_LARGE" | "UNREADABLE" | "NOT_JSON" }> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, reason: "TOO_LARGE" };
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, reason: "UNREADABLE" };
  }
  if (new TextEncoder().encode(text).length > maxBytes) {
    return { ok: false, reason: "TOO_LARGE" };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, reason: "NOT_JSON" };
  }
}

/* -------------------------------------------------------------------------- */
/* Per-endpoint shared rate limiters                                          */
/*                                                                            */
/* Limits (unchanged from B2): challenge/verify 10 req/60s per client key;    */
/* session endpoints 60 req/60s. Database-backed when DATABASE_URL is set     */
/* (shared across instances, pruned to current windows); memory otherwise.     */
/* -------------------------------------------------------------------------- */

export type RateLimitKind = "challenge" | "verify" | "session";

const RATE_LIMIT_OPTIONS: Record<RateLimitKind, { windowMs: number; maxRequests: number }> = {
  challenge: { windowMs: 60_000, maxRequests: 10 },
  verify: { windowMs: 60_000, maxRequests: 10 },
  session: { windowMs: 60_000, maxRequests: 60 },
};

const memoryLimiters = new Map<RateLimitKind, AsyncRateLimiter>();

export function getRateLimiter(kind: RateLimitKind): AsyncRateLimiter {
  const db = getDb();
  if (db) {
    return createDrizzleRateLimiter(db, RATE_LIMIT_OPTIONS[kind], `auth:${kind}:`);
  }
  let limiter = memoryLimiters.get(kind);
  if (!limiter) {
    limiter = createMemoryRateLimiter(RATE_LIMIT_OPTIONS[kind]);
    memoryLimiters.set(kind, limiter);
  }
  return limiter;
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return request.headers.get("x-real-ip")?.trim() || "local";
}
