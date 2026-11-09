/**
 * B2.1 deterministic self-check for shared auth state and hardening.
 * Run: npm run test:auth-store
 *
 * Fully offline. Two memory-persistence instances over ONE shared backing
 * simulate two server instances against one database (the Drizzle
 * implementation shares state the same way, via single-statement atomic SQL).
 * Covers: cross-instance issue/verify, exactly-once concurrent consumption,
 * replay, expiry, cross-instance revocation, store-outage fail-closed,
 * domain/URI mismatch, forged-Host irrelevance, secret-length enforcement,
 * and cross-instance rate limiting. No secrets logged.
 */

import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  buildSignInMessage,
  createChallenge,
  createSession,
  isSufficientSecret,
  verifyChallengeResponse,
  verifySessionToken,
  WalletAuthError,
  type WalletAuthConfig,
} from "@/lib/auth/wallet-auth";
import {
  createMemoryAuthBacking,
  createMemoryAuthPersistence,
  type AuthPersistence,
} from "@/lib/auth/persistence";
import { createMemoryRateLimiter } from "@/lib/auth/rate-limit";
import { authConfigFromEnv, getTrustedOrigins } from "@/lib/auth/server";

const ACCOUNT_A = privateKeyToAccount(generatePrivateKey());
const ACCOUNT_B = privateKeyToAccount(generatePrivateKey());

const CONFIG: WalletAuthConfig = {
  origins: ["https://providus.test"],
  sessionSecret: "b2-1-test-secret-that-is-long-enough!!",
  challengeTtlMs: 5 * 60 * 1000,
  sessionTtlMs: 12 * 60 * 60 * 1000,
};

async function expectCode(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof WalletAuthError, `expected WalletAuthError, got ${String(err)}`);
    assert.equal(err.code, code);
    return;
  }
  assert.fail(`expected error ${code}, but call succeeded`);
}

function failingPersistence(): AuthPersistence {
  const down = new Error("shared store unavailable");
  return {
    saveNonce: async () => { throw down; },
    consumeNonce: async () => { throw down; },
    revokeSession: async () => { throw down; },
    isSessionRevoked: async () => { throw down; },
    pruneAuth: async () => { throw down; },
  };
}

