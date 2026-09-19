/**
 * Server-only Paycrest HTTP client.
 * Import only from server modules. Never import from client components.
 * Never logs API keys, headers, request bodies, or sensitive response bodies.
 */

import {
  buildOfframpOrderPayload,
  redactOfframpOutgoingBody,
  summarizeOfframpPayloadFields,
} from "@/lib/paycrest/offramp-payload";
import { filterNgnBankInstitutions } from "@/lib/paycrest/recipient";
import { validateCryptoAmount } from "@/lib/paycrest/server/amount";
import { getPaycrestConfig, resolvePaycrestUrl } from "@/lib/paycrest/server/config";
import {
  classifyUpstreamOrderFailure,
  formatSafeOrderDiagnosticLog,
  isPaycrestDiagnosticsEnabled,
  newDiagnosticId,
} from "@/lib/paycrest/server/upstream-error";
import type {
  CeloUsdcToken,
  CorridorQuote,
  InstitutionSummary,
  PaycrestResult,
  PaycrestSide,
} from "@/lib/paycrest/types";

export {
  parsePaycrestValidationDetails,
  sanitizeValidationErrorString,
} from "@/lib/paycrest/server/upstream-error";
export {
  buildOfframpOrderPayload,
  redactOfframpOutgoingBody,
} from "@/lib/paycrest/offramp-payload";

const NETWORK = "celo" as const;
const TOKEN = "USDC" as const;
const FIAT = "NGN" as const;
const REQUEST_TIMEOUT_MS = 12_000;

/** Short in-memory cache for non-sensitive NGN institution list only. */
let institutionsCache: {
  at: number;
  data: InstitutionSummary[];
} | null = null;
const INSTITUTIONS_CACHE_MS = 60_000;

type UpstreamJson = {
  status?: string;
  message?: string;
  error?: string;
  data?: unknown;
};

type RateSidePayload = {
  rate?: unknown;
  providerIds?: unknown;
  orderType?: unknown;
  refundTimeoutMinutes?: unknown;
};

