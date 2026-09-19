/**
 * Self-check suite for Providus P1 transaction persistence & state machine.
 * Run: npx tsx lib/transactions/persistence-self-check.ts
 */

import assert from "node:assert/strict";
import {
  InMemoryTransactionRepository,
  isTerminalStatus,
  sanitizeFailureReason,
  shouldAdvancePaycrestStatus,
  validateStatusTransition,
  type CreateTransactionInput,
} from "@/lib/transactions";

async function run() {
  console.info("Starting P1 persistence & state machine self-check...");

  const repo = new InMemoryTransactionRepository();

  // 1. Unique idempotency & creation
  const input1: CreateTransactionInput = {
    idempotencyKey: "idem_test_1",
    type: "cash_out",
    walletAddress: "0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa",
    amountUsdc: "10.500000",
    paycrestReference: "p4b_test_ref_1",
    metadata: { institutionName: "GTBank", accountName: "TEST USER" },
  };

  const createRes1 = await repo.create(input1);
  assert.equal(createRes1.ok, true, "First create should succeed");
  if (!createRes1.ok) return;

  assert.equal(createRes1.reused, false, "First create should not be reused");
  assert.equal(createRes1.record.status, "pending", "Initial status must be pending");
  assert.equal(createRes1.record.idempotencyKey, "idem_test_1");
  assert.equal(createRes1.record.amountUsdc, "10.500000");

  // 2. Duplicate create returns/reuses safely
  const createResDuplicate = await repo.create(input1);
  assert.equal(createResDuplicate.ok, true, "Duplicate create should succeed");
  if (!createResDuplicate.ok) return;

  assert.equal(createResDuplicate.reused, true, "Duplicate create must return reused: true");
  assert.equal(createResDuplicate.record.id, createRes1.record.id, "Must return same transaction ID");

  // 3. Bind Paycrest Order ID
  const bindOrderRes = await repo.bindPaycrestOrder({
    id: createRes1.record.id,
    paycrestOrderId: "pc_ord_123",
    receiveAddress: "0x1111111111111111111111111111111111111111",
    validUntil: "2026-09-19T12:00:00.000Z",
    paycrestStatus: "initiated",
  });
  assert.equal(bindOrderRes.ok, true, "Binding Paycrest order should succeed");
  if (!bindOrderRes.ok) return;
  assert.equal(bindOrderRes.record.paycrestOrderId, "pc_ord_123");
  assert.equal(bindOrderRes.record.receiveAddress, "0x1111111111111111111111111111111111111111");

  // 4. Bind Celo Tx Hash and transition to settling
  const validHash = "0x" + "a".repeat(64);
  const bindHashRes = await repo.bindCeloTxHash({
    id: createRes1.record.id,
    celoTxHash: validHash,
  });
  assert.equal(bindHashRes.ok, true, "Binding valid Celo tx hash should succeed");
  if (!bindHashRes.ok) return;
  assert.equal(bindHashRes.record.status, "settling", "Status should transition to settling");
  assert.equal(bindHashRes.record.celoTxHash, validHash);

  // Duplicate bind of same hash is safe & idempotent
  const rebindRes = await repo.bindCeloTxHash({
    id: createRes1.record.id,
    celoTxHash: validHash,
  });
  assert.equal(rebindRes.ok, true, "Re-binding same hash should be safe");

  // Rejects invalid tx hash format
  const invalidHashRes = await repo.bindCeloTxHash({
    id: createRes1.record.id,
    celoTxHash: "0x123", // Too short
  });
  assert.equal(invalidHashRes.ok, false, "Invalid hash must be rejected");

  // 5. Legal State Transitions
  // settling -> settled is legal
  const settleRes = await repo.updateStatus(createRes1.record.id, {
    status: "settled",
    paycrestStatus: "settled",
  });
  assert.equal(settleRes.ok, true, "settling -> settled is legal");
  if (!settleRes.ok) return;
  assert.equal(settleRes.record.status, "settled");

  // 6. Terminal State Protection
  // settled is terminal; cannot transition backward to pending, settling, or failed!
  const illegalPending = await repo.updateStatus(createRes1.record.id, {
    status: "pending",
  });
  assert.equal(illegalPending.ok, false, "Cannot transition from settled to pending");

  const illegalSettling = await repo.updateStatus(createRes1.record.id, {
    status: "settling",
  });
  assert.equal(illegalSettling.ok, false, "Cannot transition from settled to settling");

  const illegalFailed = await repo.updateStatus(createRes1.record.id, {
    status: "failed",
  });
  assert.equal(illegalFailed.ok, false, "Cannot transition from settled to failed");

  // Repeat of same terminal state is an idempotent no-op
  const idempotentSettled = await repo.updateStatus(createRes1.record.id, {
    status: "settled",
  });
  assert.equal(idempotentSettled.ok, true, "Re-applying settled is an idempotent no-op");
  if (idempotentSettled.ok) {
    assert.equal(idempotentSettled.isNoop, true);
  }

  // 7. Transition Validator Unit Checks
  // cash_out lifecycle: pending -> settling -> settled
  assert.equal(validateStatusTransition("pending", "settling", "cash_out").allowed, true);
  assert.equal(validateStatusTransition("pending", "failed", "cash_out").allowed, true);
  assert.equal(validateStatusTransition("settling", "settled", "cash_out").allowed, true);
  assert.equal(validateStatusTransition("settling", "refunded", "cash_out").allowed, true);
  assert.equal(validateStatusTransition("settling", "failed", "cash_out").allowed, true);

  // cash_out terminality: cash_out CANNOT accidentally enter fulfilment!
  assert.equal(
    validateStatusTransition("settled", "processing", "cash_out").allowed,
    false,
    "cash_out MUST NOT accidentally enter fulfilment (processing)",
  );
  assert.equal(
    validateStatusTransition("settled", "completed", "cash_out").allowed,
    false,
    "cash_out MUST NOT enter completed directly",
  );
  assert.equal(isTerminalStatus("settled", "cash_out"), true, "settled is terminal for cash_out");

  // utility lifecycle (airtime): pending -> settling -> settled -> processing -> completed
  assert.equal(validateStatusTransition("pending", "settling", "airtime").allowed, true);
  assert.equal(validateStatusTransition("settling", "settled", "airtime").allowed, true);
  assert.equal(
    validateStatusTransition("settled", "processing", "airtime").allowed,
    true,
    "settled MUST allow transition to processing for utility transactions",
  );
  assert.equal(
    validateStatusTransition("processing", "completed", "airtime").allowed,
    true,
    "processing MUST allow transition to completed for utility transactions",
  );
  assert.equal(
    validateStatusTransition("processing", "failed", "airtime").allowed,
    true,
    "processing MUST allow transition to failed on fulfilment failure",
  );
  assert.equal(
    isTerminalStatus("settled", "airtime"),
    false,
    "settled is NOT terminal for airtime utility transactions",
  );
  assert.equal(
    isTerminalStatus("completed", "airtime"),
    true,
    "completed is terminal for airtime",
  );

  // Terminal states protection: failed & refunded CANNOT be revived under any circumstances
  assert.equal(validateStatusTransition("failed", "settled", "cash_out").allowed, false);
  assert.equal(validateStatusTransition("failed", "pending", "cash_out").allowed, false);
  assert.equal(validateStatusTransition("failed", "processing", "airtime").allowed, false);
  assert.equal(validateStatusTransition("refunded", "settled", "cash_out").allowed, false);
  assert.equal(validateStatusTransition("refunded", "processing", "airtime").allowed, false);
  assert.equal(validateStatusTransition("completed", "settled", "airtime").allowed, false);
  assert.equal(validateStatusTransition("completed", "processing", "airtime").allowed, false);
  assert.equal(isTerminalStatus("failed", "cash_out"), true);
  assert.equal(isTerminalStatus("failed", "airtime"), true);
  assert.equal(isTerminalStatus("refunded", "cash_out"), true);
  assert.equal(isTerminalStatus("refunded", "airtime"), true);
  assert.equal(isTerminalStatus("completed"), true);
  assert.equal(isTerminalStatus("pending"), false);
  assert.equal(isTerminalStatus("settling"), false);

  // 8. End-to-end repository test: utility lifecycle (airtime)
  const airtimeTx = await repo.create({
    idempotencyKey: "idem_airtime_lifecycle_1",
    type: "airtime",
    walletAddress: "0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa",
    amountUsdc: "2.000000",
    paycrestReference: "ref_airtime_1",
  });
  assert.equal(airtimeTx.ok, true);
  if (!airtimeTx.ok) return;
  assert.equal(airtimeTx.record.type, "airtime");
  assert.equal(airtimeTx.record.status, "pending");

  // pending -> settling
  const atHash = await repo.bindCeloTxHash({
    id: airtimeTx.record.id,
    celoTxHash: "0x" + "d".repeat(64),
  });
  assert.equal(atHash.ok, true);
  if (!atHash.ok) return;
  assert.equal(atHash.record.status, "settling");

  // settling -> settled (fiat delivered into utility rail)
  const atSettled = await repo.updateStatus(airtimeTx.record.id, {
    status: "settled",
    paycrestStatus: "validated",
  });
  assert.equal(atSettled.ok, true);
  if (!atSettled.ok) return;
  assert.equal(atSettled.record.status, "settled");

  // settled -> processing (utility fulfilment begins)
  const atProcessing = await repo.updateStatus(airtimeTx.record.id, {
    status: "processing",
  });
  assert.equal(atProcessing.ok, true, "airtime settled -> processing MUST succeed");
  if (!atProcessing.ok) return;
  assert.equal(atProcessing.record.status, "processing");

  // processing -> completed (utility fulfilment finishes)
  const atCompleted = await repo.updateStatus(airtimeTx.record.id, {
    status: "completed",
  });
  assert.equal(atCompleted.ok, true, "airtime processing -> completed MUST succeed");
  if (!atCompleted.ok) return;
  assert.equal(atCompleted.record.status, "completed");

  // completed is terminal: cannot revive or change
  const atIllegalRevive = await repo.updateStatus(airtimeTx.record.id, {
    status: "processing",
  });
  assert.equal(atIllegalRevive.ok, false, "airtime completed MUST NOT be revived");

  // 9. End-to-end repository test: cash_out CANNOT enter processing
  const cashOutBlocked = await repo.updateStatus(createRes1.record.id, {
    status: "processing",
  });
  assert.equal(
    cashOutBlocked.ok,
    false,
    "cash_out from settled to processing MUST be rejected by repository",
  );
  // 10. Upstream paycrestStatus rank progression checks
  assert.equal(shouldAdvancePaycrestStatus("validated", "settling"), true);
  assert.equal(shouldAdvancePaycrestStatus("validated", "settled"), true);
  assert.equal(shouldAdvancePaycrestStatus("fulfilling", "fulfilled"), true);
  assert.equal(shouldAdvancePaycrestStatus("pending", "fulfilling"), true);
  assert.equal(
    shouldAdvancePaycrestStatus("settled", "fulfilling"),
    false,
    "settled cannot be regressed to fulfilling",
  );
  assert.equal(
    shouldAdvancePaycrestStatus("settled", "settling"),
    false,
    "settled cannot be regressed to settling",
  );
  assert.equal(
    shouldAdvancePaycrestStatus("settled", "validated"),
    false,
    "settled cannot be regressed to validated",
  );
  assert.equal(
    shouldAdvancePaycrestStatus("validated", "fulfilling"),
    false,
    "validated cannot be regressed to fulfilling",
  );
  assert.equal(
    shouldAdvancePaycrestStatus("validated", "refunding"),
    false,
    "validated cannot be overwritten by stale refunding",
  );
  assert.equal(
    shouldAdvancePaycrestStatus("settling", "refunding"),
    false,
    "settling cannot be overwritten by stale refunding",
  );
  assert.equal(shouldAdvancePaycrestStatus("settled", "settled"), false, "identical status is no-op");

  // Documented valid refund branch: fulfilling -> refunding -> refunded
  assert.equal(
    shouldAdvancePaycrestStatus("fulfilling", "refunding"),
    true,
    "fulfilling must advance to refunding",
  );
  assert.equal(
    shouldAdvancePaycrestStatus("refunding", "refunded"),
    true,
    "refunding must advance to refunded",
  );
  assert.equal(
    shouldAdvancePaycrestStatus("refunding", "validated"),
    false,
    "refunding CANNOT be revived to validated",
  );
  assert.equal(
    shouldAdvancePaycrestStatus("refunding", "settled"),
    false,
    "refunding CANNOT be revived to settled",
  );
  assert.equal(
    shouldAdvancePaycrestStatus("refunding", "fulfilling"),
    false,
    "refunding CANNOT regress to fulfilling",
  );

  // 11. End-to-end repository test: fulfilling -> refunding -> refunded
  const refundTx = await repo.create({
    idempotencyKey: "idem_refund_branch_1",
    type: "cash_out",
    walletAddress: "0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa",
    amountUsdc: "3.000000",
    paycrestReference: "ref_refund_branch_1",
  });
  assert.equal(refundTx.ok, true);
  if (!refundTx.ok) return;

  await repo.bindCeloTxHash({
    id: refundTx.record.id,
    celoTxHash: "0x" + "f".repeat(64),
  });

  const rFulfilling = await repo.updateStatus(refundTx.record.id, {
    status: "settling",
    paycrestStatus: "fulfilling",
  });
  assert.equal(rFulfilling.ok, true);
  if (!rFulfilling.ok) return;
  assert.equal(rFulfilling.record.paycrestStatus, "fulfilling");

  const rRefunding = await repo.updateStatus(refundTx.record.id, {
    status: "settling",
    paycrestStatus: "refunding",
  });
  assert.equal(rRefunding.ok, true, "settling with refunding paycrestStatus must succeed");
  if (!rRefunding.ok) return;
  assert.equal(rRefunding.record.paycrestStatus, "refunding");

  const rRefunded = await repo.updateStatus(refundTx.record.id, {
    status: "refunded",
    paycrestStatus: "refunded",
  });
  assert.equal(rRefunded.ok, true, "transition to refunded must succeed");
  if (!rRefunded.ok) return;
  assert.equal(rRefunded.record.status, "refunded");
  assert.equal(rRefunded.record.paycrestStatus, "refunded");

  // refunded is terminal
  const rRevive = await repo.updateStatus(refundTx.record.id, {
    status: "settled",
  });
  assert.equal(rRevive.ok, false, "refunded cannot transition to settled");

  // 12. Sanitization checks
  const sensitiveString =
    "Error with api_key=secret_123456789 and Bearer abcdef123456\nat internal/stack/trace.js:10:5";
  const sanitized = sanitizeFailureReason(sensitiveString);
  assert.ok(sanitized, "Sanitized string must exist");
  assert.ok(!sanitized.includes("secret_123456789"), "API key must be redacted");
  assert.ok(!sanitized.includes("abcdef123456"), "Bearer token must be redacted");
  assert.ok(!sanitized.includes("internal/stack/trace.js"), "Stack trace must be stripped");

  console.info("persistence self-check: all assertions passed");
}

run().catch((err) => {
  console.error("persistence self-check failed:", err);
  process.exit(1);
});
