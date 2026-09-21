/**
 * Extracted verbatim from the transaction status route so that read-only
 * consumers (status API, conversational assistant) share one definition of
 * what a transaction state actually means. No I/O, no mutation.
 */

import type {
  TransactionRecord,
  PublicTransactionDto,
} from "@/lib/transactions/types";
import { isFiatDeliveryFinal } from "@/lib/transactions/types";

export type TransactionStage =
  | "awaiting_payment"
  | "deposit_confirming"
  | "deposit_confirmed"
  | "settling"
  | "settled"
  | "failed"
  | "recovery_required"
  | "airtime_submitting"
  | "airtime_processing"
  | "airtime_reconciliation_required"
  | "airtime_delivered";

export type CashOutStage = TransactionStage;

export interface StageInfo {
  stage: TransactionStage;
  label: string;
  description: string;
  isFiatFinal: boolean;
  isFiatDelivered: boolean;
  isProtocolSettled: boolean;
  isDepositConfirmed: boolean;
  isAirtimeDelivered?: boolean;
  isReconciliationRequired?: boolean;
}

function extractFulfilmentInfo(tx: TransactionRecord | PublicTransactionDto) {
  const txObj: object = tx;
  const pubFulfilment =
    "fulfilment" in txObj &&
    txObj.fulfilment !== null &&
    typeof txObj.fulfilment === "object"
      ? (txObj.fulfilment as Record<string, unknown>)
      : null;
  const metadata =
    "metadata" in txObj &&
    txObj.metadata !== null &&
    typeof txObj.metadata === "object"
      ? (txObj.metadata as Record<string, unknown>)
      : null;

  const reconciliationRequired = Boolean(
    pubFulfilment?.reconciliationRequired ??
      metadata?.fulfilment_reconciliation_required ??
      metadata?.reconciliationRequired,
  );

  const attemptsRaw =
    pubFulfilment?.attempts ??
    metadata?.fulfilment_attempts ??
    metadata?.attempts;
  const attempts =
    attemptsRaw !== undefined && attemptsRaw !== null
      ? Number(attemptsRaw)
      : null;

  const statusCode = (
    pubFulfilment?.statusCode ??
    metadata?.clubkonnect_status_code ??
    metadata?.statusCode ??
    ""
  )?.toString();

  const fulfilledAt =
    pubFulfilment?.fulfilledAt ??
    metadata?.fulfilled_at ??
    metadata?.fulfilledAt;

  const reservedAt =
    pubFulfilment?.reservedAt ??
    metadata?.fulfilment_reserved_at ??
    metadata?.reservedAt;

  const requestId =
    pubFulfilment?.requestId ??
    metadata?.clubkonnect_request_id ??
    metadata?.requestId;

  return {
    reconciliationRequired,
    attempts,
    statusCode,
    fulfilledAt,
    reservedAt,
    requestId,
  };
}

