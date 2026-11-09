/**
 * B2/B2.1 deterministic self-check for wallet-signature authentication.
 * Run: npm run test:auth
 *
 * Fully offline: signatures use throwaway local test keys (never real funds,
 * never any network). Persistence is the shared-backing memory implementation.
 * No secrets logged.
 */

import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  createChallenge,
  createSession,
  extractSessionToken,
  parseSignInMessage,
  revokeSession,
  verifyChallengeResponse,
  verifySessionToken,
  WalletAuthError,
  type WalletAuthConfig,
} from "@/lib/auth/wallet-auth";
import { createMemoryAuthPersistence } from "@/lib/auth/persistence";
import { createMemoryRateLimiter } from "@/lib/auth/rate-limit";

// Throwaway local test keys, generated fresh per run. No value, no network use.
const ACCOUNT_A = privateKeyToAccount(generatePrivateKey());
const ACCOUNT_B = privateKeyToAccount(generatePrivateKey());

const CONFIG: WalletAuthConfig = {
  origins: ["https://providus.test"],
  sessionSecret: "test-secret-that-is-long-enough-for-hmac",
  challengeTtlMs: 5 * 60 * 1000,
  sessionTtlMs: 12 * 60 * 60 * 1000,
};

async function expectCode(
  fn: () => Promise<unknown> | unknown,
  code: string,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof WalletAuthError, `expected WalletAuthError, got ${String(err)}`);
    assert.equal(err.code, code);
    return;
  }
  assert.fail(`expected error ${code}, but call succeeded`);
}

