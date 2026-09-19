import type { TransactionStatus, TransactionType } from "@/lib/transactions/types";

/**
 * Universally terminal statuses that can NEVER transition to any other status
 * regardless of transaction type.
 */
export const UNIVERSALLY_TERMINAL_STATUSES: Record<TransactionStatus, boolean> = {
  pending: false,
  settling: false,
  settled: false, // NOT universally terminal: extensible for utility lifecycles (airtime)
  processing: false,
  completed: true, // Universally terminal
  failed: true, // Universally terminal
  refunded: true, // Universally terminal
};

/**
 * Checks whether a status is terminal for a given transaction type:
 * - For cash_out: 'settled' is an effective terminal business outcome (fiat confirmed delivered).
 * - For utility transactions (e.g. airtime): 'settled' is non-terminal, transitioning to 'processing' -> 'completed'.
 * - 'completed', 'failed', and 'refunded' are universally terminal across all transaction types.
 */
export function isTerminalStatus(
  status: TransactionStatus,
  type: TransactionType = "cash_out",
): boolean {
  if (UNIVERSALLY_TERMINAL_STATUSES[status]) {
    return true;
  }
  if (status === "settled" && type === "cash_out") {
    return true;
  }
  return false;
}

/**
 * Deterministic, type-aware transition tables:
 *
 * cash_out:
 *   pending -> settling -> settled
 *   (settled is terminal; no fulfilment states permitted)
 *
 * airtime (and future utility transactions):
 *   pending -> settling -> settled -> processing -> completed
 *   (settled leads to processing; processing leads to completed or failed)
 */
export const ALLOWED_TRANSITIONS_BY_TYPE: Record<
  TransactionType,
  Record<TransactionStatus, Partial<Record<TransactionStatus, true>>>
> = {
  cash_out: {
    pending: { pending: true, settling: true, failed: true },
    settling: { settling: true, settled: true, refunded: true, failed: true },
    settled: { settled: true }, // Terminal business outcome for cash_out
    processing: {},
    completed: {},
    failed: { failed: true }, // Universally terminal
    refunded: { refunded: true }, // Universally terminal
  },
  airtime: {
    pending: { pending: true, settling: true, failed: true },
    settling: { settling: true, settled: true, refunded: true, failed: true },
    settled: { settled: true, processing: true }, // Extensible for utility fulfilment
    processing: { processing: true, completed: true, failed: true },
    completed: { completed: true }, // Universally terminal
    failed: { failed: true }, // Universally terminal
    refunded: { refunded: true }, // Universally terminal
  },
};

export interface TransitionValidationResult {
  allowed: boolean;
  isNoop: boolean;
  reason?: string;
}

/**
 * Validates whether transitioning from `currentStatus` to `targetStatus` is permitted
 * for the given transaction `type`.
 */
export function validateStatusTransition(
  currentStatus: TransactionStatus,
  targetStatus: TransactionStatus,
  type: TransactionType = "cash_out",
): TransitionValidationResult {
  if (currentStatus === targetStatus) {
    return { allowed: true, isNoop: true };
  }

  if (isTerminalStatus(currentStatus, type)) {
    return {
      allowed: false,
      isNoop: false,
      reason: `Cannot transition from terminal status '${currentStatus}' to '${targetStatus}' for transaction type '${type}'.`,
    };
  }

  const typeTransitions =
    ALLOWED_TRANSITIONS_BY_TYPE[type] ?? ALLOWED_TRANSITIONS_BY_TYPE.cash_out;
  const allowedNext = typeTransitions[currentStatus];
  if (!allowedNext || !allowedNext[targetStatus]) {
    return {
      allowed: false,
      isNoop: false,
      reason: `Illegal transition from '${currentStatus}' to '${targetStatus}' for transaction type '${type}'.`,
    };
  }

  return { allowed: true, isNoop: false };
}
