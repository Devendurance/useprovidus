/**
 * ClubKonnect airtime fulfilment orchestration.
 *
 * The single place where a ClubKonnect airtime purchase is allowed to happen.
 * The ordering below is load-bearing and cannot be rearranged:
 *
 *   1. terminal states short-circuit (nothing to do),
 *   2. an already-reserved transaction is reconciled, NEVER re-purchased,
 *   3. only `settled` airtime transactions with authoritative metadata proceed,
 *   4. provider float is checked with a read-only preflight,
 *   5. a conditional reservation is acquired (exactly one winner),
 *   6. the fulfilment attempt is claimed (0 -> 1) immediately before the call,
 *   7. exactly one purchase is executed; its answer must carry the bound
 *      RequestID, and only then is its outcome persisted.
 *
 * A timeout, network failure, unreadable answer, or an answer bound to a
 * different RequestID is recorded as an unknown outcome that requires
 * reconciliation; it is never retried blindly and never becomes a refund.
 *
 * A float check that cannot be read is never exhaustion: only an observed
 * balance below the amount is. An unreadable check leaves the row settled
 * and reports the check as unavailable, so the next call can retry safely.
 *
 * Import ONLY from server modules. Never import from client components.
 */

import "server-only";

import {
  executeClubKonnectAirtimePurchase,
  normalizeAndValidatePhone,
  queryClubKonnectWalletBalance,
  validateAirtimeAmount,
} from "@/lib/clubkonnect/server/client";
import {
  reconcileAirtimeFulfilment,
  readFulfilmentBinding,
} from "@/lib/clubkonnect/server/reconciliation";
import { buildClubKonnectRequestId } from "@/lib/clubkonnect/server/status";
import type {
  ClubKonnectNetwork,
  WalletBalanceResult,
} from "@/lib/clubkonnect/types";
import {
  getTransactionRepository,
  type FulfilmentMutationResult,
  type FulfilmentOutcomeInput,
  type FulfilmentReservationError,
  type TransactionRecord,
  type TransactionRepository,
  type TransactionStatus,
} from "@/lib/transactions";

export interface AirtimeFulfilmentOptions {
  /** Skips the provider float pre-check. Reserved for tests and recovery paths. */
  skipFloatCheck?: boolean;
  /** Test/self-check seam; production omits it and uses the shared singleton. */
  repository?: TransactionRepository;
}

/** Non-terminal-in-the-provider-sense outcomes a fulfil call can report. */
export type AirtimeFulfilmentOutcome = "processing" | "completed" | "failed";

export type AirtimeFulfilmentErrorCode =
  | "TRANSACTION_NOT_FOUND"
  | "NOT_ELIGIBLE"
  | "FULFILMENT_INVALID_TYPE"
  | "FULFILMENT_NOT_ELIGIBLE"
  | "FULFILMENT_REQUEST_ID_MISMATCH"
  | "FULFILMENT_METADATA_INVALID"
  | "FULFILMENT_RESERVATION_FAILED"
  | "FULFILMENT_CLAIM_FAILED"
  | "PROVIDER_FLOAT_EXHAUSTED"
  | "FLOAT_CHECK_UNAVAILABLE"
  | "PERSISTENCE_FAILED";

export type AirtimeFulfilmentResult =
  | {
      ok: true;
      status: AirtimeFulfilmentOutcome;
      transaction: TransactionRecord;
      message?: string;
    }
  | {
      ok: false;
      code: AirtimeFulfilmentErrorCode;
      message: string;
      transaction?: TransactionRecord;
    };

const RESERVATION_ERROR_CODE: Record<
  FulfilmentReservationError,
  AirtimeFulfilmentErrorCode
> = {
  TRANSACTION_NOT_FOUND: "TRANSACTION_NOT_FOUND",
  FULFILMENT_INVALID_TYPE: "FULFILMENT_INVALID_TYPE",
  FULFILMENT_NOT_ELIGIBLE: "FULFILMENT_NOT_ELIGIBLE",
  FULFILMENT_REQUEST_ID_MISMATCH: "FULFILMENT_REQUEST_ID_MISMATCH",
  FULFILMENT_METADATA_INVALID: "FULFILMENT_METADATA_INVALID",
  DATABASE_UNAVAILABLE: "FULFILMENT_RESERVATION_FAILED",
};

const CLUBKONNECT_NETWORKS: Record<ClubKonnectNetwork, true> = {
  mtn: true,
  glo: true,
  "9mobile": true,
  airtel: true,
};

