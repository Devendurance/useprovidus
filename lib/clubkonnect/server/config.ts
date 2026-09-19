/**
 * Server-only ClubKonnect configuration and URL redaction.
 * Import ONLY from server modules. Never import from client components.
 */

import "server-only";

import type { ClubKonnectConfig, ClubKonnectResult } from "@/lib/clubkonnect/types";

export const DEFAULT_CLUBKONNECT_BASE_URL = "https://www.nellobytesystems.com";

/**
 * Reads and validates ClubKonnect configuration from environment at runtime.
 * Fails closed if credentials are missing or invalid.
 * Never prints or leaks credentials in returned error messages.
 */
export function getClubKonnectConfig(): ClubKonnectResult<ClubKonnectConfig> {
  const userId = process.env.CLUBKONNECT_USER_ID;
  const apiKey = process.env.CLUBKONNECT_API_KEY;
  const rawBase = process.env.CLUBKONNECT_BASE_URL;

  if (!userId || userId.trim() === "") {
    return {
      ok: false,
      code: "MISSING_CONFIG",
      message: "ClubKonnect User ID is not configured",
    };
  }

  if (!apiKey || apiKey.trim() === "") {
    return {
      ok: false,
      code: "MISSING_CONFIG",
      message: "ClubKonnect API Key is not configured",
    };
  }

  const rawClean =
    rawBase && rawBase.trim() !== "" ? rawBase.trim() : DEFAULT_CLUBKONNECT_BASE_URL;

  if (!/^https:\/\//i.test(rawClean)) {
    return {
      ok: false,
      code: "MISSING_CONFIG",
      message: "ClubKonnect base URL must be an https URL",
    };
  }

  let baseUrl: string;
  try {
    const parsed = new URL(rawClean);
    if (parsed.search || parsed.hash) {
      return {
        ok: false,
        code: "MISSING_CONFIG",
        message: "ClubKonnect base URL must not contain query parameters or fragments",
      };
    }
    baseUrl = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
  } catch {
    return {
      ok: false,
      code: "MISSING_CONFIG",
      message: "Invalid ClubKonnect base URL format",
    };
  }

  return {
    ok: true,
    data: {
      userId: userId.trim(),
      apiKey: apiKey.trim(),
      baseUrl,
    },
  };
}

/** Marker substituted for redacted credential values. */
const REDACTED_VALUE = "[REDACTED]";

/**
 * Query parameter keys whose values are credentials. Compared case-insensitively
 * because ClubKonnect itself sends mixed-case keys (`UserID`, `APIKey`).
 */
const SENSITIVE_QUERY_KEYS: Record<string, true> = {
  userid: true,
  user_id: true,
  apikey: true,
  api_key: true,
  "x-api-key": true,
  secret: true,
  token: true,
  password: true,
  authorization: true,
};

/** Query parameter keys whose values are masked rather than fully redacted. */
const PHONE_QUERY_KEYS: Record<string, true> = { mobilenumber: true, phone: true };

/** Matches `key=value` / `key: value` credential pairs embedded inside free-form strings. */
const EMBEDDED_SENSITIVE_PATTERN =
  /\b(api[_-]?key|x-api-key|user[_-]?id|secret|token|password|authorization)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^&\s,;)\]}]+)/gi;

/** Matches a value that must be treated as a URL before redaction. */
const URL_LIKE_PATTERN = /^(?:https?:\/\/|\/\/)/i;

/** Matches a value that carries query parameters even when it is not an absolute URL. */
const QUERY_PARAM_PATTERN = /[?&][^=&\s]+=/;

