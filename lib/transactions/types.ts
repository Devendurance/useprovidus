import type { TransactionStatus, TransactionType } from "@/lib/db/schema";
import { sanitizeFailureReason } from "@/lib/transactions/sanitization";

export type { TransactionStatus, TransactionType };

export type FulfilmentStatus =
  | "processing"
  | "completed"
  | "failed"
  | "unknown";

/**
 * Provider fulfilment state persisted inside agent_transactions.metadata.
 *
 * The repository treats this as a fail-closed state machine: the request ID
 * is bound before the provider call, attempts are 0 before the call and 1
 * immediately before it, and order IDs are write-once.
 */
export interface FulfilmentMetadata {
  clubkonnect_request_id: string;
  clubkonnect_order_id: string | null;
  clubkonnect_status_code: string | null;
  clubkonnect_raw_status: string | null;
  fulfilment_attempts: number;
  fulfilment_reserved_at: string | null;
  fulfilled_at: string | null;
  fulfilment_status: FulfilmentStatus;
  fulfilment_reconciliation_required: boolean;
  fulfilment_last_error_code: string | null;
  fulfilment_last_error_reason: string | null;
  fulfilment_last_checked_at: string | null;
}

export interface TransactionMetadata {
  institution?: string;
  institutionName?: string;
  accountIdentifierMasked?: string;
  accountName?: string;
  rate?: string | null;
  senderFee?: string;
  transactionFee?: string;
  totalUsdcToSend?: string;
  refundAddress?: string;
  clubkonnect_request_id?: FulfilmentMetadata["clubkonnect_request_id"];
  clubkonnect_order_id?: FulfilmentMetadata["clubkonnect_order_id"];
  clubkonnect_status_code?: FulfilmentMetadata["clubkonnect_status_code"];
  clubkonnect_raw_status?: FulfilmentMetadata["clubkonnect_raw_status"];
  fulfilment_attempts?: FulfilmentMetadata["fulfilment_attempts"];
  fulfilment_reserved_at?: FulfilmentMetadata["fulfilment_reserved_at"];
  fulfilled_at?: FulfilmentMetadata["fulfilled_at"];
  fulfilment_status?: FulfilmentMetadata["fulfilment_status"];
  fulfilment_reconciliation_required?: FulfilmentMetadata["fulfilment_reconciliation_required"];
  fulfilment_last_error_code?: FulfilmentMetadata["fulfilment_last_error_code"];
  fulfilment_last_error_reason?: FulfilmentMetadata["fulfilment_last_error_reason"];
  fulfilment_last_checked_at?: FulfilmentMetadata["fulfilment_last_checked_at"];
  [key: string]: unknown;
}

