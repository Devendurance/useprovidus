/**
 * Safe extraction of Paycrest upstream error envelopes.
 * Never returns raw bodies, accounts, wallets, or secrets.
 */

import type { PaycrestErrorCode, SafeValidationDetail } from "@/lib/paycrest/types";

export type UpstreamEnvelopeShape =
  | "data_array"
  | "data_object"
  | "errors_array"
  | "error_object"
  | "error_string"
  | "details_array"
  | "details_object"
  | "message_only"
  | "plain_text"
  | "html_like"
  | "empty"
  | "malformed_json"
  | "unknown";

export type SafeUpstreamDiagnosis = {
  diagnosticId: string;
  httpStatus: number;
  contentType: string | null;
  envelopeShape: UpstreamEnvelopeShape;
  topLevelKeys: string[];
  message: string;
  code: PaycrestErrorCode;
  validationDetails: SafeValidationDetail[];
};

const MAX_DETAILS = 8;
const MAX_FIELD_LEN = 60;
const MAX_MSG_LEN = 120;
const MAX_TOP_MESSAGE = 160;

const ALLOWLISTED_VALIDATION_FIELDS = new Set([
  "amount",
  "amountIn",
  "source",
  "source.type",
  "source.currency",
  "source.network",
  "source.refundAddress",
  "destination",
  "destination.type",
  "destination.currency",
  "destination.recipient",
  "destination.recipient.institution",
  "destination.recipient.accountIdentifier",
  "destination.recipient.accountName",
  "destination.recipient.memo",
  "reference",
  "rate",
  "senderFee",
  "senderFeePercent",
  "token",
  "network",
  "currency",
  "recipient",
  "institution",
  "accountIdentifier",
  "accountName",
  "memo",
  "refundAddress",
  "returnAddress",
]);

export function newDiagnosticId(): string {
  const bytes = new Uint8Array(6);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { randomBytes } = require("node:crypto") as typeof import("node:crypto");
    const buf = randomBytes(6);
    for (let i = 0; i < 6; i++) bytes[i] = buf[i];
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `pc_${hex}`;
}

export function sanitizeValidationErrorString(str: string): string {
  if (!str) return "";
  return str
    .replace(/0x[a-fA-F0-9]{40}/gi, "[address]")
    .replace(/\b\d{10,12}\b/g, "[account]")
    .replace(/bearer\s+[^\s]+/gi, "[redacted]")
    .replace(/api[_-]?key\s*[:=]\s*[^\s,;]+/gi, "[redacted]")
    .replace(/authorization\s*[:=]\s*[^\s,;]+/gi, "[redacted]")
    .trim();
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeFieldName(raw: string): string {
  return raw
    .trim()
    .replace(/^body\./i, "")
    .replace(/^payload\./i, "")
    .replace(/\[(\d+)\]/g, ".$1");
}

function fieldAllowed(field: string): boolean {
  if (ALLOWLISTED_VALIDATION_FIELDS.has(field)) return true;
  // Allow dotted prefixes of known paths (e.g. destination.recipient.foo → no)
  for (const allowed of ALLOWLISTED_VALIDATION_FIELDS) {
    if (field === allowed || field.startsWith(`${allowed}.`)) {
      // only exact allowlist or known parent — still require full match on leaf allowlist
      if (ALLOWLISTED_VALIDATION_FIELDS.has(field)) return true;
    }
  }
  // Map common snake_case / alternate names
  const aliases: Record<string, string> = {
    account_identifier: "accountIdentifier",
    account_name: "accountName",
    refund_address: "refundAddress",
    return_address: "returnAddress",
    sender_fee: "senderFee",
    sender_fee_percent: "senderFeePercent",
    amount_in: "amountIn",
  };
  if (aliases[field] && ALLOWLISTED_VALIDATION_FIELDS.has(aliases[field])) {
    return true;
  }
  return ALLOWLISTED_VALIDATION_FIELDS.has(field);
}

function pushDetail(
  out: SafeValidationDetail[],
  fieldRaw: string | null,
  msgRaw: string | null,
): void {
  if (out.length >= MAX_DETAILS) return;
  if (!fieldRaw || !msgRaw) return;
  const field = normalizeFieldName(fieldRaw);
  if (!fieldAllowed(field)) return;
  const message = sanitizeValidationErrorString(msgRaw);
  if (!message) return;
  out.push({
    field: field.slice(0, MAX_FIELD_LEN),
    message: message.slice(0, MAX_MSG_LEN),
  });
}

function extractFromItem(item: unknown, out: SafeValidationDetail[]): void {
  if (!isRecord(item)) return;
  const field = asString(
    item.field ?? item.path ?? item.param ?? item.property ?? item.key ?? item.name,
  );
  const message = asString(
    item.message ?? item.error ?? item.msg ?? item.detail ?? item.description,
  );
  pushDetail(out, field, message);
}

function extractFromArray(arr: unknown[], out: SafeValidationDetail[]): void {
  for (const item of arr) {
    if (out.length >= MAX_DETAILS) break;
    extractFromItem(item, out);
  }
}

function extractFromObjectMap(
  obj: Record<string, unknown>,
  out: SafeValidationDetail[],
  prefix = "",
): void {
  for (const [key, value] of Object.entries(obj)) {
    if (out.length >= MAX_DETAILS) break;
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      pushDetail(out, path, value);
    } else if (Array.isArray(value)) {
      for (const v of value) {
        if (typeof v === "string") pushDetail(out, path, v);
        else extractFromItem(v, out);
      }
    } else if (isRecord(value)) {
      // nested validation object — only one level of free-form keys if parent is allowlisted path
      extractFromItem(value, out);
      if (fieldAllowed(path) || ALLOWLISTED_VALIDATION_FIELDS.has(key)) {
        extractFromObjectMap(value, out, path);
      }
    }
  }
}

