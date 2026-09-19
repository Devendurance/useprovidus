/**
 * Conservative ClubKonnect status normalization and idempotency rules.
 * Server-only: depends on config redaction, so it must never reach client bundles.
 */

import "server-only";

import { createHash } from "node:crypto";
import { redactClubKonnectString } from "@/lib/clubkonnect/server/config";
import type {
  ClubKonnectRawResponse,
  NormalizedFulfilmentResult,
} from "@/lib/clubkonnect/types";

const MAX_RAW_STATUS_TEXT_LENGTH = 120;

/**
 * Truncates and sanitizes raw provider messages to prevent log bloat or secret leakage.
 * Credential-bearing URLs and embedded `key=value` credentials are redacted through the
 * shared config redaction contract, so `rawStatusText` can never echo secrets into logs.
 */
function sanitizeRawMessage(msg: unknown): string {
  if (typeof msg !== "string") return "";
  const flattened = msg.replace(/[\r\n\t]/g, " ").trim();
  return redactClubKonnectString(flattened).slice(0, MAX_RAW_STATUS_TEXT_LENGTH);
}

/**
 * Normalizes upstream ClubKonnect response into internal fulfilment outcome.
 *
 * CRITICAL STATUS INVARIANTS:
 * - 100 = ORDER_RECEIVED: Acknowledgement only, NOT success -> processing (non-terminal)
 * - 300 = Processing: In-flight -> processing (non-terminal)
 * - statuscode 200 = ORDER_COMPLETED / Successful: ONLY this numeric code is terminal success
 *         -> completed (terminal). Status TEXT alone ("ORDER_COMPLETED", "successful") is NEVER
 *         sufficient: statuscode 201 also returns status "ORDER_COMPLETED" with a network remark.
 * - 201 = Network Unresponsive: Upstream network timed out or unresponsive.
 *         May have debited float or reached telco in an unknown state!
 *         MUST NOT be treated as success, and MUST NOT be assumed clean terminal failure.
 *         Mapped to non-terminal "unknown" with RECONCILIATION_REQUIRED.
 * - 417 = Insufficient Balance: Provider float issue -> failed (terminal)
 * - Unknown / unrecognized status code: Reconciliation required -> unknown (NEVER infer success)
 */
export function normalizeClubKonnectStatus(
  raw: ClubKonnectRawResponse,
): NormalizedFulfilmentResult {
  const rawCode = raw.statuscode ?? raw.statusCode ?? raw.status_code;
  const statusCodeStr = rawCode !== undefined && rawCode !== null ? String(rawCode).trim() : "";
  const rawStatusText = sanitizeRawMessage(
    raw.msg ?? raw.message ?? raw.remark ?? raw.description ?? raw.status ?? "",
  );
  const orderId = raw.orderid ?? raw.orderId ? String(raw.orderid ?? raw.orderId) : undefined;
  const requestId = raw.requestid ?? raw.requestId ? String(raw.requestid ?? raw.requestId) : undefined;

  // 200 = Success — the ONLY terminal success signal.
  // Provider status TEXT such as "ORDER_COMPLETED" / "successful" MUST NEVER imply success:
  // official ClubKonnect docs return status "ORDER_COMPLETED" for BOTH statuscode 200 and
  // statuscode 201 ("Network Unresponsive"), so only the numeric code is authoritative.
  // A non-"200" statuscode with "ORDER_COMPLETED" text falls through to unknown below.
  if (statusCodeStr === "200") {
    return {
      status: "completed",
      isPending: false,
      isFinal: true,
      isSuccess: true,
      statusCode: "200",
      rawStatusText: rawStatusText || "ORDER_COMPLETED",
      orderId,
      requestId,
    };
  }

  // 100 = ORDER_RECEIVED (acknowledgement only, NOT success)
  if (
    statusCodeStr === "100" ||
    statusCodeStr.toLowerCase() === "order_received"
  ) {
    return {
      status: "processing",
      isPending: true,
      isFinal: false,
      isSuccess: false,
      statusCode: "100",
      rawStatusText: rawStatusText || "ORDER_RECEIVED",
      orderId,
      requestId,
    };
  }

  // 300 = Processing (NOT success)
  if (
    statusCodeStr === "300" ||
    statusCodeStr.toLowerCase() === "processing"
  ) {
    return {
      status: "processing",
      isPending: true,
      isFinal: false,
      isSuccess: false,
      statusCode: "300",
      rawStatusText: rawStatusText || "PROCESSING",
      orderId,
      requestId,
    };
  }

  // 201 = Network Unresponsive (Provider network issue; outcome UNKNOWN, reconciliation required)
  // MUST NOT be treated as success, and MUST NOT be treated as terminal failure without reconciliation.
  if (
    statusCodeStr === "201" ||
    statusCodeStr.toLowerCase().includes("unresponsive")
  ) {
    return {
      status: "unknown",
      isPending: false,
      isFinal: false,
      isSuccess: false,
      statusCode: "201",
      rawStatusText: rawStatusText || "Network Unresponsive",
      orderId,
      requestId,
      failureCode: "PROVIDER_NETWORK_UNRESPONSIVE",
      failureReason: "Provider network unresponsive; reconciliation required",
    };
  }

  // 417 = Insufficient Balance / Float issue (Clean rejection before debit)
  if (
    statusCodeStr === "417" ||
    statusCodeStr.toLowerCase().includes("insufficient")
  ) {
    return {
      status: "failed",
      isPending: false,
      isFinal: true,
      isSuccess: false,
      statusCode: "417",
      rawStatusText: rawStatusText || "Insufficient Balance",
      orderId,
      requestId,
      failureCode: "PROVIDER_FLOAT_EXHAUSTED",
      failureReason: "Provider operating float exhausted",
    };
  }

  // Unrecognized or unknown code: Fail safe to unknown
  return {
    status: "unknown",
    isPending: false,
    isFinal: false,
    isSuccess: false,
    statusCode: statusCodeStr || "UNKNOWN",
    rawStatusText: rawStatusText || "Unrecognized provider status",
    orderId,
    requestId,
    failureCode: "UNKNOWN_OUTCOME",
    failureReason: "Unrecognized provider response; reconciliation required",
  };
}

/**
 * Builds a deterministic, collision-resistant, bounded RequestID from a Providus transaction ID.
 *
 * Requirements:
 * - Deterministic: Produces the exact same RequestID for the same transactionId on retry/reconciliation.
 * - Collision-resistant: Combines a sanitized prefix with a SHA-256 digest suffix of the full input.
 * - Non-empty validation: Throws or rejects invalid/empty transaction ID.
 * - Length: Strictly <= 32 alphanumeric characters, suitable for provider systems.
 *
 * Format: "ck" + sanitized prefix (up to 18 chars) + 12 chars hex hash = max 32 chars.
 */
export function buildClubKonnectRequestId(transactionId: string): string {
  if (!transactionId || typeof transactionId !== "string" || transactionId.trim() === "") {
    throw new Error("Invalid transactionId for ClubKonnect RequestID generation");
  }

  const trimmed = transactionId.trim();
  const hash = createHash("sha256").update(trimmed).digest("hex").slice(0, 12);
  const sanitized = trimmed.replace(/[^a-zA-Z0-9]/g, "");
  const prefix = (sanitized || "tx").slice(0, 18);

  return `ck${prefix}${hash}`.slice(0, 32);
}
