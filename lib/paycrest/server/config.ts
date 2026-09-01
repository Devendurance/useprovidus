/**
 * Server-only Paycrest configuration.
 * Import only from server modules (route handlers, server libs). Never import from client components.
 */

import type { PaycrestResult } from "@/lib/paycrest/types";

const DEFAULT_BASE_URL = "https://api.paycrest.io/v2";

export type PaycrestConfig = {
  apiKey: string;
  baseUrl: string;
};

/**
 * Resolves full Paycrest API endpoint URL.
 * Guarantees outgoing URL resolves exactly once to target path, e.g. https://api.paycrest.io/v2/sender/orders.
 * Prevents double /v2/v2 or missing /v2.
 */
export function resolvePaycrestUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;

  if (base.endsWith("/v2") && p.startsWith("/v2/")) {
    return `${base.slice(0, -3)}${p}`;
  }
  if (!/\/v2(\/|$)/i.test(base) && !p.startsWith("/v2/")) {
    return `${base}/v2${p}`;
  }
  return `${base}${p}`;
}

/**
 * Reads and validates Paycrest env at call time.
 * Never includes the raw key in error messages.
 */
export function getPaycrestConfig(): PaycrestResult<PaycrestConfig> {
  const rawKey = process.env.PAYCREST_API_KEY;
  const rawBase = process.env.PAYCREST_BASE_URL;

  if (rawKey === undefined || rawKey.trim() === "") {
    return {
      ok: false,
      code: "MISSING_CONFIG",
      message: "Paycrest API key is not configured",
    };
  }

  const baseUrl =
    rawBase === undefined || rawBase.trim() === ""
      ? DEFAULT_BASE_URL
      : rawBase.trim().replace(/\/+$/, "");

  if (!/^https:\/\//i.test(baseUrl)) {
    return {
      ok: false,
      code: "MISSING_CONFIG",
      message: "Paycrest base URL must be an https URL",
    };
  }

  return {
    ok: true,
    data: {
      apiKey: rawKey.trim(),
      baseUrl,
    },
  };
}