async function run() {
  // --- valid wallet authentication ---
  {
    const persistence = createMemoryAuthPersistence();
    const challenge = await createChallenge(CONFIG, persistence, {
      address: ACCOUNT_A.address,
      chainId: 677,
      nowMs: 1_000_000,
    });
    assert.ok(challenge.message.includes("providus.test"));
    assert.ok(challenge.message.includes("Chain ID: 677"));
    const parsed = parseSignInMessage(challenge.message);
    assert.equal(parsed.address, ACCOUNT_A.address);
    assert.equal(parsed.chainId, 677);

    const signature = await ACCOUNT_A.signMessage({ message: challenge.message });
    const session = await verifyChallengeResponse(CONFIG, persistence, {
      message: challenge.message,
      signature,
      nowMs: 1_000_100,
    });
    assert.equal(session.ownerAddress, ACCOUNT_A.address);
    assert.equal(session.chainId, 677);

    const claims = await verifySessionToken(CONFIG, persistence, {
      token: session.token,
      nowMs: 1_000_200,
    });
    assert.equal(claims.ownerAddress, ACCOUNT_A.address);
    assert.equal(claims.sessionId, session.sessionId);
  }

  // --- invalid signature (tampered s-value) ---
  {
    const persistence = createMemoryAuthPersistence();
    const challenge = await createChallenge(CONFIG, persistence, {
      address: ACCOUNT_A.address,
      chainId: 677,
      nowMs: 2_000_000,
    });
    const signature = await ACCOUNT_A.signMessage({ message: challenge.message });
    // Flip a nibble inside `s`. Note: flipping only the final `v` byte
    // (27 <-> 0) is a no-op in viem's parity normalization, so the tamper
    // must touch r/s to be meaningful.
    const pos = 20;
    const tampered =
      signature.slice(0, pos) +
      (signature[pos] === "0" ? "1" : "0") +
      signature.slice(pos + 1);
    await expectCode(
      () => verifyChallengeResponse(CONFIG, persistence, { message: challenge.message, signature: tampered, nowMs: 2_000_100 }),
      "SIGNATURE_INVALID",
    );
  }

  // --- wrong wallet: B signs A's challenge ---
  {
    const persistence = createMemoryAuthPersistence();
    const challenge = await createChallenge(CONFIG, persistence, {
      address: ACCOUNT_A.address,
      chainId: 677,
      nowMs: 3_000_000,
    });
    const wrongSig = await ACCOUNT_B.signMessage({ message: challenge.message });
    await expectCode(
      () => verifyChallengeResponse(CONFIG, persistence, { message: challenge.message, signature: wrongSig, nowMs: 3_000_100 }),
      "SIGNATURE_INVALID",
    );
  }

  // --- stolen/replayed nonce: second verify fails closed ---
  {
    const persistence = createMemoryAuthPersistence();
    const challenge = await createChallenge(CONFIG, persistence, {
      address: ACCOUNT_A.address,
      chainId: 677,
      nowMs: 4_000_000,
    });
    const signature = await ACCOUNT_A.signMessage({ message: challenge.message });
    await verifyChallengeResponse(CONFIG, persistence, { message: challenge.message, signature, nowMs: 4_000_100 });
    await expectCode(
      () => verifyChallengeResponse(CONFIG, persistence, { message: challenge.message, signature, nowMs: 4_000_200 }),
      "NONCE_UNKNOWN",
    );
  }

  // --- expired challenge (message validity window fires first) ---
  {
    const persistence = createMemoryAuthPersistence();
    const challenge = await createChallenge(CONFIG, persistence, {
      address: ACCOUNT_A.address,
      chainId: 677,
      nowMs: 5_000_000,
    });
    const signature = await ACCOUNT_A.signMessage({ message: challenge.message });
    await expectCode(
      () => verifyChallengeResponse(CONFIG, persistence, {
        message: challenge.message,
        signature,
        nowMs: 5_000_000 + 5 * 60 * 1000 + 1,
      }),
      "MESSAGE_EXPIRED",
    );
  }

  // --- expired nonce record with a still-valid message window ---
  {
    const persistence = createMemoryAuthPersistence();
    const long: WalletAuthConfig = { ...CONFIG, challengeTtlMs: 60 * 60 * 1000 };
    const challenge = await createChallenge(long, persistence, {
      address: ACCOUNT_A.address,
      chainId: 677,
      nowMs: 5_100_000,
    });
    const signature = await ACCOUNT_A.signMessage({ message: challenge.message });
    const record = await persistence.consumeNonce(challenge.nonce, 5_100_000);
    assert.ok(record);
    // Re-store as already-expired: consumption must now report unknown.
    await persistence.saveNonce({ ...record, expiresAtMs: 5_100_001 });
    await expectCode(
      () => verifyChallengeResponse(long, persistence, {
        message: challenge.message,
        signature,
        nowMs: 5_100_100,
      }),
      "NONCE_UNKNOWN",
    );
  }

  // --- expired message validity window (message-level, not store-level) ---
  {
    const persistence = createMemoryAuthPersistence();
    const short: WalletAuthConfig = { ...CONFIG, challengeTtlMs: 60 * 1000 };
    const challenge = await createChallenge(short, persistence, {
      address: ACCOUNT_A.address,
      chainId: 968,
      nowMs: 6_000_000,
    });
    const signature = await ACCOUNT_A.signMessage({ message: challenge.message });
    await expectCode(
      () => verifyChallengeResponse(short, persistence, {
        message: challenge.message,
        signature,
        nowMs: 6_000_000 + 60 * 1000 + 1,
      }),
      "MESSAGE_EXPIRED",
    );
  }

  // --- wrong domain ---
  {
    const persistence = createMemoryAuthPersistence();
    const challenge = await createChallenge(CONFIG, persistence, {
      address: ACCOUNT_A.address,
      chainId: 677,
      nowMs: 7_000_000,
    });
    const signature = await ACCOUNT_A.signMessage({ message: challenge.message });
    const evil: WalletAuthConfig = { ...CONFIG, origins: ["https://evil.example"] };
    await expectCode(
      () => verifyChallengeResponse(evil, persistence, { message: challenge.message, signature, nowMs: 7_000_100 }),
      "WRONG_DOMAIN",
    );
    // Original domain still verifies (nonce intact — domain check precedes consume).
    const ok = await verifyChallengeResponse(CONFIG, persistence, {
      message: challenge.message,
      signature,
      nowMs: 7_000_100,
    });
    assert.equal(ok.ownerAddress, ACCOUNT_A.address);
  }

  // --- malformed message / signature shapes ---
  {
    const persistence = createMemoryAuthPersistence();
    await expectCode(
      () => verifyChallengeResponse(CONFIG, persistence, { message: "hello", signature: "0x1234", nowMs: 8_000_000 }),
      "MESSAGE_MALFORMED",
    );
  }

  // --- unsupported chain at challenge time ---
  {
    const persistence = createMemoryAuthPersistence();
    await expectCode(
      () => createChallenge(CONFIG, persistence, { address: ACCOUNT_A.address, chainId: 1, nowMs: 9_000_000 }),
      "UNSUPPORTED_CHAIN",
    );
    await expectCode(
      () => createChallenge(CONFIG, persistence, { address: "not-an-address", chainId: 677, nowMs: 9_000_000 }),
      "INVALID_ADDRESS",
    );
  }

  // --- session expiry ---
  {
    const persistence = createMemoryAuthPersistence();
    const short: WalletAuthConfig = { ...CONFIG, sessionTtlMs: 1_000 };
    const session = createSession(short, {
      ownerAddress: ACCOUNT_A.address,
      chainId: 677,
      nowMs: 10_000_000,
    });
    const claims = await verifySessionToken(short, persistence, { token: session.token, nowMs: 10_000_500 });
    assert.equal(claims.ownerAddress, ACCOUNT_A.address);
    await expectCode(
      async () => verifySessionToken(short, persistence, { token: session.token, nowMs: 10_001_001 }),
      "SESSION_EXPIRED",
    );
  }

  // --- logout / revocation ---
  {
    const persistence = createMemoryAuthPersistence();
    const session = createSession(CONFIG, {
      ownerAddress: ACCOUNT_A.address,
      chainId: 677,
      nowMs: 11_000_000,
    });
    await revokeSession(persistence, session.sessionId, session.expiresAtMs);
    await expectCode(
      async () => verifySessionToken(CONFIG, persistence, { token: session.token, nowMs: 11_000_100 }),
      "SESSION_REVOKED",
    );
  }

  // --- tampered + unauthenticated tokens ---
  {
    const persistence = createMemoryAuthPersistence();
    const session = createSession(CONFIG, {
      ownerAddress: ACCOUNT_A.address,
      chainId: 677,
      nowMs: 12_000_000,
    });
    await expectCode(
      async () => verifySessionToken(CONFIG, persistence, { token: session.token.slice(0, -2) + "ab", nowMs: 12_000_100 }),
      "SESSION_MALFORMED",
    );
    await expectCode(
      async () => verifySessionToken(CONFIG, persistence, { token: null, nowMs: 12_000_100 }),
      "SESSION_MALFORMED",
    );
    await expectCode(
      async () => verifySessionToken(CONFIG, persistence, { token: "no-dot-here", nowMs: 12_000_100 }),
      "SESSION_MALFORMED",
    );
    // Wrong secret fails closed.
    await expectCode(
      async () => verifySessionToken({ ...CONFIG, sessionSecret: "wrong-secret-that-is-still-long-enough!!" }, persistence, {
        token: session.token,
        nowMs: 12_000_100,
      }),
      "SESSION_MALFORMED",
    );
  }

  // --- wallet switch: ownership always derives from the presented token ---
  {
    const persistence = createMemoryAuthPersistence();
    const sessionA = createSession(CONFIG, { ownerAddress: ACCOUNT_A.address, chainId: 677, nowMs: 13_000_000 });
    const sessionB = createSession(CONFIG, { ownerAddress: ACCOUNT_B.address, chainId: 677, nowMs: 13_000_100 });
    const claimsA = await verifySessionToken(CONFIG, persistence, { token: sessionA.token, nowMs: 13_000_200 });
    const claimsB = await verifySessionToken(CONFIG, persistence, { token: sessionB.token, nowMs: 13_000_200 });
    assert.notEqual(claimsA.ownerAddress, claimsB.ownerAddress);
    assert.equal(claimsB.ownerAddress, ACCOUNT_B.address);
    // Logging in as B never grants A's identity: each token carries its own sub.
    assert.equal(claimsA.sessionId !== claimsB.sessionId, true);
  }

  // --- cookie helpers ---
  {
    const header = `other=1; ${extractSessionToken("other=1; providus_session=tok123; x=2")}`;
    assert.equal(header, "other=1; tok123");
    assert.equal(extractSessionToken(null), null);
    assert.equal(extractSessionToken("providus_session=; x=1"), null);
  }

  // --- rate limiter shape (async, shared-capable) ---
  {
    const limiter = createMemoryRateLimiter({ windowMs: 60_000, maxRequests: 2 });
    assert.equal((await limiter.check("ip", 0)).allowed, true);
    assert.equal((await limiter.check("ip", 1)).allowed, true);
    const third = await limiter.check("ip", 2);
    assert.equal(third.allowed, false);
    assert.ok(third.retryAfterSeconds >= 1);
    assert.equal((await limiter.check("other", 2)).allowed, true);
  }

  console.log("auth self-check (B2): all assertions passed");
}

run().catch((err) => {
  console.error("auth self-check (B2) failed:", err);
  process.exit(1);
});
