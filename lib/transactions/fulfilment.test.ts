/**
 * P6 airtime fulfilment repository contract self-check.
 *
 * Proves the durable half of Paycrest -> ClubKonnect fulfilment:
 *
 *   1. reservation is a single-winner race, and only 'acquired' may purchase;
 *   2. the purchase attempt is one-shot (0 -> 1, never 1 -> 2);
 *   3. provider outcomes map exactly: 200 completes; 100/300 stay in flight;
 *      201 / timeout / unreadable answers are unknown and require reconciliation;
 *      417 fails without inventing a refund;
 *   4. terminal rows are never downgraded and a provider order id is write-once;
 *   5. the public DTO projects a sanitized fulfilment view and no secrets;
 *   6. a repository without a database connection fails closed.
 *
 * Run: npx tsx lib/transactions/fulfilment.test.ts
 */

import assert from "node:assert/strict";
import {
  DrizzleTransactionRepository,
  InMemoryTransactionRepository,
  toPublicTransactionDto,
  type CreateTransactionInput,
  type FulfilmentOutcomeInput,
  type TransactionRecord,
} from "@/lib/transactions";

const WALLET = "0x21e5fc03e4305cc8cfb874253c6d66a8bdb0bcda";
const REQUEST_ID = "cktxp6fulfil0001a1b2c3d4e5";
const OTHER_REQUEST_ID = "cktxp6fulfil0002f6e5d4c3b2";
const ORDER_ID = "CK-ORDER-1";

type AirtimeStage = "pending" | "settling" | "settled";

async function seedAirtime(
  repo: InMemoryTransactionRepository,
  stage: AirtimeStage,
  suffix: string,
  overrides: Partial<CreateTransactionInput> = {},
): Promise<string> {
  const created = await repo.create({
    id: `tx_p6_fulfil_${suffix}`,
    idempotencyKey: `idem_p6_fulfil_${suffix}`,
    type: "airtime",
    walletAddress: WALLET,
    amountUsdc: "0.500000",
    amountNgn: "500",
    paycrestReference: `ref_p6_fulfil_${suffix}`,
    metadata: { phone: "08031234567", network: "mtn", rate: "1500" },
    ...overrides,
  });
  if (!created.ok) assert.fail(`seed failed: ${created.message}`);

  if (stage === "pending") return created.record.id;

  const settling = await repo.updateStatus(created.record.id, {
    status: "settling",
    paycrestStatus: "deposited",
  });
  if (!settling.ok) assert.fail(`seed settling failed: ${settling.message}`);
  if (stage === "settling") return created.record.id;

  const settled = await repo.updateStatus(created.record.id, {
    status: "settled",
    paycrestStatus: "validated",
  });
  if (!settled.ok) assert.fail(`seed settled failed: ${settled.message}`);

  return created.record.id;
}

async function load(
  repo: InMemoryTransactionRepository,
  id: string,
): Promise<TransactionRecord> {
  const record = await repo.findById(id);
  if (!record) assert.fail(`transaction ${id} disappeared`);
  return record;
}

/** Reserves fulfilment and asserts the single purchase right was granted. */
async function reserve(
  repo: InMemoryTransactionRepository,
  transactionId: string,
  requestId = REQUEST_ID,
): Promise<TransactionRecord> {
  const result = await repo.acquireAirtimeFulfilmentReservation({
    transactionId,
    requestId,
  });
  if (!result.ok) {
    assert.fail(`reservation failed: ${result.error} ${result.message}`);
  }
  assert.equal(result.status, "acquired");
  return result.transaction;
}

/** Claims the purchase attempt and asserts it was this caller who claimed it. */
async function claim(
  repo: InMemoryTransactionRepository,
  transactionId: string,
  requestId = REQUEST_ID,
): Promise<TransactionRecord> {
  const result = await repo.claimAirtimeFulfilmentAttempt({
    transactionId,
    requestId,
  });
  if (!result.ok) {
    assert.fail(`claim failed: ${result.error} ${result.message}`);
  }
  assert.equal(result.status, "claimed");
  return result.transaction;
}

function outcomeInput(
  transactionId: string,
  overrides: Partial<FulfilmentOutcomeInput> = {},
): FulfilmentOutcomeInput {
  return {
    transactionId,
    requestId: REQUEST_ID,
    normalizedStatus: "processing",
    statusCode: "100",
    rawStatus: "ORDER_RECEIVED",
    reconciliationRequired: false,
    ...overrides,
  };
}

/** Seeds a settled airtime row that is reserved and has spent its attempt. */
async function seedClaimedAirtime(
  repo: InMemoryTransactionRepository,
  suffix: string,
): Promise<string> {
  const transactionId = await seedAirtime(repo, "settled", suffix);
  await reserve(repo, transactionId);
  await claim(repo, transactionId);
  return transactionId;
}

const failures: string[] = [];

