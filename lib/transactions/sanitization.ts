const SENSITIVE_PATTERNS = [
  /api[-_]?key[=:\s]+["']?([a-zA-Z0-9_\-.]+)["']?/gi,
  /secret[=:\s]+["']?([a-zA-Z0-9_\-.]+)["']?/gi,
  /bearer\s+([a-zA-Z0-9_\-.]+)/gi,
  /password[=:\s]+["']?([^"'\s]+)["']?/gi,
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
