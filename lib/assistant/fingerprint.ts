/**
 * Deterministic intent fingerprinting and preview binding for airtime
 * confirmations.
 *
 * The fingerprint is the only thing that ties a quoted preview back to the
 * exact intent it was priced for. It is a pure, synchronous SHA-256 over the
 * canonical `amountNgn:phone:network` triple, so any drift in the amount, the
 * recipient, or the network invalidates the quote instead of silently
 * re-pricing it.
 *
 * `validatePreviewBinding` is the trust boundary: it requires the intent to be
 * complete and canonical (non-empty amount and phone, fulfilment-supported
 * network) and proves the preview is the exact snapshot priced for it, before
 * any caller is allowed to build a payment payload from it.
 *
 * Server-only: callers must never let a client compute or compare this value.
 *
 * Precondition: `amountNgn`, `phone`, and `network` must be the canonicalized
 * values produced by the server intent engine (`normalizeAirtimeAmountNgn`,
 * `normalizePhoneNumber`, `normalizePaymentNetwork`). The fingerprint is only
 * as strong as that canonicalization, and must never be computed over raw user
 * text.
 */

import "server-only";

import { createHash } from "node:crypto";

import { SUPPORTED_PAYMENT_NETWORKS } from "@/lib/assistant/validation";
import type {
  AirtimeIntent,
  AirtimePreview,
} from "@/lib/assistant/types";
import { addDecimalStrings, divideDecimalStrings } from "@/lib/money/decimal";

/** Intent fields that participate in the canonical fingerprint. */
export interface IntentFingerprintInput {
  amountNgn?: string;
  phone?: string;
  network?: string;
}

/**
 * Lowercase hex SHA-256 of the canonical `amountNgn:phone:network` string.
 * Absent fields contribute an empty segment, so a partial intent still
 * fingerprints deterministically yet never equals a complete one.
 */
export function computeIntentFingerprint(intent: IntentFingerprintInput): string {
  const canonical = `${intent.amountNgn ?? ""}:${intent.phone ?? ""}:${intent.network ?? ""}`;
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Stable machine-readable reasons a preview cannot be bound to an intent. */
export type PreviewBindingReason =
  | "EXPIRED"
  | "FINGERPRINT_MISMATCH"
  | "FIELD_MISMATCH"
  | "NOT_READY";

export type PreviewBindingResult =
  | { valid: true }
  | { valid: false; reason: PreviewBindingReason };

/**
 * Proves that `preview` is the quote currently priced for `intent`, and that
 * the intent itself is complete enough to confirm.
 *
 * Order of rejection is fixed so callers and users see a stable reason:
 * readiness and completeness, then quote binding (fingerprint), then field
 * consistency, then freshness. Field consistency includes the quote's own
 * economics — `amountUsdc`/`totalUsdc` must be exactly what the inverse quote
 * at `rate` produces, and `expiresAt` must be exactly the fixed 5-minute TTL
 * after `quotedAt` — so a tampered quote can never widen the price or the
 * validity window. Every ambiguity resolves to "invalid" — there is no path
 * where a missing, stale, or mismatched value is treated as acceptable.
 */
export function validatePreviewBinding(
  preview: AirtimePreview,
  intent: AirtimeIntent,
  nowMs?: number,
): PreviewBindingResult {
  if (intent.readyForConfirmation !== true || intent.type !== "airtime") {
    return { valid: false, reason: "NOT_READY" };
  }

  // Completeness is checked at runtime, not merely assumed from the type: an
  // incomplete intent must never reach the fingerprint or field comparisons.
  const { amountNgn, phone, network } = intent;
  if (
    typeof amountNgn !== "string" ||
    amountNgn.length === 0 ||
    typeof phone !== "string" ||
    phone.length === 0 ||
    typeof network !== "string" ||
    !(SUPPORTED_PAYMENT_NETWORKS as readonly string[]).includes(network)
  ) {
    return { valid: false, reason: "NOT_READY" };
  }

  if (
    typeof preview.intentFingerprint !== "string" ||
    preview.intentFingerprint.length === 0 ||
    preview.intentFingerprint !== computeIntentFingerprint({ amountNgn, phone, network })
  ) {
    return { valid: false, reason: "FINGERPRINT_MISMATCH" };
  }

  if (
    preview.amountNgn !== amountNgn ||
    preview.phone !== phone ||
    preview.network !== network ||
    preview.feeUsdc !== "0" ||
    (typeof preview.amountUsdc !== "string" || preview.amountUsdc.length === 0) ||
    (typeof preview.totalUsdc !== "string" || preview.totalUsdc.length === 0) ||
    (typeof preview.rate !== "string" || preview.rate.length === 0) ||
    (typeof preview.quotedAt !== "string" || preview.quotedAt.length === 0)
  ) {
    return { valid: false, reason: "FIELD_MISMATCH" };
  }

  // The quote is a snapshot of a fixed 5-minute TTL: `expiresAt` must be
  // exactly `quotedAt + 5 minutes`. A forged horizon (far future, unparseable, or
  // shifted origin) is a tampered snapshot, never a longer-lived quote.
  const quotedAtMs = Date.parse(preview.quotedAt);
  const expiresAtMs = Date.parse(preview.expiresAt);
  if (
    !Number.isFinite(quotedAtMs) ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs !== quotedAtMs + 5 * 60_000
  ) {
    return { valid: false, reason: "FIELD_MISMATCH" };
  }

  // The price is a snapshot too: a client must not be able to confirm a
  // cheaper `amountUsdc`/`totalUsdc` than the inverse quote at the locked
  // `rate` yields. This mirrors the server's own pricing exactly (ceil to 6
  // fractional digits, plus the fee), so a legitimate preview always matches.
  try {
    const expectedUsdc = divideDecimalStrings(amountNgn, preview.rate, 6, "ceil");
    const expectedTotal = addDecimalStrings(expectedUsdc, preview.feeUsdc);
    if (
      preview.amountUsdc !== expectedUsdc ||
      preview.totalUsdc !== expectedTotal
    ) {
      return { valid: false, reason: "FIELD_MISMATCH" };
    }
  } catch {
    return { valid: false, reason: "FIELD_MISMATCH" };
  }

  const currentMs = nowMs ?? Date.now();
  if (!(currentMs < expiresAtMs)) {
    return { valid: false, reason: "EXPIRED" };
  }

  return { valid: true };
}