export function detectEnvelopeShape(
  text: string,
  parsed: unknown | undefined,
  jsonOk: boolean,
): UpstreamEnvelopeShape {
  const trimmed = text.trim();
  if (trimmed === "") return "empty";
  if (!jsonOk) {
    if (/^\s*</.test(trimmed) || /<html/i.test(trimmed)) return "html_like";
    // Non-JSON body that looks like plain text (not `{`/`[`)
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return "plain_text";
    return "malformed_json";
  }
  if (!isRecord(parsed)) {
    if (typeof parsed === "string") return "plain_text";
    return "unknown";
  }
  const root = parsed;
  if (Array.isArray(root.data)) return "data_array";
  if (isRecord(root.data)) return "data_object";
  if (Array.isArray(root.errors)) return "errors_array";
  if (isRecord(root.error)) return "error_object";
  if (typeof root.error === "string") return "error_string";
  if (Array.isArray(root.details)) return "details_array";
  if (isRecord(root.details)) return "details_object";
  if (typeof root.message === "string") return "message_only";
  return "unknown";
}

export function parsePaycrestValidationDetails(
  json: unknown,
): SafeValidationDetail[] {
  const details: SafeValidationDetail[] = [];
  if (!isRecord(json)) return details;

  const root = json;

  if (Array.isArray(root.data)) extractFromArray(root.data, details);
  else if (isRecord(root.data)) {
    // data may be { field, message } or { errors: [] } or field map
    extractFromItem(root.data, details);
    if (Array.isArray(root.data.errors)) extractFromArray(root.data.errors, details);
    if (Array.isArray(root.data.details)) extractFromArray(root.data.details, details);
    if (isRecord(root.data.errors)) extractFromObjectMap(root.data.errors, details);
    // Only scan plain string maps under data when keys look like fields
    for (const [k, v] of Object.entries(root.data)) {
      if (k === "errors" || k === "details") continue;
      if (typeof v === "string") pushDetail(details, k, v);
      else if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
        for (const s of v) pushDetail(details, k, s);
      }
    }
  }

  if (Array.isArray(root.errors)) extractFromArray(root.errors, details);
  else if (isRecord(root.errors)) extractFromObjectMap(root.errors, details);

  if (Array.isArray(root.details)) extractFromArray(root.details, details);
  else if (isRecord(root.details)) extractFromObjectMap(root.details, details);

  if (isRecord(root.error)) extractFromItem(root.error, details);

  return details;
}

function topLevelKeys(parsed: unknown): string[] {
  if (!isRecord(parsed)) return [];
  return Object.keys(parsed).slice(0, 12);
}

function extractTopMessage(parsed: unknown, text: string): string {
  if (isRecord(parsed)) {
    const m =
      asString(parsed.message) ??
      (typeof parsed.error === "string" ? parsed.error : null) ??
      (isRecord(parsed.error) ? asString(parsed.error.message) : null);
    if (m) return sanitizeValidationErrorString(m).slice(0, MAX_TOP_MESSAGE);
  }
  if (typeof parsed === "string") {
    return sanitizeValidationErrorString(parsed).slice(0, MAX_TOP_MESSAGE);
  }
  const t = text.trim();
  if (t && t.length < 200 && !t.startsWith("{") && !t.startsWith("<")) {
    return sanitizeValidationErrorString(t).slice(0, MAX_TOP_MESSAGE);
  }
  return "";
}

/**
 * Classify upstream HTTP failure into a safe local code + optional field details.
 * Structured validation never becomes UPSTREAM_ERROR.
 */
