/**
 * Server-only ClubKonnect HTTP client and request builders.
 * Import ONLY from server modules. Never import from client components.
 */

import "server-only";

import {
  getClubKonnectConfig,
  redactClubKonnectUrl,
  redactClubKonnectObject,
} from "@/lib/clubkonnect/server/config";
import {
  normalizeClubKonnectStatus,
  buildClubKonnectRequestId,
} from "@/lib/clubkonnect/server/status";
import type {
  AirtimeOrderInput,
  AirtimeRequestPayload,
  ClubKonnectNetwork,
  ClubKonnectNetworkCode,
  ClubKonnectRawResponse,
  ClubKonnectResult,
  NormalizedFulfilmentResult,
  WalletBalanceResult,
} from "@/lib/clubkonnect/types";

const REQUEST_TIMEOUT_MS = 15_000;

export const NETWORK_CODES: Record<ClubKonnectNetwork, ClubKonnectNetworkCode> = {
  mtn: "01",
  glo: "02",
  "9mobile": "03",
  airtel: "04",
};

/**
 * Validates Nigerian phone number (e.g. 08031234567 or +2348031234567).
 * Returns normalized 11-digit string starting with 0.
 */
export function normalizeAndValidatePhone(phone: string): string | null {
  const trimmed = phone.trim().replace(/[\s-()]/g, "");
  if (/^0[789][01]\d{8}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\+234[789][01]\d{8}$/.test(trimmed)) {
    return `0${trimmed.slice(4)}`;
  }
  if (/^234[789][01]\d{8}$/.test(trimmed)) {
    return `0${trimmed.slice(3)}`;
  }
  return null;
}

/**
 * Validates airtime amount (positive integer NGN between 50 and 50,000).
 */
export function validateAirtimeAmount(amountNgn: number): boolean {
  return Number.isInteger(amountNgn) && amountNgn >= 50 && amountNgn <= 50_000;
}

/**
 * Builds typed airtime request payload with validation.
 *
 * SECRET HANDLING: the returned `payload`/`url` contain UserID/APIKey in
 * server memory. NEVER serialize them into an API response, log line, or
 * client prop — only `redactedUrl` and `redactClubKonnectObject` output may
 * cross the server boundary outward.
 */
export function buildAirtimeRequestPayload(
  input: AirtimeOrderInput,
): ClubKonnectResult<{ payload: AirtimeRequestPayload; url: string; redactedUrl: string }> {
  const configRes = getClubKonnectConfig();
  if (!configRes.ok) {
    return configRes;
  }

  const phone = normalizeAndValidatePhone(input.phone);
  if (!phone) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Invalid Nigerian phone number format",
    };
  }

  if (!validateAirtimeAmount(input.amountNgn)) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Airtime amount must be an integer between 50 and 50,000 NGN",
    };
  }

  const networkCode = NETWORK_CODES[input.network];
  if (!networkCode) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: `Invalid mobile network: ${input.network}`,
    };
  }

  const requestId = buildClubKonnectRequestId(input.transactionId);

  const payload: AirtimeRequestPayload = {
    UserID: configRes.data.userId,
    APIKey: configRes.data.apiKey,
    MobileNetwork: networkCode,
    Amount: String(input.amountNgn),
    MobileNumber: phone,
    RequestID: requestId,
    CallBackURL: input.callBackUrl,
  };

  const urlObj = new URL(`${configRes.data.baseUrl}/APIAirtimeV1.asp`);
  urlObj.searchParams.set("UserID", payload.UserID);
  urlObj.searchParams.set("APIKey", payload.APIKey);
  urlObj.searchParams.set("MobileNetwork", payload.MobileNetwork);
  urlObj.searchParams.set("Amount", payload.Amount);
  urlObj.searchParams.set("MobileNumber", payload.MobileNumber);
  urlObj.searchParams.set("RequestID", payload.RequestID);
  if (payload.CallBackURL) {
    urlObj.searchParams.set("CallBackURL", payload.CallBackURL);
  }

  const fullUrl = urlObj.toString();
  const redactedUrl = redactClubKonnectUrl(fullUrl);

  return {
    ok: true,
    data: {
      payload,
      url: fullUrl,
      redactedUrl,
    },
  };
}

