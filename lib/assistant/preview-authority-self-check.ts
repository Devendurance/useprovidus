/**
 * Self-check for the P5 preview authority layer (CRITICAL BUILDER A).
 *
 * Proves, against the real route handlers and both repository
 * implementations:
 *   1. `buildAirtimePreview` persists the complete server quote bound to the
 *      caller's wallet and returns its `prev_${uuid}` identifier; the stored
 *      row carries every contract field, lowercased wallet, and null lifecycle
 *      stamps;
 *   2. `POST /api/assistant/preview` / `GET` require a valid wallet address and
 *      return `{ ok: true, previewId, preview }` with exactly the frozen
 *      ten-field preview;
 *   3. consumption is atomic and single-use: of two concurrent attempts
 *      exactly one succeeds, the loser gets PREVIEW_NOT_USABLE, and the stored
 *      row keeps the winner's transactionId;
 *   3b. a compensating release reopens exactly the row consumed for the named
 *      transaction — never a later consumption — so a failed pre-order insert
 *      can roll a quote back without reopening anything else;
 *   4. an expired preview can never be consumed, and a failed attempt mutates
 *      nothing;
 *   5. a preview cannot be consumed by another wallet, while the same wallet
 *      in different casing is the same wallet;
 *   6. with no database configured outside tests the factory fails closed, and
 *      the route surfaces PREVIEW_STORE_UNAVAILABLE instead of issuing an
 *      unpersisted quote.
 *
 * No live Paycrest calls, no database connection, no wallet or blockchain
 * transactions. Run:
 *   npx tsx --conditions=react-server lib/assistant/preview-authority-self-check.ts
 */

import "server-only";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { getAddress } from "viem";

import { GET, POST } from "@/app/api/assistant/preview/route";
import { buildAirtimePreview } from "@/lib/assistant/preview";
import type { AirtimePreview } from "@/lib/assistant/types";
import {
  DrizzlePreviewRepository,
  InMemoryPreviewRepository,
  getPreviewRepository,
  setPreviewRepositoryForTesting,
  type AirtimePreviewRecordInput,
} from "@/lib/assistant/preview-repository";

// Isolate Paycrest config before any call reads it.
process.env.PAYCREST_API_KEY = "test-key-not-real";
process.env.PAYCREST_BASE_URL = "https://api.paycrest.io/v2";

const AMOUNT_NGN = "500";
const PHONE = "08031234567";
const SELL_RATE = "1500";
/** Exact ceiling inverse quote for 500 NGN at 1500 NGN/USDC. */
const AMOUNT_USDC = "0.333334";

const WALLET = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const WALLET_CHECKSUMMED = getAddress(WALLET);
const OTHER_WALLET = "0x2222222222222222222222222222222222222222";

const FINGERPRINT = createHash("sha256")
  .update(`${AMOUNT_NGN}:${PHONE}:mtn`, "utf8")
  .digest("hex");

const PREVIEW_ID_PATTERN = /^prev_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SELL_CORRIDOR_PAYLOAD = {
  status: "success",
  data: {
    sell: {
      rate: SELL_RATE,
      providerIds: ["provider-1"],
      orderType: "regular",
      refundTimeoutMinutes: 10,
    },
    buy: {
      rate: "1400",
      providerIds: ["provider-1"],
      orderType: "regular",
      refundTimeoutMinutes: 10,
    },
  },
};

/** Corridor-endpoint stub: counts calls, never touches the network. */
function corridorStub(calls: string[], status = 200, body: unknown = SELL_CORRIDOR_PAYLOAD): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function previewUrl(query: string): string {
  return `http://localhost/api/assistant/preview${query}`;
}

/** Quote-shaped row input for repository-level tests. */
function quoteInput(
  overrides: Partial<AirtimePreviewRecordInput> = {},
): AirtimePreviewRecordInput {
  const quotedAt = new Date().toISOString();
  return {
    walletAddress: WALLET,
    intentFingerprint: FINGERPRINT,
    amountNgn: AMOUNT_NGN,
    phone: PHONE,
    network: "mtn",
    rate: SELL_RATE,
    amountUsdc: AMOUNT_USDC,
    feeUsdc: "0",
    totalUsdc: AMOUNT_USDC,
    quotedAt,
    expiresAt: new Date(Date.parse(quotedAt) + 5 * 60_000).toISOString(),
    ...overrides,
  };
}

function assertNoLifecycleStamps(row: {
  consumedAt: string | null;
  transactionId: string | null;
}): void {
  assert.equal(row.consumedAt, null);
  assert.equal(row.transactionId, null);
}

