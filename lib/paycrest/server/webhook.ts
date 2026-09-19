import crypto from "node:crypto";
import {
  mapPaycrestStatusToInternal,
  type StatusMappingResult,
} from "@/lib/paycrest/server/reconciliation";
import {
  getTransactionRepository,
  type TransactionRecord,
} from "@/lib/transactions";

export interface WebhookVerificationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Verifies Paycrest webhook signature:
 * HMAC-SHA256 over UTF-8 raw request body with timing-safe hex comparison.
 */
export function verifyPaycrestWebhookSignature(params: {
  rawBody: string;
  signatureHeader: string | null;
  apiSecret: string | undefined;
}): WebhookVerificationResult {
  const { rawBody, signatureHeader, apiSecret } = params;

  if (!apiSecret || apiSecret.trim() === "") {
    return { valid: false, reason: "PAYCREST_API_SECRET is not configured" };
  }

  if (!signatureHeader || signatureHeader.trim() === "") {
    return { valid: false, reason: "Missing X-Paycrest-Signature header" };
  }

  const expectedHmac = crypto
    .createHmac("sha256", apiSecret.trim())
    .update(rawBody, "utf8")
    .digest("hex");

  const sigBuffer = Buffer.from(signatureHeader.trim().toLowerCase(), "utf8");
  const expectedBuffer = Buffer.from(expectedHmac.toLowerCase(), "utf8");

  if (sigBuffer.length !== expectedBuffer.length) {
    return { valid: false, reason: "Signature length mismatch" };
  }

  const matches = crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  if (!matches) {
    return { valid: false, reason: "Invalid webhook signature" };
  }

  return { valid: true };
}

export interface ProcessWebhookResult {
  processed: boolean;
  transaction?: TransactionRecord;
  mapping?: StatusMappingResult;
  reason?: string;
}

/**
 * Idempotently processes an authenticated Paycrest webhook event.
 * Never mutates state backwards from terminal states.
 */
export async function processPaycrestWebhook(
  payload: unknown,
): Promise<ProcessWebhookResult> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { processed: false, reason: "Invalid webhook payload shape" };
  }

  const rec = payload as Record<string, unknown>;
  const eventData =
    rec.data && typeof rec.data === "object" && !Array.isArray(rec.data)
      ? (rec.data as Record<string, unknown>)
      : rec;

  const orderId =
    typeof eventData.id === "string"
      ? eventData.id
      : typeof eventData.orderId === "string"
        ? eventData.orderId
        : null;

  const reference =
    typeof eventData.reference === "string" ? eventData.reference : null;

  const rawStatus =
    typeof eventData.status === "string"
      ? eventData.status.toLowerCase().trim()
      : null;

  if (!rawStatus) {
    return { processed: false, reason: "No status found in webhook payload" };
  }

  const repo = getTransactionRepository();
  let tx: TransactionRecord | null = null;

  if (orderId) {
    tx = await repo.findByPaycrestOrderId(orderId);
  }
  if (!tx && reference) {
    tx = await repo.findByPaycrestReference(reference);
  }

  if (!tx) {
    return {
      processed: false,
      reason: `No matching transaction found for orderId=${orderId} reference=${reference}`,
    };
  }

  const mapping = mapPaycrestStatusToInternal(rawStatus, tx.status, tx.type);
  const updateResult = await repo.updateStatus(tx.id, {
    status: mapping.targetStatus,
    paycrestStatus: rawStatus,
    failureReason:
      mapping.targetStatus === "failed" ? `Webhook status: ${rawStatus}` : undefined,
  });

  if (!updateResult.ok) {
    return {
      processed: false,
      transaction: tx,
      mapping,
      reason: updateResult.message,
    };
  }

  return {
    processed: true,
    transaction: updateResult.record,
    mapping,
  };
}
