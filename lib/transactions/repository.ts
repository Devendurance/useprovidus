import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { agentTransactions } from "@/lib/db/schema";
import { sanitizeFailureReason } from "@/lib/transactions/sanitization";
import {
  ALLOWED_TRANSITIONS_BY_TYPE,
  isTerminalStatus,
  validateStatusTransition,
} from "@/lib/transactions/transitions";
import type {
  BindPaycrestOrderInput,
  CreateTransactionInput,
  FulfilmentAttemptInput,
  FulfilmentAttemptResult,
  FulfilmentMutationResult,
  FulfilmentOperationError,
  FulfilmentOutcomeInput,
  FulfilmentPreflightFailureInput,
  FulfilmentReservationError,
  FulfilmentReservationInput,
  FulfilmentReservationResult,
  FulfilmentReservationState,
  FulfilmentReservationStatus,
  FulfilmentStatus,
  TransactionMetadata,
  TransactionRecord,
  TransactionStatus,
  UpdateTransactionStatusInput,
} from "@/lib/transactions/types";
import { isFiatDeliveryFinal, isFulfilmentStatus } from "@/lib/transactions/types";

export interface TransactionRepository {
  create(
    input: CreateTransactionInput,
  ): Promise<
    | { ok: true; record: TransactionRecord; reused: boolean }
    | { ok: false; code: string; message: string }
  >;
  findById(id: string): Promise<TransactionRecord | null>;
  findByIdempotencyKey(key: string): Promise<TransactionRecord | null>;
  findByPaycrestReference(reference: string): Promise<TransactionRecord | null>;
  findByPaycrestOrderId(orderId: string): Promise<TransactionRecord | null>;
  bindPaycrestOrder(
    input: BindPaycrestOrderInput,
  ): Promise<
    | { ok: true; record: TransactionRecord }
    | { ok: false; code: string; message: string }
  >;
  bindCeloTxHash(input: {
    id: string;
    celoTxHash: string;
  }): Promise<
    | { ok: true; record: TransactionRecord }
    | { ok: false; code: string; message: string }
  >;
  updateStatus(
    id: string,
    update: UpdateTransactionStatusInput,
  ): Promise<
    | { ok: true; record: TransactionRecord; isNoop: boolean }
    | { ok: false; code: string; message: string }
  >;
  /**
   * Atomically reserves the single purchase right for an airtime fulfilment.
   *
   * 'acquired' is the only outcome that authorizes a provider purchase;
   * 'already_processing' is query-only; terminal rows are successful no-ops.
   */
  acquireAirtimeFulfilmentReservation(
    input: FulfilmentReservationInput,
  ): Promise<FulfilmentReservationResult>;
  /**
   * Atomically consumes the one-shot purchase attempt (0 -> 1) for an already
   * reserved transaction. Exactly one caller can ever be 'claimed'.
   */
  claimAirtimeFulfilmentAttempt(
    input: FulfilmentAttemptInput,
  ): Promise<FulfilmentAttemptResult>;
  /**
   * Persists a provider outcome. Completed/failed rows are never downgraded and
   * a provider order id is write-once.
   */
  recordAirtimeFulfilmentOutcome(
    input: FulfilmentOutcomeInput,
  ): Promise<FulfilmentMutationResult>;
  /**
   * Marks a pre-purchase (no provider call) failure as terminal without
   * consuming the purchase attempt.
   */
  recordAirtimeFulfilmentPreflightFailure(
    input: FulfilmentPreflightFailureInput,
  ): Promise<FulfilmentMutationResult>;
}

