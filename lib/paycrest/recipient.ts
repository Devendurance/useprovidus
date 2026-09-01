/**
 * Pure NGN recipient helpers — no secrets, no network I/O.
 * Safe for client and server unit tests.
 */

import type { InstitutionSummary } from "@/lib/paycrest/types";

/** Nigerian NUBAN account numbers are exactly 10 ASCII digits. */
export const NGN_ACCOUNT_DIGITS = 10;

export type AccountValidation =
  | { ok: true; data: string }
  | { ok: false; code: "INVALID_ACCOUNT_IDENTIFIER"; message: string };

export type InstitutionValidation =
  | { ok: true; data: InstitutionSummary }
  | { ok: false; code: "INVALID_INSTITUTION"; message: string };

/**
 * Institution types treated as Nigerian bank payout targets for this scope.
 * Unknown/null types are excluded when stricter filtering is enabled.
 */
export const NGN_BANK_INSTITUTION_TYPES = new Set([
  "bank",
  "nuban",
  "commercial",
  "commercial_bank",
  "microfinance",
  "mfb",
]);

/**
 * Filter live Paycrest institutions to bank-like NGN payout targets.
 * If no items have a type field, keep all (Paycrest sometimes omits type).
 */
export function filterNgnBankInstitutions(
  institutions: InstitutionSummary[],
): InstitutionSummary[] {
  if (institutions.length === 0) return [];

  const withType = institutions.filter(
    (i) => i.type != null && String(i.type).trim() !== "",
  );

  if (withType.length === 0) {
    // No type metadata — return all, sorted by name
    return sortInstitutionsByName(institutions);
  }

  const filtered = institutions.filter((i) => {
    if (i.type == null || String(i.type).trim() === "") return false;
    const t = String(i.type).toLowerCase().trim();
    return NGN_BANK_INSTITUTION_TYPES.has(t) || t.includes("bank");
  });

  return sortInstitutionsByName(filtered.length > 0 ? filtered : institutions);
}

export function sortInstitutionsByName(
  institutions: InstitutionSummary[],
): InstitutionSummary[] {
  return [...institutions].sort((a, b) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
  );
}

export function validateNgnAccountIdentifier(
  raw: string,
): AccountValidation {
  if (typeof raw !== "string") {
    return {
      ok: false,
      code: "INVALID_ACCOUNT_IDENTIFIER",
      message: "Account number must be a string",
    };
  }
  const trimmed = raw.trim();
  if (!/^\d{10}$/.test(trimmed)) {
    return {
      ok: false,
      code: "INVALID_ACCOUNT_IDENTIFIER",
      message: "Enter exactly 10 digits (Nigerian bank account number)",
    };
  }
  return { ok: true, data: trimmed };
}

/**
 * Mask account for display: ******7890
 * Full number never returned from this helper after masking.
 */
export function maskAccountIdentifier(accountIdentifier: string): string {
  const digits = accountIdentifier.trim();
  if (digits.length < 4) return "****";
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

export function findInstitutionByCode(
  institutions: InstitutionSummary[],
  code: string,
): InstitutionSummary | undefined {
  const c = code.trim();
  return institutions.find((i) => i.code === c);
}

export function validateInstitutionCode(
  code: string,
  allowed: InstitutionSummary[],
): InstitutionValidation {
  if (typeof code !== "string" || code.trim() === "") {
    return {
      ok: false,
      code: "INVALID_INSTITUTION",
      message: "Select a bank",
    };
  }
  if (code.length > 64) {
    return {
      ok: false,
      code: "INVALID_INSTITUTION",
      message: "Invalid bank selection",
    };
  }
  const found = findInstitutionByCode(allowed, code);
  if (!found) {
    return {
      ok: false,
      code: "INVALID_INSTITUTION",
      message: "Selected bank is not in the live NGN institution list",
    };
  }
  return { ok: true, data: found };
}

/** Recipient verification is bound to exact institution + account pair. */
export type VerifiedRecipientBinding = {
  institution: string;
  accountIdentifier: string;
  accountName: string;
  institutionName: string;
  verifiedAt: string;
};

export function isVerificationBoundToSelection(
  verified: VerifiedRecipientBinding | null,
  institution: string,
  accountIdentifier: string,
): boolean {
  if (!verified) return false;
  return (
    verified.institution === institution.trim() &&
    verified.accountIdentifier === accountIdentifier.trim()
  );
}

/** Providus quote freshness policy (not a Paycrest guarantee). */
export const PROVIDUS_QUOTE_FRESHNESS_MS = 60_000;

export function isQuoteFresh(
  checkedAtIso: string,
  nowMs: number = Date.now(),
  maxAgeMs: number = PROVIDUS_QUOTE_FRESHNESS_MS,
): boolean {
  const t = Date.parse(checkedAtIso);
  if (Number.isNaN(t)) return false;
  return nowMs - t <= maxAgeMs;
}

export type CashOutReviewReadiness = {
  ready: boolean;
  reasons: string[];
};

export function evaluateCashOutReviewReadiness(input: {
  directionIsCashOut: boolean;
  walletReady: boolean;
  tokenCompatible: boolean;
  amountValid: boolean;
  quoteAvailable: boolean;
  quoteCheckedAt: string | null;
  balanceLoaded: boolean;
  balanceSufficient: boolean;
  institutionSelected: boolean;
  verificationBound: boolean;
  pendingRequest: boolean;
  quoteFresh: boolean;
}): CashOutReviewReadiness {
  const reasons: string[] = [];
  if (!input.directionIsCashOut) reasons.push("DIRECTION");
  if (!input.walletReady) reasons.push("WALLET");
  if (!input.tokenCompatible) reasons.push("TOKEN_MISMATCH");
  if (!input.amountValid) reasons.push("AMOUNT");
  if (!input.quoteAvailable) reasons.push("QUOTE_UNAVAILABLE");
  if (!input.quoteFresh) reasons.push("QUOTE_STALE");
  if (!input.balanceLoaded) reasons.push("BALANCE_UNLOADED");
  if (!input.balanceSufficient) reasons.push("INSUFFICIENT_BALANCE");
  if (!input.institutionSelected) reasons.push("INSTITUTION");
  if (!input.verificationBound) reasons.push("VERIFICATION");
  if (input.pendingRequest) reasons.push("PENDING");
  return { ready: reasons.length === 0, reasons };
}