export function computeTransactionStage(
  tx: TransactionRecord | PublicTransactionDto,
): StageInfo {
  if (tx.type === "airtime") {
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
        isAirtimeDelivered: false,
        isReconciliationRequired: false,
      };
    }

    const fulfilment = extractFulfilmentInfo(tx);
    const paycrestStatus = tx.paycrestStatus?.toLowerCase();
    // Fiat delivery is a durable monotonic fact. Raw `settling` alone is not
    // proof, but it cannot revoke a previously recorded `validated` fact.
    const isFiatFinal = isFiatDeliveryFinal(tx);
    const isFiatDelivered = isFiatFinal;
    // Protocol settlement is a strictly Paycrest-side terminal fact. Internal
    // progress states only prove fiat delivery, never that Paycrest itself has
    // settled, so they must not be used to infer it.
    const isProtocolSettled = paycrestStatus === "settled";

    if (tx.status === "failed") {
      if (isFiatDelivered) {
        return {
          stage: "failed",
          label: "Airtime fulfilment failed",
          description: `NGN settlement was confirmed, but airtime fulfilment failed: ${
            tx.failureReason || "Provider rejected request"
          }. Providus did not issue an automatic refund.`,
          isFiatFinal,
          isFiatDelivered,
          isProtocolSettled,
          isDepositConfirmed: true,
          isAirtimeDelivered: false,
          isReconciliationRequired: false,
        };
      }

      return {
        stage: "failed",
        label: "Failed",
        description: tx.failureReason || "Transaction or payment failed.",
        isFiatFinal: false,
        isFiatDelivered: false,
        isProtocolSettled,
        isDepositConfirmed: Boolean(tx.celoTxHash),
        isAirtimeDelivered: false,
        isReconciliationRequired: false,
      };
    }

    if (tx.status === "refunded") {
      return {
        stage: "failed",
        label: "Refunded",
        description: "Payment was refunded to your refund address.",
        isFiatFinal: false,
        isFiatDelivered: false,
        isProtocolSettled,
        isDepositConfirmed: true,
        isAirtimeDelivered: false,
        isReconciliationRequired: false,
      };
    }

    const hasVerifiedDeliveryCode = fulfilment.statusCode === "200";
    if (tx.status === "completed") {
      if (hasVerifiedDeliveryCode) {
        return {
          stage: "airtime_delivered",
          label: "Airtime delivered",
          description:
            "ClubKonnect returned the documented terminal success status and airtime delivery is verified.",
          isFiatFinal,
          isFiatDelivered,
          isProtocolSettled,
          isDepositConfirmed: true,
          isAirtimeDelivered: true,
          isReconciliationRequired: false,
        };
      }

      if (fulfilment.reconciliationRequired) {
        return {
          stage: "recovery_required",
          label: "Recovery required",
          description:
            "Airtime completion was recorded without a verified ClubKonnect success code. This request needs reconciliation.",
          isFiatFinal,
          isFiatDelivered,
          isProtocolSettled,
          isDepositConfirmed: true,
          isAirtimeDelivered: false,
          isReconciliationRequired: true,
        };
      }

      return {
        stage: "failed",
        label: "Airtime fulfilment failed",
        description:
          "Airtime completion was recorded without a verified ClubKonnect success code.",
        isFiatFinal,
        isFiatDelivered,
        isProtocolSettled,
        isDepositConfirmed: true,
        isAirtimeDelivered: false,
        isReconciliationRequired: false,
      };
    }

    if (tx.status === "processing") {
      if (fulfilment.reconciliationRequired) {
        return {
          stage: "airtime_reconciliation_required",
          label: "Provider status unresolved",
          description:
            "The airtime provider status is unresolved. Providus will not submit another purchase; this request needs reconciliation.",
          isFiatFinal,
          isFiatDelivered,
          isProtocolSettled,
          isDepositConfirmed: true,
          isAirtimeDelivered: false,
          isReconciliationRequired: true,
        };
      }

      if (fulfilment.attempts === 0) {
        return {
          stage: "airtime_submitting",
          label: "Airtime request submitting",
          description: isFiatDelivered
            ? "Your Celo payment and NGN settlement are confirmed. The airtime request is being submitted."
            : "Celo payment confirmed / NGN settlement processing. The airtime request is being submitted.",
          isFiatFinal,
          isFiatDelivered,
          isProtocolSettled,
          isDepositConfirmed: true,
          isAirtimeDelivered: false,
          isReconciliationRequired: false,
        };
      }

      if (
        fulfilment.statusCode === "100" ||
        fulfilment.statusCode === "300"
      ) {
        return {
          stage: "airtime_processing",
          label: "Airtime processing",
          description:
            "The airtime request was received and is still processing. I will not create another purchase while this request is unresolved.",
          isFiatFinal,
          isFiatDelivered,
          isProtocolSettled,
          isDepositConfirmed: true,
          isAirtimeDelivered: false,
          isReconciliationRequired: false,
        };
      }

      if (
        fulfilment.attempts === 1 ||
        fulfilment.statusCode === "200"
      ) {
        return {
          stage: "airtime_reconciliation_required",
          label: "Provider status unresolved",
          description:
            "The airtime provider status is unresolved. Providus will not submit another purchase; this request needs reconciliation.",
          isFiatFinal,
          isFiatDelivered,
          isProtocolSettled,
          isDepositConfirmed: true,
          isAirtimeDelivered: false,
          isReconciliationRequired: true,
        };
      }

      return {
        stage: "airtime_submitting",
        label: "Airtime request submitting",
        description: isFiatDelivered
          ? "Your Celo payment and NGN settlement are confirmed. The airtime request is being submitted."
          : "Celo payment confirmed / NGN settlement processing. The airtime request is being submitted.",
        isFiatFinal,
        isFiatDelivered,
        isProtocolSettled,
        isDepositConfirmed: true,
        isAirtimeDelivered: false,
        isReconciliationRequired: false,
      };
    }

    if (tx.status === "settled") {
      if (!isFiatDelivered) {
        return {
          stage: "settling",
          label: "NGN settlement processing",
          description: "Celo payment confirmed / NGN settlement processing.",
          isFiatFinal: false,
          isFiatDelivered: false,
          isProtocolSettled,
          isDepositConfirmed: true,
          isAirtimeDelivered: false,
          isReconciliationRequired: false,
        };
      }

      return {
        stage: "settled",
        label: "NGN settlement confirmed",
        description:
          "Your Celo payment and NGN settlement are confirmed. I have not sent the airtime request yet.",
        isFiatFinal,
        isFiatDelivered,
        isProtocolSettled,
        isDepositConfirmed: true,
        isAirtimeDelivered: false,
        isReconciliationRequired: false,
      };
    }

    if (tx.status === "settling") {
      const upstream = tx.paycrestStatus?.toLowerCase() ?? "";
      if (upstream === "fulfilling" || upstream === "fulfilled") {
        return {
          stage: "settling",
          label: "NGN payout in progress",
          description:
            "Celo deposit confirmed. Liquidity provider is disbursing NGN to recipient bank account.",
          isFiatFinal: false,
          isFiatDelivered: false,
          isProtocolSettled,
          isDepositConfirmed: true,
          isAirtimeDelivered: false,
          isReconciliationRequired: false,
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
          isProtocolSettled,
          isDepositConfirmed: true,
          isAirtimeDelivered: false,
          isReconciliationRequired: false,
        };
      }

      return {
        stage: "deposit_confirmed",
        label: "Celo deposit confirmed",
        description:
          "USDC deposit confirmed on-chain. Waiting for Paycrest fiat settlement rails.",
        isFiatFinal: false,
        isFiatDelivered: false,
        isProtocolSettled,
        isDepositConfirmed: true,
        isAirtimeDelivered: false,
        isReconciliationRequired: false,
      };
    }

    // Pending
    return {
      stage: "awaiting_payment",
      label: "Awaiting payment",
      description: "Order created. Send USDC deposit on Celo before expiry.",
      isFiatFinal: false,
      isFiatDelivered: false,
      isProtocolSettled,
      isDepositConfirmed: false,
      isAirtimeDelivered: false,
      isReconciliationRequired: false,
    };
  }

  // Cash-out flow (preserved exactly)
  const cashOutFiatFinal = isFiatDeliveryFinal(tx);
  const cashOutProtocolSettled = tx.paycrestStatus?.toLowerCase() === "settled";
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
      isAirtimeDelivered: false,
      isReconciliationRequired: false,
    };
  }

  if (tx.status === "failed") {
    return {
      stage: "failed",
      label: "Failed",
      description: tx.failureReason || "Transaction or payment failed.",
      isFiatFinal: cashOutFiatFinal,
      isFiatDelivered: cashOutFiatFinal,
      isProtocolSettled: cashOutProtocolSettled,
      isDepositConfirmed: false,
      isAirtimeDelivered: false,
      isReconciliationRequired: false,
    };
  }

  if (tx.status === "refunded") {
    return {
      stage: "failed",
      label: "Refunded",
      description: "Payment was refunded to your refund address.",
      isFiatFinal: cashOutFiatFinal,
      isFiatDelivered: cashOutFiatFinal,
      isProtocolSettled: cashOutProtocolSettled,
      isDepositConfirmed: true,
      isAirtimeDelivered: false,
      isReconciliationRequired: false,
    };
  }

  if (tx.status === "completed") {
    return {
      stage: "settled",
      label: "Completed",
      description: "Payment and utility fulfilment verified successfully.",
      isFiatFinal: cashOutFiatFinal,
      isFiatDelivered: cashOutFiatFinal,
      // Protocol settlement is only ever the Paycrest `settled` milestone; a
      // completed row with no such upstream proof is not protocol settled.
      isProtocolSettled: cashOutProtocolSettled,
      isDepositConfirmed: true,
      isAirtimeDelivered: false,
      isReconciliationRequired: false,
    };
  }

  if (tx.status === "processing") {
    return {
      stage: "settled",
      label: "Fulfilment processing",
      description:
        "Fiat payout verified. Downstream utility fulfilment in progress.",
      isFiatFinal: cashOutFiatFinal,
      isFiatDelivered: cashOutFiatFinal,
      isProtocolSettled: cashOutProtocolSettled,
      isDepositConfirmed: true,
      isAirtimeDelivered: false,
      isReconciliationRequired: false,
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
      isFiatFinal: cashOutFiatFinal,
      isFiatDelivered: cashOutFiatFinal,
      isProtocolSettled: isProtocolComplete,
      isDepositConfirmed: true,
      isAirtimeDelivered: false,
      isReconciliationRequired: false,
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
        isFiatFinal: cashOutFiatFinal,
        isFiatDelivered: cashOutFiatFinal,
        isProtocolSettled: cashOutProtocolSettled,
        isDepositConfirmed: true,
        isAirtimeDelivered: false,
        isReconciliationRequired: false,
      };
    }

    if (upstream === "settling") {
      return {
        stage: "settling",
        label: "NGN settlement processing",
        description:
          "Celo deposit confirmed. Payout settlement in progress.",
        isFiatFinal: cashOutFiatFinal,
        isFiatDelivered: cashOutFiatFinal,
        isProtocolSettled: cashOutProtocolSettled,
        isDepositConfirmed: true,
        isAirtimeDelivered: false,
        isReconciliationRequired: false,
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
      isAirtimeDelivered: false,
      isReconciliationRequired: false,
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
    isAirtimeDelivered: false,
    isReconciliationRequired: false,
  };
}
