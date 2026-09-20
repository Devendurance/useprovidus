/**
 * Status UX & Airtime Stage Invariant Tests
 *
 * Run: npx tsx --conditions=react-server tests/status-ux.test.ts
 */

import assert from "node:assert/strict";
import { computeTransactionStage } from "@/lib/transactions/status";
import { formatStatusAnswer } from "@/lib/assistant/status";
import {
  toPublicTransactionDto,
  type TransactionRecord,
  type PublicTransactionDto,
} from "@/lib/transactions";

function createMockAirtimeRecord(
  overrides: Partial<TransactionRecord> = {},
): TransactionRecord {
  return {
    id: "tx_airtime_test_1",
    idempotencyKey: "idem_airtime_1",
    type: "airtime",
    status: "pending",
    walletAddress: "0x1111111111111111111111111111111111111111",
    amountUsdc: "1.00",
    amountNgn: "1500",
    celoTxHash: null,
    paycrestOrderId: "ord_airtime_1",
    paycrestReference: "ref_airtime_1",
    paycrestStatus: null,
    receiveAddress: "0x2222222222222222222222222222222222222222",
    validUntil: new Date(Date.now() + 600000).toISOString(),
    failureCode: null,
    failureReason: null,
    metadata: {
      phone: "+2348012345678",
      network: "MTN",
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockCashOutRecord(
  overrides: Partial<TransactionRecord> = {},
): TransactionRecord {
  return {
    id: "tx_cashout_test_1",
    idempotencyKey: "idem_cashout_1",
    type: "cash_out",
    status: "pending",
    walletAddress: "0x1111111111111111111111111111111111111111",
    amountUsdc: "10.00",
    amountNgn: "15000",
    celoTxHash: null,
    paycrestOrderId: "ord_cashout_1",
    paycrestReference: "ref_cashout_1",
    paycrestStatus: null,
    receiveAddress: "0x2222222222222222222222222222222222222222",
    validUntil: new Date(Date.now() + 600000).toISOString(),
    failureCode: null,
    failureReason: null,
    metadata: {
      institutionName: "Providus Bank",
      accountIdentifierMasked: "******1234",
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function runTests() {
  console.log("Running Providus Status UX & Airtime Stage Tests...\n");

  /* ======================================================================== */
  /* 1. Airtime Stage Derivations                                             */
  /* ======================================================================== */
  console.log("1. Testing Airtime Stage Computations...");

  // Pending
  {
    const tx = createMockAirtimeRecord({ status: "pending" });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "awaiting_payment");
    assert.equal(stage.isDepositConfirmed, false);
    assert.equal(stage.isFiatFinal, false);
    assert.equal(stage.isFiatDelivered, false);
    assert.equal(stage.isAirtimeDelivered, false);
    assert.equal(stage.isReconciliationRequired, false);
  }

  // Settling (Deposit Confirmed, waiting on Paycrest)
  {
    const tx = createMockAirtimeRecord({
      status: "settling",
      celoTxHash: "0xabc",
    });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "deposit_confirmed");
    assert.equal(stage.isDepositConfirmed, true);
    assert.equal(stage.isFiatFinal, false);
    assert.equal(stage.isAirtimeDelivered, false);
  }

  // Settling (Paycrest bank payout in progress)
  {
    const tx = createMockAirtimeRecord({
      status: "settling",
      paycrestStatus: "fulfilling",
      celoTxHash: "0xabc",
    });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "settling");
    assert.equal(stage.label, "NGN payout in progress");
    assert.equal(stage.isDepositConfirmed, true);
    assert.equal(stage.isFiatFinal, false);
    assert.equal(stage.isAirtimeDelivered, false);
  }

  // Settled (NGN settlement confirmed, fulfilment not yet reserved/sent)
  {
    const tx = createMockAirtimeRecord({
      status: "settled",
      paycrestStatus: "validated",
      celoTxHash: "0xabc",
    });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "settled");
    assert.equal(stage.label, "NGN settlement confirmed");
    assert.equal(
      stage.description,
      "Your Celo payment and NGN settlement are confirmed. I have not sent the airtime request yet.",
    );
    assert.equal(stage.isFiatFinal, true);
    assert.equal(stage.isFiatDelivered, true);
    assert.equal(
      stage.isProtocolSettled,
      false,
      "Paycrest 'validated' proves fiat delivery but not protocol settlement",
    );
    assert.equal(stage.isDepositConfirmed, true);
    assert.equal(stage.isAirtimeDelivered, false);
    assert.equal(stage.isReconciliationRequired, false);
  }

  // Processing - Submitting (attempts = 0, no status code yet)
  {
    const tx = createMockAirtimeRecord({
      status: "processing",
      paycrestStatus: "validated",
      metadata: {
        phone: "+2348012345678",
        network: "MTN",
        clubkonnect_request_id: "req_airtime_1",
        fulfilment_attempts: 0,
        fulfilment_reserved_at: new Date().toISOString(),
      },
    });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "airtime_submitting");
    assert.equal(stage.label, "Airtime request submitting");
    assert.equal(
      stage.description,
      "Your Celo payment and NGN settlement are confirmed. The airtime request is being submitted.",
    );
    assert.equal(stage.isFiatFinal, true);
    assert.equal(stage.isFiatDelivered, true);
    assert.equal(stage.isDepositConfirmed, true);
    assert.equal(stage.isAirtimeDelivered, false);
    assert.equal(stage.isReconciliationRequired, false);
  }

  // Processing - In flight (attempts = 1, status 100 ORDER_RECEIVED)
  {
    const tx = createMockAirtimeRecord({
      status: "processing",
      paycrestStatus: "validated",
      metadata: {
        phone: "+2348012345678",
        network: "MTN",
        clubkonnect_request_id: "req_airtime_1",
        clubkonnect_status_code: "100",
        fulfilment_attempts: 1,
      },
    });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "airtime_processing");
    assert.equal(stage.label, "Airtime processing");
    assert.equal(
      stage.description,
      "The airtime request was received and is still processing. I will not create another purchase while this request is unresolved.",
    );
    assert.equal(stage.isFiatFinal, true);
    assert.equal(stage.isFiatDelivered, true);
    assert.equal(stage.isDepositConfirmed, true);
    assert.equal(stage.isAirtimeDelivered, false);
    assert.equal(stage.isReconciliationRequired, false);
  }

  // Processing - In flight (status 300 PROCESSING)
  {
    const tx = createMockAirtimeRecord({
      status: "processing",
      paycrestStatus: "validated",
      metadata: {
        phone: "+2348012345678",
        network: "MTN",
        clubkonnect_request_id: "req_airtime_1",
        clubkonnect_status_code: "300",
        fulfilment_attempts: 1,
      },
    });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "airtime_processing");
    assert.equal(stage.isAirtimeDelivered, false);
    assert.equal(stage.isReconciliationRequired, false);
  }

  // Processing - Reconciliation Required (201 NETWORK_UNRESPONSIVE / timeout)
  {
    const tx = createMockAirtimeRecord({
      status: "processing",
      paycrestStatus: "validated",
      metadata: {
        phone: "+2348012345678",
        network: "MTN",
        clubkonnect_request_id: "req_airtime_1",
        clubkonnect_status_code: "201",
        fulfilment_reconciliation_required: true,
        fulfilment_attempts: 1,
      },
    });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "airtime_reconciliation_required");
    assert.equal(stage.label, "Provider status unresolved");
    assert.equal(
      stage.description,
      "The airtime provider status is unresolved. Providus will not submit another purchase; this request needs reconciliation.",
    );
    assert.equal(stage.isFiatFinal, true);
    assert.equal(stage.isFiatDelivered, true);
    assert.equal(stage.isDepositConfirmed, true);
    assert.equal(stage.isAirtimeDelivered, false);
    assert.equal(stage.isReconciliationRequired, true);
  }

  // Completed - Delivered (status 200)
  {
    const tx = createMockAirtimeRecord({
      status: "completed",
      paycrestStatus: "validated",
      metadata: {
        phone: "+2348012345678",
        network: "MTN",
        clubkonnect_request_id: "req_airtime_1",
        clubkonnect_order_id: "ck_ord_1",
        clubkonnect_status_code: "200",
        fulfilled_at: new Date().toISOString(),
      },
    });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "airtime_delivered");
    assert.equal(stage.label, "Airtime delivered");
    assert.equal(
      stage.description,
      "ClubKonnect returned the documented terminal success status and airtime delivery is verified.",
    );
    assert.equal(stage.isFiatFinal, true);
    assert.equal(stage.isFiatDelivered, true);
    assert.equal(
      stage.isProtocolSettled,
      false,
      "delivery is verified by ClubKonnect; Paycrest 'validated' is not protocol settlement",
    );
    assert.equal(stage.isDepositConfirmed, true);
    assert.equal(stage.isAirtimeDelivered, true);
    assert.equal(stage.isReconciliationRequired, false);
  }

  // Completed WITHOUT a verified ClubKonnect 200 is never delivered
  {
    const tx = createMockAirtimeRecord({
      status: "completed",
      paycrestStatus: "validated",
      metadata: {
        phone: "+2348012345678",
        network: "MTN",
        clubkonnect_request_id: "req_airtime_1",
        clubkonnect_order_id: "ck_ord_1",
        // Terminal completion alone is not proof: no provider status code here.
        fulfilled_at: new Date().toISOString(),
      },
    });
    const stage = computeTransactionStage(tx);
    assert.notEqual(stage.stage, "airtime_delivered");
    assert.equal(stage.stage, "failed");
    assert.equal(stage.isAirtimeDelivered, false);
    assert.equal(stage.isReconciliationRequired, false);
  }

  // Completed with a non-success provider code is never delivered either
  {
    const tx = createMockAirtimeRecord({
      status: "completed",
      paycrestStatus: "validated",
      metadata: {
        phone: "+2348012345678",
        network: "MTN",
        clubkonnect_request_id: "req_airtime_1",
        clubkonnect_status_code: "300",
        fulfilled_at: new Date().toISOString(),
      },
    });
    const stage = computeTransactionStage(tx);
    assert.notEqual(stage.stage, "airtime_delivered");
    assert.equal(stage.stage, "failed");
    assert.equal(stage.isAirtimeDelivered, false);
    assert.equal(stage.isProtocolSettled, false);
  }

  // Completed without 200 but flagged for reconciliation: review, not delivery
  {
    const tx = createMockAirtimeRecord({
      status: "completed",
      paycrestStatus: "validated",
      metadata: {
        phone: "+2348012345678",
        network: "MTN",
        clubkonnect_request_id: "req_airtime_1",
        fulfilment_reconciliation_required: true,
      },
    });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "recovery_required");
    assert.equal(stage.isAirtimeDelivered, false);
    assert.equal(stage.isReconciliationRequired, true);
  }

  // Processing - a claimed attempt with no persisted provider outcome
  {
    const tx = createMockAirtimeRecord({
      status: "processing",
      paycrestStatus: "validated",
      metadata: {
        phone: "+2348012345678",
        network: "MTN",
        clubkonnect_request_id: "req_airtime_1",
        fulfilment_attempts: 1,
        fulfilment_reserved_at: new Date().toISOString(),
      },
    });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "airtime_reconciliation_required");
    assert.equal(stage.label, "Provider status unresolved");
    assert.equal(stage.isReconciliationRequired, true);
    assert.equal(stage.isAirtimeDelivered, false);
    assert.equal(stage.isFiatDelivered, true);
  }

  // Processing - a claimed attempt with an empty provider code is unresolved too
  {
    const tx = createMockAirtimeRecord({
      status: "processing",
      paycrestStatus: "validated",
      metadata: {
        phone: "+2348012345678",
        network: "MTN",
        clubkonnect_request_id: "req_airtime_1",
        clubkonnect_status_code: "",
        fulfilment_attempts: 1,
      },
    });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "airtime_reconciliation_required");
    assert.equal(stage.isReconciliationRequired, true);
  }

  // Failed after Paycrest settlement (e.g. 417 float failure)
  {
    const tx = createMockAirtimeRecord({
      status: "failed",
      paycrestStatus: "validated",
      failureCode: "PROVIDER_FLOAT_EXHAUSTED",
      failureReason: "ClubKonnect float balance insufficient",
      metadata: {
        phone: "+2348012345678",
        network: "MTN",
        clubkonnect_request_id: "req_airtime_1",
        fulfilment_reserved_at: new Date().toISOString(),
      },
    });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "failed");
    assert.equal(stage.label, "Airtime fulfilment failed");
    assert.equal(
      stage.description,
      "NGN settlement was confirmed, but airtime fulfilment failed: ClubKonnect float balance insufficient. Providus did not issue an automatic refund.",
    );
    assert.equal(stage.isFiatFinal, true);
    assert.equal(stage.isFiatDelivered, true);
    assert.equal(stage.isDepositConfirmed, true);
    assert.equal(stage.isAirtimeDelivered, false);
    assert.equal(stage.isReconciliationRequired, false);
  }

  // Paycrest 'fulfilled' is payout-in-progress, never proof NGN was delivered
  {
    const tx = createMockAirtimeRecord({
      status: "failed",
      paycrestStatus: "fulfilled",
      failureCode: "PROVIDER_REJECTED",
      failureReason: "Provider rejected the airtime request",
    });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "failed");
    assert.equal(
      stage.isFiatDelivered,
      false,
      "'fulfilled' must never be read as fiat delivered",
    );
    assert.equal(stage.isProtocolSettled, false);
    assert.equal(
      stage.label,
      "Failed",
      "'fulfilled' must not surface the fiat-settlement failure wording",
    );
  }

  // Paycrest 'fulfilled' on an in-flight airtime row: internal progress must
  // never be promoted to NGN delivery.
  {
    const tx = createMockAirtimeRecord({
      status: "processing",
      paycrestStatus: "fulfilled",
      metadata: {
        phone: "+2348012345678",
        network: "MTN",
        clubkonnect_request_id: "req_airtime_1",
        clubkonnect_status_code: "100",
        fulfilment_attempts: 1,
      },
    });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "airtime_processing");
    assert.equal(
      stage.isFiatDelivered,
      false,
      "'fulfilled' is payout-in-progress, never NGN delivery",
    );
    assert.equal(stage.isFiatFinal, false);
    assert.equal(stage.isProtocolSettled, false);
    assert.equal(
      stage.description.includes("NGN settlement are confirmed"),
      false,
      "an unconfirmed milestone must never be reported as confirmed settlement",
    );
  }

  // A settled row whose Paycrest milestone is not terminal is not settled
  for (const unconfirmed of ["fulfilled", null] as const) {
    const tx = createMockAirtimeRecord({
      status: "settled",
      paycrestStatus: unconfirmed,
    });
    const stage = computeTransactionStage(tx);
    assert.equal(
      stage.isFiatDelivered,
      false,
      `Paycrest ${String(unconfirmed)} proves no NGN delivery`,
    );
    assert.equal(stage.isFiatFinal, false);
    assert.equal(
      stage.label,
      "NGN settlement processing",
      "the label must not claim settlement without a terminal Paycrest milestone",
    );
    assert.equal(stage.stage, "settling");
  }

  // Completed airtime with an unconfirmed Paycrest milestone: ClubKonnect may
  // have delivered, but NGN delivery is never claimed.
  {
    const tx = createMockAirtimeRecord({
      status: "completed",
      paycrestStatus: "fulfilled",
      metadata: {
        phone: "+2348012345678",
        network: "MTN",
        clubkonnect_request_id: "req_airtime_1",
        clubkonnect_status_code: "200",
        fulfilled_at: new Date().toISOString(),
      },
    });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "airtime_delivered");
    assert.equal(stage.isAirtimeDelivered, true);
    assert.equal(
      stage.isFiatDelivered,
      false,
      "only the Paycrest 'validated' / 'settled' milestones prove NGN delivery",
    );
    assert.equal(stage.isFiatFinal, false);
    assert.equal(stage.isProtocolSettled, false);
  }

  // Milestones are matched case-insensitively and only 'settled' is protocol
  // settlement, while 'validated' is delivery without protocol settlement.
  {
    const validated = computeTransactionStage(
      createMockAirtimeRecord({
        status: "settled",
        paycrestStatus: "VALIDATED",
      }),
    );
    assert.equal(validated.isFiatDelivered, true);
    assert.equal(validated.isProtocolSettled, false);

    const protocolSettled = computeTransactionStage(
      createMockAirtimeRecord({
        status: "processing",
        paycrestStatus: "settled",
      }),
    );
    assert.equal(protocolSettled.isFiatDelivered, true);
    assert.equal(protocolSettled.isProtocolSettled, true);
  }

  // Failed before settlement (e.g. Celo payment expired)
  {
    const tx = createMockAirtimeRecord({
      status: "failed",
      paycrestStatus: "expired",
      failureCode: "ORDER_EXPIRED",
      failureReason: "Payment window elapsed",
    });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "failed");
    assert.equal(stage.label, "Failed");
    assert.equal(stage.isFiatFinal, false);
    assert.equal(stage.isFiatDelivered, false);
  }

  // PublicTransactionDto parity with fulfilment projection
  {
    const pubDto: PublicTransactionDto = {
      id: "tx_airtime_pub_1",
      idempotencyKey: "idem_pub_1",
      type: "airtime",
      status: "processing",
      walletAddress: "0x1111111111111111111111111111111111111111",
      amountUsdc: "1.00",
      amountNgn: "1500",
      celoTxHash: "0xabc",
      paycrestOrderId: "ord_1",
      paycrestReference: "ref_1",
      paycrestStatus: "validated",
      receiveAddress: "0x222",
      validUntil: null,
      failureCode: null,
      failureReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      fulfilment: {
        provider: "clubkonnect",
        requestId: "req_airtime_pub_1",
        orderId: null,
        statusCode: "201",
        rawStatus: "Network Unresponsive",
        normalizedStatus: "unknown",
        attempts: 1,
        reservedAt: new Date().toISOString(),
        fulfilledAt: null,
        reconciliationRequired: true,
      },
    };
    const stage = computeTransactionStage(pubDto);
    assert.equal(stage.stage, "airtime_reconciliation_required");
    assert.equal(stage.isReconciliationRequired, true);
    assert.equal(stage.isFiatFinal, true);
  }

  console.log("✓ All Airtime stage derivations passed.\n");

  /* ======================================================================== */
  /* 2. Cash-Out Regression Freedom                                           */
  /* ======================================================================== */
  console.log("2. Testing Cash-Out Stage Regressions...");

  // Cash-out pending
  {
    const tx = createMockCashOutRecord({ status: "pending" });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "awaiting_payment");
    assert.equal(stage.label, "Awaiting payment");
    assert.equal(stage.isDepositConfirmed, false);
    assert.equal(stage.isFiatFinal, false);
    assert.equal(stage.isAirtimeDelivered, false);
  }

  // Cash-out settling
  {
    const tx = createMockCashOutRecord({
      status: "settling",
      paycrestStatus: "fulfilling",
    });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "settling");
    assert.equal(stage.label, "NGN payout in progress");
    assert.equal(stage.isDepositConfirmed, true);
    assert.equal(stage.isFiatFinal, false);
    assert.equal(stage.isAirtimeDelivered, false);
  }

  // Cash-out settled (validated milestone)
  {
    const tx = createMockCashOutRecord({
      status: "settled",
      paycrestStatus: "validated",
    });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "settled");
    assert.equal(stage.label, "Fiat delivery confirmed");
    assert.equal(stage.isFiatFinal, true);
    assert.equal(stage.isFiatDelivered, true);
    assert.equal(stage.isProtocolSettled, false);
    assert.equal(stage.isAirtimeDelivered, false);
  }

  // Cash-out settled (protocol complete)
  {
    const tx = createMockCashOutRecord({
      status: "settled",
      paycrestStatus: "settled",
    });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "settled");
    assert.equal(stage.label, "Paycrest protocol settled");
    assert.equal(stage.isFiatFinal, true);
    assert.equal(stage.isFiatDelivered, true);
    assert.equal(stage.isProtocolSettled, true);
    assert.equal(stage.isAirtimeDelivered, false);
  }

  // Cash-out processing (backward compatible legacy)
  {
    const tx = createMockCashOutRecord({
      status: "processing",
    });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "settled");
    assert.equal(stage.label, "Fulfilment processing");
    assert.equal(stage.isAirtimeDelivered, false);
  }

  // Cash-out completed
  {
    const tx = createMockCashOutRecord({ status: "completed" });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "settled");
    assert.equal(stage.label, "Completed");
    assert.equal(stage.isAirtimeDelivered, false);
    assert.equal(
      stage.isProtocolSettled,
      false,
      "a completed row with no Paycrest 'settled' milestone is not protocol settled",
    );
  }

  // Cash-out completed with the Paycrest 'settled' milestone
  {
    const tx = createMockCashOutRecord({
      status: "completed",
      paycrestStatus: "settled",
    });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.isProtocolSettled, true);
    assert.equal(stage.label, "Completed");
  }

  // Cash-out failed
  {
    const tx = createMockCashOutRecord({
      status: "failed",
      failureReason: "Bank account invalid",
    });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "failed");
    assert.equal(stage.label, "Failed");
    assert.equal(stage.description, "Bank account invalid");
    assert.equal(stage.isAirtimeDelivered, false);
  }

  // Cash-out refunded
  {
    const tx = createMockCashOutRecord({ status: "refunded" });
    const stage = computeTransactionStage(tx);
    assert.equal(stage.stage, "failed");
    assert.equal(stage.label, "Refunded");
    assert.equal(stage.isAirtimeDelivered, false);
  }

  console.log("✓ Cash-Out stages are 100% regression-free.\n");

  /* ======================================================================== */
  /* 3. Assistant Truthful Status Formatting                                  */
  /* ======================================================================== */
  console.log("3. Testing Assistant Status Formatting...");

  // Airtime Settled
  {
    const tx = createMockAirtimeRecord({
      id: "tx_air_101",
      status: "settled",
      paycrestStatus: "validated",
    });
    const stage = computeTransactionStage(tx);
    const text = formatStatusAnswer({
      transaction: toPublicTransactionDto(tx),
      stage,
    });
    assert.match(text, /NGN settlement confirmed/);
    assert.match(
      text,
      /Your Celo payment and NGN settlement are confirmed\. The airtime request is being prepared\./,
    );
    assert.equal(text.includes("Airtime delivered"), false);
    assert.match(text, /recorded state only/);
  }

  // Airtime Submitting (Paycrest milestone confirmed)
  {
    const tx = createMockAirtimeRecord({
      id: "tx_air_102",
      status: "processing",
      paycrestStatus: "validated",
      metadata: {
        clubkonnect_request_id: "req_102",
        fulfilment_attempts: 0,
      },
    });
    const stage = computeTransactionStage(tx);
    const text = formatStatusAnswer({
      transaction: toPublicTransactionDto(tx),
      stage,
    });
    assert.match(text, /Airtime request submitting/);
    assert.match(
      text,
      /Your Celo payment and NGN settlement are confirmed\. The airtime request is being submitted\./,
    );
    assert.equal(text.includes("Airtime delivered"), false);
  }

  // Airtime Submitting without a terminal Paycrest milestone: the answer must
  // not claim NGN settlement, even though the row is already in flight.
  {
    const tx = createMockAirtimeRecord({
      id: "tx_air_109",
      status: "processing",
      paycrestStatus: null,
      metadata: {
        clubkonnect_request_id: "req_109",
        fulfilment_attempts: 0,
      },
    });
    const stage = computeTransactionStage(tx);
    const text = formatStatusAnswer({
      transaction: toPublicTransactionDto(tx),
      stage,
    });
    assert.equal(stage.isFiatDelivered, false);
    assert.match(text, /Airtime request submitting/);
    assert.match(text, /NGN settlement is still processing/);
    assert.equal(
      text.includes("NGN settlement are confirmed"),
      false,
      "an unconfirmed Paycrest milestone must never be reported as confirmed settlement",
    );
  }

  // Airtime Processing (100 / 300)
  {
    const tx = createMockAirtimeRecord({
      id: "tx_air_103",
      status: "processing",
      metadata: {
        clubkonnect_request_id: "req_103",
        clubkonnect_status_code: "100",
        fulfilment_attempts: 1,
      },
    });
    const stage = computeTransactionStage(tx);
    const text = formatStatusAnswer({
      transaction: toPublicTransactionDto(tx),
      stage,
    });
    assert.match(text, /Airtime processing/);
    assert.match(
      text,
      /The airtime request was received and is still processing\. Providus will not create another purchase while this request is unresolved\./,
    );
    // MUST NOT claim airtime delivered on 100 or 300!
    assert.equal(text.includes("Airtime delivered."), false);
  }

  // Airtime Reconciliation Required (201 / timeout)
  {
    const tx = createMockAirtimeRecord({
      id: "tx_air_104",
      status: "processing",
      metadata: {
        clubkonnect_request_id: "req_104",
        clubkonnect_status_code: "201",
        fulfilment_reconciliation_required: true,
        fulfilment_attempts: 1,
      },
    });
    const stage = computeTransactionStage(tx);
    const text = formatStatusAnswer({
      transaction: toPublicTransactionDto(tx),
      stage,
    });
    assert.match(text, /Provider status unresolved/);
    assert.match(
      text,
      /The airtime provider status is unresolved\. Providus will not submit another purchase; this request needs reconciliation\./,
    );
    // MUST NOT claim airtime delivered on 201!
    assert.equal(text.includes("Airtime delivered."), false);
  }

  // Airtime Delivered (200)
  {
    const tx = createMockAirtimeRecord({
      id: "tx_air_105",
      status: "completed",
      metadata: {
        clubkonnect_request_id: "req_105",
        clubkonnect_status_code: "200",
        fulfilled_at: new Date().toISOString(),
      },
    });
    const stage = computeTransactionStage(tx);
    const text = formatStatusAnswer({
      transaction: toPublicTransactionDto(tx),
      stage,
    });
    assert.match(text, /Airtime delivered/);
    assert.match(text, /Airtime delivered\. Delivery was confirmed by ClubKonnect\./);
  }

  // Airtime Completed WITHOUT a verified 200: never presented as delivered
  {
    const tx = createMockAirtimeRecord({
      id: "tx_air_108",
      status: "completed",
      paycrestStatus: "validated",
      metadata: {
        clubkonnect_request_id: "req_108",
        fulfilled_at: new Date().toISOString(),
      },
    });
    const stage = computeTransactionStage(tx);
    const text = formatStatusAnswer({
      transaction: toPublicTransactionDto(tx),
      stage,
    });
    assert.equal(text.includes("Airtime delivered"), false);
    assert.equal(
      text.includes("Delivery was confirmed by ClubKonnect"),
      false,
      "an unverified completion must never claim provider-confirmed delivery",
    );
    assert.match(text, /did not issue an automatic refund/);
  }

  // Airtime Failed After Settlement: NO FAKE REFUNDS
  {
    const tx = createMockAirtimeRecord({
      id: "tx_air_106",
      status: "failed",
      paycrestStatus: "validated",
      failureCode: "PROVIDER_FLOAT_EXHAUSTED",
      failureReason: "Provider float exhausted",
      metadata: {
        fulfilment_reserved_at: new Date().toISOString(),
      },
    });
    const stage = computeTransactionStage(tx);
    const text = formatStatusAnswer({
      transaction: toPublicTransactionDto(tx),
      stage,
    });
    assert.match(text, /Airtime fulfilment failed/);
    assert.match(
      text,
      /NGN settlement was confirmed, but airtime fulfilment failed: Provider float exhausted\. Providus did not issue an automatic refund\./,
    );
    // Proves Providus never claims automatic refund when fulfilment fails after fiat settlement
    assert.equal(text.includes("refunded to your refund address"), false);
    assert.equal(text.includes("deposit was refunded on Celo"), false);
  }

  // Cash-Out Status Answer: Unchanged & Regression Free
  {
    const tx = createMockCashOutRecord({
      id: "tx_cash_107",
      status: "settled",
      paycrestStatus: "validated",
    });
    const stage = computeTransactionStage(tx);
    const text = formatStatusAnswer({
      transaction: toPublicTransactionDto(tx),
      stage,
    });
    assert.match(text, /Fiat delivery confirmed/);
    assert.match(
      text,
      /The provider has confirmed fiat delivery to the recipient account\./,
    );
  }

  console.log("✓ Assistant status formatting tests passed.\n");

  /* ======================================================================== */
  /* 4. Public DTO Sanitization (Defense in Depth)                            */
  /* ======================================================================== */
  console.log("4. Testing Public DTO Sanitization...");

  // A raw provider string written by an older path must still be redacted/bounded
  {
    const secretBearing = `APIKey=secret_abc123xyz Bearer tok_987654321 ${"x".repeat(400)}`;
    const tx = createMockAirtimeRecord({
      status: "processing",
      metadata: {
        clubkonnect_request_id: "req_airtime_sanitize",
        clubkonnect_raw_status: secretBearing,
      },
    });
    const dto = toPublicTransactionDto(tx);
    assert.ok(dto.fulfilment, "a bound request id must produce a fulfilment projection");
    const rawStatus = dto.fulfilment?.rawStatus ?? "";
    assert.equal(
      rawStatus.includes("secret_abc123xyz"),
      false,
      "credentials must never reach the public DTO",
    );
    assert.equal(
      rawStatus.includes("tok_987654321"),
      false,
      "bearer tokens must never reach the public DTO",
    );
    assert.ok(rawStatus.length <= 256, "the public raw status must stay bounded");
  }

  // An ordinary provider status is still projected verbatim
  {
    const tx = createMockAirtimeRecord({
      status: "processing",
      metadata: {
        clubkonnect_request_id: "req_airtime_plain",
        clubkonnect_raw_status: "ORDER_RECEIVED",
      },
    });
    assert.equal(toPublicTransactionDto(tx).fulfilment?.rawStatus, "ORDER_RECEIVED");
  }

  // A hostile status code written by an older path is redacted and bounded
  {
    const hostileCode = `api_key=sk_live_9f2a7c ${"Z".repeat(500)}`;
    const tx = createMockAirtimeRecord({
      status: "processing",
      metadata: {
        clubkonnect_request_id: "req_airtime_code_hostile",
        clubkonnect_status_code: hostileCode,
      },
    });
    const dto = toPublicTransactionDto(tx);
    assert.ok(dto.fulfilment, "a bound request id must produce a fulfilment projection");
    const statusCode = dto.fulfilment?.statusCode ?? "";
    assert.equal(
      statusCode.includes("sk_live_9f2a7c"),
      false,
      "credentials embedded in a status code must never reach the public DTO",
    );
    assert.equal(
      statusCode.includes("Z".repeat(40)),
      false,
      "unbounded provider text must never reach the public DTO",
    );
    assert.ok(statusCode.length <= 32, "the public status code must stay bounded");
  }

  // An ordinary status code survives sanitization verbatim: stage derivation
  // compares `fulfilment.statusCode` against the documented provider codes.
  {
    const tx = createMockAirtimeRecord({
      status: "processing",
      metadata: {
        clubkonnect_request_id: "req_airtime_code_plain",
        clubkonnect_status_code: "200",
      },
    });
    assert.equal(toPublicTransactionDto(tx).fulfilment?.statusCode, "200");
  }

  // Hostile credentials written into both public fulfilment fields: neither
  // `rawStatus` nor `statusCode` may leak a UserID or token value.
  {
    const hostile = "UserID=SECRET_USER token=SECRET_TOKEN";
    const tx = createMockAirtimeRecord({
      status: "processing",
      metadata: {
        clubkonnect_request_id: "req_airtime_credentials",
        clubkonnect_raw_status: hostile,
        clubkonnect_status_code: hostile,
      },
    });
    const dto = toPublicTransactionDto(tx);
    assert.ok(dto.fulfilment, "a bound request id must produce a fulfilment projection");
    for (const [field, value] of [
      ["rawStatus", dto.fulfilment?.rawStatus],
      ["statusCode", dto.fulfilment?.statusCode],
    ] as const) {
      assert.equal(typeof value, "string", `${field} must be projected`);
      const text = value ?? "";
      assert.equal(
        text.includes("SECRET_USER"),
        false,
        `UserID credentials must never reach ${field}`,
      );
      assert.equal(
        text.includes("SECRET_TOKEN"),
        false,
        `token credentials must never reach ${field}`,
      );
    }
  }

  // Every credential key named by the fulfilment redaction contract is
  // case-insensitive and is redacted on both public fulfilment fields.
  {
    const credentials: Array<[string, string]> = [
      ["UserID", "SECRET_USERID"],
      ["APIKey", "SECRET_APIKEY"],
      ["token", "SECRET_TOKEN"],
      ["auth", "SECRET_AUTH"],
      ["secret", "SECRET_SECRET"],
      ["password", "SECRET_PASSWORD"],
      ["key", "SECRET_KEY"],
      ["SecretKey", "SECRET_SECRETKEY"],
      ["private_key", "SECRET_PRIVATEKEY"],
    ];
    for (const [key, secret] of credentials) {
      const tx = createMockAirtimeRecord({
        status: "processing",
        metadata: {
          clubkonnect_request_id: `req_airtime_${key}`,
          clubkonnect_raw_status: `${key}=${secret}`,
          clubkonnect_status_code: `${key}=${secret}`,
        },
      });
      const dto = toPublicTransactionDto(tx);
      for (const [field, value] of [
        ["rawStatus", dto.fulfilment?.rawStatus],
        ["statusCode", dto.fulfilment?.statusCode],
      ] as const) {
        assert.equal(
          (value ?? "").includes(secret),
          false,
          `${key} must be redacted in ${field}`,
        );
      }
    }

    // Query-string form: the credential value stops at the next parameter.
    const tx = createMockAirtimeRecord({
      status: "processing",
      metadata: {
        clubkonnect_request_id: "req_airtime_query_credentials",
        clubkonnect_raw_status:
          "https://provider.example/API?UserID=SECRET_USERID&APIKey=SECRET_APIKEY&Status=200",
      },
    });
    const rawStatus = toPublicTransactionDto(tx).fulfilment?.rawStatus ?? "";
    assert.equal(rawStatus.includes("SECRET_USERID"), false);
    assert.equal(rawStatus.includes("SECRET_APIKEY"), false);
    assert.equal(rawStatus.includes("Status=200"), true, "non-sensitive values survive");
  }

  // A hostile failure reason written by an older path is redacted before it can
  // reach the client: credentials must never survive into the public DTO.
  {
    const tx = createMockAirtimeRecord({
      status: "failed",
      paycrestStatus: "validated",
      failureCode: "PROVIDER_REJECTED",
      failureReason: "APIKey=SECRET_KEY token=SECRET_TOKEN",
    });
    const reason = toPublicTransactionDto(tx).failureReason ?? "";
    assert.equal(
      reason.includes("SECRET_KEY"),
      false,
      "APIKey credentials must never reach the public failure reason",
    );
    assert.equal(
      reason.includes("SECRET_TOKEN"),
      false,
      "token credentials must never reach the public failure reason",
    );
    assert.equal(reason.includes("APIKey="), false);
    assert.equal(reason.includes("token="), false);
  }

  // The same applies to a cash-out row, and an ordinary reason is still
  // projected verbatim so the client can explain the failure.
  {
    const cashOut = createMockCashOutRecord({
      status: "failed",
      failureReason: "SeCrEt: hunter2",
    });
    assert.equal(
      (toPublicTransactionDto(cashOut).failureReason ?? "").includes("hunter2"),
      false,
      "credentials must never reach a cash-out public failure reason",
    );

    const plain = createMockAirtimeRecord({
      status: "failed",
      failureReason: "Provider rejected the airtime request",
    });
    assert.equal(
      toPublicTransactionDto(plain).failureReason,
      "Provider rejected the airtime request",
      "an ordinary failure reason survives sanitization",
    );
  }

  console.log("✓ Public DTO sanitization tests passed.\n");
  console.log("ALL STATUS UX & STAGE INVARIANT TESTS PASSED SUCCESSFULLY!");
}

runTests();
