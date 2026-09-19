/**
 * Pure cash-out stage derivation.
 *
 * Extracted verbatim from the transaction status route so that read-only
 * consumers (status API, conversational assistant) share one definition of
 * what a transaction state actually means. No I/O, no mutation.
 */

import type { TransactionRecord } from "@/lib/transactions/types";

export type CashOutStage =
  | "awaiting_payment"
  | "deposit_confirming"
  | "deposit_confirmed"
  | "settling"
  | "settled"
  | "failed"
  | "recovery_required";

export interface StageInfo {
  stage: CashOutStage;
  label: string;
  description: string;
  isFiatFinal: boolean;
  isFiatDelivered: boolean;
  isProtocolSettled: boolean;
  isDepositConfirmed: boolean;
}

export function computeTransactionStage(tx: TransactionRecord): StageInfo {
  if (tx.failureCode === "ORDER_CREATION_OUTCOME_UNKNOWN") {
    return {
      stage: "recovery_required",
      label: "Recovery required",
      description:
        "Order creation timed out; outcome unknown. Do not create another order immediately.",
      isFiatFinal: false,
      isFiatDelivered: false,
      isProtocolSettled: false,
      isDepositConfirmed: false,
    };
  }

  if (tx.status === "failed") {
    return {
      stage: "failed",
      label: "Failed",
      description: tx.failureReason || "Transaction or payment failed.",
      isFiatFinal: false,
      isFiatDelivered: false,
      isProtocolSettled: false,
      isDepositConfirmed: false,
    };
  }

  if (tx.status === "refunded") {
    return {
      stage: "failed",
      label: "Refunded",
      description: "Payment was refunded to your refund address.",
      isFiatFinal: false,
      isFiatDelivered: false,
      isProtocolSettled: false,
      isDepositConfirmed: true,
    };
  }

  if (tx.status === "completed") {
    return {
      stage: "settled",
      label: "Completed",
      description: "Payment and utility fulfilment verified successfully.",
      isFiatFinal: true,
      isFiatDelivered: true,
      isProtocolSettled: true,
      isDepositConfirmed: true,
    };
  }

  if (tx.status === "processing") {
    return {
      stage: "settled",
      label: "Fulfilment processing",
      description:
        "Fiat payout verified. Downstream utility fulfilment in progress.",
      isFiatFinal: true,
      isFiatDelivered: true,
      isProtocolSettled: tx.paycrestStatus?.toLowerCase() === "settled",
      isDepositConfirmed: true,
    };
  }

  if (tx.status === "settled") {
    const isProtocolComplete = tx.paycrestStatus?.toLowerCase() === "settled";
    return {
      stage: "settled",
      label: isProtocolComplete
        ? "Paycrest protocol settled"
        : "Fiat delivery confirmed",
      description: isProtocolComplete
        ? "Fiat delivery confirmed and Paycrest protocol settlement complete."
        : "Fiat funds have been confirmed delivered into recipient bank account by provider.",
      isFiatFinal: true,
      isFiatDelivered: true,
      isProtocolSettled: isProtocolComplete,
      isDepositConfirmed: true,
    };
  }

  if (tx.status === "settling") {
    // Distinguish on-chain deposit confirmed vs bank settling
    const upstream = tx.paycrestStatus?.toLowerCase() ?? "";
    if (upstream === "fulfilling" || upstream === "fulfilled") {
      return {
        stage: "settling",
        label: "NGN payout in progress",
        description:
          "Celo deposit confirmed. Liquidity provider is disbursing NGN to recipient bank account.",
        isFiatFinal: false,
        isFiatDelivered: false,
        isProtocolSettled: false,
        isDepositConfirmed: true,
      };
    }

    if (upstream === "settling") {
      return {
        stage: "settling",
        label: "NGN settlement processing",
        description:
          "Celo deposit confirmed. Payout settlement in progress.",
        isFiatFinal: false,
        isFiatDelivered: false,
        isProtocolSettled: false,
        isDepositConfirmed: true,
      };
    }

    return {
      stage: "deposit_confirmed",
      label: "Celo deposit confirmed",
      description:
        "USDC deposit confirmed on-chain. Waiting for Paycrest fiat settlement rails.",
      isFiatFinal: false,
      isFiatDelivered: false,
      isProtocolSettled: false,
      isDepositConfirmed: true,
    };
  }

  // Pending
  return {
    stage: "awaiting_payment",
    label: "Awaiting payment",
    description: "Order created. Send USDC deposit on Celo before expiry.",
    isFiatFinal: false,
    isFiatDelivered: false,
    isProtocolSettled: false,
    isDepositConfirmed: false,
  };
}
