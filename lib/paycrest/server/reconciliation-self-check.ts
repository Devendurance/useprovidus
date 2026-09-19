/**
 * Self-check suite for Paycrest status reconciliation & webhook verification.
 * Run: npx tsx lib/paycrest/server/reconciliation-self-check.ts
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  DOCUMENTED_PAYCREST_STATUSES,
  mapPaycrestStatusToInternal,
  reconcileTransaction,
} from "@/lib/paycrest/server/reconciliation";
import {
  processPaycrestWebhook,
  verifyPaycrestWebhookSignature,
} from "@/lib/paycrest/server/webhook";
import {
  InMemoryTransactionRepository,
  setTransactionRepositoryForTesting,
} from "@/lib/transactions";

async function run() {
  console.info("Starting P1 Paycrest reconciliation self-check...");

  // 1. Verify mapping of all 12 documented statuses
  assert.equal(DOCUMENTED_PAYCREST_STATUSES.length, 12);

  // initiated -> pending (if currently pending)
  const initMap = mapPaycrestStatusToInternal("initiated", "pending");
  assert.equal(initMap.targetStatus, "pending");
  assert.equal(initMap.isDepositConfirmed, false);
  assert.equal(initMap.isFiatFinal, false);

  // deposited -> settling (deposit confirmed, but fiat NOT final!)
  const depMap = mapPaycrestStatusToInternal("deposited", "pending");
  assert.equal(depMap.targetStatus, "settling");
  assert.equal(depMap.isDepositConfirmed, true);
  assert.equal(depMap.isFiatFinal, false, "deposited is NOT fiat finality!");

  // pending / fulfilling / fulfilled -> remain 'settling', fiat NOT final
  for (const s of ["pending", "fulfilling", "fulfilled"]) {
    const m = mapPaycrestStatusToInternal(s, "settling");
    assert.equal(m.targetStatus, "settling", `${s} must map to settling`);
    assert.equal(m.isDepositConfirmed, true);
    assert.equal(m.isFiatFinal, false, `${s} must NOT be fiat final`);
    assert.equal(m.isFiatDelivered, false, `${s} must NOT be fiat delivered`);
    assert.equal(m.isProtocolSettled, false);
  }

  // validated -> provider confirmed fiat delivery! FIAT FINALITY confirmed
  const validatedMap = mapPaycrestStatusToInternal("validated", "settling", "cash_out");
  assert.equal(validatedMap.targetStatus, "settled", "validated MUST map to internal settled");
  assert.equal(validatedMap.isFiatFinal, true, "validated MUST be fiat final");
  assert.equal(validatedMap.isFiatDelivered, true, "validated MUST be fiat delivered");
  assert.equal(validatedMap.isProtocolSettled, false, "validated is waiting for protocol settlement");
  assert.equal(validatedMap.isTerminal, true, "settled is terminal for cash_out");

  // settling:
  // - if currently settling: stays settling
  const settlingFromSettling = mapPaycrestStatusToInternal("settling", "settling");
  assert.equal(settlingFromSettling.targetStatus, "settling");
  assert.equal(settlingFromSettling.isFiatFinal, false);
  // - if currently settled (via validated): stays settled! NEVER reverts!
  const settlingFromSettled = mapPaycrestStatusToInternal("settling", "settled");
  assert.equal(settlingFromSettled.targetStatus, "settled", "settling MUST NOT revert settled state");
  assert.equal(settlingFromSettled.isFiatFinal, true);
  assert.equal(settlingFromSettled.isFiatDelivered, true);

  // settled -> FIAT FINALITY & PROTOCOL SETTLED
  const settledMap = mapPaycrestStatusToInternal("settled", "settling", "cash_out");
  assert.equal(settledMap.targetStatus, "settled");
  assert.equal(settledMap.isFiatFinal, true, "settled MUST be fiat final!");
  assert.equal(settledMap.isFiatDelivered, true);
  assert.equal(settledMap.isProtocolSettled, true, "settled MUST be protocol settled");
  assert.equal(settledMap.isTerminal, true);
  const cancelMap = mapPaycrestStatusToInternal("cancelled", "pending");
  assert.equal(cancelMap.targetStatus, "failed");
  assert.equal(cancelMap.isTerminal, true);

  // refunding -> settling, refunded -> refunded
  const refundingMap = mapPaycrestStatusToInternal("refunding", "settling");
  assert.equal(refundingMap.targetStatus, "settling");
  const refundedMap = mapPaycrestStatusToInternal("refunded", "settling");
  assert.equal(refundedMap.targetStatus, "refunded");
  assert.equal(refundedMap.isTerminal, true);

  // expired: if already settling (deposited), do not drop funds
  const expSettling = mapPaycrestStatusToInternal("expired", "settling");
  assert.equal(expSettling.targetStatus, "settling", "Expired after deposit must remain settling");
  const expPending = mapPaycrestStatusToInternal("expired", "pending");
  assert.equal(expPending.targetStatus, "failed", "Expired before deposit is failed");

  // Unknown upstream status handled safely without corrupting state
  const unknownMap = mapPaycrestStatusToInternal("some_new_future_status", "settling");
  assert.equal(unknownMap.targetStatus, "settling", "Unknown status must preserve current state");
  assert.equal(unknownMap.isFiatFinal, false);

  // 2. State machine reconciliation checks (repeated poll, out-of-order)
  const repo = new InMemoryTransactionRepository();
  setTransactionRepositoryForTesting(repo);

  const txRes = await repo.create({
    idempotencyKey: "idem_recon_1",
    walletAddress: "0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa",
    amountUsdc: "5.000000",
    paycrestReference: "ref_recon_1",
  });
  assert.equal(txRes.ok, true);
  if (!txRes.ok) return;

  await repo.bindPaycrestOrder({
    id: txRes.record.id,
    paycrestOrderId: "ord_recon_1",
    receiveAddress: "0x1111111111111111111111111111111111111111",
  });

  // User deposits on-chain
  await repo.bindCeloTxHash({
    id: txRes.record.id,
    celoTxHash: "0x" + "b".repeat(64),
  });

  // Poll 1: Paycrest reports 'fulfilling' -> internal becomes 'settling'
  const update1 = await repo.updateStatus(txRes.record.id, {
    status: "settling",
    paycrestStatus: "fulfilling",
  });
  assert.equal(update1.ok, true);
  if (!update1.ok) return;
  assert.equal(update1.record.status, "settling");
  assert.equal(update1.record.paycrestStatus, "fulfilling");

  // Poll 2: Same upstream status repeated -> idempotent no-op
  const update2 = await repo.updateStatus(txRes.record.id, {
    status: "settling",
    paycrestStatus: "fulfilling",
  });
  assert.equal(update2.ok, true);
  if (update2.ok) {
    assert.equal(update2.isNoop, true, "Same status repeated must be isNoop: true");
  }

  // Poll 3: Paycrest reports 'validated' -> internal transitions to 'settled' (fiat delivery confirmed)
  const update3 = await repo.updateStatus(txRes.record.id, {
    status: "settled",
    paycrestStatus: "validated",
  });
  assert.equal(update3.ok, true);
  if (!update3.ok) return;
  assert.equal(update3.record.status, "settled");
  assert.equal(update3.record.paycrestStatus, "validated");

  // Poll 4: Paycrest reports 'settling' (on-chain settlement broadcast)
  // MUST NOT revert from 'settled' to 'settling'! It remains 'settled' with updated paycrestStatus.
  const update4 = await repo.updateStatus(txRes.record.id, {
    status: "settled",
    paycrestStatus: "settling",
  });
  assert.equal(update4.ok, true, "Upstream settling after validated must be accepted idempotently");
  if (!update4.ok) return;
  assert.equal(update4.record.status, "settled", "Internal status MUST remain settled");
  assert.equal(update4.record.paycrestStatus, "settling");

  // Poll 5: Paycrest reports 'settled' -> idempotent update of paycrestStatus
  const update5 = await repo.updateStatus(txRes.record.id, {
    status: "settled",
    paycrestStatus: "settled",
  });
  assert.equal(update5.ok, true);
  if (!update5.ok) return;
  assert.equal(update5.record.status, "settled");
  assert.equal(update5.record.paycrestStatus, "settled");

  // Poll 6 (Out-of-order): An out-of-order poll arrives with old 'fulfilling' status
  // It MUST NOT revert from 'settled' to 'settling'!
  const outOfOrder = await repo.updateStatus(txRes.record.id, {
    status: "settling",
    paycrestStatus: "fulfilling",
  });
  assert.equal(outOfOrder.ok, false, "Out-of-order poll must be rejected from terminal settled");
  // 3. Webhook Signature Verification
  const testSecret = "paycrest_webhook_secret_xyz";
  const bodyText = JSON.stringify({
    event: "order.settled",
    data: { id: "ord_recon_1", reference: "ref_recon_1", status: "settled" },
  });

  const validHmac = crypto
    .createHmac("sha256", testSecret)
    .update(bodyText, "utf8")
    .digest("hex");

  // Valid signature check
  const v1 = verifyPaycrestWebhookSignature({
    rawBody: bodyText,
    signatureHeader: validHmac,
    apiSecret: testSecret,
  });
  assert.equal(v1.valid, true, "Valid HMAC must pass verification");

  // Tampered body check
  const v2 = verifyPaycrestWebhookSignature({
    rawBody: bodyText + " ",
    signatureHeader: validHmac,
    apiSecret: testSecret,
  });
  assert.equal(v2.valid, false, "Tampered body must fail verification");

  // Missing secret check
  const v3 = verifyPaycrestWebhookSignature({
    rawBody: bodyText,
    signatureHeader: validHmac,
    apiSecret: "",
  });
  assert.equal(v3.valid, false, "Missing secret must fail verification");

  // Missing header check
  const v4 = verifyPaycrestWebhookSignature({
    rawBody: bodyText,
    signatureHeader: null,
    apiSecret: testSecret,
  });
  assert.equal(v4.valid, false, "Missing header must fail verification");

  // 4. Webhook processing check
  const webhookResult = await processPaycrestWebhook(JSON.parse(bodyText));
  assert.equal(webhookResult.processed, true, "Valid webhook must be processed");

  // 5. Provider timeout during reconcileTransaction does NOT corrupt state
  const txTimeout = await repo.create({
    idempotencyKey: "idem_timeout_test",
    walletAddress: "0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa",
    amountUsdc: "1.000000",
    paycrestReference: "ref_timeout_test",
  });
  assert.equal(txTimeout.ok, true);
  if (!txTimeout.ok) return;

  await repo.bindPaycrestOrder({
    id: txTimeout.record.id,
    paycrestOrderId: "ord_timeout_test",
    receiveAddress: "0x1111111111111111111111111111111111111111",
  });
  await repo.bindCeloTxHash({
    id: txTimeout.record.id,
    celoTxHash: "0x" + "c".repeat(64),
  });

  const originalFetch = globalThis.fetch;
  process.env.PAYCREST_API_KEY = "test_key";
  process.env.PAYCREST_BASE_URL = "https://api.paycrest.io/v2";

  try {
    globalThis.fetch = async () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    };

    const timeoutRecon = await reconcileTransaction(txTimeout.record.id);
    assert.equal(timeoutRecon.ok, false, "Timeout reconciliation must return ok: false");
    assert.equal(timeoutRecon.changed, false, "Timeout reconciliation must not change state");

    const reloaded = await repo.findById(txTimeout.record.id);
    assert.ok(reloaded, "Transaction must still exist");
    assert.equal(reloaded.status, "settling", "Status must remain settling and not be corrupted");
    assert.equal(reloaded.celoTxHash, "0x" + "c".repeat(64), "Tx hash must be preserved");
  } finally {
    globalThis.fetch = originalFetch;
  }

  // 6. reconcileTransaction: when tx is internal 'settled' with paycrestStatus 'validated',
  // fetching upstream 'settled' updates paycrestStatus to 'settled' idempotently without changing status.
  const txProgression = await repo.create({
    idempotencyKey: "idem_recon_progression",
    walletAddress: "0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa",
    amountUsdc: "5.000000",
    paycrestReference: "ref_recon_progression",
  });
  assert.equal(txProgression.ok, true);
  if (!txProgression.ok) return;

  await repo.bindPaycrestOrder({
    id: txProgression.record.id,
    paycrestOrderId: "ord_recon_progression",
    receiveAddress: "0x1111111111111111111111111111111111111111",
  });
  await repo.bindCeloTxHash({
    id: txProgression.record.id,
    celoTxHash: "0x" + "e".repeat(64),
  });
  await repo.updateStatus(txProgression.record.id, {
    status: "settled",
    paycrestStatus: "validated",
  });

  const originalFetch2 = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          status: "success",
          message: "Order fetched",
          data: {
            id: "ord_recon_progression",
            status: "settled",
            reference: "ref_recon_progression",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const reconRes = await reconcileTransaction(txProgression.record.id);
    assert.equal(reconRes.ok, true);
    assert.equal(reconRes.transaction.status, "settled", "Status must remain settled");
    assert.equal(
      reconRes.transaction.paycrestStatus,
      "settled",
      "paycrestStatus must advance to settled",
    );
    assert.equal(reconRes.isFiatFinal, true);
    assert.equal(reconRes.changed, true, "paycrestStatus change must report changed: true");
  } finally {
    globalThis.fetch = originalFetch2;
  }

  setTransactionRepositoryForTesting(null);
  console.info("reconciliation self-check: all assertions passed");
}

run().catch((err) => {
  console.error("reconciliation self-check failed:", err);
  process.exit(1);
});