export interface TransactionRecord {
  id: string;
  idempotencyKey: string;
  type: TransactionType;
  status: TransactionStatus;
  walletAddress: string;
  amountUsdc: string;
  amountNgn: string | null;
  celoTxHash: string | null;
  paycrestOrderId: string | null;
  paycrestReference: string;
  paycrestStatus: string | null;
  receiveAddress: string | null;
  validUntil: string | null;
  failureCode: string | null;
  failureReason: string | null;
  metadata?: TransactionMetadata | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTransactionInput {
  id?: string;
  idempotencyKey: string;
  type?: TransactionType;
  walletAddress: string;
  amountUsdc: string;
  amountNgn?: string | null;
  paycrestOrderId?: string | null;
  paycrestReference: string;
  paycrestStatus?: string | null;
  receiveAddress?: string | null;
  validUntil?: string | null;
  metadata?: TransactionMetadata;
}

export interface BindPaycrestOrderInput {
  id: string;
  paycrestOrderId: string;
  paycrestReference?: string;
  receiveAddress: string;
  validUntil?: string | null;
  paycrestStatus?: string | null;
  metadata?: TransactionMetadata;
}

export interface UpdateTransactionStatusInput {
  status: TransactionStatus;
  paycrestStatus?: string | null;
  celoTxHash?: string | null;
  failureCode?: string | null;
  failureReason?: string | null;
}

/**
 * Error vocabulary for fulfilment repository operations. Deliberately limited
 * to the codes every consumer maps to an orchestration error, so a Record over
 * this union stays exhaustive.
 */
export type FulfilmentReservationError =
  | "TRANSACTION_NOT_FOUND"
  | "FULFILMENT_INVALID_TYPE"
  | "FULFILMENT_NOT_ELIGIBLE"
  | "FULFILMENT_REQUEST_ID_MISMATCH"
  | "FULFILMENT_METADATA_INVALID"
  | "DATABASE_UNAVAILABLE";

/**
 * Error vocabulary for fulfilment repository operations. The reservation union
 * is limited to the six codes every consumer maps to an orchestration error, so
 * a Record over it stays exhaustive; operation-only codes are added here for the
 * conditions that reservation can never report.
 */
export type FulfilmentOperationError =
  | FulfilmentReservationError
  | "FULFILMENT_REQUEST_ID_MISSING"
  | "FULFILMENT_ORDER_ID_CONFLICT";

/**
 * Grouped reservation discriminator required by the P6 assignment contract:
 * 'failed' and 'refunded' both collapse into 'already_failed_or_refunded'
 * because neither may ever be re-reserved or re-purchased.
 */
export type FulfilmentReservationStatus =
  | "acquired"
  | "already_processing"
  | "already_completed"
  | "already_failed_or_refunded";

/**
 * Precise terminal state exposed alongside `status` for orchestration callers
 * that must distinguish a definite provider failure from a user refund.
 */
export type FulfilmentReservationState =
  | "acquired"
  | "already_processing"
  | "already_completed"
  | "already_failed"
  | "already_refunded";

export type FulfilmentReservationResult =
  | {
      ok: true;
      status: "acquired";
      state: "acquired";
      transaction: TransactionRecord;
      record: TransactionRecord;
      requestId: string;
    }
  | {
      ok: true;
      status: Exclude<FulfilmentReservationStatus, "acquired">;
      state: Exclude<FulfilmentReservationState, "acquired">;
      transaction: TransactionRecord;
      record: TransactionRecord;
      requestId?: string;
    }
  | {
      ok: false;
      error: FulfilmentReservationError;
      code: FulfilmentReservationError;
      message: string;
      record?: TransactionRecord;
    };

export type FulfilmentAttemptStatus = "claimed" | "already_claimed";

export type FulfilmentAttemptResult =
  | {
      ok: true;
      status: FulfilmentAttemptStatus;
      state: FulfilmentAttemptStatus;
      transaction: TransactionRecord;
      record: TransactionRecord;
    }
  | {
      ok: false;
      error: FulfilmentOperationError;
      code: FulfilmentOperationError;
      message: string;
      record?: TransactionRecord;
    };

export type FulfilmentMutationResult =
  | {
      ok: true;
      changed: boolean;
      transaction: TransactionRecord;
      record: TransactionRecord;
    }
  | {
      ok: false;
      error: FulfilmentOperationError;
      code: FulfilmentOperationError;
      message: string;
      record?: TransactionRecord;
    };

export interface FulfilmentReservationInput {
  transactionId: string;
  requestId: string;
}

export interface FulfilmentAttemptInput {
  transactionId: string;
  requestId: string;
}

export interface FulfilmentOutcomeInput {
  transactionId: string;
  requestId: string;
  normalizedStatus: FulfilmentStatus;
  statusCode: string;
  rawStatus: string;
  orderId?: string | null;
  reconciliationRequired: boolean;
  failureCode?: string | null;
  failureReason?: string | null;
}

export interface FulfilmentPreflightFailureInput {
  transactionId: string;
  requestId: string;
  failureCode: string;
  failureReason: string;
}

export interface PublicFulfilmentDto {
  provider: "clubkonnect";
  requestId: string;
  orderId: string | null;
  statusCode: string | null;
  rawStatus: string | null;
  normalizedStatus: FulfilmentStatus;
  attempts: number;
  reservedAt: string | null;
  fulfilledAt: string | null;
  reconciliationRequired: boolean;
}

/**
 * Public DTO returned to client. Contains no secrets, internal stack traces,
 * or full bank account numbers.
 */
export interface PublicTransactionDto {
  id: string;
  idempotencyKey: string;
  type: TransactionType;
  status: TransactionStatus;
  walletAddress: string;
  amountUsdc: string;
  amountNgn: string | null;
  celoTxHash: string | null;
  paycrestOrderId: string | null;
  paycrestReference: string;
  paycrestStatus: string | null;
  receiveAddress: string | null;
  validUntil: string | null;
  failureCode: string | null;
  failureReason: string | null;
  metadata?: {
    institutionName?: string;
    accountIdentifierMasked?: string;
    rate?: string | null;
    totalUsdcToSend?: string;
  };
  fulfilment: PublicFulfilmentDto | null;
  createdAt: string;
  updatedAt: string;
}

export function isFulfilmentStatus(value: unknown): value is FulfilmentStatus {
  return (
    value === "processing" ||
    value === "completed" ||
    value === "failed" ||
    value === "unknown"
  );
}

/**
 * Provider status codes are short tokens ("200", "300", "REQUEST_ID_MISMATCH").
 * Anything longer that reaches the public DTO is untrusted text, not a code.
 */
const MAX_PUBLIC_STATUS_CODE_LENGTH = 32;

function toPublicFulfilmentDto(
  tx: TransactionRecord,
): PublicFulfilmentDto | null {
  if (tx.type === "cash_out") return null;

  const metadata = tx.metadata;
  const requestId = metadata?.clubkonnect_request_id;
  if (typeof requestId !== "string" || requestId.trim() === "") {
    return null;
  }

  const attempts =
    typeof metadata?.fulfilment_attempts === "number" &&
    Number.isInteger(metadata.fulfilment_attempts) &&
    metadata.fulfilment_attempts >= 0
      ? metadata.fulfilment_attempts
      : 0;

  const status = isFulfilmentStatus(metadata?.fulfilment_status)
    ? metadata.fulfilment_status
    : "processing";

  return {
    provider: "clubkonnect",
    requestId,
    orderId:
      typeof metadata?.clubkonnect_order_id === "string"
        ? metadata.clubkonnect_order_id
        : null,
    // Defense-in-depth: provider text is sanitized when it is written, but a row
    // produced by an older path must never leak credentials, stack traces, or
    // unbounded text through the public DTO. Provider codes are short by
    // contract, so whatever survives sanitization is bounded hard.
    statusCode:
      sanitizeFailureReason(
        typeof metadata?.clubkonnect_status_code === "string"
          ? metadata.clubkonnect_status_code
          : "",
      )?.slice(0, MAX_PUBLIC_STATUS_CODE_LENGTH) ?? null,
    rawStatus:
      typeof metadata?.clubkonnect_raw_status === "string"
        ? sanitizeFailureReason(metadata.clubkonnect_raw_status)
        : null,
    normalizedStatus: status,
    attempts,
    reservedAt:
      typeof metadata?.fulfilment_reserved_at === "string"
        ? metadata.fulfilment_reserved_at
        : null,
    fulfilledAt:
      typeof metadata?.fulfilled_at === "string"
        ? metadata.fulfilled_at
        : null,
    reconciliationRequired:
      metadata?.fulfilment_reconciliation_required === true,
  };
}

export function toPublicTransactionDto(
  tx: TransactionRecord,
): PublicTransactionDto {
  return {
    id: tx.id,
    idempotencyKey: tx.idempotencyKey,
    type: tx.type,
    status: tx.status,
    walletAddress: tx.walletAddress,
    amountUsdc: tx.amountUsdc,
    amountNgn: tx.amountNgn,
    celoTxHash: tx.celoTxHash,
    paycrestOrderId: tx.paycrestOrderId,
    paycrestReference: tx.paycrestReference,
    paycrestStatus: tx.paycrestStatus,
    receiveAddress: tx.receiveAddress,
    validUntil: tx.validUntil,
    failureCode: tx.failureCode,
    // Defense-in-depth: expiry and provider text is sanitized when written, but
    // a row produced by an older path must never leak credentials or unbounded
    // provider text through the public DTO.
    failureReason: sanitizeFailureReason(tx.failureReason),
    metadata: tx.metadata
      ? {
          institutionName: tx.metadata.institutionName,
          accountIdentifierMasked: tx.metadata.accountIdentifierMasked,
          rate: tx.metadata.rate,
          totalUsdcToSend: tx.metadata.totalUsdcToSend,
        }
      : undefined,
    fulfilment: toPublicFulfilmentDto(tx),
    createdAt: tx.createdAt,
    updatedAt: tx.updatedAt,
  };
}