async function scenario(name: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
    console.log(`  ok: ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`  FAILED: ${name}`);
    console.error(error);
  }
}

async function run(): Promise<void> {
  console.log("P6 airtime fulfilment repository self-check");

  /* ------------------------------------------------------------------ */
  /* 1. Reservation is a single-winner race                              */
  /* ------------------------------------------------------------------ */

  await scenario("two concurrent reservations grant exactly one purchase right", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedAirtime(repo, "settled", "race01");

    const [first, second] = await Promise.all([
      repo.acquireAirtimeFulfilmentReservation({ transactionId, requestId: REQUEST_ID }),
      repo.acquireAirtimeFulfilmentReservation({ transactionId, requestId: REQUEST_ID }),
    ]);

    const statuses = [first, second].map((result) => (result.ok ? result.status : result.error));
    assert.deepEqual(statuses.sort(), ["acquired", "already_processing"]);

    const stored = await load(repo, transactionId);
    assert.equal(stored.status, "processing");
    assert.equal(stored.metadata?.clubkonnect_request_id, REQUEST_ID);
    assert.equal(stored.metadata?.fulfilment_attempts, 0, "reservation never spends the attempt");
    assert.equal(stored.metadata?.fulfilment_reconciliation_required, false);
    assert.equal(typeof stored.metadata?.fulfilment_reserved_at, "string");
    assert.equal(stored.metadata?.fulfilled_at, null);
  });

  await scenario("reservation preserves unrelated metadata", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedAirtime(repo, "settled", "meta01");

    await reserve(repo, transactionId);
    const stored = await load(repo, transactionId);

    assert.equal(stored.metadata?.phone, "08031234567");
    assert.equal(stored.metadata?.network, "mtn");
    assert.equal(stored.metadata?.rate, "1500");
  });

  await scenario("a repeated reservation reports already_processing", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedAirtime(repo, "settled", "repeat01");
    await reserve(repo, transactionId);

    const again = await repo.acquireAirtimeFulfilmentReservation({
      transactionId,
      requestId: REQUEST_ID,
    });

    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.status, "already_processing");
    assert.equal(again.state, "already_processing");
    assert.equal(again.transaction.status, "processing");
    assert.equal(again.record.status, "processing");
  });

  await scenario("a settled cash-out is never reserved for fulfilment", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedAirtime(repo, "settled", "cashout01", {
      type: "cash_out",
    });

    const result = await repo.acquireAirtimeFulfilmentReservation({
      transactionId,
      requestId: REQUEST_ID,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "FULFILMENT_INVALID_TYPE");
    assert.equal(result.code, "FULFILMENT_INVALID_TYPE");
    assert.equal((await load(repo, transactionId)).status, "settled");
  });

  await scenario("pending and settling airtime are not eligible", async () => {
    const repo = new InMemoryTransactionRepository();
    const pendingId = await seedAirtime(repo, "pending", "pend01");
    const settlingId = await seedAirtime(repo, "settling", "settl01");

    for (const transactionId of [pendingId, settlingId]) {
      const result = await repo.acquireAirtimeFulfilmentReservation({
        transactionId,
        requestId: REQUEST_ID,
      });
      assert.equal(result.ok, false);
      if (result.ok) continue;
      assert.equal(result.error, "FULFILMENT_NOT_ELIGIBLE");
    }

    assert.equal((await load(repo, pendingId)).status, "pending");
    assert.equal((await load(repo, settlingId)).status, "settling");
  });

  await scenario("a missing transaction is reported as not found", async () => {
    const repo = new InMemoryTransactionRepository();
    const result = await repo.acquireAirtimeFulfilmentReservation({
      transactionId: "tx_p6_missing",
      requestId: REQUEST_ID,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "TRANSACTION_NOT_FOUND");
  });

  await scenario("a different request id can never hijack a reserved row", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedAirtime(repo, "settled", "mismatch01");
    await reserve(repo, transactionId);

    const hijack = await repo.acquireAirtimeFulfilmentReservation({
      transactionId,
      requestId: OTHER_REQUEST_ID,
    });

    assert.equal(hijack.ok, false);
    if (hijack.ok) return;
    assert.equal(hijack.error, "FULFILMENT_REQUEST_ID_MISMATCH");
    assert.equal((await load(repo, transactionId)).metadata?.clubkonnect_request_id, REQUEST_ID);
  });

  await scenario("a processing row without a bound request id fails closed", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedAirtime(repo, "settled", "noreq01");
    const moved = await repo.updateStatus(transactionId, { status: "processing" });
    assert.equal(moved.ok, true, "airtime settled -> processing is legal");

    const result = await repo.acquireAirtimeFulfilmentReservation({
      transactionId,
      requestId: REQUEST_ID,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "FULFILMENT_METADATA_INVALID");
    assert.ok(result.message.includes("without a bound fulfilment request id"));
  });

  await scenario("malformed fulfilment metadata fails closed", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedAirtime(repo, "settled", "badmeta01", {
      metadata: { fulfilment_attempts: 2 },
    });

    const result = await repo.acquireAirtimeFulfilmentReservation({
      transactionId,
      requestId: REQUEST_ID,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "FULFILMENT_METADATA_INVALID");
  });

  await scenario("terminal rows report their precise terminal state", async () => {
    const repo = new InMemoryTransactionRepository();

    const completedId = await seedClaimedAirtime(repo, "term01");
    const completed = await repo.recordAirtimeFulfilmentOutcome(
      outcomeInput(completedId, {
        normalizedStatus: "completed",
        statusCode: "200",
        rawStatus: "ORDER_COMPLETED",
        orderId: ORDER_ID,
      }),
    );
    assert.equal(completed.ok, true);

    const completedReservation = await repo.acquireAirtimeFulfilmentReservation({
      transactionId: completedId,
      requestId: REQUEST_ID,
    });
    assert.equal(completedReservation.ok, true);
    if (!completedReservation.ok) return;
    assert.equal(completedReservation.status, "already_completed");
    assert.equal(completedReservation.state, "already_completed");

    const failedId = await seedClaimedAirtime(repo, "term02");
    const failed = await repo.recordAirtimeFulfilmentOutcome(
      outcomeInput(failedId, {
        normalizedStatus: "failed",
        statusCode: "417",
        rawStatus: "Insufficient Balance",
        failureCode: "PROVIDER_FLOAT_EXHAUSTED",
        failureReason: "Provider operating float exhausted",
      }),
    );
    assert.equal(failed.ok, true);

    const failedReservation = await repo.acquireAirtimeFulfilmentReservation({
      transactionId: failedId,
      requestId: REQUEST_ID,
    });
    assert.equal(failedReservation.ok, true);
    if (!failedReservation.ok) return;
    assert.equal(failedReservation.status, "already_failed_or_refunded");
    assert.equal(failedReservation.state, "already_failed");

    const refundedId = await seedAirtime(repo, "settling", "term03");
    const refunded = await repo.updateStatus(refundedId, { status: "refunded" });
    assert.equal(refunded.ok, true, "settling -> refunded is legal for airtime");
    const refundReservation = await repo.acquireAirtimeFulfilmentReservation({
      transactionId: refundedId,
      requestId: REQUEST_ID,
    });
    assert.equal(refundReservation.ok, true);
    if (!refundReservation.ok) return;
    assert.equal(refundReservation.status, "already_failed_or_refunded");
    assert.equal(refundReservation.state, "already_refunded");
    assert.equal(refundReservation.transaction.status, "refunded");
  });

  /* ------------------------------------------------------------------ */
  /* 2. The purchase attempt is one-shot                                 */
  /* ------------------------------------------------------------------ */

  await scenario("the purchase attempt is claimed exactly once", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedAirtime(repo, "settled", "claim01");
    await reserve(repo, transactionId);

    const [first, second] = await Promise.all([
      repo.claimAirtimeFulfilmentAttempt({ transactionId, requestId: REQUEST_ID }),
      repo.claimAirtimeFulfilmentAttempt({ transactionId, requestId: REQUEST_ID }),
    ]);

    const statuses = [first, second].map((result) => (result.ok ? result.status : result.error));
    assert.deepEqual(statuses.sort(), ["already_claimed", "claimed"]);

    const third = await repo.claimAirtimeFulfilmentAttempt({
      transactionId,
      requestId: REQUEST_ID,
    });
    assert.equal(third.ok, true);
    if (!third.ok) return;
    assert.equal(third.status, "already_claimed");
    assert.equal(third.state, "already_claimed");

    const stored = await load(repo, transactionId);
    assert.equal(stored.metadata?.fulfilment_attempts, 1);
    assert.equal(stored.status, "processing");
  });

  await scenario("no attempt can be claimed before a reservation", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedAirtime(repo, "settled", "claim02");

    const result = await repo.claimAirtimeFulfilmentAttempt({
      transactionId,
      requestId: REQUEST_ID,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "FULFILMENT_NOT_ELIGIBLE");
    assert.equal(result.record?.status, "settled");
  });

  await scenario("an attempt cannot be claimed with a foreign request id", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedAirtime(repo, "settled", "claim03");
    await reserve(repo, transactionId);

    const result = await repo.claimAirtimeFulfilmentAttempt({
      transactionId,
      requestId: OTHER_REQUEST_ID,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "FULFILMENT_REQUEST_ID_MISMATCH");
    assert.equal((await load(repo, transactionId)).metadata?.fulfilment_attempts, 0);
  });

  /* ------------------------------------------------------------------ */
  /* 3. Provider outcomes map exactly                                    */
  /* ------------------------------------------------------------------ */

  await scenario("statuscode 200 completes the transaction", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedClaimedAirtime(repo, "out200");

    const result = await repo.recordAirtimeFulfilmentOutcome(
      outcomeInput(transactionId, {
        normalizedStatus: "completed",
        statusCode: "200",
        rawStatus: "ORDER_COMPLETED",
        orderId: ORDER_ID,
        reconciliationRequired: true,
      }),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.changed, true);
    assert.equal(result.transaction.status, "completed");
    assert.equal(result.record.status, "completed");

    const stored = await load(repo, transactionId);
    assert.equal(stored.metadata?.fulfilment_status, "completed");
    assert.equal(stored.metadata?.clubkonnect_order_id, ORDER_ID);
    assert.equal(stored.metadata?.clubkonnect_status_code, "200");
    assert.equal(stored.metadata?.clubkonnect_raw_status, "ORDER_COMPLETED");
    assert.equal(stored.metadata?.fulfilment_reconciliation_required, false, "200 never needs reconciliation");
    assert.equal(typeof stored.metadata?.fulfilled_at, "string");
    assert.equal(stored.metadata?.fulfilment_attempts, 1);
    assert.equal(stored.failureCode, null);
    assert.equal(stored.failureReason, null);
  });

  await scenario("statuscode 100 and 300 stay in flight", async () => {
    const repo = new InMemoryTransactionRepository();

    for (const [suffix, statusCode, rawStatus] of [
      ["out100", "100", "ORDER_RECEIVED"],
      ["out300", "300", "PROCESSING"],
    ] as const) {
      const transactionId = await seedClaimedAirtime(repo, suffix);
      const result = await repo.recordAirtimeFulfilmentOutcome(
        outcomeInput(transactionId, { statusCode, rawStatus }),
      );

      assert.equal(result.ok, true);
      if (!result.ok) continue;
      assert.equal(result.transaction.status, "processing");

      const stored = await load(repo, transactionId);
      assert.equal(stored.status, "processing");
      assert.equal(stored.metadata?.fulfilment_status, "processing");
      assert.equal(stored.metadata?.clubkonnect_status_code, statusCode);
      assert.equal(stored.metadata?.fulfilment_reconciliation_required, false);
      assert.equal(stored.metadata?.fulfilled_at, null);
      assert.equal(typeof stored.metadata?.fulfilment_last_checked_at, "string");
    }
  });

  await scenario("statuscode 201 stays in flight and requires reconciliation", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedClaimedAirtime(repo, "out201");

    const result = await repo.recordAirtimeFulfilmentOutcome(
      outcomeInput(transactionId, {
        normalizedStatus: "unknown",
        statusCode: "201",
        rawStatus: "Network Unresponsive",
        orderId: ORDER_ID,
        reconciliationRequired: false,
        failureCode: "PROVIDER_NETWORK_UNRESPONSIVE",
        failureReason: "Provider network unresponsive; reconciliation required",
      }),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;

    const stored = await load(repo, transactionId);
    assert.equal(stored.status, "processing", "201 is never success and never terminal failure");
    assert.equal(stored.metadata?.fulfilment_status, "unknown");
    assert.equal(stored.metadata?.fulfilment_reconciliation_required, true);
    assert.equal(stored.metadata?.clubkonnect_order_id, ORDER_ID);
    assert.equal(stored.metadata?.fulfilment_last_error_code, "PROVIDER_NETWORK_UNRESPONSIVE");
    assert.equal(stored.metadata?.fulfilled_at, null);
    assert.equal(stored.failureCode, null, "an unknown outcome is not a terminal failure");
  });

  await scenario("a timeout or unreadable answer is unknown and needs reconciliation", async () => {
    const repo = new InMemoryTransactionRepository();

    for (const [suffix, statusCode] of [
      ["timeout01", "TIMEOUT"],
      ["unreadable01", "UNKNOWN"],
    ] as const) {
      const transactionId = await seedClaimedAirtime(repo, suffix);
      const result = await repo.recordAirtimeFulfilmentOutcome(
        outcomeInput(transactionId, {
          normalizedStatus: "unknown",
          statusCode,
          rawStatus: "Unrecognized provider response",
          reconciliationRequired: false,
          failureCode: "UNKNOWN_OUTCOME",
          failureReason: "Unrecognized provider response; reconciliation required",
        }),
      );

      assert.equal(result.ok, true);
      if (!result.ok) continue;

      const stored = await load(repo, transactionId);
      assert.equal(stored.status, "processing");
      assert.equal(stored.metadata?.fulfilment_status, "unknown");
      assert.equal(stored.metadata?.fulfilment_reconciliation_required, true);
      assert.equal(stored.metadata?.clubkonnect_status_code, statusCode);
    }
  });

  await scenario("statuscode 417 fails the transaction without inventing a refund", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedClaimedAirtime(repo, "out417");

    const result = await repo.recordAirtimeFulfilmentOutcome(
      outcomeInput(transactionId, {
        normalizedStatus: "failed",
        statusCode: "417",
        rawStatus: "Insufficient Balance",
        failureCode: "PROVIDER_FLOAT_EXHAUSTED",
        failureReason: "Provider operating float exhausted",
      }),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.transaction.status, "failed");

    const stored = await load(repo, transactionId);
    assert.equal(stored.status, "failed");
    assert.equal(stored.failureCode, "PROVIDER_FLOAT_EXHAUSTED");
    assert.equal(stored.failureReason, "Provider operating float exhausted");
    assert.equal(stored.metadata?.fulfilment_status, "failed");
    assert.equal(stored.metadata?.fulfilment_last_error_code, "PROVIDER_FLOAT_EXHAUSTED");
    assert.equal(stored.metadata?.fulfilment_reconciliation_required, false);
    assert.equal(stored.metadata?.fulfilled_at, null);
    assert.equal(stored.paycrestStatus, "validated", "no refund is invented");
  });

  await scenario("an outcome cannot be recorded before a reservation", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedAirtime(repo, "settled", "early01");

    const result = await repo.recordAirtimeFulfilmentOutcome(outcomeInput(transactionId));

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "FULFILMENT_NOT_ELIGIBLE");
    assert.equal((await load(repo, transactionId)).status, "settled");
  });

  await scenario("an outcome for a cash-out is rejected", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedAirtime(repo, "settling", "cashout02", {
      type: "cash_out",
    });

    const result = await repo.recordAirtimeFulfilmentOutcome(outcomeInput(transactionId));

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "FULFILMENT_INVALID_TYPE");
  });

  /* ------------------------------------------------------------------ */
  /* 4. Terminal protection and write-once order ids                     */
  /* ------------------------------------------------------------------ */

  await scenario("a completed row is never downgraded by a stale in-flight answer", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedClaimedAirtime(repo, "guard01");
    await repo.recordAirtimeFulfilmentOutcome(
      outcomeInput(transactionId, {
        normalizedStatus: "completed",
        statusCode: "200",
        rawStatus: "ORDER_COMPLETED",
        orderId: ORDER_ID,
      }),
    );

    const stale = await repo.recordAirtimeFulfilmentOutcome(
      outcomeInput(transactionId, {
        statusCode: "100",
        rawStatus: "ORDER_RECEIVED",
        orderId: ORDER_ID,
      }),
    );

    assert.equal(stale.ok, true);
    if (!stale.ok) return;
    assert.equal(stale.changed, false);
    assert.equal(stale.transaction.status, "completed");
    assert.equal(stale.transaction.metadata?.fulfilment_status, "completed");

    const stored = await load(repo, transactionId);
    assert.equal(stored.status, "completed");
    assert.equal(stored.metadata?.fulfilment_status, "completed");
    assert.equal(stored.metadata?.clubkonnect_status_code, "200");
    assert.equal(typeof stored.metadata?.fulfilled_at, "string");
  });

  await scenario("a failed row is never completed by a later success", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedClaimedAirtime(repo, "guard02");
    await repo.recordAirtimeFulfilmentOutcome(
      outcomeInput(transactionId, {
        normalizedStatus: "failed",
        statusCode: "417",
        rawStatus: "Insufficient Balance",
        failureCode: "PROVIDER_FLOAT_EXHAUSTED",
        failureReason: "Provider operating float exhausted",
      }),
    );

    const lateSuccess = await repo.recordAirtimeFulfilmentOutcome(
      outcomeInput(transactionId, {
        normalizedStatus: "completed",
        statusCode: "200",
        rawStatus: "ORDER_COMPLETED",
        orderId: ORDER_ID,
      }),
    );

    assert.equal(lateSuccess.ok, true);
    if (!lateSuccess.ok) return;
    assert.equal(lateSuccess.changed, false);
    assert.equal(lateSuccess.transaction.status, "failed");

    const stored = await load(repo, transactionId);
    assert.equal(stored.status, "failed");
    assert.equal(stored.metadata?.fulfilment_status, "failed");
    assert.equal(stored.metadata?.fulfilled_at, null);
    assert.equal(stored.failureCode, "PROVIDER_FLOAT_EXHAUSTED");
  });

  await scenario("a provider order id is write-once", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedClaimedAirtime(repo, "order01");

    const unknown = await repo.recordAirtimeFulfilmentOutcome(
      outcomeInput(transactionId, {
        normalizedStatus: "unknown",
        statusCode: "201",
        rawStatus: "Network Unresponsive",
        orderId: ORDER_ID,
        failureCode: "PROVIDER_NETWORK_UNRESPONSIVE",
        failureReason: "Provider network unresponsive; reconciliation required",
      }),
    );
    assert.equal(unknown.ok, true);
    if (!unknown.ok) return;
    assert.equal(unknown.transaction.metadata?.clubkonnect_order_id, ORDER_ID);

    // The same order id is idempotent...
    const repeat = await repo.recordAirtimeFulfilmentOutcome(
      outcomeInput(transactionId, {
        normalizedStatus: "completed",
        statusCode: "200",
        rawStatus: "ORDER_COMPLETED",
        orderId: ORDER_ID,
      }),
    );
    assert.equal(repeat.ok, true);

    // ...but a different order id must never overwrite the first one.
    const conflicting = await repo.recordAirtimeFulfilmentOutcome(
      outcomeInput(transactionId, {
        normalizedStatus: "completed",
        statusCode: "200",
        rawStatus: "ORDER_COMPLETED",
        orderId: "CK-ORDER-2",
      }),
    );
    assert.equal(conflicting.ok, false);
    if (conflicting.ok) return;
    assert.equal(conflicting.error, "FULFILMENT_ORDER_ID_CONFLICT");
    assert.ok(conflicting.message.includes("CK-ORDER-2"));
    assert.ok(conflicting.message.includes(ORDER_ID));

    const stored = await load(repo, transactionId);
    assert.equal(stored.metadata?.clubkonnect_order_id, ORDER_ID);
    assert.equal(stored.status, "completed");
  });

  await scenario("a failed row keeps its persisted order id against a conflicting one", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedClaimedAirtime(repo, "order02");

    await repo.recordAirtimeFulfilmentOutcome(
      outcomeInput(transactionId, {
        normalizedStatus: "failed",
        statusCode: "417",
        rawStatus: "Insufficient Balance",
        orderId: ORDER_ID,
        failureCode: "PROVIDER_FLOAT_EXHAUSTED",
        failureReason: "Provider operating float exhausted",
      }),
    );

    const conflicting = await repo.recordAirtimeFulfilmentOutcome(
      outcomeInput(transactionId, {
        normalizedStatus: "completed",
        statusCode: "200",
        rawStatus: "ORDER_COMPLETED",
        orderId: "CK-ORDER-2",
      }),
    );

    assert.equal(conflicting.ok, false);
    if (conflicting.ok) return;
    assert.equal(conflicting.error, "FULFILMENT_ORDER_ID_CONFLICT");
    assert.ok(conflicting.message.includes("CK-ORDER-2"));
    assert.equal((await load(repo, transactionId)).status, "failed");
  });

  await scenario("provider text is sanitized and bounded before persistence", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedClaimedAirtime(repo, "sanitize01");

    const result = await repo.recordAirtimeFulfilmentOutcome(
      outcomeInput(transactionId, {
        normalizedStatus: "unknown",
        statusCode: `9${"9".repeat(120)}`,
        rawStatus: "upstream said apikey=SUPERSECRETVALUE\nleaked second line",
        reconciliationRequired: true,
      }),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;

    const stored = await load(repo, transactionId);
    const rawStatus = stored.metadata?.clubkonnect_raw_status;
    const statusCode = stored.metadata?.clubkonnect_status_code;

    assert.equal(typeof rawStatus, "string");
    assert.equal((rawStatus as string).includes("SUPERSECRETVALUE"), false, "secrets must be redacted");
    assert.equal((rawStatus as string).includes("\n"), false, "raw status must be a single line");
    assert.equal(typeof statusCode, "string");
    assert.equal((statusCode as string).length, 64, "status codes are bounded");
  });

  await scenario("a sanitized failure reason is persisted on both surfaces", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedClaimedAirtime(repo, "sanitize02");

    const result = await repo.recordAirtimeFulfilmentOutcome(
      outcomeInput(transactionId, {
        normalizedStatus: "failed",
        statusCode: "417",
        rawStatus: "Insufficient Balance",
        failureCode: "PROVIDER_FLOAT_EXHAUSTED",
        failureReason: "float exhausted secret=SUPERSECRETVALUE",
      }),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;

    const stored = await load(repo, transactionId);
    assert.equal(stored.failureCode, "PROVIDER_FLOAT_EXHAUSTED");
    assert.equal(stored.failureReason?.includes("SUPERSECRETVALUE"), false, "secrets must be redacted");
    assert.equal(
      stored.metadata?.fulfilment_last_error_reason?.includes("SUPERSECRETVALUE"),
      false,
    );
  });

  await scenario("a settled row that already spent its attempt is never re-reserved", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedAirtime(repo, "settled", "spent01", {
      metadata: { clubkonnect_request_id: REQUEST_ID, fulfilment_attempts: 1 },
    });

    const result = await repo.acquireAirtimeFulfilmentReservation({
      transactionId,
      requestId: REQUEST_ID,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "FULFILMENT_METADATA_INVALID");
    assert.ok(result.message.includes("purchase attempt"));

    const stored = await load(repo, transactionId);
    assert.equal(stored.status, "settled");
    assert.equal(stored.metadata?.fulfilment_attempts, 1, "the spent attempt is never reset");
  });

  await scenario("a completion claim without statuscode 200 is refused", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedClaimedAirtime(repo, "gate01");

    const result = await repo.recordAirtimeFulfilmentOutcome(
      outcomeInput(transactionId, {
        normalizedStatus: "completed",
        statusCode: "201",
        rawStatus: "ORDER_COMPLETED",
        orderId: ORDER_ID,
      }),
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "FULFILMENT_METADATA_INVALID");
    assert.ok(result.message.includes("200"));

    const stored = await load(repo, transactionId);
    assert.equal(stored.status, "processing", "a contradictory completion never persists");
    assert.equal(stored.metadata?.fulfilled_at, null);
    assert.notEqual(stored.metadata?.fulfilment_status, "completed");
  });

  await scenario("a duplicate statuscode 200 keeps the original fulfilled_at", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedClaimedAirtime(repo, "idem200");
    const success = outcomeInput(transactionId, {
      normalizedStatus: "completed",
      statusCode: "200",
      rawStatus: "ORDER_COMPLETED",
      orderId: ORDER_ID,
    });

    const first = await repo.recordAirtimeFulfilmentOutcome(success);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const fulfilledAt = first.transaction.metadata?.fulfilled_at;
    assert.equal(typeof fulfilledAt, "string");

    const duplicate = await repo.recordAirtimeFulfilmentOutcome(success);
    assert.equal(duplicate.ok, true);
    if (!duplicate.ok) return;
    assert.equal(duplicate.changed, false);
    assert.equal(duplicate.transaction.metadata?.fulfilled_at, fulfilledAt);
  });

  await scenario("operation-only codes report a missing bound request id precisely", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedAirtime(repo, "settled", "opmissing01");
    const moved = await repo.updateStatus(transactionId, { status: "processing" });
    assert.equal(moved.ok, true);

    const claimed = await repo.claimAirtimeFulfilmentAttempt({
      transactionId,
      requestId: REQUEST_ID,
    });
    assert.equal(claimed.ok, false);
    if (!claimed.ok) assert.equal(claimed.error, "FULFILMENT_REQUEST_ID_MISSING");

    const recorded = await repo.recordAirtimeFulfilmentOutcome(outcomeInput(transactionId));
    assert.equal(recorded.ok, false);
    if (!recorded.ok) assert.equal(recorded.error, "FULFILMENT_REQUEST_ID_MISSING");

    const preflight = await repo.recordAirtimeFulfilmentPreflightFailure({
      transactionId,
      requestId: REQUEST_ID,
      failureCode: "PROVIDER_FLOAT_EXHAUSTED",
      failureReason: "Provider operating float exhausted",
    });
    assert.equal(preflight.ok, false);
    if (!preflight.ok) assert.equal(preflight.error, "FULFILMENT_REQUEST_ID_MISSING");

    assert.equal((await load(repo, transactionId)).status, "processing");
  });

  /* ------------------------------------------------------------------ */
  /* 5. Pre-purchase (preflight) failures                                 */
  /* ------------------------------------------------------------------ */

  await scenario("a preflight failure fails the row without spending the attempt", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedAirtime(repo, "settled", "preflight01");
    await reserve(repo, transactionId);

    const result = await repo.recordAirtimeFulfilmentPreflightFailure({
      transactionId,
      requestId: REQUEST_ID,
      failureCode: "PROVIDER_FLOAT_EXHAUSTED",
      failureReason: "Provider operating float exhausted",
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.changed, true);
    assert.equal(result.transaction.status, "failed");

    const stored = await load(repo, transactionId);
    assert.equal(stored.status, "failed");
    assert.equal(stored.failureCode, "PROVIDER_FLOAT_EXHAUSTED");
    assert.equal(stored.metadata?.fulfilment_status, "failed");
    assert.equal(stored.metadata?.fulfilment_attempts, 0, "no purchase was attempted");
    assert.equal(stored.metadata?.fulfilment_reconciliation_required, false);
    assert.equal(stored.metadata?.fulfilled_at, null);
  });

  await scenario("a preflight failure after a claimed attempt is refused", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedClaimedAirtime(repo, "preflight02");

    const result = await repo.recordAirtimeFulfilmentPreflightFailure({
      transactionId,
      requestId: REQUEST_ID,
      failureCode: "PROVIDER_FLOAT_EXHAUSTED",
      failureReason: "Provider operating float exhausted",
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "FULFILMENT_METADATA_INVALID");
    assert.equal((await load(repo, transactionId)).status, "processing");
  });

  await scenario("a preflight failure is refused before the row is reserved", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedAirtime(repo, "settled", "preflight03");

    const result = await repo.recordAirtimeFulfilmentPreflightFailure({
      transactionId,
      requestId: REQUEST_ID,
      failureCode: "PROVIDER_FLOAT_EXHAUSTED",
      failureReason: "Provider operating float exhausted",
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "FULFILMENT_NOT_ELIGIBLE");
    assert.equal((await load(repo, transactionId)).status, "settled");
  });

  await scenario("a terminal row is a no-op for a late preflight failure", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedClaimedAirtime(repo, "preflight04");
    await repo.recordAirtimeFulfilmentOutcome(
      outcomeInput(transactionId, {
        normalizedStatus: "completed",
        statusCode: "200",
        rawStatus: "ORDER_COMPLETED",
        orderId: ORDER_ID,
      }),
    );

    const result = await repo.recordAirtimeFulfilmentPreflightFailure({
      transactionId,
      requestId: REQUEST_ID,
      failureCode: "PROVIDER_FLOAT_EXHAUSTED",
      failureReason: "Provider operating float exhausted",
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.changed, false);
    assert.equal(result.transaction.status, "completed");
  });

  /* ------------------------------------------------------------------ */
  /* 6. Public DTO projection                                            */
  /* ------------------------------------------------------------------ */

  await scenario("the public DTO projects a sanitized fulfilment view", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedClaimedAirtime(repo, "dto01");
    await repo.recordAirtimeFulfilmentOutcome(
      outcomeInput(transactionId, {
        normalizedStatus: "unknown",
        statusCode: "201",
        rawStatus: "Network Unresponsive",
        orderId: ORDER_ID,
        failureCode: "PROVIDER_NETWORK_UNRESPONSIVE",
        failureReason: "Provider network unresponsive; reconciliation required",
      }),
    );

    const stored = await load(repo, transactionId);
    const dto = toPublicTransactionDto({
      ...stored,
      metadata: {
        ...stored.metadata,
        internalSecretKey: "SHOULD_NOT_LEAK",
        apikey: "SECRET_KEY_XYZ",
      },
    });

    assert.ok(dto.fulfilment, "airtime fulfilment must be projected");
    if (!dto.fulfilment) return;
    assert.equal(dto.fulfilment.provider, "clubkonnect");
    assert.equal(dto.fulfilment.requestId, REQUEST_ID);
    assert.equal(dto.fulfilment.orderId, ORDER_ID);
    assert.equal(dto.fulfilment.statusCode, "201");
    assert.equal(dto.fulfilment.rawStatus, "Network Unresponsive");
    assert.equal(dto.fulfilment.normalizedStatus, "unknown");
    assert.equal(dto.fulfilment.attempts, 1);
    assert.equal(typeof dto.fulfilment.reservedAt, "string");
    assert.equal(dto.fulfilment.fulfilledAt, null);
    assert.equal(dto.fulfilment.reconciliationRequired, true);

    const serialized = JSON.stringify(dto);
    assert.equal(serialized.includes("SHOULD_NOT_LEAK"), false);
    assert.equal(serialized.includes("SECRET_KEY_XYZ"), false);
    assert.equal(serialized.includes("clubkonnect_raw_status"), false);
    assert.equal(serialized.includes("fulfilment_last_error_reason"), false);
  });

  await scenario("a completed airtime row projects its fulfilment timestamps", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedClaimedAirtime(repo, "dto02");
    await repo.recordAirtimeFulfilmentOutcome(
      outcomeInput(transactionId, {
        normalizedStatus: "completed",
        statusCode: "200",
        rawStatus: "ORDER_COMPLETED",
        orderId: ORDER_ID,
      }),
    );

    const dto = toPublicTransactionDto(await load(repo, transactionId));

    assert.ok(dto.fulfilment);
    if (!dto.fulfilment) return;
    assert.equal(dto.fulfilment.normalizedStatus, "completed");
    assert.equal(dto.fulfilment.reconciliationRequired, false);
    assert.equal(typeof dto.fulfilment.fulfilledAt, "string");
  });

  await scenario("a cash-out never projects fulfilment", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedAirtime(repo, "settled", "dto03", {
      type: "cash_out",
    });

    const dto = toPublicTransactionDto(await load(repo, transactionId));

    assert.equal(dto.fulfilment, null);
  });

  await scenario("an airtime row without fulfilment metadata projects null", async () => {
    const repo = new InMemoryTransactionRepository();
    const transactionId = await seedAirtime(repo, "settled", "dto04");

    const dto = toPublicTransactionDto(await load(repo, transactionId));

    assert.equal(dto.fulfilment, null);
  });

  /* ------------------------------------------------------------------ */
  /* 7. Fail-closed database access                                      */
  /* ------------------------------------------------------------------ */

  await scenario("a Drizzle repository without a database fails closed", async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      const repo = new DrizzleTransactionRepository();

      const reservation = await repo.acquireAirtimeFulfilmentReservation({
        transactionId: "tx_p6_dbless",
        requestId: REQUEST_ID,
      });
      assert.equal(reservation.ok, false);
      if (!reservation.ok) assert.equal(reservation.error, "DATABASE_UNAVAILABLE");

      const claimResult = await repo.claimAirtimeFulfilmentAttempt({
        transactionId: "tx_p6_dbless",
        requestId: REQUEST_ID,
      });
      assert.equal(claimResult.ok, false);
      if (!claimResult.ok) assert.equal(claimResult.error, "DATABASE_UNAVAILABLE");

      const recorded = await repo.recordAirtimeFulfilmentOutcome(
        outcomeInput("tx_p6_dbless"),
      );
      assert.equal(recorded.ok, false);
      if (!recorded.ok) assert.equal(recorded.error, "DATABASE_UNAVAILABLE");

      const preflight = await repo.recordAirtimeFulfilmentPreflightFailure({
        transactionId: "tx_p6_dbless",
        requestId: REQUEST_ID,
        failureCode: "PROVIDER_FLOAT_EXHAUSTED",
        failureReason: "Provider operating float exhausted",
      });
      assert.equal(preflight.ok, false);
      if (!preflight.ok) assert.equal(preflight.error, "DATABASE_UNAVAILABLE");
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });

  if (failures.length > 0) {
    console.error(`\n${failures.length} scenario(s) failed:`);
    for (const name of failures) console.error(`  - ${name}`);
    process.exit(1);
  }

  console.log("P6 airtime fulfilment repository self-check: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
