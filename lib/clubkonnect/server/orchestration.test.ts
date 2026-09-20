/**
 * P6 ClubKonnect airtime fulfilment self-check.
 *
 * Proves the safety-critical properties of purchase execution, orchestration,
 * and reconciliation, with every provider call served by a scripted stub:
 *
 *   1. only numeric statuscode 200 completes a transaction;
 *   2. 100 / 300 stay in flight and never complete;
 *   3. 201 (and every unreadable answer) is an unknown outcome that requires
 *      reconciliation, never completes, and is never re-purchased;
 *   4. 417 fails the transaction without inventing a refund;
 *   5. a duplicate fulfil call reconciles and never executes a second purchase
 *      (the attempt counter stays at 1);
 *   6. a non-settled or non-airtime transaction is rejected before any provider
 *      call, and the fulfilment route ignores client-supplied purchase fields;
 *   7. reconciliation through the read-only Query API advances state;
 *   8. an answer bound to a different RequestID is never applied, even when it
 *      reports statuscode 200 — it stays in flight requiring reconciliation;
 *   9. a float check that cannot be read is never exhaustion: the check runs
 *      before the reservation, so the row stays settled and untouched, the
 *      next call retries the check and then purchases exactly once, and no
 *      purchase is ever attempted without a readable float; and
 *  10. a provider answer that cannot be persisted — whether the write reports a
 *      failure or throws — is reported as requiring reconciliation on the
 *      returned snapshot itself;
 *  11. a settled row is only spendable once Paycrest confirmed fiat delivery
 *      (validated / settled): a stale or missing milestone is rejected before
 *      any float read, reservation, attempt claim, or provider call; and
 *  12. a provider answer — purchase or Query API — that does not echo the
 *      expected RequestID is never applied, not even when it reports 200, and
 *      leaves the transaction requiring reconciliation.
 *
 * Run: npx tsx --conditions=react-server lib/clubkonnect/server/orchestration.test.ts
 */

import assert from "node:assert/strict";
import { POST } from "@/app/api/transactions/[id]/fulfil/route";
import { executeClubKonnectAirtimePurchase } from "@/lib/clubkonnect/server/client";
import { fulfilAirtimeOrder } from "@/lib/clubkonnect/server/orchestration";
import { reconcileAirtimeFulfilment } from "@/lib/clubkonnect/server/reconciliation";
import { buildClubKonnectRequestId } from "@/lib/clubkonnect/server/status";
import {
  InMemoryTransactionRepository,
  setTransactionRepositoryForTesting,
  toPublicTransactionDto,
  type CreateTransactionInput,
  type FulfilmentMutationResult,
  type TransactionRecord,
} from "@/lib/transactions";
import { computeTransactionStage } from "@/lib/transactions/status";

// Provider credentials for the scripted stub. These values must never appear in
// persisted state or error text; the assertions below check exactly that.
const USER_ID = "test_user_id";
const API_KEY = "test_api_key_secret";
process.env.CLUBKONNECT_USER_ID = USER_ID;
process.env.CLUBKONNECT_API_KEY = API_KEY;
process.env.CLUBKONNECT_BASE_URL = "https://www.nellobytesystems.com";

const TX_ID = "tx_p6_airtime_0001";
const PHONE = "08031234567";
const AMOUNT_NGN = "500";
const REQUEST_ID = buildClubKonnectRequestId(TX_ID);
const ORDER_ID = "CK-ORDER-1";

const AIRTIME_ENDPOINT = "APIAirtimeV1.asp";
const QUERY_ENDPOINT = "APIQueryV1.asp";
const BALANCE_ENDPOINT = "APIWalletBalanceV1.asp";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A realistic purchase answer; the status TEXT is only a hint, never proof. */
function purchaseResponse(
  statuscode: string | number,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse({
    status: "ORDER_COMPLETED",
    statuscode,
    orderid: ORDER_ID,
    requestid: REQUEST_ID,
    ...extra,
  });
}

function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

interface EndpointSpec {
  /** Wallet balance in NGN, or null to make the balance check fail. */
  balance?: string | null;
  /** Overrides the balance answer, e.g. to make the check unreadable. */
  balanceResponse?: () => Response;
  purchase?: () => Response;
  query?: () => Response;
}

/** Routes each ClubKonnect stub request to its endpoint, failing on surprises. */
function clubKonnectStub(spec: EndpointSpec): (url: string) => Response {
  return (url) => {
    if (url.includes(BALANCE_ENDPOINT)) {
      if (spec.balanceResponse) return spec.balanceResponse();
      return spec.balance === null
        ? jsonResponse({ statuscode: "503", msg: "balance unavailable" }, 503)
        : jsonResponse({ statuscode: "200", walletbalance: spec.balance ?? "500000" });
    }
    if (url.includes(AIRTIME_ENDPOINT)) {
      if (!spec.purchase) {
        throw new Error("unexpected ClubKonnect purchase call");
      }
      return spec.purchase();
    }
    if (url.includes(QUERY_ENDPOINT)) {
      if (!spec.query) {
        throw new Error("unexpected ClubKonnect query call");
      }
      return spec.query();
    }
    throw new Error(`unexpected ClubKonnect endpoint: ${url}`);
  };
}

/** Replaces global fetch with the stub, recording every request URL. */
function installFetchStub(
  handler: (url: string) => Response,
  calls: string[] = [],
): string[] {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push(url);
    return handler(url);
  }) as typeof fetch;
  return calls;
}

function endpointCalls(calls: string[], endpoint: string): string[] {
  return calls.filter((url) => url.includes(endpoint));
}

/** Seeds one settled airtime transaction with authoritative metadata. */
async function seedSettledAirtime(
  repo: InMemoryTransactionRepository,
  overrides: Partial<CreateTransactionInput> = {},
): Promise<string> {
  const created = await repo.create({
    id: TX_ID,
    idempotencyKey: "idem_p6_airtime_0001",
    type: "airtime",
    walletAddress: "0x21e5fc03e4305cc8cfb874253c6d66a8bdb0bcda",
    amountUsdc: "0.500000",
    amountNgn: AMOUNT_NGN,
    paycrestReference: "ref_p6_airtime_0001",
    metadata: {
      phone: PHONE,
      network: "mtn",
      rate: "1500",
      totalUsdcToSend: "0.500000",
    },
    ...overrides,
  });
  if (!created.ok) assert.fail(`seed failed: ${created.message}`);

  const settling = await repo.updateStatus(created.record.id, {
    status: "settling",
    paycrestStatus: "deposited",
  });
  if (!settling.ok) assert.fail(`seed settling failed: ${settling.message}`);

  const settled = await repo.updateStatus(created.record.id, {
    status: "settled",
    paycrestStatus: "validated",
  });
  if (!settled.ok) assert.fail(`seed settled failed: ${settled.message}`);

  return created.record.id;
}

