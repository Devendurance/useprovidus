import { resolvePaymentCardView, type PaymentCardViewInput } from "@/lib/transfers/payment-card-view";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

const base: PaymentCardViewInput = {
  submission: null,
  freshnessFresh: true,
  intentExpired: false,
  intentPending: true,
  intentCancelled: false,
  recoveryHash: null,
  uncertainBroadcast: false,
  pendingWalletConfirmation: false,
  paymentPreparationPending: false,
  supportedNetwork: true,
  accountMatches: true,
  networkMatches: true,
  hasPlan: true,
  hasGas: true,
  reviewError: false,
  tokenRequired: false,
  allowanceState: null,
};

const verified = resolvePaymentCardView({
  ...base,
  freshnessFresh: false,
  intentPending: false,
  uncertainBroadcast: true,
  submission: { status: "confirmed", txHash: "0xverified", verifiedAt: "2026-11-10T12:00:00Z", failureReason: null },
});
assert(verified.kind === "verified", "verified B5 evidence takes precedence over local recovery and stale intent state");

const confirmedWithoutEvidence = resolvePaymentCardView({
  ...base,
  submission: { status: "confirmed", txHash: "0xsubmitted", verifiedAt: null, failureReason: null },
});
assert(confirmedWithoutEvidence.kind === "verification_pending", "confirmed without verifiedAt stays pending");

const submitted = resolvePaymentCardView({
  ...base,
  submission: { status: "submitted", txHash: "0xsubmitted", verifiedAt: null, failureReason: null },
});
assert(submitted.kind === "verification_pending" && submitted.submitted, "submitted hash is never success");

const unknown = resolvePaymentCardView({
  ...base,
  submission: { status: "unknown", txHash: "0xunknown", verifiedAt: null, failureReason: "receipt not found" },
});
assert(unknown.kind === "unknown" && !unknown.needsHashRecovery, "unknown transaction keeps its existing hash for recheck");

const failed = resolvePaymentCardView({
  ...base,
  submission: { status: "failed", txHash: "0xfail", verifiedAt: null, failureReason: "reverted" },
});
assert(failed.kind === "failed" && failed.txHash === "0xfail", "failed payment retains proof without a resend action");

const expired = resolvePaymentCardView({ ...base, intentExpired: true, freshnessFresh: false });
assert(expired.kind === "expired", "expired intent has no review action");

const cancelled = resolvePaymentCardView({ ...base, intentPending: false, intentCancelled: true });
assert(cancelled.kind === "cancelled", "cancelled intent is not mislabeled as expired");

const stale = resolvePaymentCardView({ ...base, freshnessFresh: false });
assert(stale.kind === "stale", "changed payment terms are distinguished from actual expiration");

const allowanceRequired = resolvePaymentCardView({ ...base, tokenRequired: true, allowanceState: "approval_required" });
assert(allowanceRequired.kind === "review" && allowanceRequired.nextAction === "approve_allowance", "insufficient allowance requires its own approval");

const allowanceSufficient = resolvePaymentCardView({ ...base, tokenRequired: true, allowanceState: "payment_ready" });
assert(allowanceSufficient.kind === "review" && allowanceSufficient.nextAction === "confirm_payment", "sufficient allowance advances to separate payment approval");

console.log("Payment card view checks passed (10 assertions).");