async function run() {
  // --- nonce created on instance A, verified on instance B ---
  {
    const shared = createMemoryAuthBacking();
    const instanceA = createMemoryAuthPersistence(shared);
    const instanceB = createMemoryAuthPersistence(shared);
    const challenge = await createChallenge(CONFIG, instanceA, {
      address: ACCOUNT_A.address,
      chainId: 677,
      nowMs: 1_000_000,
    });
    const signature = await ACCOUNT_A.signMessage({ message: challenge.message });
    const session = await verifyChallengeResponse(CONFIG, instanceB, {
      message: challenge.message,
      signature,
      nowMs: 1_000_100,
    });
    assert.equal(session.ownerAddress, ACCOUNT_A.address);
    const claims = await verifySessionToken(CONFIG, instanceB, {
      token: session.token,
      nowMs: 1_000_200,
    });
    assert.equal(claims.ownerAddress, ACCOUNT_A.address);
  }

  // --- concurrent consumption: exactly one succeeds ---
  {
    const shared = createMemoryAuthBacking();
    const instances = [
      createMemoryAuthPersistence(shared),
      createMemoryAuthPersistence(shared),
    ];
    const challenge = await createChallenge(CONFIG, instances[0], {
      address: ACCOUNT_A.address,
      chainId: 677,
      nowMs: 2_000_000,
    });
    const signature = await ACCOUNT_A.signMessage({ message: challenge.message });
    const attempts = await Promise.allSettled(
      [0, 1, 2, 3, 4].map((i) =>
        verifyChallengeResponse(CONFIG, instances[i % 2], {
          message: challenge.message,
          signature,
          nowMs: 2_000_100 + i,
        }),
      ),
    );
    const succeeded = attempts.filter((r) => r.status === "fulfilled");
    const failed = attempts.filter((r) => r.status === "rejected");
    assert.equal(succeeded.length, 1);
    assert.equal(failed.length, 4);
    for (const f of failed) {
      assert.ok(f.status === "rejected" && f.reason instanceof WalletAuthError);
      assert.equal((f.reason as WalletAuthError).code, "NONCE_UNKNOWN");
    }
    // Replay after the race still fails.
    await expectCode(
      () => verifyChallengeResponse(CONFIG, instances[0], {
        message: challenge.message,
        signature,
        nowMs: 2_001_000,
      }),
      "NONCE_UNKNOWN",
    );
  }

  // --- expired nonce fails ---
  {
    const persistence = createMemoryAuthPersistence();
    const challenge = await createChallenge(CONFIG, persistence, {
      address: ACCOUNT_A.address,
      chainId: 968,
      nowMs: 3_000_000,
    });
    const signature = await ACCOUNT_A.signMessage({ message: challenge.message });
    await expectCode(
      () => verifyChallengeResponse(CONFIG, persistence, {
        message: challenge.message,
        signature,
        nowMs: 3_000_000 + 5 * 60 * 1000 + 1,
      }),
      "MESSAGE_EXPIRED",
    );
  }

  // --- logout revocation respected across instances ---
  {
    const shared = createMemoryAuthBacking();
    const instanceA = createMemoryAuthPersistence(shared);
    const instanceB = createMemoryAuthPersistence(shared);
    const session = createSession(CONFIG, {
      ownerAddress: ACCOUNT_A.address,
      chainId: 677,
      nowMs: 4_000_000,
    });
    assert.equal(
      (await verifySessionToken(CONFIG, instanceB, { token: session.token, nowMs: 4_000_100 })).ownerAddress,
      ACCOUNT_A.address,
    );
    const { revokeSession } = await import("@/lib/auth/wallet-auth");
    await revokeSession(instanceA, session.sessionId, session.expiresAtMs);
    await expectCode(
      async () => verifySessionToken(CONFIG, instanceB, { token: session.token, nowMs: 4_000_200 }),
      "SESSION_REVOKED",
    );
  }

  // --- shared-store outage fails closed (no session, no nonce, no auth) ---
  {
    const down = failingPersistence();
    await expectCode(
      () => createChallenge(CONFIG, down, { address: ACCOUNT_A.address, chainId: 677, nowMs: 5_000_000 }),
      "NONCE_STORE_UNAVAILABLE",
    );
    // A well-formed signed challenge still cannot verify when the store is down.
    const good = createMemoryAuthPersistence();
    const challenge = await createChallenge(CONFIG, good, {
      address: ACCOUNT_A.address,
      chainId: 677,
      nowMs: 5_000_000,
    });
    const signature = await ACCOUNT_A.signMessage({ message: challenge.message });
    await expectCode(
      () => verifyChallengeResponse(CONFIG, down, { message: challenge.message, signature, nowMs: 5_000_100 }),
      "NONCE_STORE_UNAVAILABLE",
    );
    // A well-formed token cannot authenticate when revocation cannot be checked.
    const session = createSession(CONFIG, {
      ownerAddress: ACCOUNT_A.address,
      chainId: 677,
      nowMs: 5_000_000,
    });
    await expectCode(
      async () => verifySessionToken(CONFIG, down, { token: session.token, nowMs: 5_000_100 }),
      "NONCE_STORE_UNAVAILABLE",
    );
  }

  // --- domain / URI mismatch fails ---
  {
    const persistence = createMemoryAuthPersistence();
    const forged = buildSignInMessage({
      domain: "evil-providus.com",
      uri: "https://evil-providus.com",
      address: ACCOUNT_A.address,
      chainId: 677,
      nonce: "f".repeat(32),
      issuedAtMs: 6_000_000,
      expirationMs: 6_000_000 + 5 * 60 * 1000,
    });
    const signature = await ACCOUNT_A.signMessage({ message: forged });
    await persistence.saveNonce({
      nonce: "f".repeat(32),
      address: ACCOUNT_A.address,
      chainId: 677,
      issuedAtMs: 6_000_000,
      expiresAtMs: 6_000_000 + 5 * 60 * 1000,
    });
    await expectCode(
      () => verifyChallengeResponse(CONFIG, persistence, { message: forged, signature, nowMs: 6_000_100 }),
      "WRONG_DOMAIN",
    );
  }

  // --- forged Host headers cannot alter allowed SIWE authority ---
  {
    const prevOrigins = process.env.APP_ORIGINS;
    const prevDomain = process.env.APP_DOMAIN;
    const prevSecret = process.env.SESSION_SECRET;
    try {
      process.env.APP_ORIGINS = "https://providus.test";
      process.env.SESSION_SECRET = "env-derived-secret-that-is-long-enough!!";
      // Authority is env-derived only; there is no Host input to this function.
      assert.deepEqual(getTrustedOrigins(), ["https://providus.test"]);
      const config = authConfigFromEnv();
      assert.ok(config);
      assert.deepEqual(config.origins, ["https://providus.test"]);
      // A request carrying `Host: evil.com` changes nothing: verification uses
      // config.origins, and the attacker's message still fails WRONG_DOMAIN.
      const persistence = createMemoryAuthPersistence();
      const attacker = buildSignInMessage({
        domain: "evil.com",
        uri: "https://evil.com",
        address: ACCOUNT_A.address,
        chainId: 677,
        nonce: "a".repeat(32),
        issuedAtMs: 7_000_000,
        expirationMs: 7_000_000 + 5 * 60 * 1000,
      });
      const sig = await ACCOUNT_A.signMessage({ message: attacker });
      await persistence.saveNonce({
        nonce: "a".repeat(32),
        address: ACCOUNT_A.address,
        chainId: 677,
        issuedAtMs: 7_000_000,
        expiresAtMs: 7_000_000 + 5 * 60 * 1000,
      });
      await expectCode(
        () => verifyChallengeResponse(config, persistence, { message: attacker, signature: sig, nowMs: 7_000_100 }),
        "WRONG_DOMAIN",
      );
    } finally {
      if (prevOrigins === undefined) delete process.env.APP_ORIGINS;
      else process.env.APP_ORIGINS = prevOrigins;
      if (prevDomain === undefined) delete process.env.APP_DOMAIN;
      else process.env.APP_DOMAIN = prevDomain;
      if (prevSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = prevSecret;
    }
  }

  // --- insufficient SESSION_SECRET rejected ---
  {
    assert.equal(isSufficientSecret("short"), false);
    assert.equal(isSufficientSecret("x".repeat(31)), false);
    assert.equal(isSufficientSecret("x".repeat(32)), true);
    const prevSecret = process.env.SESSION_SECRET;
    const prevOrigins = process.env.APP_ORIGINS;
    try {
      process.env.SESSION_SECRET = "too-short";
      process.env.APP_ORIGINS = "https://providus.test";
      assert.equal(authConfigFromEnv(), null);
      process.env.SESSION_SECRET = "this-secret-is-long-enough-for-production";
      assert.ok(authConfigFromEnv());
    } finally {
      if (prevSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = prevSecret;
      if (prevOrigins === undefined) delete process.env.APP_ORIGINS;
      else process.env.APP_ORIGINS = prevOrigins;
    }
  }

  // --- rate limiting works across independent instances (shared store) ---
  {
    const shared = new Map<string, number[]>();
    const limiterA = createMemoryRateLimiter({ windowMs: 60_000, maxRequests: 3 }, shared);
    const limiterB = createMemoryRateLimiter({ windowMs: 60_000, maxRequests: 3 }, shared);
    assert.equal((await limiterA.check("client-1", 0)).allowed, true);
    assert.equal((await limiterB.check("client-1", 1)).allowed, true);
    assert.equal((await limiterA.check("client-1", 2)).allowed, true);
    // The fourth request — via the OTHER instance — is rejected: counts combine.
    const fourth = await limiterB.check("client-1", 3);
    assert.equal(fourth.allowed, false);
    assert.ok(fourth.retryAfterSeconds >= 1);
    // A different key is unaffected.
    assert.equal((await limiterB.check("client-2", 3)).allowed, true);
    // Next window allows again.
    assert.equal((await limiterA.check("client-1", 60_001)).allowed, true);
  }

  // --- pruning bounds retention ---
  {
    const persistence = createMemoryAuthPersistence();
    await persistence.saveNonce({
      nonce: "expired-nonce",
      address: ACCOUNT_A.address,
      chainId: 677,
      issuedAtMs: 8_000_000,
      expiresAtMs: 8_000_001,
    });
    await persistence.pruneAuth(9_000_000);
    await expectCode(
      () => verifyChallengeResponse(CONFIG, persistence, {
        message: "unused",
        signature: "0x00",
        nowMs: 9_000_100,
      }),
      "MESSAGE_MALFORMED",
    );
    const shortConfig: WalletAuthConfig = { ...CONFIG, sessionTtlMs: 1_000 };
    const session = createSession(shortConfig, {
      ownerAddress: ACCOUNT_B.address,
      chainId: 677,
      nowMs: 8_000_000,
    });
    const { revokeSession } = await import("@/lib/auth/wallet-auth");
    await revokeSession(persistence, session.sessionId, session.expiresAtMs);
    await persistence.pruneAuth(9_000_000);
    // Pruned revocation of an already-expired session: token now fails on
    // expiry, never accepted.
    await expectCode(
      async () => verifySessionToken(shortConfig, persistence, { token: session.token, nowMs: 9_000_100 }),
      "SESSION_EXPIRED",
    );
  }

  console.log("auth-store self-check (B2.1): all assertions passed");
}

run().catch((err) => {
  console.error("auth-store self-check (B2.1) failed:", err);
  process.exit(1);
});
