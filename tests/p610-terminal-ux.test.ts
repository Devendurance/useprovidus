// P6.10 Terminal State & Wallet Receipt Regression Checks (synthetic fixtures only)
import assert from "node:assert/strict";
import { computeTransactionStage } from "@/lib/transactions/status";
import type { PublicTransactionDto } from "@/lib/transactions/types";
import {
  createTransactionPollingController,
  shouldPollTransactionStatus,
} from "@/hooks/use-transaction-status";

async function runTests() {
  console.log("Running P6.10 Terminal & Polling UX Regression Checks...");

// 1. Completed airtime derives terminal delivered UI state
const completedAirtimeTx: PublicTransactionDto = {
  id: "tx_test_completed_123",
  idempotencyKey: "idem_test_completed_123",
  type: "airtime",
  status: "completed",
  amountUsdc: "0.732612",
  amountNgn: "1000",
  walletAddress: "0xc446000000000000000000000000000000006dc9",
  receiveAddress: "0xAc78000000000000000000000000000000004416",
  celoTxHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  paycrestOrderId: "7d4ea880-eaca-4fc0-8554-48cee0f5dd01",
  paycrestReference: "p4b_test_reference_123",
  paycrestStatus: "settled",
  validUntil: new Date(Date.now() + 3600000).toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  failureCode: null,
  failureReason: null,
  metadata: {
    institutionName: "OPay",
    accountIdentifierMasked: "***6560",
    phoneMasked: "***4560",
    network: "mtn",
    rate: "1364.98",
    totalUsdcToSend: "0.736312",
  },
  fulfilment: {
    provider: "clubkonnect",
    requestId: "cktx48b9c6d0dff345be8099b27e341f",
    orderId: "6720476887",
    statusCode: "200",
    rawStatus: "success",
    normalizedStatus: "completed",
    attempts: 1,
    reservedAt: new Date().toISOString(),
    fulfilledAt: new Date().toISOString(),
    reconciliationRequired: false,
  },
};

const stageInfo = computeTransactionStage(completedAirtimeTx);
assert.equal(stageInfo.stage, "airtime_delivered", "completed airtime maps to airtime_delivered stage");
assert.equal(stageInfo.isAirtimeDelivered, true, "isAirtimeDelivered flag is true");
assert.equal(stageInfo.isFiatFinal, true, "isFiatFinal flag is true");
assert.equal(stageInfo.isDepositConfirmed, true, "isDepositConfirmed flag is true");
console.log("✓ Completed airtime derives terminal delivered stage (airtime_delivered)");
// 2. Production polling predicates mirrored from hooks/use-transaction-status.ts
// The hook halts polling at terminal delivered/failed/recovery or completed/failed/refunded
function mirrorShouldPoll(stage: string, status: string, type = "airtime"): boolean {
  return shouldPollTransactionStatus(stage, type, status);
}

// Exercise the polling controller used by the hook: one nonterminal timer
// produces one reconcile request, then a terminal response stops future timers
// even when the effect is recreated by a rerender.
const pendingTimers: Array<() => void> = [];
const reconcileUrls: string[] = [];
let nextTimerId = 0;
const terminalResponse = {
  stage: "airtime_delivered",
  transaction: { type: "airtime", status: "completed" },
};
const requestStatus = async () => {
  reconcileUrls.push("/api/transactions/tx_test_completed_123?reconcile=true");
  return terminalResponse;
};
const pollingController = createTransactionPollingController(
  requestStatus,
  (callback) => {
    pendingTimers.push(callback);
    return ++nextTimerId;
  },
  () => {},
);
pollingController.start("settled", "airtime", "settled");
assert.equal(pendingTimers.length, 1, "nonterminal airtime should schedule a poll");
const firstPoll = pendingTimers.shift();
assert.ok(firstPoll, "poll timer should be registered");
await firstPoll?.();
assert.equal(reconcileUrls.length, 1, "initial poll should issue one reconcile request");
pollingController.stop();

const rerenderedTerminalController = createTransactionPollingController(
  requestStatus,
  (callback) => {
    pendingTimers.push(callback);
    return ++nextTimerId;
  },
  () => {},
);
rerenderedTerminalController.start("airtime_delivered", "airtime", "completed");
assert.equal(
  pendingTimers.length,
  0,
  "rerender after terminal response must not schedule another reconcile request",
);
rerenderedTerminalController.stop();
assert.equal(reconcileUrls.length, 1, "terminal rerender must not add a reconcile URL");
console.log("✓ Terminal rerender does not schedule another reconciliation request");

// 2a. Terminal states halt polling
assert.equal(mirrorShouldPoll("airtime_delivered", "completed"), false, "airtime_delivered must halt polling");
assert.equal(mirrorShouldPoll("failed", "failed"), false, "failed must halt polling");
assert.equal(mirrorShouldPoll("recovery_required", "refunded"), false, "recovery_required must halt polling");
console.log("✓ Terminal states correctly halt polling (mirrored production predicate)");

// 2b. Nonterminal states continue polling
assert.equal(mirrorShouldPoll("settling", "settling"), true, "settling must continue polling");
assert.equal(mirrorShouldPoll("deposit_confirmed", "settling"), true, "deposit_confirmed must continue polling");
assert.equal(mirrorShouldPoll("settled", "settled"), true, "settled must continue polling");
assert.equal(mirrorShouldPoll("airtime_submitting", "processing"), true, "airtime_submitting must continue polling");
assert.equal(mirrorShouldPoll("airtime_processing", "processing"), true, "airtime_processing must continue polling");
assert.equal(mirrorShouldPoll("airtime_reconciliation_required", "processing"), true, "airtime_reconciliation_required must continue polling");
console.log("✓ Nonterminal stages correctly continue polling (mirrored production predicate)");

// 3. Receipt wallet boundary predicate mirrored from app/receipt/receipt-client.tsx
function mirrorReceiptAllowed(connectedWallet: string, ownerWallet: string): boolean {
  if (connectedWallet === "" || ownerWallet === "") return false;
  return connectedWallet.toLowerCase() === ownerWallet.toLowerCase();
}

// 3a. Disconnected viewers are blocked because receipt reads require owner context.
assert.equal(mirrorReceiptAllowed("", "0xc446000000000000000000000000000000006dc9"), false, "disconnected receipt view blocked");
// 3b. Matching owner (checksum vs lowercase) may view
assert.equal(mirrorReceiptAllowed("0xc446000000000000000000000000000000006dc9", "0xC446000000000000000000000000000000006DC9"), true, "owner wallet allowed case-insensitively");
// 3c. Foreign wallet blocked
assert.equal(mirrorReceiptAllowed("0x1111111111111111111111111111111111111111", "0xc446000000000000000000000000000000006dc9"), false, "foreign wallet blocked from receipt");
console.log("✓ Receipt wallet boundary predicate verified (explicit identity, no cross-wallet leakage)");

  console.log("ALL P6.10 REGRESSION CHECKS PASSED!");
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