function nowIso(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

async function paycrestFetch(
  path: string,
  init?: RequestInit,
): Promise<PaycrestResult<{ status: number; json: UpstreamJson }>> {
  const config = getPaycrestConfig();
  if (!config.ok) return config;

  const url = resolvePaycrestUrl(config.data.baseUrl, path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      method: init?.method ?? "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "API-Key": config.data.apiKey,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });

    let json: UpstreamJson;
    try {
      json = (await response.json()) as UpstreamJson;
    } catch {
      return {
        ok: false,
        code: "PARSE_ERROR",
        message: "Upstream response was not valid JSON",
        httpStatus: response.status,
      };
    }

    return { ok: true, data: { status: response.status, json } };
  } catch (err) {
    const name =
      err && typeof err === "object" && "name" in err
        ? String((err as { name?: unknown }).name)
        : "";
    if (name === "AbortError") {
      return {
        ok: false,
        code: "UPSTREAM_TIMEOUT",
        message: "Paycrest request timed out",
      };
    }
    return {
      ok: false,
      code: "UPSTREAM_UNAVAILABLE",
      message: "Paycrest request failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

function mapAuthOrUpstream(
  status: number,
  message: string | undefined,
): PaycrestResult<never> {
  if (status === 401 || status === 403) {
    return {
      ok: false,
      code: "AUTH_FAILED",
      message: "Paycrest authentication failed",
      httpStatus: status,
    };
  }
  if (status === 503) {
    return {
      ok: false,
      code: "UPSTREAM_UNAVAILABLE",
      message: message?.trim() || "Paycrest temporarily unavailable",
      httpStatus: status,
    };
  }
  return {
    ok: false,
    code: "UPSTREAM_ERROR",
    message: message?.trim() || `Paycrest returned HTTP ${status}`,
    httpStatus: status,
  };
}

function parseRateSide(
  side: PaycrestSide,
  cryptoAmount: string,
  payload: RateSidePayload,
  checkedAt: string,
): CorridorQuote | null {
  const rate = asString(payload.rate);
  if (rate === null || rate.trim() === "") return null;

  let providerCount = 0;
  if (Array.isArray(payload.providerIds)) {
    providerCount = payload.providerIds.length;
  }

  const orderType =
    typeof payload.orderType === "string" ? payload.orderType : null;
  const refundTimeoutMinutes =
    asNumber(payload.refundTimeoutMinutes) !== null
      ? Math.trunc(asNumber(payload.refundTimeoutMinutes) as number)
      : null;

  return {
    available: true,
    side,
    network: NETWORK,
    token: TOKEN,
    fiat: FIAT,
    cryptoAmount,
    rate: rate.trim(),
    providerCount,
    orderType,
    refundTimeoutMinutes,
    checkedAt,
    live: true,
  };
}

function isNoProviderResponse(
  status: number,
  json: UpstreamJson,
): boolean {
  if (status === 404) return true;
  if (json.data === null || json.data === undefined) {
    const msg = (json.message ?? "").toLowerCase();
    if (
      msg.includes("no provider") ||
      msg.includes("provider available") ||
      msg.includes("not available")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Live corridor quote for celo / USDC / NGN.
 * amount is crypto notional (path param) — validated string passed as-is.
 */
export async function getCorridorQuote(
  side: PaycrestSide,
  cryptoAmount: string,
): Promise<PaycrestResult<CorridorQuote>> {
  if (side !== "buy" && side !== "sell") {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "side must be buy or sell",
    };
  }

  const amountCheck = validateCryptoAmount(cryptoAmount);
  if (!amountCheck.ok) return amountCheck;

  const amount = amountCheck.data;
  const path = `/rates/${NETWORK}/${TOKEN}/${encodeURIComponent(amount)}/${FIAT}?side=${side}`;
  const result = await paycrestFetch(path);
  if (!result.ok) return result;

  const { status, json } = result.data;
  const checkedAt = nowIso();

  if (status === 200 && isRecord(json.data)) {
    const sidePayload = json.data[side];
    if (isRecord(sidePayload)) {
      const quote = parseRateSide(
        side,
        amount,
        sidePayload as RateSidePayload,
        checkedAt,
      );
      if (quote) {
        return { ok: true, data: quote };
      }
    }
    // 200 but missing side payload → treat as no provider if data empty-ish
    if (
      json.data[side] === null ||
      json.data[side] === undefined ||
      (isRecord(json.data) && Object.keys(json.data).length === 0)
    ) {
      return {
        ok: true,
        data: {
          available: false,
          side,
          network: NETWORK,
          token: TOKEN,
          fiat: FIAT,
          reason: "NO_PROVIDER",
          checkedAt,
          live: true,
        },
      };
    }
    return {
      ok: false,
      code: "PARSE_ERROR",
      message: "Unexpected rate response shape",
      httpStatus: status,
    };
  }

  if (isNoProviderResponse(status, json)) {
    return {
      ok: true,
      data: {
        available: false,
        side,
        network: NETWORK,
        token: TOKEN,
        fiat: FIAT,
        reason: "NO_PROVIDER",
        checkedAt,
        live: true,
      },
    };
  }

  return mapAuthOrUpstream(status, json.message);
}

/**
 * List NGN institutions from Paycrest.
 */
export async function listNgnInstitutions(): Promise<
  PaycrestResult<InstitutionSummary[]>
> {
  if (
    institutionsCache &&
    Date.now() - institutionsCache.at < INSTITUTIONS_CACHE_MS
  ) {
    return { ok: true, data: institutionsCache.data };
  }

  const result = await paycrestFetch(`/institutions/${FIAT}`);
  if (!result.ok) return result;

  const { status, json } = result.data;
  if (status !== 200) {
    return mapAuthOrUpstream(status, json.message);
  }

  if (!Array.isArray(json.data)) {
    return {
      ok: false,
      code: "PARSE_ERROR",
      message: "Unexpected institutions response shape",
      httpStatus: status,
    };
  }

  const institutions: InstitutionSummary[] = [];
  for (const item of json.data) {
    if (!isRecord(item)) continue;
    const code = asString(item.code);
    const name = asString(item.name);
    if (!code || !name) continue;

    const typeRaw =
      item.type ?? item.institutionType ?? item.institution_type ?? null;
    const type =
      typeRaw === null || typeRaw === undefined
        ? null
        : asString(typeRaw);

    institutions.push({
      code,
      name,
      ...(type !== undefined ? { type } : {}),
    });
  }

  institutionsCache = { at: Date.now(), data: institutions };
  return { ok: true, data: institutions };
}

/**
 * Live NGN institutions filtered for bank payout selection.
 */
export async function listNgnBankInstitutions(): Promise<
  PaycrestResult<InstitutionSummary[]>
> {
  if (
    institutionsCache &&
    Date.now() - institutionsCache.at < INSTITUTIONS_CACHE_MS
  ) {
    return {
      ok: true,
      data: filterNgnBankInstitutions(institutionsCache.data),
    };
  }

  const result = await listNgnInstitutions();
  if (!result.ok) return result;
  return { ok: true, data: filterNgnBankInstitutions(result.data) };
}

export type AccountNameResult = {
  accountName: string;
};

/**
 * Create a Paycrest offramp order.
 * POST /v2/sender/orders — no retries, no caching, no logging of PII.
 * Callers must not retry on timeout (ambiguous outcome).
 * Reads upstream body as text once, then classifies safely.
 */
export async function createOfframpOrder(payload: {
  amount: string;
  reference: string;
  refundAddress: string;
  institution: string;
  accountIdentifier: string;
  accountName: string;
  memo?: string;
}): Promise<
  PaycrestResult<{ raw: unknown; status: number; diagnosticId: string }>
> {
  const diagnosticId = newDiagnosticId();
  const config = getPaycrestConfig();
  if (!config.ok) return config;

  const body = buildOfframpOrderPayload(payload);
  const url = resolvePaycrestUrl(config.data.baseUrl, "/sender/orders");
  let resolvedOrigin = "";
  let resolvedPathname = "/sender/orders";
  try {
    const u = new URL(url);
    resolvedOrigin = u.origin;
    resolvedPathname = u.pathname;
  } catch {
    resolvedOrigin = "invalid-url";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    // Temporary dev diagnostic: redacted view of the exact `body` object below.
    // Same variable is passed to JSON.stringify — nothing mutates `body` after this.
    if (isPaycrestDiagnosticsEnabled()) {
      console.info(
        JSON.stringify({
          tag: "paycrest_outgoing_body",
          diagnosticId,
          url,
          method: "POST",
          contentType: "application/json",
          authHeaderName: "API-Key",
          body: redactOfframpOutgoingBody(body),
        }),
      );
    }

    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "API-Key": config.data.apiKey,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const contentType = response.headers.get("content-type");
    const bodyText = await response.text();
    const status = response.status;

    if (status === 200 || status === 201) {
      let json: unknown;
      try {
        json = bodyText === "" ? null : JSON.parse(bodyText);
      } catch {
        return {
          ok: false,
          code: "PARSE_ERROR",
          message: "Upstream success response was not valid JSON",
          httpStatus: status,
          diagnosticId,
        };
      }
      return {
        ok: true,
        data: { raw: json, status, diagnosticId },
      };
    }

    const diagnosis = classifyUpstreamOrderFailure({
      httpStatus: status,
      contentType,
      bodyText,
      diagnosticId,
    });

    if (isPaycrestDiagnosticsEnabled()) {
      // Safe structured diagnostic only — no secrets, accounts, wallets, or raw bodies.
      console.info(
        formatSafeOrderDiagnosticLog({
          diagnosticId,
          origin: resolvedOrigin,
          pathname: resolvedPathname,
          httpStatus: status,
          contentType,
          envelopeShape: diagnosis.envelopeShape,
          topLevelKeys: diagnosis.topLevelKeys,
          reference: payload.reference,
          payloadFields: summarizeOfframpPayloadFields(body),
          code: diagnosis.code,
        }),
      );
    }

    return {
      ok: false,
      code: diagnosis.code,
      message: diagnosis.message,
      httpStatus: diagnosis.httpStatus,
      validationDetails:
        diagnosis.validationDetails.length > 0
          ? diagnosis.validationDetails
          : undefined,
      diagnosticId,
      envelopeShape: diagnosis.envelopeShape,
    };
  } catch (err) {
    const name =
      err && typeof err === "object" && "name" in err
        ? String((err as { name?: unknown }).name)
        : "";
    if (name === "AbortError") {
      return {
        ok: false,
        code: "UPSTREAM_TIMEOUT",
        message: "ORDER_CREATION_OUTCOME_UNKNOWN",
        diagnosticId,
      };
    }
    return {
      ok: false,
      code: "UPSTREAM_UNAVAILABLE",
      message: "Paycrest request failed",
      diagnosticId,
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface PaycrestOrderDetails {
  id: string;
  reference: string;
  status: string;
  amount?: string;
  amountIn?: string;
  rate?: string;
  receiveAddress?: string;
  validUntil?: string;
  transactionFee?: string;
  senderFee?: string;
  raw: unknown;
}

/**
 * Fetches current Paycrest order status: GET /v2/sender/orders/:id.
 * Read-only authenticated query. Never mutates order or logs secrets.
 */
export async function getOfframpOrder(
  orderId: string,
): Promise<PaycrestResult<PaycrestOrderDetails>> {
  if (!orderId || typeof orderId !== "string" || orderId.trim() === "") {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Order ID is required",
    };
  }

  const cleanId = orderId.trim();
  const config = getPaycrestConfig();
  if (!config.ok) return config;

  const url = resolvePaycrestUrl(
    config.data.baseUrl,
    `/sender/orders/${encodeURIComponent(cleanId)}`,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "API-Key": config.data.apiKey,
      },
      cache: "no-store",
    });

    const status = response.status;
    let json: UpstreamJson | null = null;
    try {
      json = (await response.json()) as UpstreamJson;
    } catch {
      return {
        ok: false,
        code: "PARSE_ERROR",
        message: "Upstream response was not valid JSON",
        httpStatus: status,
      };
    }

    if (status === 200 || status === 201) {
      const data = isRecord(json?.data) ? (json.data as Record<string, unknown>) : null;
      if (!data) {
        return {
          ok: false,
          code: "PARSE_ERROR",
          message: "Paycrest get-order response missing data envelope",
          httpStatus: status,
        };
      }

      const id = asString(data.id) ?? cleanId;
      const reference = asString(data.reference) ?? "";
      const rawStatus = asString(data.status)?.toLowerCase().trim() ?? "unknown";
      const amount = asString(data.amount) ?? undefined;
      const amountIn = asString(data.amountIn) ?? undefined;
      const rate = asString(data.rate) ?? undefined;
      const receiveAddress = asString(data.receiveAddress) ?? undefined;
      const validUntil = asString(data.validUntil) ?? undefined;
      const transactionFee = asString(data.transactionFee) ?? undefined;
      const senderFee = asString(data.senderFee) ?? undefined;

      return {
        ok: true,
        data: {
          id,
          reference,
          status: rawStatus,
          amount,
          amountIn,
          rate,
          receiveAddress,
          validUntil,
          transactionFee,
          senderFee,
          raw: json,
        },
      };
    }

    if (status === 404) {
      return {
        ok: false,
        code: "UPSTREAM_ERROR",
        message: `Order ${cleanId} not found upstream`,
        httpStatus: 404,
      };
    }

    if (status === 401 || status === 403) {
      return {
        ok: false,
        code: "AUTH_FAILED",
        message: "Paycrest authentication failed",
        httpStatus: status,
      };
    }

    return {
      ok: false,
      code: "UPSTREAM_ERROR",
      message: json?.message ?? `Upstream returned status ${status}`,
      httpStatus: status,
    };
  } catch (err) {
    const name =
      err && typeof err === "object" && "name" in err
        ? String((err as { name?: unknown }).name)
        : "";
    if (name === "AbortError") {
      return {
        ok: false,
        code: "UPSTREAM_TIMEOUT",
        message: "Paycrest order status request timed out",
      };
    }
    return {
      ok: false,
      code: "UPSTREAM_UNAVAILABLE",
      message: "Unable to connect to Paycrest",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Live Paycrest account name resolution for NGN bank accounts.
 * POST /v2/verify-account — no retries, no caching, no logging of PII.
 */
export async function verifyNgnAccountName(input: {
  institution: string;
  accountIdentifier: string;
}): Promise<PaycrestResult<AccountNameResult>> {
  const result = await paycrestFetch("/verify-account", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      institution: input.institution,
      accountIdentifier: input.accountIdentifier,
    }),
  });

  if (!result.ok) return result;

  const { status, json } = result.data;

  if (status === 401 || status === 403) {
    return mapAuthOrUpstream(status, json.message);
  }
  if (status === 429) {
    return {
      ok: false,
      code: "UPSTREAM_ERROR",
      message: "Paycrest rate limited",
      httpStatus: 429,
    };
  }
  if (status === 404) {
    return {
      ok: false,
      code: "UPSTREAM_ERROR",
      message: json.message?.trim() || "Account not found",
      httpStatus: 404,
    };
  }
  if (status === 400 || status === 422) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: json.message?.trim() || "Account verification rejected",
      httpStatus: status,
    };
  }
  if (status !== 200) {
    return mapAuthOrUpstream(status, json.message);
  }

  // data may be a string name or object with accountName
  let accountName: string | null = null;
  if (typeof json.data === "string") {
    accountName = json.data.trim();
  } else if (isRecord(json.data)) {
    accountName =
      asString(json.data.accountName) ??
      asString(json.data.account_name) ??
      asString(json.data.name);
    if (accountName) accountName = accountName.trim();
  }

  if (!accountName || accountName === "") {
    return {
      ok: false,
      code: "PARSE_ERROR",
      message: "Paycrest did not return an account name",
      httpStatus: status,
    };
  }

  // Reject non-name placeholders for NGN bank scope
  if (accountName.toUpperCase() === "OK") {
    return {
      ok: false,
      code: "PARSE_ERROR",
      message:
        "Paycrest returned a non-name verification result; recipient not accepted",
      httpStatus: status,
    };
  }

  return { ok: true, data: { accountName } };
}

/**
 * Resolve USDC token metadata on Celo from Paycrest /tokens.
 */
export async function getCeloUsdcToken(): Promise<
  PaycrestResult<CeloUsdcToken>
> {
  const result = await paycrestFetch(`/tokens?network=${NETWORK}`);
  if (!result.ok) return result;

  const { status, json } = result.data;
  if (status !== 200) {
    // Fallback without network filter if filtered call fails with 400
    if (status === 400) {
      const all = await paycrestFetch("/tokens");
      if (!all.ok) return all;
      if (all.data.status !== 200) {
        return mapAuthOrUpstream(all.data.status, all.data.json.message);
      }
      return pickCeloUsdc(all.data.json.data, all.data.status);
    }
    return mapAuthOrUpstream(status, json.message);
  }

  return pickCeloUsdc(json.data, status);
}

function pickCeloUsdc(
  data: unknown,
  httpStatus: number,
): PaycrestResult<CeloUsdcToken> {
  if (!Array.isArray(data)) {
    return {
      ok: false,
      code: "PARSE_ERROR",
      message: "Unexpected tokens response shape",
      httpStatus,
    };
  }

  for (const item of data) {
    if (!isRecord(item)) continue;
    const symbol = asString(item.symbol);
    const network = asString(item.network);
    if (!symbol || !network) continue;
    if (symbol.toUpperCase() !== TOKEN) continue;
    if (network.toLowerCase() !== NETWORK) continue;

    const contractAddress = asString(
      item.contractAddress ?? item.contract_address,
    );
    const decimals = asNumber(item.decimals);
    if (!contractAddress || decimals === null) {
      return {
        ok: false,
        code: "PARSE_ERROR",
        message: "USDC on celo missing contract or decimals",
        httpStatus,
      };
    }

    const baseCurrency = asString(item.baseCurrency ?? item.base_currency);

    const token: CeloUsdcToken = {
      symbol: TOKEN,
      network: NETWORK,
      contractAddress,
      decimals: Math.trunc(decimals),
    };
    if (baseCurrency) token.baseCurrency = baseCurrency;
    return { ok: true, data: token };
  }

  return {
    ok: false,
    code: "TOKEN_NOT_FOUND",
    message: "USDC on celo not found in Paycrest tokens",
    httpStatus,
  };
}

/**
 * Live support probe: Celo USDC token + buy/sell quotes at amount "1".
 */
export async function getCorridorSupport(): Promise<
  PaycrestResult<{
    token: CeloUsdcToken;
    buy: CorridorQuote;
    sell: CorridorQuote;
  }>
> {
  const tokenResult = await getCeloUsdcToken();
  if (!tokenResult.ok) return tokenResult;

  const [buyResult, sellResult] = await Promise.all([
    getCorridorQuote("buy", "1"),
    getCorridorQuote("sell", "1"),
  ]);

  if (!buyResult.ok) return buyResult;
  if (!sellResult.ok) return sellResult;

  return {
    ok: true,
    data: {
      token: tokenResult.data,
      buy: buyResult.data,
      sell: sellResult.data,
    },
  };
}
