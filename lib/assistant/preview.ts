/**
 * Server-only airtime preview: the inverse-quote boundary.
 *
 * The Paycrest sell rate is NGN per 1 unit of the quote's asset, so the crypto
 * amount a user must provide for a given NGN airtime value is `amountNgn /
 * rate`, rounded upward at 6 base-unit decimals — the scale both supported Celo
 * assets use. USDC is read at a single-unit notional; cNGN's corridor is
 * minimum-gated by the provider, so it is read at the airtime value itself and
 * never below a gate this module would have to know. All arithmetic is exact
 * decimal-string math — never floating point — so a preview can never
 * under-fund a payment.
 */

import "server-only";

import { getAddress, isAddress } from "viem";

import { computeIntentFingerprint } from "@/lib/assistant/fingerprint";
import { getPreviewRepository } from "@/lib/assistant/preview-repository";
import type {
  AirtimePreviewRecord,
  Result,
} from "@/lib/assistant/preview-repository";
import type { AirtimePreview, PaymentNetwork } from "@/lib/assistant/types";
import {
  normalizeAirtimeAmountNgn,
  normalizePaymentNetwork,
  normalizePhoneNumber,
} from "@/lib/assistant/validation";
import {
  getPaymentAsset,
  normalizePaymentAssetSymbol,
  type PaymentAssetSymbol,
} from "@/lib/celo/assets";
import { addDecimalStrings, divideDecimalStrings } from "@/lib/money/decimal";
import { getCorridorQuote } from "@/lib/paycrest/server/client";
import type { CorridorQuote, PaycrestResult } from "@/lib/paycrest/types";

/** A preview is valid only while the current time is strictly before `expiresAt` (5-minute human-safe TTL). */
export const PREVIEW_TTL_MS = 5 * 60_000;

/** Crypto notional used on the sell side to read the current NGN-per-USDC rate. */
export const SELL_NOTIONAL_USDC = "1";

/** P4 fee: airtime previews carry no separate fee. */
export const PREVIEW_FEE_USDC = "0";

/**
 * Fractional base-unit digits the inverse quote is rounded (up) to. Both
 * supported Celo payment assets carry 6 decimals, so the same scale prices the
 * frozen `amountUsdc` / `totalUsdc` wire fields either way.
 */
export const PREVIEW_USDC_DECIMALS = 6;

/**
 * cNGN's sell corridor is minimum-gated by the provider, so a quote can be
 * refused for a value USDC's single-unit probe still answers. The refusal names
 * cNGN and stays retryable; the provider's minimum is never hardcoded and no
 * rate is ever assumed in its place.
 */
const CNGN_RATE_UNAVAILABLE_MESSAGE =
  "No cNGN sell rate is available for this amount right now; the cNGN provider minimum for this corridor may not be met";

export type AirtimePreviewErrorCode =
  | "INCOMPLETE_INTENT"
  | "INVALID_INTENT"
  | "WALLET_CONTEXT_INVALID"
  | "QUOTE_UNAVAILABLE"
  | "RATE_UNAVAILABLE"
  | "INVALID_RATE"
  | "PREVIEW_STORE_UNAVAILABLE";

export interface AirtimePreviewError {
  code: AirtimePreviewErrorCode;
  message: string;
  retryable: boolean;
}

/**
 * A successful preview always carries the identifier of the persisted quote it
 * was built from: only that row can later be consumed for payment, and only by
 * the wallet it was issued to.
 */
export type AirtimePreviewResult =
  | { ok: true; data: AirtimePreview; previewId: string }
  | { ok: false; error: AirtimePreviewError };

/** Normalized airtime intent required to produce a preview. */
export interface AirtimePreviewIntent {
  amountNgn: string;
  phone: string;
  network: PaymentNetwork;
  /**
   * Asset the airtime value is priced in. Absent or blank is the legacy USDC
   * default; an unsupported value is refused before any network call.
   */
  asset?: PaymentAssetSymbol;
}