/**
 * Builds URL to query transaction status by RequestID or OrderID.
 */
export function buildQueryTransactionUrl(params: {
  requestId?: string;
  orderId?: string;
}): ClubKonnectResult<{ url: string; redactedUrl: string }> {
  const configRes = getClubKonnectConfig();
  if (!configRes.ok) {
    return configRes;
  }

  if (!params.requestId && !params.orderId) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Either requestId or orderId must be provided to query transaction",
    };
  }

  const urlObj = new URL(`${configRes.data.baseUrl}/APIQueryV1.asp`);
  urlObj.searchParams.set("UserID", configRes.data.userId);
  urlObj.searchParams.set("APIKey", configRes.data.apiKey);
  if (params.requestId) {
    urlObj.searchParams.set("RequestID", params.requestId);
  }
  if (params.orderId) {
    urlObj.searchParams.set("OrderID", params.orderId);
  }

  const fullUrl = urlObj.toString();
  const redactedUrl = redactClubKonnectUrl(fullUrl);

  return {
    ok: true,
    data: {
      url: fullUrl,
      redactedUrl,
    },
  };
}

/**
 * Builds URL to query wallet balance.
 */
export function buildWalletBalanceUrl(): ClubKonnectResult<{ url: string; redactedUrl: string }> {
  const configRes = getClubKonnectConfig();
  if (!configRes.ok) {
    return configRes;
  }

  const urlObj = new URL(`${configRes.data.baseUrl}/APIWalletBalanceV1.asp`);
  urlObj.searchParams.set("UserID", configRes.data.userId);
  urlObj.searchParams.set("APIKey", configRes.data.apiKey);

  const fullUrl = urlObj.toString();
  const redactedUrl = redactClubKonnectUrl(fullUrl);

  return {
    ok: true,
    data: {
      url: fullUrl,
      redactedUrl,
    },
  };
}

/**
 * Query ClubKonnect wallet balance.
 * Read-only safe query. Returns MISSING_CONFIG if credentials are not present.
 */
export async function queryClubKonnectWalletBalance(): Promise<ClubKonnectResult<WalletBalanceResult>> {
  const urlRes = buildWalletBalanceUrl();
  if (!urlRes.ok) {
    return urlRes;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(urlRes.data.url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      return {
        ok: false,
        code: "UPSTREAM_ERROR",
        message: `ClubKonnect returned HTTP ${res.status}`,
        statusCode: res.status,
      };
    }

    const json = (await res.json()) as ClubKonnectRawResponse;
    const balance = json.walletbalance ?? json.balance ?? "0";

    return {
      ok: true,
      data: {
        balanceNgn: String(balance),
        rawResponse: redactClubKonnectObject(json as Record<string, unknown>),
      },
    };
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      code: isTimeout ? "UPSTREAM_TIMEOUT" : "NETWORK_ERROR",
      message: isTimeout ? "ClubKonnect request timed out" : "Failed to connect to ClubKonnect",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Query ClubKonnect transaction status for reconciliation.
 * Safe read-only query. Never triggers a new purchase.
 */
export async function queryClubKonnectTransaction(params: {
  requestId?: string;
  orderId?: string;
}): Promise<ClubKonnectResult<NormalizedFulfilmentResult>> {
  const urlRes = buildQueryTransactionUrl(params);
  if (!urlRes.ok) {
    return urlRes;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(urlRes.data.url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      return {
        ok: false,
        code: "UPSTREAM_ERROR",
        message: `ClubKonnect query returned HTTP ${res.status}`,
        statusCode: res.status,
      };
    }

    const json = (await res.json()) as ClubKonnectRawResponse;
    const normalized = normalizeClubKonnectStatus(json);

    return {
      ok: true,
      data: normalized,
    };
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      code: isTimeout ? "UPSTREAM_TIMEOUT" : "NETWORK_ERROR",
      message: isTimeout
        ? "ClubKonnect query timed out (reconciliation required)"
        : "Failed to connect to ClubKonnect for status query",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
