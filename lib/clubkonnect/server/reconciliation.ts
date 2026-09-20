/**
 * ClubKonnect airtime fulfilment reconciliation.
 *
 * Server-only. Reconciliation is strictly read-only against ClubKonnect: it
 * queries APIQueryV1 with the deterministic RequestID (plus the bound OrderID
 * when one exists) and folds the normalized answer back into the transaction.
 * It NEVER executes a purchase, so repeated reconciliation can never duplicate
 * an airtime order — that invariant is what makes retry-after-unknown safe.
 *
 * Import ONLY from server modules. Never import from client components.
 */

import "server-only";

import { queryClubKonnectTransaction } from "@/lib/clubkonnect/server/client";
import { buildClubKonnectRequestId } from "@/lib/clubkonnect/server/status";
import {
  getTransactionRepository,
  type TransactionRecord,
  type TransactionRepository,
} from "@/lib/transactions";

export interface AirtimeReconciliationOptions {
  /** Test/self-check seam; production omits it and uses the shared singleton. */
  repository?: TransactionRepository;
}

export type AirtimeReconciliationResult =
  | {
      ok: true;
      transaction: TransactionRecord;
      changed: boolean;
      reconciliationRequired: boolean;
      upstreamStatus?: string;
      message?: string;
    }
  | {
      ok: false;
      code: string;
      message: string;
      transaction?: TransactionRecord;
    };

/** The provider identifiers already bound to a transaction's metadata. */
export interface FulfilmentBinding {
  requestId: string | null;
  orderId: string | null;
}

/**
 * Reads the bound provider identifiers, treating any non-string or blank value
 * as absent. Metadata is untrusted at rest (jsonb written by earlier attempts),
 * so a malformed value must fail closed rather than coerce into a provider call.
 */
export function readFulfilmentBinding(tx: TransactionRecord): FulfilmentBinding {
  const metadata = tx.metadata;
  const requestId = metadata?.clubkonnect_request_id;
  const orderId = metadata?.clubkonnect_order_id;
  return {
    requestId:
      typeof requestId === "string" && requestId.trim() !== "" ? requestId : null,
    orderId:
      typeof orderId === "string" && orderId.trim() !== "" ? orderId : null,
  };
}

/**
 * Reconciles one in-flight airtime transaction against ClubKonnect.
 *
 * Only a stored RequestID that matches `buildClubKonnectRequestId(tx.id)` is
 * queried: a mismatch means the row belongs to a different provider attempt,
 * so it is reported instead of being reconciled against the wrong order.
 * Provider failures, conflicts, and unrecognized answers all leave the
 * transaction in `processing` with reconciliation still required, and never
 * invent a refund.
 */
export async function reconcileAirtimeFulfilment(
  transactionId: string,
  options?: AirtimeReconciliationOptions,
): Promise<AirtimeReconciliationResult> {
  const repository = options?.repository ?? getTransactionRepository();
  const tx = await repository.findById(transactionId);

  if (!tx) {
    return {
      ok: false,
      code: "TRANSACTION_NOT_FOUND",
      message: `Transaction ${transactionId} not found`,
    };
  }

  // Terminal outcomes are final: nothing is re-queried into a different state.
  if (
    tx.status === "completed" ||
    tx.status === "failed" ||
    tx.status === "refunded"
  ) {
    return {
      ok: true,
      transaction: tx,
      changed: false,
      reconciliationRequired: false,
    };
  }

  if (tx.type !== "airtime") {
    return {
      ok: false,
      code: "FULFILMENT_INVALID_TYPE",
      message: "Only airtime transactions are reconciled through ClubKonnect",
      transaction: tx,
    };
  }

  if (tx.status !== "processing") {
    return {
      ok: false,
      code: "FULFILMENT_NOT_ELIGIBLE",
      message: "Transaction must be in processing status to reconcile",
      transaction: tx,
    };
  }

  const requestId = buildClubKonnectRequestId(tx.id);
  const binding = readFulfilmentBinding(tx);

  if (binding.requestId !== requestId) {
    return {
      ok: false,
      code: "FULFILMENT_REQUEST_ID_MISMATCH",
      message:
        "Stored ClubKonnect request ID does not match the deterministic transaction request ID",
      transaction: tx,
    };
  }

  const query = await queryClubKonnectTransaction({
    requestId,
    orderId: binding.orderId ?? undefined,
  });

  // An unreadable answer says nothing about the order: keep processing, keep
  // reconciliation required, and record that the check happened.
  if (!query.ok) {
    const recorded = await repository.recordAirtimeFulfilmentOutcome({
      transactionId,
      requestId,
      normalizedStatus: "unknown",
      statusCode: query.code,
      rawStatus: query.message,
      orderId: binding.orderId,
      reconciliationRequired: true,
      failureCode: query.code,
      failureReason: query.message,
    });

    if (!recorded.ok) {
      return {
        ok: false,
        code: recorded.error,
        message: recorded.message,
        transaction: tx,
      };
    }

    return {
      ok: true,
      transaction: recorded.transaction,
      changed: true,
      reconciliationRequired: true,
      message: query.message,
    };
  }

  const normalized = query.data;
  const queriedOrderId = normalized.orderId ?? null;

  // A different order answering for our RequestID means the binding is wrong:
  // never overwrite the stored order with a foreign one. A missing (or empty)
  // RequestID is no better: an answer that does not bind itself to the
  // deterministic request we queried can never be applied to this transaction.
  const requestIdConflict = normalized.requestId !== requestId;
  const orderIdConflict =
    binding.orderId !== null &&
    queriedOrderId !== null &&
    queriedOrderId !== binding.orderId;

  if (requestIdConflict || orderIdConflict) {
    const recorded = await repository.recordAirtimeFulfilmentOutcome({
      transactionId,
      requestId,
      normalizedStatus: "unknown",
      statusCode: normalized.statusCode,
      rawStatus: normalized.rawStatusText,
      orderId: binding.orderId,
      reconciliationRequired: true,
      failureCode: requestIdConflict
        ? "FULFILMENT_REQUEST_ID_MISMATCH"
        : "FULFILMENT_ORDER_ID_CONFLICT",
      failureReason: requestIdConflict
        ? "Queried ClubKonnect response is missing or does not match the expected RequestID"
        : "Queried ClubKonnect order does not match the stored fulfilment binding",
    });

    if (!recorded.ok) {
      return {
        ok: false,
        code: recorded.error,
        message: recorded.message,
        transaction: tx,
      };
    }

    return {
      ok: true,
      transaction: recorded.transaction,
      changed: true,
      reconciliationRequired: true,
      upstreamStatus: normalized.statusCode,
      message: requestIdConflict
        ? "ClubKonnect response RequestID binding conflict; reconciliation required"
        : "ClubKonnect order binding conflict; reconciliation required",
    };
  }

  const recorded = await repository.recordAirtimeFulfilmentOutcome({
    transactionId,
    requestId,
    normalizedStatus: normalized.status,
    statusCode: normalized.statusCode,
    rawStatus: normalized.rawStatusText,
    orderId: queriedOrderId ?? binding.orderId,
    reconciliationRequired: normalized.status === "unknown",
    failureCode: normalized.failureCode ?? null,
    failureReason: normalized.failureReason ?? null,
  });

  if (!recorded.ok) {
    return {
      ok: false,
      code: recorded.error,
      message: recorded.message,
      transaction: tx,
    };
  }

  return {
    ok: true,
    transaction: recorded.transaction,
    changed: true,
    reconciliationRequired: normalized.status === "unknown",
    upstreamStatus: normalized.statusCode,
  };
}
