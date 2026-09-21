/**
 * Confirmation transition for airtime payments.
 *
 * This is the last gate before a confirmation is treated as proven: it takes
 * the *current* intent and the *proposed* preview and returns the immutable
 * payment payload only when the preview is genuinely bound to that intent and
 * still fresh. It is pure and performs no provider call, no order creation,
 * no persistence, and no wallet or blockchain work — moving money is the
 * caller's separate, explicitly-gated step.
 */

import "server-only";

import {
  validatePreviewBinding,
  type PreviewBindingReason,
} from "@/lib/assistant/fingerprint";
import type {
  AirtimeIntent,
  AirtimePreview,
  ConfirmedAirtimePayment,
} from "@/lib/assistant/types";

export type ConfirmationTransitionResult =
  | { ok: true; data: ConfirmedAirtimePayment }
  | { ok: false; code: string; message: string };

/**
 * Truthful, non-speculative explanations. None of them claims the payment was
 * sent, and none silently re-quotes: a rejected confirmation must be replaced
 * by a fresh preview, never repaired in place.
 */
const FAILURE_MESSAGES: Record<PreviewBindingReason, string> = {
  NOT_READY:
    "This airtime intent is not ready for confirmation yet. Missing details must be provided first.",
  FINGERPRINT_MISMATCH:
    "This quote no longer matches the confirmed details. Request a fresh quote before confirming.",
  FIELD_MISMATCH:
    "This quote does not match the confirmed details. Request a fresh quote before confirming.",
  EXPIRED:
    "This quote has expired. Request a fresh quote before confirming.",
};

/**
 * Proves a proposed confirmation is strictly valid.
 *
 * Returns the frozen `ConfirmedAirtimePayment` snapshot on success; otherwise a
 * stable machine-readable `code` plus a truthful message. Rejection is total:
 * an expired quote, a quote priced for a different amount/phone/network, an
 * incomplete intent, or a non-zero fee never yields a payment payload.
 */
export function validateConfirmationTransition(
  currentIntent: AirtimeIntent,
  preview: AirtimePreview,
  nowMs?: number,
): ConfirmationTransitionResult {
  const binding = validatePreviewBinding(preview, currentIntent, nowMs);
  if (!binding.valid) {
    return {
      ok: false,
      code: binding.reason,
      message: FAILURE_MESSAGES[binding.reason],
    };
  }

  // The binding gate has already proven each of these runtime values present,
  // canonical, and equal to the intent's own fields, so nothing here can carry
  // an absent or unverified value into a payment payload.
  return {
    ok: true,
    data: {
      amountNgn: preview.amountNgn,
      phone: preview.phone,
      network: preview.network,
      // Additive-optional: a legacy USDC quote carries no asset, and the
      // confirmed payment keeps that exact shape, where absence means USDC.
      ...(preview.asset === undefined ? {} : { asset: preview.asset }),
      amountUsdc: preview.amountUsdc,
      feeUsdc: "0",
      totalUsdc: preview.totalUsdc,
      rate: preview.rate,
      quotedAt: preview.quotedAt,
      expiresAt: preview.expiresAt,
      intentFingerprint: preview.intentFingerprint,
    },
  };
}