export function classifyUpstreamOrderFailure(input: {
  httpStatus: number;
  contentType: string | null;
  bodyText: string;
  diagnosticId?: string;
}): SafeUpstreamDiagnosis {
  const diagnosticId = input.diagnosticId ?? newDiagnosticId();
  const text = input.bodyText ?? "";
  let parsed: unknown;
  let jsonOk = false;
  if (text.trim() !== "") {
    try {
      parsed = JSON.parse(text) as unknown;
      jsonOk = true;
    } catch {
      jsonOk = false;
    }
  }

  const envelopeShape = detectEnvelopeShape(text, parsed, jsonOk);
  const keys = topLevelKeys(parsed);
  const validationDetails = jsonOk ? parsePaycrestValidationDetails(parsed) : [];
  const rawMessage = extractTopMessage(parsed, text);
  const status = input.httpStatus;

  if (status === 401 || status === 403) {
    return {
      diagnosticId,
      httpStatus: status,
      contentType: input.contentType,
      envelopeShape,
      topLevelKeys: keys,
      message: "Paycrest authentication failed",
      code: "AUTH_FAILED",
      validationDetails: [],
    };
  }

  if (status === 429) {
    return {
      diagnosticId,
      httpStatus: status,
      contentType: input.contentType,
      envelopeShape,
      topLevelKeys: keys,
      message: "Paycrest rate limited",
      code: "UPSTREAM_ERROR",
      validationDetails: [],
    };
  }

  if (status === 503) {
    return {
      diagnosticId,
      httpStatus: status,
      contentType: input.contentType,
      envelopeShape,
      topLevelKeys: keys,
      message: rawMessage || "Paycrest temporarily unavailable",
      code: "UPSTREAM_UNAVAILABLE",
      validationDetails: [],
    };
  }

  if (status === 500 || status >= 502) {
    return {
      diagnosticId,
      httpStatus: status,
      contentType: input.contentType,
      envelopeShape,
      topLevelKeys: keys,
      message: rawMessage || `Paycrest returned HTTP ${status}`,
      code: "UPSTREAM_ERROR",
      validationDetails: [],
    };
  }

  // 400 / 422 / 404 / 409 and other client-ish rejections
  if (status === 400 || status === 422) {
    if (validationDetails.length > 0) {
      return {
        diagnosticId,
        httpStatus: status,
        contentType: input.contentType,
        envelopeShape,
        topLevelKeys: keys,
        message: rawMessage || "Failed to validate payload",
        code: "PAYCREST_VALIDATION_FAILED",
        validationDetails,
      };
    }
    return {
      diagnosticId,
      httpStatus: status,
      contentType: input.contentType,
      envelopeShape,
      topLevelKeys: keys,
      message:
        rawMessage ||
        "Paycrest rejected the request without returning a safe field-level reason",
      code: "PAYCREST_ORDER_REJECTED",
      validationDetails: [],
    };
  }

  if (status === 404 || status === 409) {
    return {
      diagnosticId,
      httpStatus: status,
      contentType: input.contentType,
      envelopeShape,
      topLevelKeys: keys,
      message: rawMessage || `Paycrest rejected order (HTTP ${status})`,
      code: "PAYCREST_ORDER_REJECTED",
      validationDetails: [],
    };
  }

  // Unusable JSON on unexpected status
  if (!jsonOk && text.trim() !== "") {
    return {
      diagnosticId,
      httpStatus: status,
      contentType: input.contentType,
      envelopeShape,
      topLevelKeys: keys,
      message: "Upstream response was not usable JSON",
      code: "UPSTREAM_ERROR",
      validationDetails: [],
    };
  }

  return {
    diagnosticId,
    httpStatus: status,
    contentType: input.contentType,
    envelopeShape,
    topLevelKeys: keys,
    message: rawMessage || `Paycrest returned HTTP ${status}`,
    code: "UPSTREAM_ERROR",
    validationDetails: [],
  };
}

/** Dev-only safe log line — never includes PII values. */
export function formatSafeOrderDiagnosticLog(input: {
  diagnosticId: string;
  origin: string;
  pathname: string;
  httpStatus: number;
  contentType: string | null;
  envelopeShape: UpstreamEnvelopeShape;
  topLevelKeys: string[];
  reference: string;
  payloadFields: { path: string; present: boolean; jsonType: string }[];
  code: string;
}): string {
  return JSON.stringify({
    tag: "paycrest_order_diag",
    diagnosticId: input.diagnosticId,
    origin: input.origin,
    pathname: input.pathname,
    httpStatus: input.httpStatus,
    contentType: input.contentType,
    envelopeShape: input.envelopeShape,
    topLevelKeys: input.topLevelKeys,
    reference: input.reference,
    code: input.code,
    payloadFields: input.payloadFields,
  });
}

export function isPaycrestDiagnosticsEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.PAYCREST_SAFE_DIAGNOSTICS === "1"
  );
}
