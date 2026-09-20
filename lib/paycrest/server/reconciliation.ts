import { getOfframpOrder } from "@/lib/paycrest/server/client";
import {
  getTransactionRepository,
  isTerminalStatus,
  type TransactionRecord,
  type TransactionStatus,
} from "@/lib/transactions";

/**
 * Official Paycrest off-ramp order statuses documented:
 * - initiated: order created upstream, awaiting on-chain deposit
 * - deposited: on-chain deposit detected by Paycrest at receive address
 * - pending: order is matched to liquidity provider and queued for fulfillment
 * - fulfilling: liquidity provider is disbursing fiat payout to recipient bank account / mobile wallet
 * - fulfilled: payout disbursement completed by provider (internal provider status)
 * - validated: provider has confirmed fiat delivery; safe point to notify an offramp recipient
 *   (order is awaiting on-chain escrow release settlement)
 * - settling: onchain settlement in progress (escrowed stablecoins being released to provider)
 * - settled: Paycrest order is fully / protocol-complete (onchain settlement confirmed, fiat delivered)
 * - cancelled: order was cancelled before deposit
 * - refunding: deposit return is in progress (deposit detected, fulfillment failed)
 * - refunded: deposit returned to user's refund address on Celo
 * - expired: payment window elapsed without valid deposit
 */
export const DOCUMENTED_PAYCREST_STATUSES = [
  "initiated",
  "deposited",
  "pending",
  "fulfilling",
  "fulfilled",
  "validated",
  "settling",
  "settled",
  "cancelled",
  "refunding",
  "refunded",
  "expired",
] as const;

export type DocumentedPaycrestStatus =
  (typeof DOCUMENTED_PAYCREST_STATUSES)[number];

export interface StatusMappingResult {
  targetStatus: TransactionStatus;
  isFiatFinal: boolean; // fiat delivery confirmed to recipient
  isFiatDelivered: boolean; // true for validated and settled
  isProtocolSettled: boolean; // true only when Paycrest protocol is fully settled
  isDepositConfirmed: boolean;
  isTerminal: boolean;
}

/**
 * Truthful mapping from upstream Paycrest status to internal Providus transaction status.
 *
 * CRITICAL INVARIANTS:
 * 1. 'validated' signifies confirmed fiat delivery into recipient bank account.
 *    It safely advances internal status to 'settled' (fiat delivery confirmed milestone).
 * 2. Subsequent upstream 'settling' (onchain escrow release) or 'settled' (protocol complete)
 *    MUST NOT revert internal status back to 'settling'.
 * 3. Exact upstream Paycrest status ('validated', 'settling', 'settled') is preserved in paycrest_status.
 * 4. For cash_out, 'settled' is the terminal business outcome. For utility transactions,
 *    it enables downstream fulfilment ('processing' -> 'completed').
 */
