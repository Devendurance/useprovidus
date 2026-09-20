/**
 * Credential-bearing `key=value` pairs and query parameters. The key name is
 * matched case-insensitively (including the compound forms `secret_key`,
 * `privateKey`, `access_key`, `authKey`), `=` or `:` may separate it from the
 * value, and the value runs until a query separator or whitespace — so
 * `UserID=...`, `APIKey=...`, `token=...`, `auth=...`, `secret=...`,
 * `password=...`, and a plain `key=...` can never survive into persisted or
 * public text.
 */
const CREDENTIAL_PAIR_PATTERN =
  /\b(?:api[-_]?key|(?:secret|private|access|auth)[-_]?key|user_?id|auth(?:orization)?|token|key|secret|password)\s*[=:]\s*["']?[^&\s"']+["']?/gi;

/**
 * The whitespace-separated form (`password hunter2`) for exactly the key names
 * this module already redacted before the `key=value` rule existed. Deliberately
 * narrow: a bare `key`/`token` followed by prose must not be mangled.
 */
const LEGACY_CREDENTIAL_PATTERN =
  /\b(?:api[-_]?key|secret|password)\s+["']?([a-zA-Z0-9_\-.]+)["']?/gi;

const SENSITIVE_PATTERNS = [
  CREDENTIAL_PAIR_PATTERN,
  LEGACY_CREDENTIAL_PATTERN,
  /bearer\s+([a-zA-Z0-9_\-.]+)/gi,
  /0x[a-fA-F0-9]{64}/g, // private keys or 32-byte hashes
  /https?:\/\/[^\s:]+:[^\s@]+@/gi, // URLs with user:password credentials
];

const MAX_REASON_LENGTH = 256;

/**
 * Sanitizes an error message or failure reason before storing in the database.
 * Removes sensitive tokens, credentials, stack traces, and bounds length.
 */
export function sanitizeFailureReason(
  reason?: string | null,
): string | null {
  if (!reason || typeof reason !== "string") {
    return null;
  }

  let cleaned = reason.trim();
  if (!cleaned) return null;

  // Mask sensitive patterns
  for (const pattern of SENSITIVE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "[REDACTED]");
  }

  // Strip stack trace artifacts
  const firstLine = cleaned.split("\n")[0]?.trim() ?? "";
  cleaned = firstLine || cleaned;

  // Bound length
  if (cleaned.length > MAX_REASON_LENGTH) {
    cleaned = cleaned.slice(0, MAX_REASON_LENGTH - 3) + "...";
  }

  return cleaned;
}
