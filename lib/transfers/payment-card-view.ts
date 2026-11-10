import type { TransferSubmission } from "@/lib/transfers/submissions";
import type { ApprovalState } from "@/lib/wallet/transfer-execution";

export type PaymentCardSubmission = Pick<TransferSubmission, "status" | "txHash" | "verifiedAt" | "failureReason">;

export type PaymentCardViewInput = {
  submission: PaymentCardSubmission | null;
  freshnessFresh: boolean;
  intentExpired: boolean;
  intentPending: boolean;
  intentCancelled: boolean;
  recoveryHash: string | null;
  uncertainBroadcast: boolean;
  pendingWalletConfirmation: boolean;
  paymentPreparationPending: boolean;
  supportedNetwork: boolean;
  accountMatches: boolean;
  networkMatches: boolean;
  hasPlan: boolean;
  hasGas: boolean;
  reviewError: boolean;
  tokenRequired: boolean;
  allowanceState: ApprovalState | null;
};

export type PaymentCardView =
  | { kind: "verified"; txHash: string | null; verifiedAt: string }
  | { kind: "failed"; txHash: string | null; reason: string | null }
  | { kind: "unknown"; txHash: string | null; needsHashRecovery: boolean; reason: string | null }
  | { kind: "verification_pending"; txHash: string | null; submitted: boolean }
  | { kind: "cancelled" }
  | { kind: "stale" }
  | { kind: "expired" }
  | { kind: "unsupported" }
  | {
      kind: "review";
      nextAction:
        | "switch_network"
        | "connect_wallet"
        | "prepare_payment"
        | "retry_review"
        | "prepare_review"
        | "check_allowance"
        | "approve_allowance"
        | "await_allowance_wallet"
        | "verify_allowance"
        | "confirm_payment"
        | "await_payment_wallet";
    };

export function resolvePaymentCardView(input: PaymentCardViewInput): PaymentCardView {
  const { submission } = input;

  if (submission?.status === "confirmed" && submission.verifiedAt) {
    return { kind: "verified", txHash: submission.txHash, verifiedAt: submission.verifiedAt };
  }
  if (submission?.status === "failed") {
    return { kind: "failed", txHash: submission.txHash, reason: submission.failureReason };
  }
  if (submission?.status === "unknown") {
    return { kind: "unknown", txHash: submission.txHash, needsHashRecovery: !submission.txHash, reason: submission.failureReason };
  }
  if (input.pendingWalletConfirmation) {
    return { kind: "review", nextAction: "await_payment_wallet" };
  }
  if (input.paymentPreparationPending) {
    return { kind: "review", nextAction: "prepare_payment" };
  }
  if (input.uncertainBroadcast && !input.recoveryHash) {
    return { kind: "unknown", txHash: null, needsHashRecovery: true, reason: null };
  }
  if (submission?.status === "confirmed") {
    return { kind: "verification_pending", txHash: submission.txHash, submitted: false };
  }
  if (submission || input.recoveryHash) {
    return {
      kind: "verification_pending",
      txHash: submission?.txHash ?? input.recoveryHash,
      submitted: submission?.status === "submitted",
    };
  }
  if (input.intentCancelled) return { kind: "cancelled" };
  if (input.intentExpired || !input.intentPending) return { kind: "expired" };
  if (!input.freshnessFresh) return { kind: "stale" };
  if (!input.supportedNetwork) return { kind: "unsupported" };
  if (!input.accountMatches) return { kind: "review", nextAction: "connect_wallet" };
  if (!input.networkMatches) return { kind: "review", nextAction: "switch_network" };
  if (input.reviewError) return { kind: "review", nextAction: "retry_review" };
  if (!input.hasPlan || !input.hasGas) return { kind: "review", nextAction: "prepare_review" };
  if (!input.tokenRequired) return { kind: "review", nextAction: "confirm_payment" };

  switch (input.allowanceState) {
    case "approval_required":
      return { kind: "review", nextAction: "approve_allowance" };
    case "awaiting_token_approval":
      return { kind: "review", nextAction: "await_allowance_wallet" };
    case "approval_confirming":
      return { kind: "review", nextAction: "verify_allowance" };
    case "payment_ready":
      return { kind: "review", nextAction: "confirm_payment" };
    case "checking_allowance":
    default:
      return { kind: "review", nextAction: "check_allowance" };
  }
}