async function run() {
  // NODE_ENV/DATABASE_URL are declared read-only in the ambient Next types, so
  // the checks go through the index signature to isolate this process's env.
  const mutableEnv = process.env as Record<string, string | undefined>;
  const originalNodeEnv = mutableEnv.NODE_ENV;
  const originalDatabaseUrl = mutableEnv.DATABASE_URL;
  const originalFetch = globalThis.fetch;

  const repository = new InMemoryPreviewRepository();
  setPreviewRepositoryForTesting(repository);

  try {
    /* ---------------------------------------------------------------- */
    /* 1. Preview creation persists the complete quote                   */
    /* ---------------------------------------------------------------- */

    const quoteCalls: string[] = [];
    const created = await buildAirtimePreview(
      { amountNgn: AMOUNT_NGN, phone: PHONE, network: "mtn" },
      { fetchFn: corridorStub(quoteCalls), walletAddress: WALLET_CHECKSUMMED },
    );
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error("expected a preview");
    assert.equal(quoteCalls.length, 1);

    assert.equal(PREVIEW_ID_PATTERN.test(created.previewId), true);

    const stored = await repository.findById(created.previewId);
    assert.notEqual(stored, null);
    if (!stored) throw new Error("expected a persisted preview");

    // Every contract field survives persistence, and the wallet is canonical.
    assert.equal(stored.id, created.previewId);
    assert.equal(stored.walletAddress, WALLET.toLowerCase());
    assert.equal(stored.intentFingerprint, created.data.intentFingerprint);
    assert.equal(stored.amountNgn, created.data.amountNgn);
    assert.equal(stored.phone, created.data.phone);
    assert.equal(stored.network, created.data.network);
    assert.equal(stored.rate, created.data.rate);
    assert.equal(stored.amountUsdc, created.data.amountUsdc);
    assert.equal(stored.feeUsdc, created.data.feeUsdc);
    assert.equal(stored.totalUsdc, created.data.totalUsdc);
    assert.equal(stored.quotedAt, created.data.quotedAt);
    assert.equal(stored.expiresAt, created.data.expiresAt);
    assertNoLifecycleStamps(stored);
    assert.equal(Number.isFinite(Date.parse(stored.createdAt)), true);
    assert.equal(
      Date.parse(stored.expiresAt) - Date.parse(stored.quotedAt),
      5 * 60_000,
    );

    // The returned quote is the frozen ten-field contract, with the id kept
    // outside it so no client can mistake a quote field for an identifier.
    assert.deepEqual(
      Object.keys(created.data).sort(),
      [
        "amountNgn",
        "amountUsdc",
        "expiresAt",
        "feeUsdc",
        "intentFingerprint",
        "network",
        "phone",
        "quotedAt",
        "rate",
        "totalUsdc",
      ].sort(),
    );

    // A missing or malformed wallet is rejected before the provider call.
    const guardedCalls: string[] = [];
    const guardedFetch = corridorStub(guardedCalls);
    const noWallet = await buildAirtimePreview(
      { amountNgn: AMOUNT_NGN, phone: PHONE, network: "mtn" },
      { fetchFn: guardedFetch },
    );
    assert.equal(noWallet.ok, false);
    assert.equal(!noWallet.ok && noWallet.error.code, "WALLET_CONTEXT_INVALID");
    assert.equal("data" in noWallet, false);
    assert.equal("previewId" in noWallet, false);

    const badWallet = await buildAirtimePreview(
      { amountNgn: AMOUNT_NGN, phone: PHONE, network: "mtn" },
      { fetchFn: guardedFetch, walletAddress: "not-an-address" },
    );
    assert.equal(badWallet.ok, false);
    assert.equal(!badWallet.ok && badWallet.error.code, "WALLET_CONTEXT_INVALID");
    assert.equal(guardedCalls.length, 0);

    /* ---------------------------------------------------------------- */
    /* 2. Route contract                                                 */
    /* ---------------------------------------------------------------- */

    const routeCalls: string[] = [];
    globalThis.fetch = corridorStub(routeCalls);

    const okResponse = await GET(
      new Request(
        previewUrl(
          `?amountNgn=${AMOUNT_NGN}&phone=${PHONE}&network=mtn&walletAddress=${WALLET_CHECKSUMMED}`,
        ),
      ),
    );
    assert.equal(okResponse.status, 200);
    assert.equal(okResponse.headers.get("cache-control"), "no-store");
    const okBody = (await okResponse.json()) as {
      ok: boolean;
      previewId: string;
      preview: AirtimePreview;
    };
    assert.deepEqual(Object.keys(okBody).sort(), ["ok", "preview", "previewId"]);
    assert.equal(okBody.ok, true);
    assert.equal(PREVIEW_ID_PATTERN.test(okBody.previewId), true);
    assert.equal(okBody.preview.amountNgn, AMOUNT_NGN);
    assert.equal(okBody.preview.amountUsdc, AMOUNT_USDC);
    assert.equal(okBody.preview.totalUsdc, AMOUNT_USDC);
    assert.equal(okBody.preview.rate, SELL_RATE);
    assert.equal(okBody.preview.phone, PHONE);
    assert.equal(okBody.preview.network, "mtn");
    assert.equal(okBody.preview.intentFingerprint, FINGERPRINT);

    const routeStored = await repository.findById(okBody.previewId);
    assert.equal(routeStored?.walletAddress, WALLET);
    assert.equal(routeStored?.intentFingerprint, FINGERPRINT);
    assert.equal(routeStored?.amountUsdc, AMOUNT_USDC);
    assertNoLifecycleStamps(routeStored ?? { consumedAt: null, transactionId: null });

    const postResponse = await POST(
      new Request(previewUrl(""), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amountNgn: AMOUNT_NGN,
          phone: PHONE,
          network: "mtn",
          walletAddress: WALLET_CHECKSUMMED,
        }),
      }),
    );
    assert.equal(postResponse.status, 200);
    const postBody = (await postResponse.json()) as {
      ok: boolean;
      previewId: string;
      preview: AirtimePreview;
    };
    assert.equal(postBody.ok, true);
    assert.equal(PREVIEW_ID_PATTERN.test(postBody.previewId), true);
    assert.equal(postBody.preview.amountNgn, AMOUNT_NGN);
    assert.equal(
      (await repository.findById(postBody.previewId))?.phone,
      PHONE,
    );

    const missingWalletResponse = await GET(
      new Request(previewUrl(`?amountNgn=${AMOUNT_NGN}&phone=${PHONE}&network=mtn`)),
    );
    assert.equal(missingWalletResponse.status, 400);
    const missingWalletBody = (await missingWalletResponse.json()) as {
      ok: boolean;
      error: { code: string };
      preview?: unknown;
      previewId?: unknown;
    };
    assert.equal(missingWalletBody.ok, false);
    assert.equal(missingWalletBody.error.code, "WALLET_CONTEXT_INVALID");
    assert.equal("preview" in missingWalletBody, false);
    assert.equal("previewId" in missingWalletBody, false);

    const invalidWalletResponse = await POST(
      new Request(previewUrl(""), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amountNgn: AMOUNT_NGN,
          phone: PHONE,
          network: "mtn",
          walletAddress: "0xnothex",
        }),
      }),
    );
    assert.equal(invalidWalletResponse.status, 400);
    assert.equal(
      ((await invalidWalletResponse.json()) as { error: { code: string } }).error
        .code,
      "WALLET_CONTEXT_INVALID",
    );

    globalThis.fetch = originalFetch;

    /* ---------------------------------------------------------------- */
    /* 3. Atomic single-use consumption                                  */
    /* ---------------------------------------------------------------- */

    const atomic = await repository.createPreview(quoteInput());
    assert.equal(atomic.ok, true);
    if (!atomic.ok) throw new Error("expected a persisted preview");
    const atomicId = atomic.preview.id;

    const [first, second] = await Promise.all([
      repository.consumePreview(atomicId, WALLET, "trx_first"),
      repository.consumePreview(atomicId, WALLET, "trx_second"),
    ]);
    assert.equal([first.ok, second.ok].filter(Boolean).length, 1);

    const winner = first.ok ? first : second;
    const loser = first.ok ? second : first;
    assert.equal(winner.ok, true);
    assert.equal(loser.ok, false);
    assert.equal(!loser.ok && loser.code, "PREVIEW_NOT_USABLE");
    if (!winner.ok) throw new Error("expected a consumed preview");
    assert.equal(winner.preview.id, atomicId);
    assert.equal(
      winner.preview.consumedAt === null,
      false,
      "consumption must stamp consumedAt",
    );
    assert.equal(winner.preview.transactionId, first.ok ? "trx_first" : "trx_second");
    assert.equal(Number.isFinite(Date.parse(winner.preview.consumedAt ?? "")), true);

    // The loser must not have rewritten the winner's transaction binding.
    const afterRace = await repository.findById(atomicId);
    assert.equal(afterRace?.transactionId, winner.preview.transactionId);
    assert.equal(afterRace?.consumedAt, winner.preview.consumedAt);

    // A later attempt is still refused, with the same terminal stamp.
    const replay = await repository.consumePreview(atomicId, WALLET, "trx_third");
    assert.equal(replay.ok, false);
    assert.equal(!replay.ok && replay.code, "PREVIEW_NOT_USABLE");
    const afterReplay = await repository.findById(atomicId);
    assert.equal(afterReplay?.transactionId, winner.preview.transactionId);
    assert.equal(afterReplay?.consumedAt, winner.preview.consumedAt);

    // Unknown identifiers are refused the same way.
    const unknown = await repository.consumePreview(
      `prev_${"0".repeat(36)}`,
      WALLET,
      "trx_unknown",
    );
    assert.equal(unknown.ok, false);
    assert.equal(!unknown.ok && unknown.code, "PREVIEW_NOT_USABLE");
    assert.equal(await repository.findById(`prev_${"0".repeat(36)}`), null);

    /* ---------------------------------------------------------------- */
    /* 3b. Compensating release                                          */
    /* ---------------------------------------------------------------- */

    const releasable = await repository.createPreview(quoteInput());
    assert.equal(releasable.ok, true);
    if (!releasable.ok) throw new Error("expected a persisted preview");

    const releasableConsume = await repository.consumePreview(
      releasable.preview.id,
      WALLET,
      "trx_release_me",
    );
    assert.equal(releasableConsume.ok, true);

    // A release naming any other transaction is refused and mutates nothing:
    // this is what makes the rollback safe to call blindly.
    assert.equal(
      await repository.releasePreview(releasable.preview.id, "trx_other"),
      false,
    );
    const notReleasedByForeignId = await repository.findById(releasable.preview.id);
    assert.equal(notReleasedByForeignId?.transactionId, "trx_release_me");
    assert.equal(notReleasedByForeignId?.consumedAt === null, false);

    // The matching release restores the pre-consumption row exactly.
    assert.equal(
      await repository.releasePreview(releasable.preview.id, "trx_release_me"),
      true,
    );
    assertNoLifecycleStamps(
      (await repository.findById(releasable.preview.id)) ?? {
        consumedAt: null,
        transactionId: null,
      },
    );

    // The quote is genuinely usable again — and only once.
    const reused = await repository.consumePreview(
      releasable.preview.id,
      WALLET,
      "trx_retry",
    );
    assert.equal(reused.ok, true);
    if (!reused.ok) throw new Error("expected a re-consumable preview");
    assert.equal(reused.preview.transactionId, "trx_retry");

    // Releasing the superseded attempt is a no-op: it can never steal the row
    // back from the consumption that now owns it.
    assert.equal(
      await repository.releasePreview(releasable.preview.id, "trx_release_me"),
      false,
    );
    const afterStaleRelease = await repository.findById(releasable.preview.id);
    assert.equal(afterStaleRelease?.transactionId, "trx_retry");
    assert.equal(afterStaleRelease?.consumedAt === null, false);

    // Unknown preview identifiers are never reported as released.
    assert.equal(
      await repository.releasePreview(`prev_${"0".repeat(36)}`, "trx_missing"),
      false,
    );

    /* ---------------------------------------------------------------- */
    /* 4. Expiry                                                         */
    /* ---------------------------------------------------------------- */

    const expiredQuotedAt = new Date(Date.now() - 6 * 60_000).toISOString();
    const expired = await repository.createPreview(
      quoteInput({
        quotedAt: expiredQuotedAt,
        expiresAt: new Date(Date.parse(expiredQuotedAt) + 5 * 60_000).toISOString(),
      }),
    );
    assert.equal(expired.ok, true);
    if (!expired.ok) throw new Error("expected a persisted preview");

    const expiredConsume = await repository.consumePreview(
      expired.preview.id,
      WALLET,
      "trx_expired",
    );
    assert.equal(expiredConsume.ok, false);
    assert.equal(
      !expiredConsume.ok && expiredConsume.code,
      "PREVIEW_NOT_USABLE",
    );

    // Refusal must not have touched the row.
    const expiredAfter = await repository.findById(expired.preview.id);
    assertNoLifecycleStamps(
      expiredAfter ?? { consumedAt: null, transactionId: null },
    );

    // A sibling preview that is still fresh consumes normally.
    const fresh = await repository.createPreview(quoteInput());
    assert.equal(fresh.ok, true);
    if (!fresh.ok) throw new Error("expected a persisted preview");
    const freshConsume = await repository.consumePreview(
      fresh.preview.id,
      WALLET,
      "trx_fresh",
    );
    assert.equal(freshConsume.ok, true);

    /* ---------------------------------------------------------------- */
    /* 5. Wallet binding                                                 */
    /* ---------------------------------------------------------------- */

    const bound = await repository.createPreview(quoteInput());
    assert.equal(bound.ok, true);
    if (!bound.ok) throw new Error("expected a persisted preview");

    const foreign = await repository.consumePreview(
      bound.preview.id,
      OTHER_WALLET,
      "trx_foreign",
    );
    assert.equal(foreign.ok, false);
    assert.equal(!foreign.ok && foreign.code, "PREVIEW_NOT_USABLE");
    const afterForeign = await repository.findById(bound.preview.id);
    assertNoLifecycleStamps(
      afterForeign ?? { consumedAt: null, transactionId: null },
    );

    // Same wallet, different casing: the preview is bound to an identity, not
    // to a spelling of it (and the stored row is lowercased).
    assert.equal(bound.preview.walletAddress, WALLET);
    const own = await repository.consumePreview(
      bound.preview.id,
      WALLET_CHECKSUMMED,
      "trx_own",
    );
    assert.equal(own.ok, true);
    assert.equal(own.ok && own.preview.transactionId, "trx_own");

    /* ---------------------------------------------------------------- */
    /* 6. Fail closed when no database is configured                     */
    /* ---------------------------------------------------------------- */

    delete mutableEnv.DATABASE_URL;
    mutableEnv.NODE_ENV = "production";
    setPreviewRepositoryForTesting(null);

    const failClosed = getPreviewRepository();
    const failClosedCreate = await failClosed.createPreview(quoteInput());
    assert.equal(failClosedCreate.ok, false);
    assert.equal(
      !failClosedCreate.ok && failClosedCreate.code,
      "PREVIEW_STORE_UNAVAILABLE",
    );
    const failClosedConsume = await failClosed.consumePreview(
      `prev_${"0".repeat(36)}`,
      WALLET,
      "trx_missing_store",
    );
    assert.equal(failClosedConsume.ok, false);
    assert.equal(
      !failClosedConsume.ok && failClosedConsume.code,
      "PREVIEW_STORE_UNAVAILABLE",
    );
    assert.equal(
      await failClosed.releasePreview(
        `prev_${"0".repeat(36)}`,
        "trx_missing_store",
      ),
      false,
    );
    assert.equal(await failClosed.findById(`prev_${"0".repeat(36)}`), null);

    const storeCalls: string[] = [];
    globalThis.fetch = corridorStub(storeCalls);
    const storeUnavailable = await GET(
      new Request(
        previewUrl(
          `?amountNgn=${AMOUNT_NGN}&phone=${PHONE}&network=mtn&walletAddress=${WALLET}`,
        ),
      ),
    );
    assert.equal(storeUnavailable.status, 503);
    const storeUnavailableBody = (await storeUnavailable.json()) as {
      ok: boolean;
      error: { code: string; retryable?: boolean };
      preview?: unknown;
      previewId?: unknown;
    };
    assert.equal(storeUnavailableBody.ok, false);
    assert.equal(
      storeUnavailableBody.error.code,
      "PREVIEW_STORE_UNAVAILABLE",
    );
    assert.equal(storeUnavailableBody.error.retryable, true);
    assert.equal("preview" in storeUnavailableBody, false);
    assert.equal("previewId" in storeUnavailableBody, false);

    // With a database configured, the factory wires the Postgres repository
    // (the client itself is lazy; no connection is opened here).
    setPreviewRepositoryForTesting(null);
    mutableEnv.DATABASE_URL =
      "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
    assert.equal(
      getPreviewRepository() instanceof DrizzlePreviewRepository,
      true,
      "a configured DATABASE_URL must select the Drizzle repository",
    );

    console.log("preview authority self-check: all assertions passed");
  } finally {
    globalThis.fetch = originalFetch;
    setPreviewRepositoryForTesting(null);
    repository.clear();
    if (originalNodeEnv === undefined) {
      delete mutableEnv.NODE_ENV;
    } else {
      mutableEnv.NODE_ENV = originalNodeEnv;
    }
    if (originalDatabaseUrl === undefined) {
      delete mutableEnv.DATABASE_URL;
    } else {
      mutableEnv.DATABASE_URL = originalDatabaseUrl;
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
