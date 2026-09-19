/**
 * Server-only airtime preview: the inverse-quote boundary.
 *
 * The Paycrest sell rate is NGN per 1 USDC, so the USDC amount a user must
 * provide for a given NGN airtime value is `amountNgn / rate`, rounded upward
 * at 6 USDC fractional digits. All arithmetic is exact decimal-string math —
 * never floating point — so a preview can never under-fund a payment.
 */

import "server-only";

import { computeIntentFingerprint } from "@/lib/assistant/fingerprint";
import type { AirtimePreview, PaymentNetwork } from "@/lib/assistant/types";
import {
  normalizeAirtimeAmountNgn,
  normalizePaymentNetwork,
  normalizePhoneNumber,
} from "@/lib/assistant/validation";
import { addDecimalStrings, divideDecimalStrings } from "@/lib/money/decimal";
import { getCorridorQuote } from "@/lib/paycrest/server/client";

/** A preview is valid only while the current time is strictly before `expiresAt`. */
export const PREVIEW_TTL_MS = 60_000;

/** Crypto notional used on the sell side to read the current NGN-per-USDC rate. */
export const SELL_NOTIONAL_USDC = "1";

/** P4 fee: airtime previews carry no separate fee. */
export const PREVIEW_FEE_USDC = "0";

/** Fractional USDC digits the inverse quote is rounded (up) to. */
export const PREVIEW_USDC_DECIMALS = 6;

export type AirtimePreviewErrorCode =
  | "INCOMPLETE_INTENT"
  | "INVALID_INTENT"
  | "QUOTE_UNAVAILABLE"
  | "RATE_UNAVAILABLE"
  | "INVALID_RATE";

export interface AirtimePreviewError {
  code: AirtimePreviewErrorCode;
  message: string;
  retryable: boolean;
}

export type AirtimePreviewResult =
  | { ok: true; data: AirtimePreview }
  | { ok: false; error: AirtimePreviewError };

/** Normalized airtime intent required to produce a preview. */
export interface AirtimePreviewIntent {
  amountNgn: string;
  phone: string;
  network: PaymentNetwork;
}

export interface AirtimePreviewOptions {
  /** Injectable fetch for tests/self-checks; defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

function failure(
  code: AirtimePreviewErrorCode,
  message: string,
  retryable: boolean,
): AirtimePreviewResult {
  return { ok: false, error: { code, message, retryable } };
}

type IntentCheck =
  | { ok: true; intent: AirtimePreviewIntent }
  | { ok: false; error: AirtimePreviewError };

/**
 * Canonicalizes the caller's fields and rejects an incomplete or invalid
 * intent *before* any network call, so a preview is never tied to partial
 * input.
 */
function normalizePreviewIntent(raw: {
  amountNgn: string;
  phone: string;
  network: PaymentNetwork;
}): IntentCheck {
  const hasAmount = typeof raw.amountNgn === "string" && raw.amountNgn.trim() !== "";
  const hasPhone = typeof raw.phone === "string" && raw.phone.trim() !== "";
  const hasNetwork =
    typeof raw.network === "string" && raw.network.trim() !== "";

  if (!hasAmount || !hasPhone || !hasNetwork) {
    return {
      ok: false,
      error: {
        code: "INCOMPLETE_INTENT",
        message: "Airtime amount, phone, and network are all required",
        retryable: false,
      },
    };
  }

  const amountNgn = normalizeAirtimeAmountNgn(raw.amountNgn);
  const phone = normalizePhoneNumber(raw.phone);
  const network = normalizePaymentNetwork(raw.network);

  if (amountNgn === null || phone === null || network === null) {
    return {
      ok: false,
      error: {
        code: "INVALID_INTENT",
        message: "Airtime amount, phone, or network is not valid",
        retryable: false,
      },
    };
  }

  return { ok: true, intent: { amountNgn, phone, network } };
}

/**
 * Builds the frozen `AirtimePreview` for a normalized airtime intent.
 *
 * Fetches the Paycrest sell corridor rate with a 1 USDC notional and treats it
 * as NGN per 1 USDC, computes the exact ceiling inverse quote, and stamps the
 * 60-second TTL and the intent fingerprint. Never returns a preview for an
 * incomplete intent, a failed quote, or an unusable rate.
 */
export async function buildAirtimePreview(
  intent: AirtimePreviewIntent,
  options?: AirtimePreviewOptions,
): Promise<AirtimePreviewResult> {
  const checked = normalizePreviewIntent(intent);
  if (!checked.ok) return { ok: false, error: checked.error };
  const { amountNgn, phone, network } = checked.intent;

  const quote = await getCorridorQuote("sell", SELL_NOTIONAL_USDC, {
    fetchFn: options?.fetchFn,
  });
  if (!quote.ok) {
    return failure(
      "QUOTE_UNAVAILABLE",
      "Paycrest sell rate could not be fetched",
      true,
    );
  }
  if (!quote.data.available) {
    return failure(
      "RATE_UNAVAILABLE",
      "No Paycrest sell rate is available right now",
      true,
    );
  }

  // The rate is a divisor: reject blank, malformed, or zero values outright.
  const rate = quote.data.rate.trim();
  const rateUsable =
    /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(rate) && !/^0+(?:\.0*)?$/.test(rate);
  if (!rateUsable) {
    return failure("INVALID_RATE", "Paycrest returned an unusable sell rate", false);
  }

  const amountUsdc = divideDecimalStrings(
    amountNgn,
    rate,
    PREVIEW_USDC_DECIMALS,
    "ceil",
  );
  const feeUsdc = PREVIEW_FEE_USDC;
  const totalUsdc = addDecimalStrings(amountUsdc, feeUsdc);

  // Prefer the provider timestamp; fall back to now when it is unusable.
  const providerQuotedAt = quote.data.checkedAt;
  const quotedAt =
    typeof providerQuotedAt === "string" &&
    providerQuotedAt.trim() !== "" &&
    Number.isFinite(Date.parse(providerQuotedAt))
      ? providerQuotedAt
      : new Date().toISOString();
  const expiresAt = new Date(Date.parse(quotedAt) + PREVIEW_TTL_MS).toISOString();

  const intentFingerprint = computeIntentFingerprint({
    amountNgn,
    phone,
    network,
  });

  return {
    ok: true,
    data: {
      intentFingerprint,
      amountNgn,
      phone,
      network,
      amountUsdc,
      feeUsdc,
      totalUsdc,
      rate,
      quotedAt,
      expiresAt,
    },
  };
}