export interface AirtimePreviewOptions {
  /** Injectable fetch for tests/self-checks; defaults to the global fetch. */
  fetchFn?: typeof fetch;
  /**
   * Wallet the quote is issued to. The preview is persisted under this
   * normalized address, and only this wallet may later consume it.
   */
  walletAddress?: string;
  /**
   * Asset seam for a caller that prices through the options. The intent's own
   * `asset` is authoritative and always wins when it is present.
   */
  asset?: PaymentAssetSymbol;
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
 * The asset a preview is priced in. An absent or blank value is the legacy USDC
 * default; every other value must name a supported symbol, so an unsupported
 * asset can never reach the rate lookup or be persisted on a quote.
 */
function normalizePreviewAsset(value: unknown): PaymentAssetSymbol | null {
  if (value === undefined || value === null) return "USDC";
  if (typeof value === "string" && value.trim() === "") return "USDC";
  return normalizePaymentAssetSymbol(value);
}

/**
 * Canonicalizes the caller's fields and rejects an incomplete or invalid
 * intent *before* any network call, so a preview is never tied to partial
 * input.
 */
function normalizePreviewIntent(raw: {
  amountNgn: string;
  phone: string;
  network: PaymentNetwork;
  asset?: PaymentAssetSymbol;
}): IntentCheck {
  const asset = normalizePreviewAsset(raw.asset);
  if (asset === null) {
    return {
      ok: false,
      error: {
        code: "INVALID_INTENT",
        message: "Airtime payment asset is not valid",
        retryable: false,
      },
    };
  }

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

  return { ok: true, intent: { amountNgn, phone, network, asset } };
}

/**
 * Lowercases a syntactically valid EVM address, or returns null. Binding the
 * quote to this canonical form is what lets consumption compare wallet
 * identity without caring how the client cased it.
 */
function normalizePreviewWallet(value: string | undefined): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const candidate = value.trim();
  if (!isAddress(candidate)) return null;
  return getAddress(candidate).toLowerCase();
}

/**
 * Builds the frozen `AirtimePreview` for a normalized airtime intent and
 * persists it as the server-authoritative quote.
 *
 * Fetches the Paycrest sell corridor rate for the quote's asset and treats it
 * as NGN per 1 unit of that asset, computes the exact ceiling inverse quote,
 * stamps the 5-minute TTL and the intent fingerprint, then stores the whole
 * quote bound to the caller's wallet. Never returns a preview for an incomplete
 * intent, an unsupported asset, an invalid wallet, a failed quote, an unusable
 * rate, or a quote that could not be persisted — an unpersisted quote could
 * never be consumed for payment.
 *
 * Every call that reaches the rate lookup emits one safe `preview_timing`
 * record holding only durations, so a slow Paycrest read or a slow write is
 * observable without logging the wallet, the phone number, or the quote. A
 * lookup or write that throws is timed too and rethrown unchanged: the
 * instrumentation never alters or masks a failure.
 */