function isClubKonnectNetwork(value: string): value is ClubKonnectNetwork {
  return Object.prototype.hasOwnProperty.call(CLUBKONNECT_NETWORKS, value);
}

/** Maps a persisted transaction status onto the outcome a caller observes. */
function fulfilmentOutcomeFromStatus(
  status: TransactionStatus,
): AirtimeFulfilmentOutcome {
  if (status === "completed") return "completed";
  if (status === "failed" || status === "refunded") return "failed";
  return "processing";
}

/**
 * Reads the authoritative airtime amount from the transaction row. Only a
 * plain integer NGN face value inside the supported range is accepted, so the
 * purchase amount can never come from client text or a malformed row.
 */
function parseAuthoritativeAmountNgn(raw: string | null): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const amount = Number(trimmed);
  return validateAirtimeAmount(amount) ? amount : null;
}

/** Parses the provider wallet balance; a malformed balance is treated as unusable. */
function parseBalanceNgn(raw: string): number | null {
  const trimmed = raw.trim().replace(/,/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null;
  const balance = Number(trimmed);
  return Number.isFinite(balance) ? balance : null;
}

/**
 * Reads the balance the provider actually reported. The client falls back to
 * "0" when an answer carries no balance field at all, and an absent field is an
 * unreadable check — never an observed empty wallet, which would otherwise fail
 * a paid transaction terminally.
 */
function readObservedBalanceNgn(data: WalletBalanceResult): number | null {
  const reported =
    Object.prototype.hasOwnProperty.call(data.rawResponse, "walletbalance") ||
    Object.prototype.hasOwnProperty.call(data.rawResponse, "balance");
  return reported ? parseBalanceNgn(data.balanceNgn) : null;
}

/**
 * Reports an outcome that never reached storage. The provider answer exists but
 * was lost, so the truthful state is the pre-call one: in flight, requiring
 * reconciliation. The stored row may still say otherwise, so the returned
 * snapshot carries the flag itself and a read failure never turns this report
 * into a thrown error.
 */
async function persistenceFailedResult(
  transactionId: string,
  repository: TransactionRepository,
  fallback: TransactionRecord,
): Promise<AirtimeFulfilmentResult> {
  let snapshot = fallback;
  try {
    snapshot = (await repository.findById(transactionId)) ?? fallback;
  } catch {
    // Keep the pre-call snapshot: the caller still needs the marked result.
  }

  return {
    ok: false,
    code: "PERSISTENCE_FAILED",
    message: "ClubKonnect outcome could not be persisted; reconciliation required",
    transaction: {
      ...snapshot,
      metadata: {
        ...(snapshot.metadata ?? {}),
        fulfilment_reconciliation_required: true,
      },
    },
  };
}

/**
 * Reconciles an in-flight fulfilment and reports it in the orchestration
 * vocabulary. Used by every path that must not purchase again.
 */
async function reconcileFulfilmentOutcome(
  transactionId: string,
  repository: TransactionRepository,
): Promise<AirtimeFulfilmentResult> {
  const reconciled = await reconcileAirtimeFulfilment(transactionId, {
    repository,
  });

  if (!reconciled.ok) {
    return {
      ok: false,
      code:
        reconciled.code === "TRANSACTION_NOT_FOUND"
          ? "TRANSACTION_NOT_FOUND"
          : "FULFILMENT_NOT_ELIGIBLE",
      message: reconciled.message,
      transaction: reconciled.transaction,
    };
  }

  return {
    ok: true,
    status: fulfilmentOutcomeFromStatus(reconciled.transaction.status),
    transaction: reconciled.transaction,
    ...(reconciled.message ? { message: reconciled.message } : {}),
  };
}

/**
 * Fulfils one settled airtime transaction through ClubKonnect, or advances a
 * transaction that is already in flight. Safe to call repeatedly: the
 * reservation and the attempt claim make a second purchase impossible, so a
 * retry of an unknown outcome reconciles instead of purchasing.
 */
export async function fulfilAirtimeOrder(
  transactionId: string,
  options?: AirtimeFulfilmentOptions,
): Promise<AirtimeFulfilmentResult> {
  const repository = options?.repository ?? getTransactionRepository();
  const tx = await repository.findById(transactionId);

  if (!tx) {
    return {
      ok: false,
      code: "TRANSACTION_NOT_FOUND",
      message: `Transaction ${transactionId} not found`,
    };
  }

  // Type is validated before any status branch: a non-airtime row (e.g. a
  // completed cash-out) must never be answered with a fulfilment outcome, no
  // matter which status it is in.
  if (tx.type !== "airtime") {
    return {
      ok: false,
      code: "FULFILMENT_INVALID_TYPE",
      message: "Transaction is not an airtime order",
      transaction: tx,
    };
  }

  if (tx.status === "completed") {
    return { ok: true, status: "completed", transaction: tx };
  }

  if (tx.status === "failed" || tx.status === "refunded") {
    return { ok: true, status: "failed", transaction: tx };
  }

  // Already in flight: the purchase either happened or is unknown. Query only.
  if (tx.status === "processing") {
    const expectedRequestId = buildClubKonnectRequestId(tx.id);
    const binding = readFulfilmentBinding(tx);
    if (binding.requestId !== expectedRequestId) {
      return {
        ok: false,
        code: "FULFILMENT_REQUEST_ID_MISMATCH",
        message:
          "Stored ClubKonnect request ID does not match the deterministic transaction request ID",
        transaction: tx,
      };
    }
    return reconcileFulfilmentOutcome(transactionId, repository);
  }

  if (tx.status !== "settled") {
    return {
      ok: false,
      code: "NOT_ELIGIBLE",
      message: "Transaction must be in settled status",
      transaction: tx,
    };
  }

  // Fiat-finality gate: an internal `settled` row is only spendable when
  // Paycrest itself confirmed fiat delivery. `fulfilled` / `fulfilling` /
  // `pending` are provider-internal progress (or a stale out-of-order event),
  // never proof that NGN reached the recipient, so they must not unlock a
  // purchase. This is checked before the float read, the reservation, and the
  // attempt claim, so a non-final row mutates nothing and calls no provider.
  const paycrestStatus = tx.paycrestStatus?.toLowerCase();
  if (paycrestStatus !== "validated" && paycrestStatus !== "settled") {
    return {
      ok: false,
      code: "NOT_ELIGIBLE",
      message:
        "Transaction must have confirmed Paycrest fiat delivery (validated or settled)",
      transaction: tx,
    };
  }

  // Authoritative purchase details: phone, network, and amount are read from
  // the transaction row, never from a request body.
  const phoneRaw = tx.metadata?.phone;
  const networkRaw = tx.metadata?.network;
  const phone =
    typeof phoneRaw === "string" ? normalizeAndValidatePhone(phoneRaw) : null;
  const network =
    typeof networkRaw === "string" && isClubKonnectNetwork(networkRaw)
      ? networkRaw
      : null;
  const amountNgn = parseAuthoritativeAmountNgn(tx.amountNgn);

  if (!phone || !network || amountNgn === null) {
    return {
      ok: false,
      code: "FULFILMENT_METADATA_INVALID",
      message:
        "Transaction is missing authoritative airtime phone, network, or amount",
      transaction: tx,
    };
  }

  const requestId = buildClubKonnectRequestId(tx.id);

  // Float pre-check, read-only and BEFORE the reservation is acquired: a
  // provider call is only attempted when the operating float can cover it. A
  // check that could not be read fails closed WITHOUT mutating the row, so it
  // stays `settled` with attempts still 0 and the next call retries the check
  // instead of being wedged in a query-only `processing` state. Only an
  // observed balance below the amount is exhaustion.
  let floatExhausted = false;
  if (options?.skipFloatCheck !== true) {
    const balance = await queryClubKonnectWalletBalance();

    if (!balance.ok) {
      return {
        ok: false,
        code: "FLOAT_CHECK_UNAVAILABLE",
        message: `ClubKonnect wallet float check unavailable: ${balance.message}`,
        transaction: tx,
      };
    }

    const balanceNgn = readObservedBalanceNgn(balance.data);

    if (balanceNgn === null) {
      return {
        ok: false,
        code: "FLOAT_CHECK_UNAVAILABLE",
        message: "ClubKonnect wallet balance could not be read",
        transaction: tx,
      };
    }

    floatExhausted = balanceNgn < amountNgn;
  }

  const reservation = await repository.acquireAirtimeFulfilmentReservation({
    transactionId,
    requestId,
  });

  if (!reservation.ok) {
    return {
      ok: false,
      code: RESERVATION_ERROR_CODE[reservation.error],
      message: reservation.message,
      transaction: tx,
    };
  }

  if (reservation.status === "already_processing") {
    return reconcileFulfilmentOutcome(transactionId, repository);
  }

  if (reservation.status === "already_completed") {
    return {
      ok: true,
      status: "completed",
      transaction: reservation.transaction,
    };
  }

  if (reservation.status === "already_failed_or_refunded") {
    return {
      ok: true,
      status: "failed",
      transaction: reservation.transaction,
    };
  }

  // Confirmed exhaustion: the reservation is already held (so no concurrent
  // caller can slip a purchase through) and the failure is terminal without
  // ever consuming the purchase attempt.
  if (floatExhausted) {
    const recorded = await repository.recordAirtimeFulfilmentPreflightFailure({
      transactionId,
      requestId,
      failureCode: "PROVIDER_FLOAT_EXHAUSTED",
      failureReason: "ClubKonnect wallet float insufficient",
    });

    return {
      ok: false,
      code: "PROVIDER_FLOAT_EXHAUSTED",
      message: "Provider float exhausted",
      transaction: recorded.ok ? recorded.transaction : reservation.transaction,
    };
  }

  // Attempt claim: the last gate before the irreversible provider call.
  const claim = await repository.claimAirtimeFulfilmentAttempt({
    transactionId,
    requestId,
  });

  if (!claim.ok) {
    const current = await repository.findById(transactionId);
    if (current && current.status !== "settled" && current.status !== "processing") {
      return {
        ok: true,
        status: fulfilmentOutcomeFromStatus(current.status),
        transaction: current,
      };
    }
    return {
      ok: false,
      code: "FULFILMENT_CLAIM_FAILED",
      message: claim.message,
      transaction: current ?? reservation.transaction,
    };
  }

  if (claim.status === "already_claimed") {
    return reconcileFulfilmentOutcome(transactionId, repository);
  }

  const purchase = await executeClubKonnectAirtimePurchase({
    transactionId,
    requestId,
    phone,
    amountNgn,
    network,
  });

  // RequestID binding guard: an answer only describes the order whose RequestID
  // it carries — and the response MUST echo it. A missing, empty, or foreign
  // RequestID is a provider-side data conflict, so its status is never applied
  // — not even a 200 — and the transaction stays in flight requiring
  // reconciliation.
  let outcome: FulfilmentOutcomeInput;
  if (purchase.ok && purchase.data.requestId !== requestId) {
    outcome = {
      transactionId,
      requestId,
      normalizedStatus: "unknown",
      statusCode: "REQUEST_ID_MISMATCH",
      rawStatus: "Provider response missing or mismatched RequestID",
      // The foreign order id is never bound to this transaction.
      orderId: null,
      reconciliationRequired: true,
      failureCode: "REQUEST_ID_MISMATCH",
      failureReason:
        "ClubKonnect response RequestID is missing or does not match the transaction request ID",
    };
  } else if (!purchase.ok) {
    // No readable answer: the purchase may still have reached the provider, so
    // the outcome is unknown and reconciliation is required.
    outcome = {
      transactionId,
      requestId,
      normalizedStatus: "unknown",
      statusCode: purchase.code,
      rawStatus: purchase.message,
      reconciliationRequired: true,
      failureCode: purchase.code,
      failureReason: purchase.message,
    };
  } else {
    // Exactly the provider's normalized status is applied: 100/300 stay in
    // flight without reconciliation, 201/unknown require it, and 200/417 are
    // terminal without it.
    outcome = {
      transactionId,
      requestId,
      normalizedStatus: purchase.data.status,
      statusCode: purchase.data.statusCode,
      rawStatus: purchase.data.rawStatusText,
      orderId: purchase.data.orderId ?? null,
      reconciliationRequired: purchase.data.status === "unknown",
      failureCode: purchase.data.failureCode ?? null,
      failureReason: purchase.data.failureReason ?? null,
    };
  }

  let recorded: FulfilmentMutationResult;
  try {
    recorded = await repository.recordAirtimeFulfilmentOutcome(outcome);
  } catch {
    // A repository that throws instead of reporting a failure lost the very
    // same answer: the purchase happened, so never rethrow past it.
    return persistenceFailedResult(
      transactionId,
      repository,
      reservation.transaction,
    );
  }

  if (!recorded.ok) {
    return persistenceFailedResult(
      transactionId,
      repository,
      reservation.transaction,
    );
  }

  return {
    ok: true,
    status: fulfilmentOutcomeFromStatus(recorded.transaction.status),
    transaction: recorded.transaction,
  };
}
