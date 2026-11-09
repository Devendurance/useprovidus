/**
 * B2.1 — Shared wallet-auth persistence.
 *
 * Two implementations of one contract:
 * - Memory (`createMemoryAuthPersistence`, optionally over shared backing maps
 *   to simulate two instances against one store) for tests and local dev.
 * - Drizzle/Neon (`createDrizzleAuthPersistence`) for every deployment with a
 *   DATABASE_URL. Single-statement atomic operations only: nonce consumption
 *   is DELETE ... WHERE ... RETURNING (exactly one instance wins a race),
 *   revocation checks are point reads, pruning is bounded by indexed expiry.
 *
 * Fail-closed contract: every method may throw on storage outage, and every
 * caller treats a throw as rejection (no session, no nonce, no auth).
 * Never stores secrets, signatures, or cookies — nonces bind a wallet address
 * for minutes, revocations hold opaque session ids.
 */

import { and, eq, gt, lt } from "drizzle-orm";
import {
  authNonces,
  authRevokedSessions,
  type AuthNonceRow,
} from "@/lib/db/schema";
import type { DbClient } from "@/lib/db";

export type PersistedNonce = {
  nonce: string;
  address: string;
  chainId: number;
  issuedAtMs: number;
  expiresAtMs: number;
};

export type AuthPersistence = {
  /** Store a fresh challenge nonce. */
  saveNonce(record: PersistedNonce): Promise<void>;
  /**
   * Atomic single-use consumption. Returns the record only when it existed,
   * was unexpired, and this call consumed it — otherwise null. Concurrent
   * callers: exactly one gets the record.
   */
  consumeNonce(nonce: string, nowMs: number): Promise<PersistedNonce | null>;
  /** Durable logout: the session id fails closed until its natural expiry. */
  revokeSession(sessionId: string, expiresAtMs: number): Promise<void>;
  isSessionRevoked(sessionId: string, nowMs: number): Promise<boolean>;
  /** Bounded cleanup of expired nonces and revocations. */
  pruneAuth(nowMs: number): Promise<void>;
};

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function rowToNonce(row: AuthNonceRow): PersistedNonce {
  return {
    nonce: row.nonce,
    address: row.address,
    chainId: row.chainId,
    issuedAtMs: Date.parse(row.issuedAt),
    expiresAtMs: Date.parse(row.expiresAt),
  };
}

/* -------------------------------------------------------------------------- */
/* Memory (tests, local dev)                                                  */
/* -------------------------------------------------------------------------- */

export type MemoryAuthBacking = {
  nonces: Map<string, PersistedNonce>;
  revoked: Map<string, number>;
};

export function createMemoryAuthBacking(): MemoryAuthBacking {
  return { nonces: new Map(), revoked: new Map() };
}

/**
 * Pass one backing to two instances to simulate two server instances against
 * one shared store. JS Map ops are synchronous, so consumeNonce is atomic the
 * same way DELETE ... RETURNING is atomic in Postgres.
 */
export function createMemoryAuthPersistence(
  shared: MemoryAuthBacking = createMemoryAuthBacking(),
): AuthPersistence {
  return {
    async saveNonce(record: PersistedNonce): Promise<void> {
      shared.nonces.set(record.nonce, { ...record });
      if (shared.nonces.size > 4_096) {
        for (const [key, value] of shared.nonces) {
          if (value.expiresAtMs <= Date.now()) shared.nonces.delete(key);
        }
      }
    },
    async consumeNonce(nonce: string, nowMs: number): Promise<PersistedNonce | null> {
      const record = shared.nonces.get(nonce);
      if (!record) return null;
      // Single synchronous take: the first concurrent caller wins.
      shared.nonces.delete(nonce);
      if (record.expiresAtMs <= nowMs) return null;
      return { ...record };
    },
    async revokeSession(sessionId: string, expiresAtMs: number): Promise<void> {
      shared.revoked.set(sessionId, expiresAtMs);
    },
    async isSessionRevoked(sessionId: string, nowMs: number): Promise<boolean> {
      const exp = shared.revoked.get(sessionId);
      if (exp === undefined) return false;
      if (exp <= nowMs) {
        shared.revoked.delete(sessionId);
        return false;
      }
      return true;
    },
    async pruneAuth(nowMs: number): Promise<void> {
      for (const [key, value] of shared.nonces) {
        if (value.expiresAtMs <= nowMs) shared.nonces.delete(key);
      }
      for (const [sid, exp] of shared.revoked) {
        if (exp <= nowMs) shared.revoked.delete(sid);
      }
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Drizzle / Neon (shared across instances)                                   */
/* -------------------------------------------------------------------------- */

export function createDrizzleAuthPersistence(db: DbClient): AuthPersistence {
  return {
    async saveNonce(record: PersistedNonce): Promise<void> {
      await db.insert(authNonces).values({
        nonce: record.nonce,
        address: record.address,
        chainId: record.chainId,
        issuedAt: toIso(record.issuedAtMs),
        expiresAt: toIso(record.expiresAtMs),
      });
    },
    async consumeNonce(nonce: string, nowMs: number): Promise<PersistedNonce | null> {
      // Atomic take: the row is deleted and returned in one statement, so of
      // N concurrent instances exactly one receives it. Expired rows are left
      // for pruning and report as unconsumed.
      const taken = await db
        .delete(authNonces)
        .where(and(eq(authNonces.nonce, nonce), gt(authNonces.expiresAt, toIso(nowMs))))
        .returning();
      const row = taken[0];
      return row ? rowToNonce(row) : null;
    },
    async revokeSession(sessionId: string, expiresAtMs: number): Promise<void> {
      await db
        .insert(authRevokedSessions)
        .values({ sessionId, expiresAt: toIso(expiresAtMs) })
        .onConflictDoNothing({ target: authRevokedSessions.sessionId });
    },
    async isSessionRevoked(sessionId: string, nowMs: number): Promise<boolean> {
      const rows = await db
        .select({ expiresAt: authRevokedSessions.expiresAt })
        .from(authRevokedSessions)
        .where(eq(authRevokedSessions.sessionId, sessionId))
        .limit(1);
      const row = rows[0];
      if (!row) return false;
      if (Date.parse(row.expiresAt) <= nowMs) return false;
      return true;
    },
    async pruneAuth(nowMs: number): Promise<void> {
      const cutoff = toIso(nowMs);
      await db.delete(authNonces).where(lt(authNonces.expiresAt, cutoff));
      await db.delete(authRevokedSessions).where(lt(authRevokedSessions.expiresAt, cutoff));
    },
  };
}