export function mapPaycrestStatusToInternal(
  paycrestStatus: string,
  currentInternalStatus: TransactionStatus,
  type: "cash_out" | "airtime" = "cash_out",
): StatusMappingResult {
  const normalized = paycrestStatus.toLowerCase().trim();

  switch (normalized) {
    case "initiated":
      return {
        targetStatus: currentInternalStatus === "settling" ? "settling" : "pending",
        isFiatFinal: false,
        isFiatDelivered: false,
        isProtocolSettled: false,
        isDepositConfirmed: currentInternalStatus === "settling",
        isTerminal: false,
      };

    case "deposited":
    case "pending":
    case "fulfilling":
    case "fulfilled":
      // These are provider-side progress (or stale, out-of-order) milestones:
      // none of them proves fiat reached the recipient, so none may claim fiat
      // finality, fiat delivery, or protocol settlement. A row already at
      // `settled` (e.g. via `validated` or `settled`) keeps its internal
      // status — the milestone change is recorded, never rolled back — but the
      // answer's truthfulness flags stay false.
      if (currentInternalStatus === "settled") {
        return {
          targetStatus: "settled",
          isFiatFinal: false,
          isFiatDelivered: false,
          isProtocolSettled: false,
          isDepositConfirmed: true,
          isTerminal: isTerminalStatus("settled", type),
        };
      }
      return {
        targetStatus: "settling",
        isFiatFinal: false,
        isFiatDelivered: false,
        isProtocolSettled: false,
        isDepositConfirmed: true,
        isTerminal: false,
      };

    case "validated":
      // Provider confirmed fiat delivery to bank account!
      // Safe point to notify recipient and trigger downstream utility fulfilment.
      return {
        targetStatus: "settled",
        isFiatFinal: true,
        isFiatDelivered: true,
        isProtocolSettled: false,
        isDepositConfirmed: true,
        isTerminal: isTerminalStatus("settled", type),
      };

    case "settling":
      // Paycrest on-chain settlement is in progress.
      // If fiat was already confirmed delivered ('settled'), NEVER revert backwards!
      if (currentInternalStatus === "settled") {
        return {
          targetStatus: "settled",
          isFiatFinal: true,
          isFiatDelivered: true,
          isProtocolSettled: false,
          isDepositConfirmed: true,
          isTerminal: isTerminalStatus("settled", type),
        };
      }
      return {
        targetStatus: "settling",
        isFiatFinal: false,
        isFiatDelivered: false,
        isProtocolSettled: false,
        isDepositConfirmed: true,
        isTerminal: false,
      };

    case "settled":
      // Paycrest order fully / protocol-complete (onchain settlement confirmed & fiat delivered)
      return {
        targetStatus: "settled",
        isFiatFinal: true,
        isFiatDelivered: true,
        isProtocolSettled: true,
        isDepositConfirmed: true,
        isTerminal: isTerminalStatus("settled", type),
      };
    case "cancelled":
      return {
        targetStatus: "failed",
        isFiatFinal: false,
        isFiatDelivered: false,
        isProtocolSettled: false,
        isDepositConfirmed: false,
        isTerminal: true,
      };

    case "refunding":
      if (currentInternalStatus === "settled") {
        return {
          targetStatus: "settled",
          isFiatFinal: true,
          isFiatDelivered: true,
          isProtocolSettled: false,
          isDepositConfirmed: true,
          isTerminal: isTerminalStatus("settled", type),
        };
      }
      return {
        targetStatus: "settling",
        isFiatFinal: false,
        isFiatDelivered: false,
        isProtocolSettled: false,
        isDepositConfirmed: true,
        isTerminal: false,
      };

    case "refunded":
      return {
        targetStatus: "refunded",
        isFiatFinal: false,
        isFiatDelivered: false,
        isProtocolSettled: false,
        isDepositConfirmed: true,
        isTerminal: true,
      };

    case "expired":
      // If user had already deposited on Celo ('settling'), do not blindly mark failed!
      // Keep 'settling' so funds can be tracked / refunded.
      if (currentInternalStatus === "settling") {
        return {
          targetStatus: "settling",
          isFiatFinal: false,
          isFiatDelivered: false,
          isProtocolSettled: false,
          isDepositConfirmed: true,
          isTerminal: false,
        };
      }
      return {
        targetStatus: "failed",
        isFiatFinal: false,
        isFiatDelivered: false,
        isProtocolSettled: false,
        isDepositConfirmed: false,
        isTerminal: true,
      };

    default:
      return {
        targetStatus: currentInternalStatus,
        isFiatFinal: currentInternalStatus === "settled",
        isFiatDelivered: currentInternalStatus === "settled",
        isProtocolSettled:
          currentInternalStatus === "settled" && normalized === "settled",
        isDepositConfirmed:
          currentInternalStatus === "settling" ||
          currentInternalStatus === "settled",
        isTerminal: isTerminalStatus(currentInternalStatus, type),
      };
  }
}

export interface ReconcileResult {
  ok: boolean;
  transaction: TransactionRecord;
  upstreamStatus?: string;
  isFiatFinal: boolean;
  changed: boolean;
  message?: string;
}

/**
 * Reconciles a transaction against Paycrest API:
 * 1. Fetches current state from Paycrest (GET /v2/sender/orders/:id)
 * 2. Maps upstream status conservatively
 * 3. Idempotently updates internal state
 * 4. Protects terminal states from rollback
 * 5. Returns truthful status
 */
export async function reconcileTransaction(
  transactionId: string,
): Promise<ReconcileResult> {
  const repo = getTransactionRepository();
  const tx = await repo.findById(transactionId);

  if (!tx) {
    throw new Error(`Transaction ${transactionId} not found`);
  }

  // Terminal failure / completion protection: never mutate completed, failed, or refunded
  if (
    tx.status === "failed" ||
    tx.status === "refunded" ||
    tx.status === "completed"
  ) {
    return {
      ok: true,
      transaction: tx,
      upstreamStatus: tx.paycrestStatus ?? undefined,
      isFiatFinal: false,
      changed: false,
    };
  }

  if (!tx.paycrestOrderId) {
    return {
      ok: true,
      transaction: tx,
      isFiatFinal: false,
      changed: false,
      message: "No Paycrest order ID bound to transaction yet",
    };
  }

  const upstream = await getOfframpOrder(tx.paycrestOrderId);
  if (!upstream.ok) {
    // Provider timeout or error must NEVER corrupt state
    return {
      ok: false,
      transaction: tx,
      isFiatFinal: false,
      changed: false,
      message: upstream.message,
    };
  }

  const rawStatus = upstream.data.status;
  const mapping = mapPaycrestStatusToInternal(rawStatus, tx.status, tx.type);

  const updateResult = await repo.updateStatus(tx.id, {
    status: mapping.targetStatus,
    paycrestStatus: rawStatus,
    failureReason:
      mapping.targetStatus === "failed"
        ? `Upstream status: ${rawStatus}`
        : undefined,
  });

  if (!updateResult.ok) {
    return {
      ok: false,
      transaction: tx,
      upstreamStatus: rawStatus,
      isFiatFinal: false,
      changed: false,
      message: updateResult.message,
    };
  }

  return {
    ok: true,
    transaction: updateResult.record,
    upstreamStatus: rawStatus,
    isFiatFinal: mapping.isFiatFinal,
    changed: !updateResult.isNoop,
  };
}