export async function buildAirtimePreview(
  intent: AirtimePreviewIntent,
  options?: AirtimePreviewOptions,
): Promise<AirtimePreviewResult> {
  const startedAt = Date.now();

  const checked = normalizePreviewIntent({
    ...intent,
    // The intent is authoritative; the options are only a seam for callers that
    // do not carry the asset on the intent itself.
    asset: intent?.asset ?? options?.asset,
  });
  if (!checked.ok) return { ok: false, error: checked.error };
  const { amountNgn, phone, network, asset } = checked.intent;
  const paymentAsset = getPaymentAsset(asset);
  const isCngn = paymentAsset.paycrestToken === "CNGN";

  const walletAddress = normalizePreviewWallet(options?.walletAddress);
  if (walletAddress === null) {
    return failure(
      "WALLET_CONTEXT_INVALID",
      "A valid wallet address is required to issue an airtime preview",
      false,
    );
  }

  let rateLookupDurationMs = 0;
  let dbPersistenceDurationMs = 0;

  /**
   * Emits the one safe timing record for this call. A closed record only:
   * durations and a tag — never the wallet, the phone number, the rate, or the
   * intent. Every exit taken once the rate lookup has started reaches it — the
   * return paths through `withTiming` and the throw paths through the catches
   * below — so exactly one record is emitted per call, and a step that was
   * never attempted reports 0.
   */
  const emitTiming = (): void => {
    console.log(
      JSON.stringify({
        tag: "preview_timing",
        rateLookupDurationMs,
        dbPersistenceDurationMs,
        totalMs: Math.max(0, Date.now() - startedAt),
      }),
    );
  };

  /** Emits the timing record and returns the result unchanged. */
  const withTiming = (result: AirtimePreviewResult): AirtimePreviewResult => {
    emitTiming();
    return result;
  };

  const rateLookupStartedAt = Date.now();
  let quote: PaycrestResult<CorridorQuote>;
  try {
    // USDC answers at a single-unit notional. cNGN is minimum-gated downstream,
    // so its corridor is read at the airtime value itself: the returned rate is
    // still NGN per 1 cNGN, just at a notional the provider will quote.
    quote = await getCorridorQuote(
      "sell",
      isCngn ? amountNgn : SELL_NOTIONAL_USDC,
      { fetchFn: options?.fetchFn, token: paymentAsset.paycrestToken },
    );
  } catch (error) {
    // A lookup that throws is still timed, and the error is rethrown unchanged:
    // instrumentation must never alter or mask a failure.
    rateLookupDurationMs = Math.max(0, Date.now() - rateLookupStartedAt);
    emitTiming();
    throw error;
  }
  rateLookupDurationMs = Math.max(0, Date.now() - rateLookupStartedAt);
  if (!quote.ok) {
    return withTiming(
      failure("QUOTE_UNAVAILABLE", "Paycrest sell rate could not be fetched", true),
    );
  }
  if (!quote.data.available) {
    return withTiming(
      failure(
        "RATE_UNAVAILABLE",
        isCngn
          ? CNGN_RATE_UNAVAILABLE_MESSAGE
          : "No Paycrest sell rate is available right now",
        true,
      ),
    );
  }

  // The rate is a divisor: reject blank, malformed, or zero values outright.
  const rate = quote.data.rate.trim();
  const rateUsable =
    /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(rate) && !/^0+(?:\.0*)?$/.test(rate);
  if (!rateUsable) {
    return withTiming(
      failure("INVALID_RATE", "Paycrest returned an unusable sell rate", false),
    );
  }

  // Base units of the quote's asset, at the scale the frozen `amountUsdc` and
  // `totalUsdc` wire fields carry: 6 decimals for both USDC and cNGN.
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

  // Persist the full quote before it is ever handed out: payment preparation
  // re-reads these values from the stored row and never trusts the browser.
  const persistenceStartedAt = Date.now();
  let persisted: Result<AirtimePreviewRecord>;
  try {
    persisted = await getPreviewRepository().createPreview({
      walletAddress,
      intentFingerprint,
      amountNgn,
      phone,
      network,
      asset: paymentAsset.symbol,
      rate,
      amountUsdc,
      feeUsdc,
      totalUsdc,
      quotedAt,
      expiresAt,
    });
  } catch (error) {
    // A write that throws is still timed, and the error is rethrown unchanged:
    // instrumentation must never turn a driver failure into a payment outcome.
    dbPersistenceDurationMs = Math.max(0, Date.now() - persistenceStartedAt);
    emitTiming();
    throw error;
  }
  dbPersistenceDurationMs = Math.max(0, Date.now() - persistenceStartedAt);
  if (!persisted.ok) {
    return withTiming(
      failure(
        "PREVIEW_STORE_UNAVAILABLE",
        "Airtime preview could not be persisted; no payment can be prepared",
        true,
      ),
    );
  }

  return withTiming({
    ok: true,
    previewId: persisted.preview.id,
    data: {
      intentFingerprint,
      amountNgn,
      phone,
      network,
      // Additive-optional: USDC keeps the frozen legacy shape, where an absent
      // asset means USDC, and only a non-USDC quote states what it was priced in.
      ...(isCngn ? { asset: paymentAsset.symbol } : {}),
      amountUsdc,
      feeUsdc,
      totalUsdc,
      rate,
      quotedAt,
      expiresAt,
    },
  });
}