/** Matches absolute or protocol-relative URL substrings anywhere inside a string. */
const URL_SUBSTRING_PATTERN = /(?:https?:)?\/\/[^\s"'<>]+/gi;

/**
 * Redacts credentials from a single string value. Absolute and protocol-relative
 * URL substrings are redacted wherever they appear (userinfo and query credentials),
 * free-form query pairs are redacted through the URL fallback, and embedded
 * `apiKey=...` / `token: ...` pairs are redacted last.
 * Exported so provider-message sanitization shares exactly one redaction contract.
 */
export function redactClubKonnectString(value: string): string {
  const urlSafe = value.replace(URL_SUBSTRING_PATTERN, (url) => redactClubKonnectUrl(url));
  const shouldRedactAsUrl = URL_LIKE_PATTERN.test(urlSafe) || QUERY_PARAM_PATTERN.test(urlSafe);
  const fullyRedacted = shouldRedactAsUrl ? redactClubKonnectUrl(urlSafe) : urlSafe;
  return fullyRedacted.replace(
    EMBEDDED_SENSITIVE_PATTERN,
    (_match, key: string, separator: string) => `${key}${separator}${REDACTED_VALUE}`,
  );
}

/**
 * Strict URL and query string redaction.
 * Clears userinfo, removes UserID / APIKey / token style query values, and masks
 * phone numbers / account identifiers. Never throws; unknown inputs fall back to
 * case-insensitive regex redaction.
 */
export function redactClubKonnectUrl(rawUrl: string | URL): string {
  const asString = typeof rawUrl === "string" ? rawUrl : rawUrl.toString();

  try {
    const urlObj = new URL(asString);

    // Userinfo credentials (`https://user:pass@host/...`) must never be logged.
    if (urlObj.username !== "") urlObj.username = "";
    if (urlObj.password !== "") urlObj.password = "";

    for (const key of Array.from(urlObj.searchParams.keys())) {
      const lower = key.toLowerCase();
      if (SENSITIVE_QUERY_KEYS[lower]) {
        urlObj.searchParams.set(key, REDACTED_VALUE);
      } else if (PHONE_QUERY_KEYS[lower]) {
        urlObj.searchParams.set(key, maskPhoneNumber(urlObj.searchParams.get(key) ?? ""));
      }
    }

    return urlObj.toString();
  } catch {
    // Fallback for inputs `new URL` rejects (relative / protocol-relative strings):
    // case-insensitive redaction of userinfo and credential query parameters.
    return asString
      .replace(/((?:[a-z][a-z0-9+.-]*:)?\/\/)[^/?#@\s]*@/gi, "$1")
      .replace(
        /([?&](?:user_?id|api[_-]?key|x-api-key|secret|token|password|authorization)=)[^&\s]*/gi,
        `$1${REDACTED_VALUE}`,
      )
      .replace(/([?&](?:mobilenumber|phone)=)([^&\s]+)/gi, (_match, prefix: string, num: string) => {
        return `${prefix}${maskPhoneNumber(num)}`;
      });
  }
}

/**
 * Mask sensitive phone number: e.g. 08031234567 -> 0803***4567
 */
export function maskPhoneNumber(phone: string): string {
  const clean = phone.trim();
  if (clean.length < 7) {
    return "[REDACTED_PHONE]";
  }
  return `${clean.slice(0, 4)}***${clean.slice(-4)}`;
}

/**
 * Redacts any arbitrary record or object before logging.
 * Recursively handles nested objects and arrays, redacting keys, tokens, passwords, and phone numbers.
 */
export function redactClubKonnectObject<T>(val: T): T {
  if (val === null || val === undefined) return val;
  if (typeof val === "string") return redactClubKonnectString(val) as unknown as T;
  if (typeof val === "number" || typeof val === "boolean") return val;

  if (Array.isArray(val)) {
    return val.map((item) => redactClubKonnectObject(item)) as unknown as T;
  }
  if (typeof val === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(val as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (
        lower.includes("apikey") ||
        lower.includes("api_key") ||
        lower.includes("api-key") ||
        lower.includes("secret") ||
        lower.includes("token") ||
        lower.includes("password") ||
        lower.includes("authorization")
      ) {
        result[key] = REDACTED_VALUE;
      } else if (lower.includes("userid") || lower.includes("user_id")) {
        result[key] = REDACTED_VALUE;
      } else if (lower.includes("phone") || lower.includes("mobilenumber")) {
        result[key] = typeof value === "string" ? maskPhoneNumber(value) : "[REDACTED_PHONE]";
      } else {
        result[key] = redactClubKonnectObject(value);
      }
    }
    return result as unknown as T;
  }

  return val;
}