function generateTransactionId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `tx_${crypto.randomUUID()}`;
  }
  return `tx_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isAuthoritativeFiatStatus(status?: string | null): boolean {
  const normalized = status?.toLowerCase().trim();
  return normalized === "validated" || normalized === "settled";
}

function mergeFiatDeliveryMetadata(
  current: TransactionRecord,
  incomingPaycrestStatus?: string | null,
): TransactionMetadata | null | undefined {
  const metadata = current.metadata;
  if (
    metadata?.paycrest_fiat_delivery_confirmed === true ||
    isAuthoritativeFiatStatus(incomingPaycrestStatus) ||
    isFiatDeliveryFinal(current)
  ) {
    return {
      ...(metadata ?? {}),
      paycrest_fiat_delivery_confirmed: true,
    };
  }
  return metadata;
}
function sanitizeIncomingMetadata(
  metadata: TransactionMetadata | null | undefined,
  allowFiatFinal: boolean,
): TransactionMetadata | null | undefined {
  if (!metadata) return metadata;
  const sanitized = { ...metadata };
  if (allowFiatFinal) {
    sanitized.paycrest_fiat_delivery_confirmed = true;
  } else {
    delete sanitized.paycrest_fiat_delivery_confirmed;
  }
  return sanitized;
}
const PAYCREST_HAPPY_PATH_RANK: Record<string, number> = {
  initiated: 1,
  deposited: 2,
  pending: 3,
  fulfilling: 4,
  fulfilled: 5,
  validated: 6, // fiat delivery confirmed
  settling: 7, // escrow settlement broadcast
  settled: 8, // protocol fully complete
};

export function shouldAdvancePaycrestStatus(
  currentStatus: string | null | undefined,
  incomingStatus: string | null | undefined,
): boolean {
  if (!incomingStatus) return false;
  if (!currentStatus) return true;
  const curr = currentStatus.toLowerCase().trim();
  const inc = incomingStatus.toLowerCase().trim();
  if (curr === inc) return false;

  // Terminal states: settled, refunded, cancelled, expired can never transition
  if (
    curr === "settled" ||
    curr === "refunded" ||
    curr === "cancelled" ||
    curr === "expired"
  ) {
    return false;
  }

  // Once fiat delivery is confirmed (validated / settling), reject stale pre-fiat or refund statuses
  if (curr === "validated" || curr === "settling") {
    if (inc === "settling" && curr === "validated") return true;
    if (inc === "settled") return true;
    return false;
  }

  // Once in refunding, only refunded can advance it; cannot be revived to happy path (validated, settled, etc.)
  if (curr === "refunding") {
    return inc === "refunded";
  }
  // Refund branch from pre-fiat fulfillment failure:
  // deposited / pending / fulfilling / fulfilled -> refunding -> refunded
  if (inc === "refunding") {
    return (
      curr === "initiated" ||
      curr === "deposited" ||
      curr === "pending" ||
      curr === "fulfilling" ||
      curr === "fulfilled"
    );
  }

  if (inc === "refunded") {
    return (
      curr === "initiated" ||
      curr === "deposited" ||
      curr === "pending" ||
      curr === "fulfilling" ||
      curr === "fulfilled" ||
      curr === "refunding"
    );
  }

  // Cancellation or expiration before deposit
  if (inc === "cancelled" || inc === "expired") {
    return curr === "initiated" || curr === "deposited" || curr === "pending";
  }

  // Happy path forward progression: strictly advancing rank
  const currentRank = PAYCREST_HAPPY_PATH_RANK[curr] ?? 0;
  const incomingRank = PAYCREST_HAPPY_PATH_RANK[inc] ?? 0;
  return incomingRank > currentRank;
}

/* -------------------------------------------------------------------------- */
/* Airtime fulfilment (ClubKonnect) contract                                   */
/* -------------------------------------------------------------------------- */

/** Attempts are one-shot: absent/0 means "not purchased yet", 1 means "spent". */
const FULFILMENT_ATTEMPT_LIMIT = 1;

const FULFILMENT_STATUS_CODE_MAX_LENGTH = 64;

const FULFILMENT_STRING_FIELDS = [
  "clubkonnect_order_id",
  "clubkonnect_status_code",
  "clubkonnect_raw_status",
  "fulfilment_last_error_code",
  "fulfilment_last_error_reason",
] as const;

const FULFILMENT_TIMESTAMP_FIELDS = [
  "fulfilment_reserved_at",
  "fulfilled_at",
  "fulfilment_last_checked_at",
] as const;

/**
 * Validated view of the fulfilment fields inside `agent_transactions.metadata`.
 * A malformed value fails the whole read closed instead of being guessed at.
 */
interface FulfilmentSnapshot {
  requestId: string | null;
  orderId: string | null;
  statusCode: string | null;
  rawStatus: string | null;
  attempts: number;
  reservedAt: string | null;
  fulfilledAt: string | null;
  status: FulfilmentStatus | null;
  reconciliationRequired: boolean;
  lastErrorCode: string | null;
  lastErrorReason: string | null;
  lastCheckedAt: string | null;
}

function readFulfilmentSnapshot(
  metadata: TransactionMetadata | null | undefined,
): { ok: true; snapshot: FulfilmentSnapshot } | { ok: false; message: string } {
  const source: Record<string, unknown> = metadata ?? {};

  for (const field of FULFILMENT_STRING_FIELDS) {
    const value = source[field];
    if (value !== undefined && value !== null && typeof value !== "string") {
      return {
        ok: false,
        message: `Fulfilment metadata field '${field}' must be a string or null`,
      };
    }
  }

  const requestId = source.clubkonnect_request_id;
  if (
    requestId !== undefined &&
    requestId !== null &&
    (typeof requestId !== "string" || requestId.trim() === "")
  ) {
    return {
      ok: false,
      message:
        "Fulfilment metadata field 'clubkonnect_request_id' must be a non-empty string",
    };
  }

  for (const field of FULFILMENT_TIMESTAMP_FIELDS) {
    const value = source[field];
    if (
      value !== undefined &&
      value !== null &&
      (typeof value !== "string" || Number.isNaN(Date.parse(value)))
    ) {
      return {
        ok: false,
        message: `Fulfilment metadata field '${field}' must be an ISO timestamp string or null`,
      };
    }
  }

  const attempts = source.fulfilment_attempts;
  if (
    attempts !== undefined &&
    attempts !== null &&
    (typeof attempts !== "number" ||
      !Number.isInteger(attempts) ||
      attempts < 0 ||
      attempts > FULFILMENT_ATTEMPT_LIMIT)
  ) {
    return {
      ok: false,
      message: `Fulfilment metadata field 'fulfilment_attempts' must be 0 or ${FULFILMENT_ATTEMPT_LIMIT}`,
    };
  }

  const reconciliationRequired = source.fulfilment_reconciliation_required;
  if (
    reconciliationRequired !== undefined &&
    reconciliationRequired !== null &&
    typeof reconciliationRequired !== "boolean"
  ) {
    return {
      ok: false,
      message:
        "Fulfilment metadata field 'fulfilment_reconciliation_required' must be a boolean",
    };
  }

  const status = source.fulfilment_status;
  if (status !== undefined && status !== null && !isFulfilmentStatus(status)) {
    return {
      ok: false,
      message:
        "Fulfilment metadata field 'fulfilment_status' is not a recognised status",
    };
  }

  return {
    ok: true,
    snapshot: {
      requestId: typeof requestId === "string" ? requestId : null,
      orderId:
        typeof source.clubkonnect_order_id === "string"
          ? source.clubkonnect_order_id
          : null,
      statusCode:
        typeof source.clubkonnect_status_code === "string"
          ? source.clubkonnect_status_code
          : null,
      rawStatus:
        typeof source.clubkonnect_raw_status === "string"
          ? source.clubkonnect_raw_status
          : null,
      attempts: typeof attempts === "number" ? attempts : 0,
      reservedAt:
        typeof source.fulfilment_reserved_at === "string"
          ? source.fulfilment_reserved_at
          : null,
      fulfilledAt:
        typeof source.fulfilled_at === "string" ? source.fulfilled_at : null,
      status: isFulfilmentStatus(status) ? status : null,
      reconciliationRequired: reconciliationRequired === true,
      lastErrorCode:
        typeof source.fulfilment_last_error_code === "string"
          ? source.fulfilment_last_error_code
          : null,
      lastErrorReason:
        typeof source.fulfilment_last_error_reason === "string"
          ? source.fulfilment_last_error_reason
          : null,
      lastCheckedAt:
        typeof source.fulfilment_last_checked_at === "string"
          ? source.fulfilment_last_checked_at
          : null,
    },
  };
}

/**
 * Failure result shared by every fulfilment operation. Carries both the
 * assignment's `error`/`message` contract and the orchestrator's `code` alias.
 */
function fulfilmentFailure<TError extends string>(
  error: TError,
  message: string,
  record?: TransactionRecord,
): { ok: false; error: TError; code: TError; message: string; record?: TransactionRecord } {
  return { ok: false, error, code: error, message, record };
}

function reservationAcquired(
  record: TransactionRecord,
  requestId: string,
): FulfilmentReservationResult {
  return {
    ok: true,
    status: "acquired",
    state: "acquired",
    transaction: record,
    record,
    requestId,
  };
}

function reservationHeld(
  status: Exclude<FulfilmentReservationStatus, "acquired">,
  state: Exclude<FulfilmentReservationState, "acquired">,
  record: TransactionRecord,
): FulfilmentReservationResult {
  return { ok: true, status, state, transaction: record, record };
}

function attemptSettled(
  status: "claimed" | "already_claimed",
  record: TransactionRecord,
): FulfilmentAttemptResult {
  return { ok: true, status, state: status, transaction: record, record };
}

function mutationSettled(
  changed: boolean,
  record: TransactionRecord,
): FulfilmentMutationResult {
  return { ok: true, changed, transaction: record, record };
}

type FulfilmentApplyPlan = {
  kind: "apply";
  nextStatus: TransactionStatus;
  /** Only fulfilment-owned keys, so the write never clobbers unrelated metadata. */
  patch: TransactionMetadata;
  /** Fully merged metadata for the in-memory implementation. */
  metadata: TransactionMetadata;
  failureCode?: string | null;
  failureReason?: string | null;
  changed: boolean;
};

type FulfilmentMutationPlan =
  | { kind: "noop"; record: TransactionRecord }
  | FulfilmentApplyPlan
  | { kind: "error"; error: FulfilmentOperationError; message: string };

type FulfilmentClaimPlan =
  | { kind: "claim" }
  | { kind: "held"; status: "already_claimed" }
  | { kind: "error"; error: FulfilmentOperationError; message: string };

type FulfilmentReservationPlan =
  | { kind: "acquire" }
  | {
      kind: "held";
      status: Exclude<FulfilmentReservationStatus, "acquired">;
      state: Exclude<FulfilmentReservationState, "acquired">;
    }
  | { kind: "error"; error: FulfilmentReservationError; message: string };

const FULFILMENT_TERMINAL_STATUSES: TransactionStatus[] = [
  "completed",
  "failed",
  "refunded",
];

/**
 * Decides what a reservation request means for the loaded row. Pure: every
 * caller (in-memory, Drizzle) then applies the same decision atomically.
 */
function decideFulfilmentReservation(
  record: TransactionRecord,
  requestId: string,
): FulfilmentReservationPlan {
  if (record.type !== "airtime") {
    return {
      kind: "error",
      error: "FULFILMENT_INVALID_TYPE",
      message: `Transaction ${record.id} is type '${record.type}'; only airtime supports fulfilment`,
    };
  }

  const read = readFulfilmentSnapshot(record.metadata);
  if (!read.ok) {
    return {
      kind: "error",
      error: "FULFILMENT_METADATA_INVALID",
      message: read.message,
    };
  }
  const { snapshot } = read;

  if (record.status === "processing" || FULFILMENT_TERMINAL_STATUSES.includes(record.status)) {
    if (snapshot.requestId !== null && snapshot.requestId !== requestId) {
      return {
        kind: "error",
        error: "FULFILMENT_REQUEST_ID_MISMATCH",
        message: `Request id does not match the request id bound to transaction ${record.id}`,
      };
    }
    // An in-flight row must carry the request id it was reserved with; a
    // terminal row that never reached the provider has nothing to bind.
    if (record.status === "processing" && snapshot.requestId === null) {
      return {
        kind: "error",
        error: "FULFILMENT_METADATA_INVALID",
        message: `Transaction ${record.id} is 'processing' without a bound fulfilment request id`,
      };
    }
    if (record.status === "processing") {
      return { kind: "held", status: "already_processing", state: "already_processing" };
    }
    if (record.status === "completed") {
      return { kind: "held", status: "already_completed", state: "already_completed" };
    }
    return record.status === "failed"
      ? { kind: "held", status: "already_failed_or_refunded", state: "already_failed" }
      : { kind: "held", status: "already_failed_or_refunded", state: "already_refunded" };
  }

  if (record.status !== "settled") {
    return {
      kind: "error",
      error: "FULFILMENT_NOT_ELIGIBLE",
      message: `Transaction ${record.id} is '${record.status}'; fulfilment requires 'settled'`,
    };
  }

  if (snapshot.requestId !== null && snapshot.requestId !== requestId) {
    return {
      kind: "error",
      error: "FULFILMENT_REQUEST_ID_MISMATCH",
      message: `Request id does not match the request id bound to transaction ${record.id}`,
    };
  }

  if (snapshot.orderId !== null) {
    return {
      kind: "error",
      error: "FULFILMENT_NOT_ELIGIBLE",
      message: `Transaction ${record.id} already carries provider order id '${snapshot.orderId}'`,
    };
  }

  // A spent attempt means a purchase already reached the provider: resetting
  // the counter here would hand out a second purchase right.
  if (snapshot.attempts >= FULFILMENT_ATTEMPT_LIMIT) {
    return {
      kind: "error",
      error: "FULFILMENT_METADATA_INVALID",
      message: `Transaction ${record.id} already spent its purchase attempt; refusing to reserve a second one`,
    };
  }

  return { kind: "acquire" };
}

/** The reservation metadata written on the single successful 'acquired' path. */
function buildFulfilmentReservationPatch(requestId: string): TransactionMetadata {
  return {
    clubkonnect_request_id: requestId,
    clubkonnect_order_id: null,
    clubkonnect_status_code: null,
    clubkonnect_raw_status: null,
    fulfilment_attempts: 0,
    fulfilment_reserved_at: nowIso(),
    fulfilled_at: null,
    fulfilment_status: "processing",
    fulfilment_reconciliation_required: false,
    fulfilment_last_error_code: null,
    fulfilment_last_error_reason: null,
    fulfilment_last_checked_at: null,
  };
}

function decideFulfilmentClaim(
  record: TransactionRecord,
  requestId: string,
): FulfilmentClaimPlan {
  if (record.type !== "airtime") {
    return {
      kind: "error",
      error: "FULFILMENT_INVALID_TYPE",
      message: `Transaction ${record.id} is type '${record.type}'; only airtime supports fulfilment`,
    };
  }

  const read = readFulfilmentSnapshot(record.metadata);
  if (!read.ok) {
    return {
      kind: "error",
      error: "FULFILMENT_METADATA_INVALID",
      message: read.message,
    };
  }
  const { snapshot } = read;

  if (record.status !== "processing") {
    return {
      kind: "error",
      error: "FULFILMENT_NOT_ELIGIBLE",
      message: `Attempt claim requires 'processing'; transaction ${record.id} is '${record.status}'`,
    };
  }

  if (snapshot.requestId === null) {
    return {
      kind: "error",
      error: "FULFILMENT_REQUEST_ID_MISSING",
      message: `Transaction ${record.id} is 'processing' without a bound fulfilment request id`,
    };
  }

  if (snapshot.requestId !== requestId) {
    return {
      kind: "error",
      error: "FULFILMENT_REQUEST_ID_MISMATCH",
      message: `Request id does not match the request id bound to transaction ${record.id}`,
    };
  }

  if (snapshot.attempts >= FULFILMENT_ATTEMPT_LIMIT) {
    return { kind: "held", status: "already_claimed" };
  }

  return { kind: "claim" };
}

/**
 * Decides how a provider outcome mutates the row. Terminal rows are protected:
 * a completed/failed/refunded row is never downgraded or rolled back, and a
 * provider order id is write-once.
 */
function decideFulfilmentOutcome(
  record: TransactionRecord,
  input: FulfilmentOutcomeInput,
): FulfilmentMutationPlan {
  if (record.type !== "airtime") {
    return {
      kind: "error",
      error: "FULFILMENT_INVALID_TYPE",
      message: `Transaction ${record.id} is type '${record.type}'; only airtime supports fulfilment`,
    };
  }

  const read = readFulfilmentSnapshot(record.metadata);
  if (!read.ok) {
    return {
      kind: "error",
      error: "FULFILMENT_METADATA_INVALID",
      message: read.message,
    };
  }
  const { snapshot } = read;

  const incomingOrderId = input.orderId ?? null;
  if (
    snapshot.orderId !== null &&
    incomingOrderId !== null &&
    snapshot.orderId !== incomingOrderId
  ) {
    return {
      kind: "error",
      error: "FULFILMENT_ORDER_ID_CONFLICT",
      message: `Provider order id '${incomingOrderId}' conflicts with persisted order id '${snapshot.orderId}'`,
    };
  }

  if (record.status !== "processing" && !FULFILMENT_TERMINAL_STATUSES.includes(record.status)) {
    return {
      kind: "error",
      error: "FULFILMENT_NOT_ELIGIBLE",
      message: `Transaction ${record.id} is '${record.status}'; fulfilment outcomes require 'processing'`,
    };
  }

  if (snapshot.requestId !== null && snapshot.requestId !== input.requestId) {
    return {
      kind: "error",
      error: "FULFILMENT_REQUEST_ID_MISMATCH",
      message: `Request id does not match the request id bound to transaction ${record.id}`,
    };
  }

  // Terminal protection: never downgrade or roll back a settled outcome.
  if (record.status !== "processing") {
    return { kind: "noop", record };
  }

  if (snapshot.requestId === null) {
    return {
      kind: "error",
      error: "FULFILMENT_REQUEST_ID_MISSING",
      message: `Transaction ${record.id} is 'processing' without a bound fulfilment request id`,
    };
  }

  const now = nowIso();
  const status = input.normalizedStatus;
  const statusCode = input.statusCode
    .trim()
    .slice(0, FULFILMENT_STATUS_CODE_MAX_LENGTH);

  // Hard completion gate: only the numeric statuscode 200 may complete. A
  // completion claim without it is contradictory input and is never persisted
  // (provider status TEXT such as "ORDER_COMPLETED" also accompanies 201).
  if (status === "completed" && statusCode !== "200") {
    return {
      kind: "error",
      error: "FULFILMENT_METADATA_INVALID",
      message: `Only provider statuscode 200 completes a fulfilment; received '${statusCode}'`,
    };
  }

  const nextStatus: TransactionStatus =
    status === "completed"
      ? "completed"
      : status === "failed"
        ? "failed"
        : "processing";

  // Reconciliation is derived, never trusted from the caller: an unknown
  // outcome always needs it, and no terminal outcome ever does.
  const reconciliationRequired =
    status === "processing"
      ? input.reconciliationRequired === true
      : status === "unknown";

  const failureReason = sanitizeFailureReason(input.failureReason);
  const lastErrorCode =
    status === "completed" || status === "processing"
      ? null
      : status === "failed"
        ? (input.failureCode ?? null)
        : (input.failureCode ?? snapshot.lastErrorCode);
  const lastErrorReason =
    status === "completed" || status === "processing"
      ? null
      : status === "failed"
        ? failureReason
        : (failureReason ?? snapshot.lastErrorReason);

  const patch: TransactionMetadata = {
    clubkonnect_order_id: incomingOrderId ?? snapshot.orderId,
    clubkonnect_status_code: statusCode,
    clubkonnect_raw_status: sanitizeFailureReason(input.rawStatus),
    fulfilment_status: status,
    fulfilment_reconciliation_required: reconciliationRequired,
    fulfilment_last_error_code: lastErrorCode,
    fulfilment_last_error_reason: lastErrorReason,
    fulfilment_last_checked_at: now,
    // Write-once: a duplicate 200 keeps the original completion timestamp.
    fulfilled_at:
      status === "completed" ? (snapshot.fulfilledAt ?? now) : snapshot.fulfilledAt,
  };

  return {
    kind: "apply",
    nextStatus,
    patch,
    metadata: { ...(record.metadata ?? {}), ...patch },
    failureCode: status === "failed" ? (input.failureCode ?? null) : undefined,
    failureReason: status === "failed" ? failureReason : undefined,
    changed: true,
  };
}

/**
 * Decides a definite pre-purchase failure. Only reachable before the purchase
 * attempt is claimed, so `fulfilment_attempts` must still be 0.
 */
function decideFulfilmentPreflightFailure(
  record: TransactionRecord,
  input: FulfilmentPreflightFailureInput,
): FulfilmentMutationPlan {
  if (record.type !== "airtime") {
    return {
      kind: "error",
      error: "FULFILMENT_INVALID_TYPE",
      message: `Transaction ${record.id} is type '${record.type}'; only airtime supports fulfilment`,
    };
  }

  const read = readFulfilmentSnapshot(record.metadata);
  if (!read.ok) {
    return {
      kind: "error",
      error: "FULFILMENT_METADATA_INVALID",
      message: read.message,
    };
  }
  const { snapshot } = read;

  const isTerminal = FULFILMENT_TERMINAL_STATUSES.includes(record.status);

  if (snapshot.requestId !== null && snapshot.requestId !== input.requestId) {
    return {
      kind: "error",
      error: "FULFILMENT_REQUEST_ID_MISMATCH",
      message: `Request id does not match the request id bound to transaction ${record.id}`,
    };
  }

  if (isTerminal) {
    return { kind: "noop", record };
  }

  if (record.status !== "processing") {
    return {
      kind: "error",
      error: "FULFILMENT_NOT_ELIGIBLE",
      message: `Transaction ${record.id} is '${record.status}'; preflight failure requires 'processing'`,
    };
  }

  if (snapshot.requestId === null) {
    return {
      kind: "error",
      error: "FULFILMENT_REQUEST_ID_MISSING",
      message: `Transaction ${record.id} is 'processing' without a bound fulfilment request id`,
    };
  }

  if (snapshot.attempts >= FULFILMENT_ATTEMPT_LIMIT) {
    return {
      kind: "error",
      error: "FULFILMENT_METADATA_INVALID",
      message: `Transaction ${record.id} already spent its purchase attempt; preflight failure is only valid before the provider call`,
    };
  }

  const patch: TransactionMetadata = {
    fulfilment_status: "failed",
    fulfilment_reconciliation_required: false,
    fulfilment_last_error_code: input.failureCode,
    fulfilment_last_error_reason: sanitizeFailureReason(input.failureReason),
    fulfilment_last_checked_at: nowIso(),
  };

  return {
    kind: "apply",
    nextStatus: "failed",
    patch,
    metadata: { ...(record.metadata ?? {}), ...patch },
    failureCode: input.failureCode,
    failureReason: sanitizeFailureReason(input.failureReason),
    changed: true,
  };
}

/**
 * In-Memory repository implementation used strictly for unit tests, offline execution,
 * or when explicitly injected via `setTransactionRepositoryForTesting`.
 */
export class InMemoryTransactionRepository implements TransactionRepository {
  private records = new Map<string, TransactionRecord>();

  async create(
    input: CreateTransactionInput,
  ): Promise<
    | { ok: true; record: TransactionRecord; reused: boolean }
    | { ok: false; code: string; message: string }
  > {
    const existing = await this.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return { ok: true, record: existing, reused: true };
    }

    const byRef = await this.findByPaycrestReference(input.paycrestReference);
    if (byRef) {
      return { ok: true, record: byRef, reused: true };
    }
    const id = input.id ?? generateTransactionId();
    const timestamp = nowIso();
    const record: TransactionRecord = {
      id,
      idempotencyKey: input.idempotencyKey,
      type: input.type ?? "cash_out",
      status: "pending",
      walletAddress: input.walletAddress.toLowerCase(),
      amountUsdc: input.amountUsdc,
      amountNgn: input.amountNgn ?? null,
      celoTxHash: null,
      paycrestOrderId: input.paycrestOrderId ?? null,
      paycrestReference: input.paycrestReference,
      paycrestStatus: input.paycrestStatus ?? "initiated",
      receiveAddress: input.receiveAddress ?? null,
      validUntil: input.validUntil ?? null,
      failureCode: null,
      failureReason: null,
      metadata: sanitizeIncomingMetadata(
        input.metadata,
        isAuthoritativeFiatStatus(input.paycrestStatus),
      ),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.records.set(id, record);
    return { ok: true, record, reused: false };
  }

  async findById(id: string): Promise<TransactionRecord | null> {
    return this.records.get(id) ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<TransactionRecord | null> {
    for (const record of this.records.values()) {
      if (record.idempotencyKey === key) return record;
    }
    return null;
  }

  async findByPaycrestReference(
    reference: string,
  ): Promise<TransactionRecord | null> {
    for (const record of this.records.values()) {
      if (record.paycrestReference === reference) return record;
    }
    return null;
  }

  async findByPaycrestOrderId(
    orderId: string,
  ): Promise<TransactionRecord | null> {
    for (const record of this.records.values()) {
      if (record.paycrestOrderId === orderId) return record;
    }
    return null;
  }

  async bindPaycrestOrder(
    input: BindPaycrestOrderInput,
  ): Promise<
    | { ok: true; record: TransactionRecord }
    | { ok: false; code: string; message: string }
  > {
    const record = await this.findById(input.id);
    if (!record) {
      return {
        ok: false,
        code: "TRANSACTION_NOT_FOUND",
        message: `Transaction ${input.id} not found`,
      };
    }

    if (isTerminalStatus(record.status, record.type)) {
      return {
        ok: false,
        code: "ILLEGAL_TRANSITION",
        message: `Cannot bind Paycrest order to terminal transaction '${record.status}'`,
      };
    }

    const nextMetadata: TransactionMetadata = {
      ...(record.metadata ?? {}),
      ...(input.metadata ?? {}),
    };
    const currentMarkerPresent =
      record.metadata !== null &&
      record.metadata !== undefined &&
      Object.prototype.hasOwnProperty.call(
        record.metadata,
        "paycrest_fiat_delivery_confirmed",
      );
    if (
      isAuthoritativeFiatStatus(input.paycrestStatus) ||
      isFiatDeliveryFinal(record)
    ) {
      nextMetadata.paycrest_fiat_delivery_confirmed = true;
    } else if (currentMarkerPresent) {
      nextMetadata.paycrest_fiat_delivery_confirmed =
        record.metadata?.paycrest_fiat_delivery_confirmed;
    } else {
      delete nextMetadata.paycrest_fiat_delivery_confirmed;
    }

    const updated: TransactionRecord = {
      ...record,
      paycrestOrderId: input.paycrestOrderId,
      receiveAddress: input.receiveAddress,
      validUntil: input.validUntil ?? record.validUntil,
      paycrestStatus: input.paycrestStatus ?? record.paycrestStatus,
      metadata: nextMetadata,
      updatedAt: nowIso(),
    };

    this.records.set(input.id, updated);
    return { ok: true, record: updated };
  }

  async bindCeloTxHash(input: {
    id: string;
    celoTxHash: string;
  }): Promise<
    | { ok: true; record: TransactionRecord }
    | { ok: false; code: string; message: string }
  > {
    const record = await this.findById(input.id);
    if (!record) {
      return {
        ok: false,
        code: "TRANSACTION_NOT_FOUND",
        message: `Transaction ${input.id} not found`,
      };
    }

    if (!/^0x[a-fA-F0-9]{64}$/.test(input.celoTxHash)) {
      return {
        ok: false,
        code: "INVALID_TRANSACTION_HASH",
        message: "Celo transaction hash must be a 66-character hex string",
      };
    }

    if (
      record.celoTxHash &&
      record.celoTxHash.toLowerCase() === input.celoTxHash.toLowerCase()
    ) {
      return { ok: true, record };
    }

    const validation = validateStatusTransition(
      record.status,
      "settling",
      record.type,
    );
    if (!validation.allowed) {
      return {
        ok: false,
        code: "ILLEGAL_TRANSITION",
        message:
          validation.reason ??
          `Cannot bind tx hash when status is '${record.status}'`,
      };
    }

    const updated: TransactionRecord = {
      ...record,
      celoTxHash: input.celoTxHash,
      status: "settling",
      updatedAt: nowIso(),
    };

    this.records.set(record.id, updated);
    return { ok: true, record: updated };
  }

  async updateStatus(
    id: string,
    update: UpdateTransactionStatusInput,
  ): Promise<
    | { ok: true; record: TransactionRecord; isNoop: boolean }
    | { ok: false; code: string; message: string }
  > {
    const record = await this.findById(id);
    if (!record) {
      return {
        ok: false,
        code: "TRANSACTION_NOT_FOUND",
        message: `Transaction ${id} not found`,
      };
    }

    const validation = validateStatusTransition(
      record.status,
      update.status,
      record.type,
    );
    if (!validation.allowed) {
      return {
        ok: false,
        code: "ILLEGAL_TRANSITION",
        message: validation.reason ?? "Illegal transition",
      };
    }

    if (validation.isNoop) {
      if (
        shouldAdvancePaycrestStatus(
          record.paycrestStatus,
          update.paycrestStatus,
        )
      ) {
        const updated: TransactionRecord = {
          ...record,
          paycrestStatus: update.paycrestStatus!,
          metadata: mergeFiatDeliveryMetadata(record, update.paycrestStatus),
          updatedAt: nowIso(),
        };
        this.records.set(id, updated);
        return { ok: true, record: updated, isNoop: false };
      }
      return { ok: true, record, isNoop: true };
    }

    const nextPaycrestStatus = shouldAdvancePaycrestStatus(
      record.paycrestStatus,
      update.paycrestStatus,
    )
      ? update.paycrestStatus!
      : record.paycrestStatus;
    const updated: TransactionRecord = {
      ...record,
      status: update.status,
      paycrestStatus: nextPaycrestStatus,
      metadata: mergeFiatDeliveryMetadata(record, update.paycrestStatus),
      celoTxHash: update.celoTxHash ?? record.celoTxHash,
      failureCode: update.failureCode ?? record.failureCode,
      failureReason: update.failureReason
        ? sanitizeFailureReason(update.failureReason)
        : record.failureReason,
      updatedAt: nowIso(),
    };

    this.records.set(id, updated);
    return { ok: true, record: updated, isNoop: false };
  }

  /**
   * Read/validate/write happen in one synchronous block (no await in between),
   * so concurrent callers cannot both acquire: exactly one wins.
   */
  async acquireAirtimeFulfilmentReservation(
    input: FulfilmentReservationInput,
  ): Promise<FulfilmentReservationResult> {
    const current = this.records.get(input.transactionId) ?? null;
    if (!current) {
      return fulfilmentFailure(
        "TRANSACTION_NOT_FOUND",
        `Transaction ${input.transactionId} not found`,
      );
    }

    const decision = decideFulfilmentReservation(current, input.requestId);
    if (decision.kind === "error") {
      return fulfilmentFailure(decision.error, decision.message, current);
    }
    if (decision.kind === "held") {
      return reservationHeld(decision.status, decision.state, current);
    }

    const patch = buildFulfilmentReservationPatch(input.requestId);
    const reserved: TransactionRecord = {
      ...current,
      status: "processing",
      metadata: { ...(current.metadata ?? {}), ...patch },
      updatedAt: nowIso(),
    };
    this.records.set(reserved.id, reserved);

    return reservationAcquired(reserved, input.requestId);
  }

  async claimAirtimeFulfilmentAttempt(
    input: FulfilmentAttemptInput,
  ): Promise<FulfilmentAttemptResult> {
    const current = this.records.get(input.transactionId) ?? null;
    if (!current) {
      return fulfilmentFailure(
        "TRANSACTION_NOT_FOUND",
        `Transaction ${input.transactionId} not found`,
      );
    }

    const decision = decideFulfilmentClaim(current, input.requestId);
    if (decision.kind === "error") {
      return fulfilmentFailure(decision.error, decision.message, current);
    }
    if (decision.kind === "held") {
      return attemptSettled(decision.status, current);
    }

    const claimed: TransactionRecord = {
      ...current,
      metadata: {
        ...(current.metadata ?? {}),
        fulfilment_attempts: FULFILMENT_ATTEMPT_LIMIT,
      },
      updatedAt: nowIso(),
    };
    this.records.set(claimed.id, claimed);

    return attemptSettled("claimed", claimed);
  }

  async recordAirtimeFulfilmentOutcome(
    input: FulfilmentOutcomeInput,
  ): Promise<FulfilmentMutationResult> {
    return this.applyFulfilmentPlan(input, decideFulfilmentOutcome);
  }

  async recordAirtimeFulfilmentPreflightFailure(
    input: FulfilmentPreflightFailureInput,
  ): Promise<FulfilmentMutationResult> {
    return this.applyFulfilmentPlan(input, decideFulfilmentPreflightFailure);
  }

  private applyFulfilmentPlan<TInput extends { transactionId: string }>(
    input: TInput,
    decide: (record: TransactionRecord, input: TInput) => FulfilmentMutationPlan,
  ): FulfilmentMutationResult {
    const current = this.records.get(input.transactionId) ?? null;
    if (!current) {
      return fulfilmentFailure(
        "TRANSACTION_NOT_FOUND",
        `Transaction ${input.transactionId} not found`,
      );
    }

    const plan = decide(current, input);
    if (plan.kind === "error") {
      return fulfilmentFailure(plan.error, plan.message, current);
    }
    if (plan.kind === "noop") {
      return mutationSettled(false, plan.record);
    }

    const updated: TransactionRecord = {
      ...current,
      status: plan.nextStatus,
      metadata: plan.metadata,
      failureCode:
        plan.failureCode === undefined ? current.failureCode : plan.failureCode,
      failureReason:
        plan.failureReason === undefined
          ? current.failureReason
          : plan.failureReason,
      updatedAt: nowIso(),
    };
    this.records.set(updated.id, updated);

    return mutationSettled(plan.changed, updated);
  }
}

/**
 * Production Drizzle repository implementation backed by Postgres.
 * Performs conditional, atomic SQL updates to eliminate race conditions.
 */
export class DrizzleTransactionRepository implements TransactionRepository {
  async create(
    input: CreateTransactionInput,
  ): Promise<
    | { ok: true; record: TransactionRecord; reused: boolean }
    | { ok: false; code: string; message: string }
  > {
    const db = getDb();
    if (!db) {
      return {
        ok: false,
        code: "DATABASE_UNAVAILABLE",
        message: "Database connection is not configured",
      };
    }

    const existing = await this.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return { ok: true, record: existing, reused: true };
    }

    const byRef = await this.findByPaycrestReference(input.paycrestReference);
    if (byRef) {
      return { ok: true, record: byRef, reused: true };
    }

    const id = input.id ?? generateTransactionId();
    const timestamp = nowIso();

    try {
      const [inserted] = await db
        .insert(agentTransactions)
        .values({
          id,
          idempotencyKey: input.idempotencyKey,
          type: input.type ?? "cash_out",
          status: "pending",
          walletAddress: input.walletAddress.toLowerCase(),
          amountUsdc: input.amountUsdc,
          amountNgn: input.amountNgn ?? null,
          celoTxHash: null,
          paycrestOrderId: input.paycrestOrderId ?? null,
          paycrestReference: input.paycrestReference,
          paycrestStatus: input.paycrestStatus ?? "initiated",
          receiveAddress: input.receiveAddress ?? null,
          failureCode: null,
          failureReason: null,
          metadata: sanitizeIncomingMetadata(
            input.metadata,
            isAuthoritativeFiatStatus(input.paycrestStatus),
          ),
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();

      return {
        ok: true,
        record: this.mapRow(inserted),
        reused: false,
      };
    } catch (err) {
      const checkKey = await this.findByIdempotencyKey(input.idempotencyKey);
      if (checkKey) {
        return { ok: true, record: checkKey, reused: true };
      }
      return {
        ok: false,
        code: "DATABASE_INSERT_ERROR",
        message:
          err instanceof Error ? err.message : "Failed to persist transaction",
      };
    }
  }

  async findById(id: string): Promise<TransactionRecord | null> {
    const db = getDb();
    if (!db) return null;
    const [row] = await db
      .select()
      .from(agentTransactions)
      .where(eq(agentTransactions.id, id))
      .limit(1);
    return row ? this.mapRow(row) : null;
  }

  async findByIdempotencyKey(key: string): Promise<TransactionRecord | null> {
    const db = getDb();
    if (!db) return null;
    const [row] = await db
      .select()
      .from(agentTransactions)
      .where(eq(agentTransactions.idempotencyKey, key))
      .limit(1);
    return row ? this.mapRow(row) : null;
  }

  async findByPaycrestReference(
    reference: string,
  ): Promise<TransactionRecord | null> {
    const db = getDb();
    if (!db) return null;
    const [row] = await db
      .select()
      .from(agentTransactions)
      .where(eq(agentTransactions.paycrestReference, reference))
      .limit(1);
    return row ? this.mapRow(row) : null;
  }

  async findByPaycrestOrderId(
    orderId: string,
  ): Promise<TransactionRecord | null> {
    const db = getDb();
    if (!db) return null;
    const [row] = await db
      .select()
      .from(agentTransactions)
      .where(eq(agentTransactions.paycrestOrderId, orderId))
      .limit(1);
    return row ? this.mapRow(row) : null;
  }

  async bindPaycrestOrder(
    input: BindPaycrestOrderInput,
  ): Promise<
    | { ok: true; record: TransactionRecord }
    | { ok: false; code: string; message: string }
  > {
    const db = getDb();
    if (!db) {
      return {
        ok: false,
        code: "DATABASE_UNAVAILABLE",
        message: "Database connection is not configured",
      };
    }

    const timestamp = nowIso();

    const metadataPatch: TransactionMetadata = {
      ...(input.metadata ?? {}),
    };
    if (isAuthoritativeFiatStatus(input.paycrestStatus)) {
      metadataPatch.paycrest_fiat_delivery_confirmed = true;
    } else {
      delete metadataPatch.paycrest_fiat_delivery_confirmed;
    }

    // Atomic conditional update: only update if not already terminal
    const [updated] = await db
      .update(agentTransactions)
      .set({
        paycrestOrderId: input.paycrestOrderId,
        receiveAddress: input.receiveAddress,
        validUntil: input.validUntil ?? undefined,
        paycrestStatus: input.paycrestStatus ?? undefined,
        metadata: Object.keys(metadataPatch).length
          ? sql`coalesce(${agentTransactions.metadata}, '{}'::jsonb) || ${JSON.stringify(metadataPatch)}::jsonb`
          : undefined,
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(agentTransactions.id, input.id),
          inArray(agentTransactions.status, ["pending", "settling"]),
        ),
      )
      .returning();

    if (updated) {
      return { ok: true, record: this.mapRow(updated) };
    }

    const current = await this.findById(input.id);
    if (!current) {
      return {
        ok: false,
        code: "TRANSACTION_NOT_FOUND",
        message: `Transaction ${input.id} not found`,
      };
    }
    if (isTerminalStatus(current.status, current.type)) {
      return {
        ok: false,
        code: "ILLEGAL_TRANSITION",
        message: `Cannot bind Paycrest order to terminal transaction '${current.status}'`,
      };
    }

    return {
      ok: false,
      code: "ILLEGAL_TRANSITION",
      message: `Cannot bind Paycrest order when transaction status is '${current.status}'`,
    };
  }

  async bindCeloTxHash(input: {
    id: string;
    celoTxHash: string;
  }): Promise<
    | { ok: true; record: TransactionRecord }
    | { ok: false; code: string; message: string }
  > {
    if (!/^0x[a-fA-F0-9]{64}$/.test(input.celoTxHash)) {
      return {
        ok: false,
        code: "INVALID_TRANSACTION_HASH",
        message: "Celo transaction hash must be a 66-character hex string",
      };
    }

    const db = getDb();
    if (!db) {
      return {
        ok: false,
        code: "DATABASE_UNAVAILABLE",
        message: "Database connection is not configured",
      };
    }

    const timestamp = nowIso();

    // Atomic conditional update: only transition from pending to settling,
    // or keep settling if hash matches
    const [updated] = await db
      .update(agentTransactions)
      .set({
        celoTxHash: input.celoTxHash,
        status: "settling",
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(agentTransactions.id, input.id),
          inArray(agentTransactions.status, ["pending", "settling"]),
        ),
      )
      .returning();

    if (updated) {
      return { ok: true, record: this.mapRow(updated) };
    }

    const current = await this.findById(input.id);
    if (!current) {
      return {
        ok: false,
        code: "TRANSACTION_NOT_FOUND",
        message: `Transaction ${input.id} not found`,
      };
    }

    if (
      current.celoTxHash &&
      current.celoTxHash.toLowerCase() === input.celoTxHash.toLowerCase()
    ) {
      return { ok: true, record: current };
    }
    const validation = validateStatusTransition(
      current.status,
      "settling",
      current.type,
    );
    return {
      ok: false,
      code: "ILLEGAL_TRANSITION",
      message:
        validation.reason ??
        `Cannot bind tx hash when status is '${current.status}'`,
    };
  }

  async updateStatus(
    id: string,
    update: UpdateTransactionStatusInput,
  ): Promise<
    | { ok: true; record: TransactionRecord; isNoop: boolean }
    | { ok: false; code: string; message: string }
  > {
    const db = getDb();
    if (!db) {
      return {
        ok: false,
        code: "DATABASE_UNAVAILABLE",
        message: "Database connection is not configured",
      };
    }

    const current = await this.findById(id);
    if (!current) {
      return {
        ok: false,
        code: "TRANSACTION_NOT_FOUND",
        message: `Transaction ${id} not found`,
      };
    }

    const validation = validateStatusTransition(
      current.status,
      update.status,
      current.type,
    );
    if (!validation.allowed) {
      return {
        ok: false,
        code: "ILLEGAL_TRANSITION",
        message: validation.reason ?? "Illegal transition",
      };
    }

    const timestamp = nowIso();

    if (validation.isNoop) {
      // Idempotent no-op; only advance upstream status if it represents true progression
      if (
        shouldAdvancePaycrestStatus(
          current.paycrestStatus,
          update.paycrestStatus,
        )
      ) {
        const [metaUpdated] = await db
          .update(agentTransactions)
          .set({
            paycrestStatus: update.paycrestStatus!,
            metadata:
              isAuthoritativeFiatStatus(update.paycrestStatus) ||
              isFiatDeliveryFinal(current)
                ? sql`coalesce(${agentTransactions.metadata}, '{}'::jsonb) || '{"paycrest_fiat_delivery_confirmed":true}'::jsonb`
                : undefined,
            updatedAt: timestamp,
          })
          .where(
            and(
              eq(agentTransactions.id, id),
              current.paycrestStatus === null
                ? isNull(agentTransactions.paycrestStatus)
                : eq(agentTransactions.paycrestStatus, current.paycrestStatus),
            ),
          )
          .returning();
        if (!metaUpdated) {
          const latest = await this.findById(id);
          if (!latest) {
            return {
              ok: false,
              code: "TRANSACTION_NOT_FOUND",
              message: `Transaction ${id} not found`,
            };
          }
          return { ok: true, record: latest, isNoop: true };
        }
        return {
          ok: true,
          record: this.mapRow(metaUpdated),
          isNoop: false,
        };
      }
      return { ok: true, record: current, isNoop: true };
    }

    const nextPaycrestStatus = shouldAdvancePaycrestStatus(
      current.paycrestStatus,
      update.paycrestStatus,
    )
      ? update.paycrestStatus!
      : (current.paycrestStatus ?? undefined);

    // Determine legal previous statuses for target status for this transaction's type
    const typeTransitions =
      ALLOWED_TRANSITIONS_BY_TYPE[current.type] ??
      ALLOWED_TRANSITIONS_BY_TYPE.cash_out;
    const allowedPrevious: TransactionStatus[] = (
      Object.keys(typeTransitions) as TransactionStatus[]
    ).filter((s) => typeTransitions[s]?.[update.status] === true);

    const sanitizedReason = update.failureReason
      ? sanitizeFailureReason(update.failureReason)
      : undefined;

    // Atomic conditional status update
    const [updated] = await db
      .update(agentTransactions)
      .set({
        status: update.status,
        paycrestStatus: nextPaycrestStatus,
        metadata:
          isAuthoritativeFiatStatus(update.paycrestStatus) ||
          isFiatDeliveryFinal(current)
            ? sql`coalesce(${agentTransactions.metadata}, '{}'::jsonb) || '{"paycrest_fiat_delivery_confirmed":true}'::jsonb`
            : undefined,
        celoTxHash: update.celoTxHash ?? undefined,
        failureCode: update.failureCode ?? undefined,
        failureReason: sanitizedReason ?? undefined,
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(agentTransactions.id, id),
          eq(agentTransactions.type, current.type),
          inArray(agentTransactions.status, allowedPrevious),
          current.paycrestStatus === null
            ? isNull(agentTransactions.paycrestStatus)
            : eq(agentTransactions.paycrestStatus, current.paycrestStatus),
        ),
      )
      .returning();

    if (updated) {
      return {
        ok: true,
        record: this.mapRow(updated),
        isNoop: false,
      };
    }

    // If 0 rows updated, reload to provide specific failure explanation
    const reloaded = await this.findById(id);
    if (!reloaded) {
      return {
        ok: false,
        code: "TRANSACTION_NOT_FOUND",
        message: `Transaction ${id} not found`,
      };
    }

    if (isTerminalStatus(reloaded.status, reloaded.type)) {
      return {
        ok: false,
        code: "ILLEGAL_TRANSITION",
        message: `Cannot transition from terminal status '${reloaded.status}' to '${update.status}'`,
      };
    }

    return {
      ok: false,
      code: "ILLEGAL_TRANSITION",
      message: `Illegal transition from '${reloaded.status}' to '${update.status}'`,
    };
  }

  /**
   * Atomically reserves fulfilment. The conditional UPDATE is the only place
   * the purchase right is granted; a loser of the race reloads and reports
   * `already_processing` instead of ever purchasing twice.
   */
  async acquireAirtimeFulfilmentReservation(
    input: FulfilmentReservationInput,
  ): Promise<FulfilmentReservationResult> {
    const db = getDb();
    if (!db) {
      return fulfilmentFailure(
        "DATABASE_UNAVAILABLE",
        "Database connection is not configured",
      );
    }

    const current = await this.findById(input.transactionId);
    if (!current) {
      return fulfilmentFailure(
        "TRANSACTION_NOT_FOUND",
        `Transaction ${input.transactionId} not found`,
      );
    }

    const decision = decideFulfilmentReservation(current, input.requestId);
    if (decision.kind === "error") {
      return fulfilmentFailure(decision.error, decision.message, current);
    }
    if (decision.kind === "held") {
      return reservationHeld(decision.status, decision.state, current);
    }

    const patch = buildFulfilmentReservationPatch(input.requestId);

    try {
      const [updated] = await db
        .update(agentTransactions)
        .set({
          status: "processing",
          metadata: sql`coalesce(${agentTransactions.metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
          updatedAt: nowIso(),
        })
        .where(
          and(
            eq(agentTransactions.id, input.transactionId),
            eq(agentTransactions.type, "airtime"),
            eq(agentTransactions.status, "settled"),
            sql`(${agentTransactions.metadata}->>'clubkonnect_request_id' is null or ${agentTransactions.metadata}->>'clubkonnect_request_id' = ${input.requestId})`,
            sql`${agentTransactions.metadata}->>'clubkonnect_order_id' is null`,
          ),
        )
        .returning();

      if (updated) {
        return reservationAcquired(this.mapRow(updated), input.requestId);
      }
    } catch (err) {
      return fulfilmentFailure(
        "DATABASE_UNAVAILABLE",
        err instanceof Error
          ? err.message
          : "Failed to reserve airtime fulfilment",
        current,
      );
    }

    const raced = await this.findById(input.transactionId);
    if (!raced) {
      return fulfilmentFailure(
        "TRANSACTION_NOT_FOUND",
        `Transaction ${input.transactionId} not found`,
      );
    }

    const racedDecision = decideFulfilmentReservation(raced, input.requestId);
    if (racedDecision.kind === "held") {
      return reservationHeld(racedDecision.status, racedDecision.state, raced);
    }
    if (racedDecision.kind === "error") {
      return fulfilmentFailure(racedDecision.error, racedDecision.message, raced);
    }

    return fulfilmentFailure(
      "DATABASE_UNAVAILABLE",
      `Concurrent reservation prevented acquiring transaction ${input.transactionId}`,
      raced,
    );
  }

  async claimAirtimeFulfilmentAttempt(
    input: FulfilmentAttemptInput,
  ): Promise<FulfilmentAttemptResult> {
    const db = getDb();
    if (!db) {
      return fulfilmentFailure(
        "DATABASE_UNAVAILABLE",
        "Database connection is not configured",
      );
    }

    const current = await this.findById(input.transactionId);
    if (!current) {
      return fulfilmentFailure(
        "TRANSACTION_NOT_FOUND",
        `Transaction ${input.transactionId} not found`,
      );
    }

    const decision = decideFulfilmentClaim(current, input.requestId);
    if (decision.kind === "error") {
      return fulfilmentFailure(decision.error, decision.message, current);
    }
    if (decision.kind === "held") {
      return attemptSettled(decision.status, current);
    }

    const patch: TransactionMetadata = {
      fulfilment_attempts: FULFILMENT_ATTEMPT_LIMIT,
    };

    try {
      const [updated] = await db
        .update(agentTransactions)
        .set({
          metadata: sql`coalesce(${agentTransactions.metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
          updatedAt: nowIso(),
        })
        .where(
          and(
            eq(agentTransactions.id, input.transactionId),
            eq(agentTransactions.type, "airtime"),
            eq(agentTransactions.status, "processing"),
            sql`${agentTransactions.metadata}->>'clubkonnect_request_id' = ${input.requestId}`,
            sql`coalesce(${agentTransactions.metadata}->>'fulfilment_attempts', '0') = '0'`,
          ),
        )
        .returning();

      if (updated) {
        return attemptSettled("claimed", this.mapRow(updated));
      }
    } catch (err) {
      return fulfilmentFailure(
        "DATABASE_UNAVAILABLE",
        err instanceof Error
          ? err.message
          : "Failed to claim airtime fulfilment attempt",
        current,
      );
    }

    const raced = await this.findById(input.transactionId);
    if (!raced) {
      return fulfilmentFailure(
        "TRANSACTION_NOT_FOUND",
        `Transaction ${input.transactionId} not found`,
      );
    }

    const racedDecision = decideFulfilmentClaim(raced, input.requestId);
    if (racedDecision.kind === "held") {
      return attemptSettled(racedDecision.status, raced);
    }
    if (racedDecision.kind === "error") {
      return fulfilmentFailure(racedDecision.error, racedDecision.message, raced);
    }

    return fulfilmentFailure(
      "DATABASE_UNAVAILABLE",
      `Concurrent attempt claim prevented claiming transaction ${input.transactionId}`,
      raced,
    );
  }

  async recordAirtimeFulfilmentOutcome(
    input: FulfilmentOutcomeInput,
  ): Promise<FulfilmentMutationResult> {
    return this.applyFulfilmentMutation(input, input.requestId, decideFulfilmentOutcome);
  }

  async recordAirtimeFulfilmentPreflightFailure(
    input: FulfilmentPreflightFailureInput,
  ): Promise<FulfilmentMutationResult> {
    return this.applyFulfilmentMutation(
      input,
      input.requestId,
      decideFulfilmentPreflightFailure,
    );
  }

  private async applyFulfilmentMutation<TInput extends { transactionId: string }>(
    input: TInput,
    requestId: string,
    decide: (record: TransactionRecord, input: TInput) => FulfilmentMutationPlan,
  ): Promise<FulfilmentMutationResult> {
    const db = getDb();
    if (!db) {
      return fulfilmentFailure(
        "DATABASE_UNAVAILABLE",
        "Database connection is not configured",
      );
    }

    const current = await this.findById(input.transactionId);
    if (!current) {
      return fulfilmentFailure(
        "TRANSACTION_NOT_FOUND",
        `Transaction ${input.transactionId} not found`,
      );
    }

    const plan = decide(current, input);
    if (plan.kind === "error") {
      return fulfilmentFailure(plan.error, plan.message, current);
    }
    if (plan.kind === "noop") {
      return mutationSettled(false, plan.record);
    }

    // Order ids are write-once: a concurrent different id must lose the write.
    const orderId = plan.patch.clubkonnect_order_id ?? null;
    const orderGuard =
      "clubkonnect_order_id" in plan.patch
        ? orderId === null
          ? sql`${agentTransactions.metadata}->>'clubkonnect_order_id' is null`
          : sql`coalesce(${agentTransactions.metadata}->>'clubkonnect_order_id', ${orderId}) = ${orderId}`
        : undefined;

    const conditions = [
      eq(agentTransactions.id, input.transactionId),
      eq(agentTransactions.type, "airtime"),
      eq(agentTransactions.status, "processing"),
      sql`${agentTransactions.metadata}->>'clubkonnect_request_id' = ${requestId}`,
    ];
    if (orderGuard) {
      conditions.push(orderGuard);
    }

    try {
      const [updated] = await db
        .update(agentTransactions)
        .set({
          status: plan.nextStatus,
          metadata: sql`coalesce(${agentTransactions.metadata}, '{}'::jsonb) || ${JSON.stringify(plan.patch)}::jsonb`,
          failureCode: plan.failureCode,
          failureReason: plan.failureReason,
          updatedAt: nowIso(),
        })
        .where(and(...conditions))
        .returning();

      if (updated) {
        return mutationSettled(plan.changed, this.mapRow(updated));
      }
    } catch (err) {
      return fulfilmentFailure(
        "DATABASE_UNAVAILABLE",
        err instanceof Error
          ? err.message
          : "Failed to persist airtime fulfilment outcome",
        current,
      );
    }

    const raced = await this.findById(input.transactionId);
    if (!raced) {
      return fulfilmentFailure(
        "TRANSACTION_NOT_FOUND",
        `Transaction ${input.transactionId} not found`,
      );
    }

    const racedPlan = decide(raced, input);
    if (racedPlan.kind === "noop") {
      return mutationSettled(false, racedPlan.record);
    }
    if (racedPlan.kind === "error") {
      return fulfilmentFailure(racedPlan.error, racedPlan.message, raced);
    }
    return fulfilmentFailure(
      "DATABASE_UNAVAILABLE",
      `Concurrent fulfilment update prevented persisting the outcome for transaction ${input.transactionId}`,
      raced,
    );
  }

  private mapRow(
    row: typeof agentTransactions.$inferSelect,
  ): TransactionRecord {
    return {
      id: row.id,
      idempotencyKey: row.idempotencyKey,
      type: row.type as "cash_out" | "airtime",
      status: row.status as TransactionStatus,
      walletAddress: row.walletAddress,
      amountUsdc: row.amountUsdc,
      amountNgn: row.amountNgn,
      celoTxHash: row.celoTxHash,
      paycrestOrderId: row.paycrestOrderId,
      paycrestReference: row.paycrestReference,
      paycrestStatus: row.paycrestStatus,
      receiveAddress: row.receiveAddress,
      validUntil: row.validUntil,
      failureCode: row.failureCode,
      failureReason: row.failureReason,
      metadata: row.metadata,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

class FailClosedTransactionRepository implements TransactionRepository {
  async create(): Promise<{ ok: false; code: string; message: string }> {
    return {
      ok: false,
      code: "DATABASE_UNAVAILABLE",
      message:
        "Database is unavailable. Configure DATABASE_URL in server environment.",
    };
  }

  async findById(): Promise<TransactionRecord | null> {
    return null;
  }

  async findByIdempotencyKey(): Promise<TransactionRecord | null> {
    return null;
  }

  async findByPaycrestReference(): Promise<TransactionRecord | null> {
    return null;
  }

  async findByPaycrestOrderId(): Promise<TransactionRecord | null> {
    return null;
  }

  async bindPaycrestOrder(): Promise<{
    ok: false;
    code: string;
    message: string;
  }> {
    return {
      ok: false,
      code: "DATABASE_UNAVAILABLE",
      message: "Database is unavailable",
    };
  }

  async bindCeloTxHash(): Promise<{
    ok: false;
    code: string;
    message: string;
  }> {
    return {
      ok: false,
      code: "DATABASE_UNAVAILABLE",
      message: "Database is unavailable",
    };
  }

  async updateStatus(): Promise<{
    ok: false;
    code: string;
    message: string;
  }> {
    return {
      ok: false,
      code: "DATABASE_UNAVAILABLE",
      message: "Database is unavailable",
    };
  }

  async acquireAirtimeFulfilmentReservation(): Promise<FulfilmentReservationResult> {
    return fulfilmentFailure("DATABASE_UNAVAILABLE", "Database is unavailable");
  }

  async claimAirtimeFulfilmentAttempt(): Promise<FulfilmentAttemptResult> {
    return fulfilmentFailure("DATABASE_UNAVAILABLE", "Database is unavailable");
  }

  async recordAirtimeFulfilmentOutcome(): Promise<FulfilmentMutationResult> {
    return fulfilmentFailure("DATABASE_UNAVAILABLE", "Database is unavailable");
  }

  async recordAirtimeFulfilmentPreflightFailure(): Promise<FulfilmentMutationResult> {
    return fulfilmentFailure("DATABASE_UNAVAILABLE", "Database is unavailable");
  }
}

// Global singleton instance
let activeRepository: TransactionRepository | null = null;

export function getTransactionRepository(): TransactionRepository {
  if (activeRepository) {
    return activeRepository;
  }

  if (process.env.DATABASE_URL) {
    activeRepository = new DrizzleTransactionRepository();
    return activeRepository;
  }

  // Allow InMemoryTransactionRepository ONLY in test environments
  if (process.env.NODE_ENV === "test") {
    activeRepository = new InMemoryTransactionRepository();
    return activeRepository;
  }

  // Fail closed in production/dev when DATABASE_URL is missing
  return new FailClosedTransactionRepository();
}

export function setTransactionRepositoryForTesting(
  repo: TransactionRepository | null,
): void {
  activeRepository = repo;
}