async function loadRecord(
  repo: InMemoryTransactionRepository,
  id: string,
): Promise<TransactionRecord> {
  const record = await repo.findById(id);
  if (!record) assert.fail(`transaction ${id} disappeared`);
  return record;
}

/**
 * A repository whose outcome write always fails, standing in for a database
 * error between the purchase and the persisted answer.
 */
class PersistenceFailingRepository extends InMemoryTransactionRepository {
  override async recordAirtimeFulfilmentOutcome(): Promise<FulfilmentMutationResult> {
    return {
      ok: false,
      error: "DATABASE_UNAVAILABLE",
      code: "DATABASE_UNAVAILABLE",
      message: "Simulated write failure",
    };
  }
}

/** A repository whose outcome write throws, as a dropped connection would. */
class ThrowingPersistenceRepository extends InMemoryTransactionRepository {
  override async recordAirtimeFulfilmentOutcome(): Promise<FulfilmentMutationResult> {
    throw new Error("connection terminated unexpectedly");
  }
}

/**
 * Supplies one terminal cash-out row. A completed cash-out cannot be produced
 * through the repository's own transition table ('settled' is terminal for
 * cash_out), so the snapshot is handed to the orchestration directly.
 */
class CompletedCashOutRepository extends InMemoryTransactionRepository {
  override async findById(): Promise<TransactionRecord> {
    const timestamp = new Date().toISOString();
    return {
      id: TX_ID,
      idempotencyKey: "idem_p6_cashout_completed",
      type: "cash_out",
      status: "completed",
      walletAddress: "0x21e5fc03e4305cc8cfb874253c6d66a8bdb0bcda",
      amountUsdc: "0.500000",
      amountNgn: AMOUNT_NGN,
      celoTxHash: "0xabc",
      paycrestOrderId: "ord_p6_cashout_completed",
      paycrestReference: "ref_p6_cashout_completed",
      paycrestStatus: null,
      receiveAddress: null,
      validUntil: null,
      failureCode: null,
      failureReason: null,
      metadata: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
}

/**
 * Presents the stored row as if its Paycrest milestone were never persisted —
 * the shape a row written by an older path can have. The internal status is a
 * genuine `settled`, produced by the normal seed helper.
 */
class SettledAirtimeWithoutPaycrestMilestoneRepository extends InMemoryTransactionRepository {
  override async findById(id: string): Promise<TransactionRecord | null> {
    const record = await super.findById(id);
    return record ? { ...record, paycrestStatus: null } : null;
  }
}

/** Runs one scenario with its own fetch stub, always restoring the real one. */
async function scenario(name: string, body: () => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch;
  try {
    await body();
    console.log(`  ok: ${name}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function run() {
  console.log("P6 ClubKonnect airtime fulfilment self-check");

  /* ------------------------------------------------------------------ */
  await scenario("statuscode 200 completes the transaction once", async () => {
    const repo = new InMemoryTransactionRepository();
    const txId = await seedSettledAirtime(repo);
    const calls = installFetchStub(
      clubKonnectStub({ purchase: () => purchaseResponse("200") }),
    );

    const result = await fulfilAirtimeOrder(txId, { repository: repo });
    if (!result.ok) assert.fail(`fulfil failed: ${result.code} ${result.message}`);
    assert.equal(result.status, "completed");

    const stored = await loadRecord(repo, txId);
    assert.equal(stored.status, "completed");
    assert.equal(stored.metadata?.fulfilment_status, "completed");
    assert.equal(stored.metadata?.fulfilment_attempts, 1);
    assert.equal(stored.metadata?.clubkonnect_request_id, REQUEST_ID);
    assert.equal(stored.metadata?.clubkonnect_order_id, ORDER_ID);
    assert.equal(stored.metadata?.clubkonnect_status_code, "200");
    assert.equal(stored.metadata?.fulfilment_reconciliation_required, false);
    assert.equal(typeof stored.metadata?.fulfilled_at, "string");

    const purchaseCalls = endpointCalls(calls, AIRTIME_ENDPOINT);
    assert.equal(purchaseCalls.length, 1, "exactly one purchase call");
    const purchaseUrl = new URL(purchaseCalls[0]);
    assert.equal(purchaseUrl.searchParams.get("RequestID"), REQUEST_ID);
    assert.equal(purchaseUrl.searchParams.get("MobileNumber"), PHONE);
    assert.equal(purchaseUrl.searchParams.get("Amount"), AMOUNT_NGN);
    assert.equal(purchaseUrl.searchParams.get("MobileNetwork"), "01");

    const persisted = JSON.stringify(stored);
    assert.equal(persisted.includes(API_KEY), false, "API key must never be persisted");
    assert.equal(persisted.includes(USER_ID), false, "User ID must never be persisted");
    assert.equal(
      persisted.includes("APIAirtimeV1"),
      false,
      "credential-bearing URLs must never be persisted",
    );
  });

  /* ------------------------------------------------------------------ */
  for (const statuscode of ["100", "300"]) {
    await scenario(`statuscode ${statuscode} stays in flight`, async () => {
      const repo = new InMemoryTransactionRepository();
      const txId = await seedSettledAirtime(repo);
      const calls = installFetchStub(
        clubKonnectStub({
          purchase: () =>
            purchaseResponse(statuscode, {
              status: statuscode === "100" ? "ORDER_RECEIVED" : "Processing",
            }),
        }),
      );

      const result = await fulfilAirtimeOrder(txId, { repository: repo });
      if (!result.ok) assert.fail(`fulfil failed: ${result.code} ${result.message}`);
      assert.equal(result.status, "processing");

      const stored = await loadRecord(repo, txId);
      assert.equal(stored.status, "processing", `${statuscode} is never success`);
      assert.equal(stored.metadata?.fulfilment_attempts, 1);
      assert.equal(stored.metadata?.fulfilment_status, "processing");
      assert.equal(stored.metadata?.clubkonnect_status_code, statuscode);
      assert.equal(stored.metadata?.fulfilled_at, null, `${statuscode} never fulfils`);
      // 100/300 are ordinary in-flight processing: the provider acknowledged the
      // order, so no reconciliation is owed and the UI must say "processing".
      assert.equal(
        stored.metadata?.fulfilment_reconciliation_required,
        false,
        `${statuscode} must not require reconciliation`,
      );
      const stage = computeTransactionStage(stored);
      assert.equal(
        stage.stage,
        "airtime_processing",
        `${statuscode} must present as airtime_processing`,
      );
      assert.notEqual(stage.stage, "airtime_reconciliation_required");
      assert.equal(stage.isReconciliationRequired, false);
      assert.equal(endpointCalls(calls, AIRTIME_ENDPOINT).length, 1);
    });
  }

  /* ------------------------------------------------------------------ */
  await scenario(
    "statuscode 201 is unknown, requires reconciliation, and is never retried",
    async () => {
      const repo = new InMemoryTransactionRepository();
      const txId = await seedSettledAirtime(repo);
      const calls = installFetchStub(
        clubKonnectStub({
          purchase: () =>
            purchaseResponse("201", { status: "Network Unresponsive" }),
          query: () =>
            jsonResponse({
              statuscode: "300",
              status: "Processing",
              orderid: ORDER_ID,
              requestid: REQUEST_ID,
            }),
        }),
      );

      const result = await fulfilAirtimeOrder(txId, { repository: repo });
      if (!result.ok) assert.fail(`fulfil failed: ${result.code} ${result.message}`);
      assert.equal(result.status, "processing");

      const stored = await loadRecord(repo, txId);
      assert.equal(stored.status, "processing", "201 must never complete");
      assert.equal(stored.metadata?.fulfilment_status, "unknown");
      assert.equal(stored.metadata?.fulfilment_reconciliation_required, true);
      assert.equal(stored.metadata?.fulfilment_attempts, 1);
      assert.equal(stored.metadata?.clubkonnect_status_code, "201");

      // A second call must reconcile only: the purchase endpoint is now fatal.
      installFetchStub(
        clubKonnectStub({
          query: () =>
            jsonResponse({
              statuscode: "300",
              status: "Processing",
              orderid: ORDER_ID,
              requestid: REQUEST_ID,
            }),
        }),
        calls,
      );
      const second = await fulfilAirtimeOrder(txId, { repository: repo });
      if (!second.ok) assert.fail(`second fulfil failed: ${second.code}`);
      assert.equal(second.status, "processing");
      assert.equal(
        endpointCalls(calls, AIRTIME_ENDPOINT).length,
        1,
        "an unknown outcome must never be re-purchased",
      );
      assert.equal(endpointCalls(calls, QUERY_ENDPOINT).length, 1);

      const afterSecond = await loadRecord(repo, txId);
      assert.equal(afterSecond.metadata?.fulfilment_attempts, 1);
      assert.equal(afterSecond.status, "processing");
    },
  );

  /* ------------------------------------------------------------------ */
  await scenario(
    "a 200 answer bound to a foreign RequestID never completes the transaction",
    async () => {
      const repo = new InMemoryTransactionRepository();
      const txId = await seedSettledAirtime(repo);
      const calls = installFetchStub(
        clubKonnectStub({
          // Numeric 200 is normally terminal success, but this answer belongs to
          // another order: it must not be applied to this transaction.
          purchase: () =>
            purchaseResponse("200", { requestid: "ck_foreign_request_id" }),
          query: () =>
            jsonResponse({
              statuscode: "300",
              status: "Processing",
              orderid: ORDER_ID,
              requestid: REQUEST_ID,
            }),
        }),
      );

      const result = await fulfilAirtimeOrder(txId, { repository: repo });
      if (!result.ok) assert.fail(`fulfil failed: ${result.code} ${result.message}`);
      assert.equal(result.status, "processing", "a mismatched answer is never success");

      const stored = await loadRecord(repo, txId);
      assert.equal(stored.status, "processing", "the mismatched 200 must not complete");
      assert.equal(stored.metadata?.fulfilment_status, "unknown");
      assert.equal(stored.metadata?.fulfilment_reconciliation_required, true);
      assert.equal(stored.metadata?.clubkonnect_status_code, "REQUEST_ID_MISMATCH");
      assert.equal(
        stored.metadata?.clubkonnect_raw_status,
        "Provider response missing or mismatched RequestID",
      );
      assert.equal(stored.metadata?.fulfilment_last_error_code, "REQUEST_ID_MISMATCH");
      assert.equal(
        stored.metadata?.clubkonnect_order_id,
        null,
        "a foreign order id is never bound to this transaction",
      );
      assert.equal(stored.metadata?.fulfilled_at, null, "the order is never fulfilled");
      assert.equal(stored.metadata?.fulfilment_attempts, 1);

      const stage = computeTransactionStage(stored);
      assert.equal(stage.stage, "airtime_reconciliation_required");
      assert.equal(stage.isReconciliationRequired, true);

      // The spend is never repeated: the next call reconciles instead.
      const second = await fulfilAirtimeOrder(txId, { repository: repo });
      if (!second.ok) assert.fail(`second fulfil failed: ${second.code}`);
      assert.equal(second.status, "processing");
      assert.equal(
        endpointCalls(calls, AIRTIME_ENDPOINT).length,
        1,
        "a mismatched answer must never trigger a second purchase",
      );
      assert.equal(endpointCalls(calls, QUERY_ENDPOINT).length, 1);

      // Reconciliation answers for our RequestID with a definite 300, which is
      // ordinary in-flight processing again.
      const afterSecond = await loadRecord(repo, txId);
      assert.equal(afterSecond.status, "processing");
      assert.equal(afterSecond.metadata?.clubkonnect_status_code, "300");
      assert.equal(afterSecond.metadata?.fulfilment_reconciliation_required, false);
      assert.equal(computeTransactionStage(afterSecond).stage, "airtime_processing");
    },
  );

  /* ------------------------------------------------------------------ */
  await scenario("statuscode 417 fails the transaction without a refund", async () => {
    const repo = new InMemoryTransactionRepository();
    const txId = await seedSettledAirtime(repo);
    installFetchStub(
      clubKonnectStub({
        purchase: () =>
          purchaseResponse("417", { status: "Insufficient Balance" }),
      }),
    );

    const result = await fulfilAirtimeOrder(txId, { repository: repo });
    if (!result.ok) assert.fail(`fulfil failed: ${result.code} ${result.message}`);
    assert.equal(result.status, "failed");

    const stored = await loadRecord(repo, txId);
    assert.equal(stored.status, "failed");
    assert.notEqual(stored.status, "refunded", "float failure never fakes a refund");
    assert.equal(stored.metadata?.fulfilment_status, "failed");
    assert.equal(stored.metadata?.fulfilment_last_error_code, "PROVIDER_FLOAT_EXHAUSTED");
    assert.equal(stored.metadata?.fulfilment_attempts, 1);
  });

  /* ------------------------------------------------------------------ */
  const unknownVariants = [
    {
      name: "upstream timeout",
      code: "UPSTREAM_TIMEOUT",
      purchase: () => {
        throw abortError();
      },
    },
    {
      name: "network error",
      code: "NETWORK_ERROR",
      purchase: () => {
        throw new Error("socket hang up");
      },
    },
    {
      name: "malformed provider body",
      code: "UNKNOWN_OUTCOME",
      purchase: () => new Response("not-json{", { status: 200 }),
    },
    {
      name: "provider HTTP failure",
      code: "UPSTREAM_ERROR",
      purchase: () => jsonResponse({ msg: "provider exploded" }, 503),
    },
  ];

  for (const variant of unknownVariants) {
    await scenario(`${variant.name} leaves an unknown outcome in flight`, async () => {
      const repo = new InMemoryTransactionRepository();
      const txId = await seedSettledAirtime(repo);
      installFetchStub(clubKonnectStub({ purchase: variant.purchase }));

      const result = await fulfilAirtimeOrder(txId, { repository: repo });
      if (!result.ok) assert.fail(`fulfil failed: ${result.code} ${result.message}`);
      assert.equal(result.status, "processing", variant.name);

      const stored = await loadRecord(repo, txId);
      assert.equal(stored.status, "processing", `${variant.name} is never success`);
      assert.equal(stored.metadata?.fulfilment_status, "unknown");
      assert.equal(stored.metadata?.fulfilment_reconciliation_required, true);
      assert.equal(stored.metadata?.fulfilment_last_error_code, variant.code);
      assert.equal(stored.metadata?.fulfilment_attempts, 1);
      assert.equal(stored.metadata?.fulfilled_at, null);
      assert.equal(JSON.stringify(stored).includes(API_KEY), false);
    });
  }

  /* ------------------------------------------------------------------ */
  await scenario("a duplicate fulfil call never purchases twice", async () => {
    const repo = new InMemoryTransactionRepository();
    const txId = await seedSettledAirtime(repo);
    const calls = installFetchStub(
      clubKonnectStub({
        purchase: () => purchaseResponse("300", { status: "Processing" }),
        query: () =>
          jsonResponse({
            statuscode: "300",
            status: "Processing",
            orderid: ORDER_ID,
            requestid: REQUEST_ID,
          }),
      }),
    );

    const first = await fulfilAirtimeOrder(txId, { repository: repo });
    if (!first.ok) assert.fail(`first fulfil failed: ${first.code}`);
    assert.equal(endpointCalls(calls, AIRTIME_ENDPOINT).length, 1);

    installFetchStub(
      clubKonnectStub({
        query: () =>
          jsonResponse({
            statuscode: "300",
            status: "Processing",
            orderid: ORDER_ID,
            requestid: REQUEST_ID,
          }),
      }),
      calls,
    );

    const second = await fulfilAirtimeOrder(txId, { repository: repo });
    if (!second.ok) assert.fail(`second fulfil failed: ${second.code}`);
    assert.equal(second.status, "processing");
    assert.equal(
      endpointCalls(calls, AIRTIME_ENDPOINT).length,
      1,
      "the purchase endpoint must be called exactly once",
    );
    assert.equal(endpointCalls(calls, QUERY_ENDPOINT).length, 1);

    const stored = await loadRecord(repo, txId);
    assert.equal(stored.metadata?.fulfilment_attempts, 1, "attempts stay at 1");
    assert.equal(stored.status, "processing");
  });

  /* ------------------------------------------------------------------ */
  await scenario("insufficient provider float fails closed before the purchase", async () => {
    const repo = new InMemoryTransactionRepository();
    const txId = await seedSettledAirtime(repo);
    const calls = installFetchStub(
      clubKonnectStub({ balance: "100", purchase: () => purchaseResponse("200") }),
    );

    const result = await fulfilAirtimeOrder(txId, { repository: repo });
    assert.equal(result.ok, false);
    if (result.ok) assert.fail("expected the float pre-check to reject");
    assert.equal(result.code, "PROVIDER_FLOAT_EXHAUSTED");

    assert.equal(
      endpointCalls(calls, AIRTIME_ENDPOINT).length,
      0,
      "no purchase may happen without float",
    );
    const stored = await loadRecord(repo, txId);
    assert.equal(stored.status, "failed", "a definite pre-purchase failure is terminal");
    assert.notEqual(stored.status, "refunded", "no refund is ever invented");
    assert.equal(stored.metadata?.fulfilment_attempts, 0);
    assert.equal(stored.metadata?.fulfilment_status, "failed");
    assert.equal(stored.metadata?.fulfilment_last_error_code, "PROVIDER_FLOAT_EXHAUSTED");
  });

  /* ------------------------------------------------------------------ */
  await scenario(
    "an unreadable wallet balance leaves the row settled and retryable",
    async () => {
      const repo = new InMemoryTransactionRepository();
      const txId = await seedSettledAirtime(repo);
      const calls = installFetchStub(
        clubKonnectStub({
          balanceResponse: () => {
            throw new Error("socket hang up");
          },
          purchase: () => purchaseResponse("200"),
        }),
      );

      const result = await fulfilAirtimeOrder(txId, { repository: repo });
      if (result.ok) assert.fail("a failed float check must not report success");
      assert.equal(result.code, "FLOAT_CHECK_UNAVAILABLE");
      assert.notEqual(
        result.code,
        "PROVIDER_FLOAT_EXHAUSTED",
        "an unreadable balance is not exhaustion",
      );
      assert.equal(
        endpointCalls(calls, AIRTIME_ENDPOINT).length,
        0,
        "no purchase may happen without a readable float check",
      );

      // The check is read-only and runs before the reservation, so nothing
      // about the row changed: it is not wedged in a query-only `processing`.
      const stored = await loadRecord(repo, txId);
      assert.equal(stored.status, "settled", "the check never mutates the row");
      assert.equal(stored.failureCode, null);
      assert.equal(stored.metadata?.clubkonnect_request_id, undefined);
      assert.equal(stored.metadata?.fulfilment_attempts, undefined);
      assert.equal(
        result.transaction?.status,
        "settled",
        "the returned snapshot is the untouched settled row",
      );
      assert.equal(computeTransactionStage(stored).stage, "settled");

      // Retryable: the next call re-runs the float check instead of
      // reconciling a purchase that never happened, and still never purchases
      // while the float stays unreadable.
      const second = await fulfilAirtimeOrder(txId, { repository: repo });
      assert.equal(second.ok, false);
      if (second.ok) assert.fail("an unreadable balance stays unavailable");
      assert.equal(second.code, "FLOAT_CHECK_UNAVAILABLE");
      const afterRetry = await loadRecord(repo, txId);
      assert.equal(afterRetry.status, "settled");
      assert.notEqual(afterRetry.status, "failed", "the retry never fails the row");
      assert.equal(
        endpointCalls(calls, AIRTIME_ENDPOINT).length,
        0,
        "an unreadable float is never spent",
      );
    },
  );

  /* ------------------------------------------------------------------ */
  await scenario(
    "an unavailable float check is retried and then purchases exactly once",
    async () => {
      const repo = new InMemoryTransactionRepository();
      const txId = await seedSettledAirtime(repo);
      let balanceUnavailable = true;
      const calls = installFetchStub((url) => {
        if (balanceUnavailable && url.includes(BALANCE_ENDPOINT)) {
          throw new Error("socket hang up");
        }
        return clubKonnectStub({ purchase: () => purchaseResponse("200") })(url);
      });

      const first = await fulfilAirtimeOrder(txId, { repository: repo });
      assert.equal(first.ok, false);
      if (first.ok) assert.fail("an unavailable float check must not report success");
      assert.equal(first.code, "FLOAT_CHECK_UNAVAILABLE");
      assert.equal(endpointCalls(calls, AIRTIME_ENDPOINT).length, 0);

      const afterFirst = await loadRecord(repo, txId);
      assert.equal(afterFirst.status, "settled", "an unavailable check mutates nothing");
      assert.equal(afterFirst.metadata?.clubkonnect_request_id, undefined);
      assert.equal(afterFirst.metadata?.fulfilment_attempts, undefined);

      // The provider recovers: the very same call re-checks the float, wins the
      // reservation, claims the single allowed attempt, and purchases.
      balanceUnavailable = false;
      const second = await fulfilAirtimeOrder(txId, { repository: repo });
      if (!second.ok) assert.fail(`retry failed: ${second.code} ${second.message}`);
      assert.equal(second.status, "completed");

      const stored = await loadRecord(repo, txId);
      assert.equal(stored.status, "completed");
      assert.equal(stored.metadata?.fulfilment_status, "completed");
      assert.equal(stored.metadata?.fulfilment_attempts, 1);
      assert.equal(stored.metadata?.clubkonnect_order_id, ORDER_ID);
      assert.equal(
        endpointCalls(calls, AIRTIME_ENDPOINT).length,
        1,
        "the retry purchases exactly once",
      );
      assert.equal(
        endpointCalls(calls, BALANCE_ENDPOINT).length,
        2,
        "each call re-runs the float check",
      );
    },
  );

  /* ------------------------------------------------------------------ */
  await scenario(
    "a balance answer without a balance field is unavailable, not exhaustion",
    async () => {
      const repo = new InMemoryTransactionRepository();
      const txId = await seedSettledAirtime(repo);
      // The provider answered successfully but reported no balance at all: the
      // client defaults that to "0", which must never read as an empty wallet.
      installFetchStub(
        clubKonnectStub({
          balanceResponse: () => jsonResponse({ statuscode: "200", status: "SUCCESS" }),
        }),
      );

      const result = await fulfilAirtimeOrder(txId, { repository: repo });
      if (result.ok) assert.fail("an unreported balance is not a green light");
      assert.equal(result.code, "FLOAT_CHECK_UNAVAILABLE");

      const stored = await loadRecord(repo, txId);
      assert.equal(stored.status, "settled");
      assert.notEqual(stored.failureCode, "PROVIDER_FLOAT_EXHAUSTED");
      assert.equal(stored.metadata?.clubkonnect_request_id, undefined);
      assert.equal(stored.metadata?.fulfilment_attempts, undefined);
    },
  );

  /* ------------------------------------------------------------------ */
  const persistenceFailures = [
    {
      name: "a write failure",
      make: () => new PersistenceFailingRepository(),
    },
    {
      name: "a thrown driver error",
      make: () => new ThrowingPersistenceRepository(),
    },
  ];

  for (const failure of persistenceFailures) {
    await scenario(
      `an unpersisted provider outcome (${failure.name}) is reported as reconciliation-required`,
      async () => {
        const repo = failure.make();
        const txId = await seedSettledAirtime(repo);
        const calls = installFetchStub(
          clubKonnectStub({ purchase: () => purchaseResponse("200") }),
        );

        const result = await fulfilAirtimeOrder(txId, { repository: repo });
        if (result.ok) assert.fail("a lost outcome must not be reported as success");
        assert.equal(result.code, "PERSISTENCE_FAILED");
        assert.equal(
          endpointCalls(calls, AIRTIME_ENDPOINT).length,
          1,
          "the purchase happened exactly once",
        );

        const snapshot = result.transaction;
        assert.ok(snapshot, "the snapshot is returned so the caller can react");
        assert.equal(
          snapshot.metadata?.fulfilment_reconciliation_required,
          true,
          "the returned snapshot says reconciliation is required",
        );
        assert.equal(snapshot.status, "processing", "the snapshot is never a success");
        assert.equal(
          computeTransactionStage(snapshot).stage,
          "airtime_reconciliation_required",
        );
        assert.equal(
          toPublicTransactionDto(snapshot).fulfilment?.reconciliationRequired,
          true,
          "the client-facing DTO carries the flag too",
        );

        const stored = await loadRecord(repo, txId);
        assert.equal(stored.status, "processing");
        assert.equal(stored.metadata?.fulfilment_attempts, 1);
        assert.equal(stored.metadata?.clubkonnect_status_code, null);
      },
    );
  }

  /* ------------------------------------------------------------------ */
  await scenario("a non-settled transaction is rejected before any provider call", async () => {
    const repo = new InMemoryTransactionRepository();
    const created = await repo.create({
      id: TX_ID,
      idempotencyKey: "idem_p6_pending_0001",
      type: "airtime",
      walletAddress: "0x21e5fc03e4305cc8cfb874253c6d66a8bdb0bcda",
      amountUsdc: "0.500000",
      amountNgn: AMOUNT_NGN,
      paycrestReference: "ref_p6_pending_0001",
      metadata: { phone: PHONE, network: "mtn" },
    });
    if (!created.ok) assert.fail(`seed failed: ${created.message}`);

    const calls = installFetchStub(
      clubKonnectStub({ purchase: () => purchaseResponse("200") }),
    );
    const result = await fulfilAirtimeOrder(created.record.id, { repository: repo });
    assert.equal(result.ok, false);
    if (result.ok) assert.fail("expected a non-settled rejection");
    assert.equal(result.code, "NOT_ELIGIBLE");
    assert.equal(calls.length, 0, "no provider call may happen before settlement");
  });

  /* ------------------------------------------------------------------ */
  await scenario("a settled cash-out transaction is not fulfilled as airtime", async () => {
    const repo = new InMemoryTransactionRepository();
    const txId = await seedSettledAirtime(repo, {
      type: "cash_out",
      idempotencyKey: "idem_p6_cashout_0001",
      paycrestReference: "ref_p6_cashout_0001",
    });
    const calls = installFetchStub(
      clubKonnectStub({ purchase: () => purchaseResponse("200") }),
    );

    const result = await fulfilAirtimeOrder(txId, { repository: repo });
    assert.equal(result.ok, false);
    if (result.ok) assert.fail("expected a type rejection");
    assert.equal(result.code, "FULFILMENT_INVALID_TYPE");
    assert.equal(calls.length, 0);
  });

  /* ------------------------------------------------------------------ */
  await scenario("a completed cash-out is rejected on type, not answered as fulfilled", async () => {
    const repo = new CompletedCashOutRepository();
    const calls = installFetchStub(
      clubKonnectStub({ purchase: () => purchaseResponse("200") }),
    );

    const result = await fulfilAirtimeOrder(TX_ID, { repository: repo });
    assert.equal(result.ok, false);
    if (result.ok) {
      assert.fail("a completed cash-out must never report a fulfilment outcome");
    }
    assert.equal(
      result.code,
      "FULFILMENT_INVALID_TYPE",
      "type must be validated before the completed status shortcut",
    );
    assert.equal(result.message, "Transaction is not an airtime order");
    assert.equal(result.transaction?.type, "cash_out");
    assert.equal(result.transaction?.status, "completed");
    assert.equal(
      calls.length,
      0,
      "no provider call may happen for a non-airtime transaction",
    );
  });

  /* ------------------------------------------------------------------ */
  await scenario("a mismatched RequestID never reaches the provider", async () => {
    const calls = installFetchStub(
      clubKonnectStub({ purchase: () => purchaseResponse("200") }),
    );

    const mismatched = await executeClubKonnectAirtimePurchase({
      transactionId: TX_ID,
      requestId: "ck_attacker_supplied_id",
      phone: PHONE,
      amountNgn: Number(AMOUNT_NGN),
      network: "mtn",
    });

    assert.equal(mismatched.ok, false);
    if (mismatched.ok) assert.fail("expected the RequestID guard to reject");
    assert.equal(mismatched.code, "INVALID_INPUT");
    assert.equal(calls.length, 0, "a rejected request must not call the provider");
  });

  /* ------------------------------------------------------------------ */
  await scenario("reconciliation completes an unknown order through the Query API", async () => {
    const repo = new InMemoryTransactionRepository();
    const txId = await seedSettledAirtime(repo);
    const calls = installFetchStub(
      clubKonnectStub({
        purchase: () => purchaseResponse("201", { status: "Network Unresponsive" }),
        query: () =>
          jsonResponse({
            statuscode: "200",
            status: "ORDER_COMPLETED",
            orderid: ORDER_ID,
            requestid: REQUEST_ID,
          }),
      }),
    );

    const purchase = await fulfilAirtimeOrder(txId, { repository: repo });
    if (!purchase.ok) assert.fail(`fulfil failed: ${purchase.code}`);
    assert.equal(purchase.status, "processing");

    const reconciled = await reconcileAirtimeFulfilment(txId, { repository: repo });
    if (!reconciled.ok) assert.fail(`reconcile failed: ${reconciled.code}`);
    assert.equal(reconciled.changed, true);
    assert.equal(reconciled.transaction.status, "completed");
    assert.equal(reconciled.reconciliationRequired, false);

    const queryCalls = endpointCalls(calls, QUERY_ENDPOINT);
    assert.equal(queryCalls.length, 1);
    const queryUrl = new URL(queryCalls[0]);
    assert.equal(queryUrl.searchParams.get("RequestID"), REQUEST_ID);
    assert.equal(queryUrl.searchParams.get("OrderID"), ORDER_ID);
    assert.equal(
      endpointCalls(calls, AIRTIME_ENDPOINT).length,
      1,
      "reconciliation never purchases",
    );

    const stored = await loadRecord(repo, txId);
    assert.equal(stored.status, "completed");
    assert.equal(stored.metadata?.fulfilment_status, "completed");
    assert.equal(stored.metadata?.clubkonnect_status_code, "200");
    assert.equal(typeof stored.metadata?.fulfilled_at, "string");

    // Terminal state: a further reconciliation is a no-op.
    const again = await reconcileAirtimeFulfilment(txId, { repository: repo });
    if (!again.ok) assert.fail(`second reconcile failed: ${again.code}`);
    assert.equal(again.changed, false);
    assert.equal(again.transaction.status, "completed");
  });

  /* ------------------------------------------------------------------ */
  await scenario("reconciliation keeps an unreadable query in flight", async () => {
    const repo = new InMemoryTransactionRepository();
    const txId = await seedSettledAirtime(repo);
    installFetchStub(
      clubKonnectStub({
        purchase: () => purchaseResponse("201", { status: "Network Unresponsive" }),
        query: () => {
          throw abortError();
        },
      }),
    );

    const purchase = await fulfilAirtimeOrder(txId, { repository: repo });
    if (!purchase.ok) assert.fail(`fulfil failed: ${purchase.code}`);

    const reconciled = await reconcileAirtimeFulfilment(txId, { repository: repo });
    if (!reconciled.ok) assert.fail(`reconcile failed: ${reconciled.code}`);
    assert.equal(reconciled.transaction.status, "processing");
    assert.equal(reconciled.reconciliationRequired, true);

    const stored = await loadRecord(repo, txId);
    assert.equal(stored.status, "processing");
    assert.equal(stored.metadata?.fulfilment_reconciliation_required, true);
    assert.equal(typeof stored.metadata?.fulfilment_last_checked_at, "string");
  });

  /* ------------------------------------------------------------------ */
  await scenario("the fulfilment route ignores client purchase fields", async () => {
    const repo = new InMemoryTransactionRepository();
    const txId = await seedSettledAirtime(repo);
    setTransactionRepositoryForTesting(repo);

    try {
      const calls = installFetchStub(
        clubKonnectStub({ purchase: () => purchaseResponse("200") }),
      );

      const response = await POST(
        new Request(`http://localhost/api/transactions/${txId}/fulfil`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            phone: "08099999999",
            amountNgn: "50000",
            network: "airtel",
            requestId: "client-supplied-request-id",
          }),
        }),
        { params: Promise.resolve({ id: txId }) },
      );

      assert.equal(response.status, 200);
      // The response body is JSON this route produced; only the flag is asserted.
      const body = (await response.json()) as { success?: unknown };
      assert.equal(body.success, true);

      const purchaseCalls = endpointCalls(calls, AIRTIME_ENDPOINT);
      assert.equal(purchaseCalls.length, 1);
      const purchaseUrl = new URL(purchaseCalls[0]);
      assert.equal(purchaseUrl.searchParams.get("MobileNumber"), PHONE);
      assert.equal(purchaseUrl.searchParams.get("Amount"), AMOUNT_NGN);
      assert.equal(purchaseUrl.searchParams.get("MobileNetwork"), "01");
      assert.equal(purchaseUrl.searchParams.get("RequestID"), REQUEST_ID);

      const stored = await loadRecord(repo, txId);
      assert.equal(stored.status, "completed");

      // An acknowledged-but-unfinished purchase reports 202, never 200.
      const inFlightRepo = new InMemoryTransactionRepository();
      const inFlightTx = await seedSettledAirtime(inFlightRepo);
      setTransactionRepositoryForTesting(inFlightRepo);
      installFetchStub(
        clubKonnectStub({
          purchase: () => purchaseResponse("300", { status: "Processing" }),
        }),
      );
      const inFlightResponse = await POST(
        new Request(`http://localhost/api/transactions/${inFlightTx}/fulfil`, {
          method: "POST",
        }),
        { params: Promise.resolve({ id: inFlightTx }) },
      );
      assert.equal(inFlightResponse.status, 202);
      const inFlightBody = (await inFlightResponse.json()) as { status?: unknown };
      assert.equal(inFlightBody.status, "processing");

      // An unknown transaction is a 404, not a provider call.
      const missingResponse = await POST(
        new Request("http://localhost/api/transactions/tx_missing/fulfil", {
          method: "POST",
        }),
        { params: Promise.resolve({ id: "tx_missing" }) },
      );
      assert.equal(missingResponse.status, 404);
      const missingBody = (await missingResponse.json()) as { success?: unknown };
      assert.equal(missingBody.success, false);
    } finally {
      setTransactionRepositoryForTesting(null);
    }
  });

  /* ------------------------------------------------------------------ */
  await scenario(
    "a settled row whose Paycrest milestone is not fiat-final is rejected before any provider call",
    async () => {
      // `fulfilled` / `fulfilling` / `pending` are provider-internal progress:
      // none of them proves NGN reached the recipient, so none may unlock a
      // purchase — not even on a row the provider already marked terminal.
      for (const milestone of ["fulfilled", "fulfilling", "pending"] as const) {
        const repo = new InMemoryTransactionRepository();
        const created = await repo.create({
          id: `tx_p6_stale_milestone_${milestone}`,
          idempotencyKey: `idem_p6_stale_milestone_${milestone}`,
          type: "airtime",
          walletAddress: "0x21e5fc03e4305cc8cfb874253c6d66a8bdb0bcda",
          amountUsdc: "0.500000",
          amountNgn: AMOUNT_NGN,
          paycrestReference: `ref_p6_stale_milestone_${milestone}`,
          metadata: { phone: PHONE, network: "mtn" },
        });
        if (!created.ok) assert.fail(`seed failed: ${created.message}`);
        const txId = created.record.id;

        const settling = await repo.updateStatus(txId, {
          status: "settling",
          paycrestStatus: milestone,
        });
        if (!settling.ok) assert.fail(`seed settling failed: ${settling.message}`);
        const settled = await repo.updateStatus(txId, { status: "settled" });
        if (!settled.ok) assert.fail(`seed settled failed: ${settled.message}`);

        const seeded = await loadRecord(repo, txId);
        assert.equal(seeded.status, "settled", `${milestone} seeds a settled row`);
        assert.equal(seeded.paycrestStatus, milestone);

        const calls = installFetchStub(
          clubKonnectStub({ purchase: () => purchaseResponse("200") }),
        );
        const result = await fulfilAirtimeOrder(txId, { repository: repo });

        assert.equal(result.ok, false, `${milestone} must be rejected`);
        if (result.ok) assert.fail(`${milestone} must not be eligible for fulfilment`);
        assert.equal(result.code, "NOT_ELIGIBLE", milestone);
        assert.equal(
          result.message,
          "Transaction must have confirmed Paycrest fiat delivery (validated or settled)",
        );
        assert.equal(
          calls.length,
          0,
          `${milestone} must not trigger a float read, a query, or a purchase`,
        );

        const stored = await loadRecord(repo, txId);
        assert.equal(stored.status, "settled", `${milestone} leaves the row untouched`);
        assert.equal(stored.failureCode, null);
        assert.equal(
          stored.metadata?.clubkonnect_request_id,
          undefined,
          `${milestone} reserves nothing`,
        );
        assert.equal(
          stored.metadata?.fulfilment_attempts,
          undefined,
          `${milestone} spends no attempt`,
        );
      }
    },
  );

  /* ------------------------------------------------------------------ */
  await scenario(
    "a settled row with no Paycrest milestone at all is rejected before any provider call",
    async () => {
      const repo = new SettledAirtimeWithoutPaycrestMilestoneRepository();
      const txId = await seedSettledAirtime(repo);
      const calls = installFetchStub(
        clubKonnectStub({ purchase: () => purchaseResponse("200") }),
      );

      const result = await fulfilAirtimeOrder(txId, { repository: repo });
      assert.equal(result.ok, false, "an unrecorded milestone is not fiat finality");
      if (result.ok) assert.fail("a settled row without a Paycrest milestone is ineligible");
      assert.equal(result.code, "NOT_ELIGIBLE");
      assert.equal(
        result.message,
        "Transaction must have confirmed Paycrest fiat delivery (validated or settled)",
      );
      assert.equal(
        calls.length,
        0,
        "no provider call may happen without a confirmed fiat milestone",
      );

      const stored = await repo.findById(txId);
      assert.ok(stored);
      assert.equal(stored.status, "settled", "the rejection never mutates the row");
      assert.equal(stored.metadata?.clubkonnect_request_id, undefined);
      assert.equal(stored.metadata?.fulfilment_attempts, undefined);
    },
  );

  /* ------------------------------------------------------------------ */
  await scenario(
    "a 200 purchase answer that omits the RequestID never completes the transaction",
    async () => {
      const repo = new InMemoryTransactionRepository();
      const txId = await seedSettledAirtime(repo);
      const calls = installFetchStub(
        clubKonnectStub({
          // The documented terminal success code, but the body never binds the
          // answer to the order this transaction asked for.
          purchase: () => purchaseResponse("200", { requestid: undefined }),
          query: () =>
            jsonResponse({
              statuscode: "300",
              status: "Processing",
              orderid: ORDER_ID,
              requestid: REQUEST_ID,
            }),
        }),
      );

      const result = await fulfilAirtimeOrder(txId, { repository: repo });
      if (!result.ok) assert.fail(`fulfil failed: ${result.code} ${result.message}`);
      assert.equal(result.status, "processing", "an unbound answer is never success");

      const stored = await loadRecord(repo, txId);
      assert.equal(stored.status, "processing", "the unbound 200 must not complete");
      assert.equal(stored.metadata?.fulfilment_status, "unknown");
      assert.equal(stored.metadata?.clubkonnect_status_code, "REQUEST_ID_MISMATCH");
      assert.equal(
        stored.metadata?.clubkonnect_raw_status,
        "Provider response missing or mismatched RequestID",
      );
      assert.equal(stored.metadata?.fulfilment_last_error_code, "REQUEST_ID_MISMATCH");
      assert.equal(stored.metadata?.fulfilment_reconciliation_required, true);
      assert.equal(
        stored.metadata?.clubkonnect_order_id,
        null,
        "an unbound answer never binds its order id either",
      );
      assert.equal(stored.metadata?.fulfilled_at, null, "the order is never fulfilled");
      assert.equal(stored.metadata?.fulfilment_attempts, 1);

      const stage = computeTransactionStage(stored);
      assert.equal(stage.stage, "airtime_reconciliation_required");
      assert.equal(stage.isReconciliationRequired, true);

      // Still never re-purchased: the next call reconciles the same order.
      const second = await fulfilAirtimeOrder(txId, { repository: repo });
      if (!second.ok) assert.fail(`second fulfil failed: ${second.code}`);
      assert.equal(second.status, "processing");
      assert.equal(
        endpointCalls(calls, AIRTIME_ENDPOINT).length,
        1,
        "an unbound answer must never trigger a second purchase",
      );
      assert.equal(endpointCalls(calls, QUERY_ENDPOINT).length, 1);

      const afterSecond = await loadRecord(repo, txId);
      assert.equal(afterSecond.status, "processing");
      assert.equal(afterSecond.metadata?.clubkonnect_status_code, "300");
      assert.equal(afterSecond.metadata?.fulfilment_reconciliation_required, false);
    },
  );

  /* ------------------------------------------------------------------ */
  await scenario(
    "a Query API answer that omits the RequestID is a conflict, never a completion",
    async () => {
      const repo = new InMemoryTransactionRepository();
      const txId = await seedSettledAirtime(repo);
      const calls = installFetchStub(
        clubKonnectStub({
          purchase: () => purchaseResponse("201", { status: "Network Unresponsive" }),
          // A success code for an order that never says which RequestID it
          // belongs to: it can never be applied to this transaction.
          query: () =>
            jsonResponse({
              statuscode: "200",
              status: "ORDER_COMPLETED",
              orderid: ORDER_ID,
            }),
        }),
      );

      const purchase = await fulfilAirtimeOrder(txId, { repository: repo });
      if (!purchase.ok) assert.fail(`fulfil failed: ${purchase.code}`);
      assert.equal(purchase.status, "processing");

      const reconciled = await reconcileAirtimeFulfilment(txId, {
        repository: repo,
      });
      if (!reconciled.ok) assert.fail(`reconcile failed: ${reconciled.code}`);
      assert.equal(reconciled.changed, true);
      assert.equal(
        reconciled.reconciliationRequired,
        true,
        "an unbound query answer leaves the outcome unresolved",
      );
      assert.notEqual(reconciled.transaction.status, "completed");

      const stored = await loadRecord(repo, txId);
      assert.equal(stored.status, "processing", "an unbound success code never completes");
      assert.equal(stored.metadata?.fulfilment_status, "unknown");
      assert.equal(stored.metadata?.fulfilment_reconciliation_required, true);
      assert.equal(
        stored.metadata?.fulfilment_last_error_code,
        "FULFILMENT_REQUEST_ID_MISMATCH",
      );
      assert.equal(stored.metadata?.fulfilled_at, null);
      assert.equal(computeTransactionStage(stored).stage, "airtime_reconciliation_required");
      assert.equal(
        endpointCalls(calls, AIRTIME_ENDPOINT).length,
        1,
        "reconciliation never purchases",
      );
    },
  );

  console.log("P6 airtime fulfilment self-check: all assertions passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
