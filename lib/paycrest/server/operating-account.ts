/**
 * Server-only operating settlement account.
 *
 * Every airtime payment is offramped into Providus's own operating bank
 * account, and the utility purchase settles downstream against it. The account
 * is therefore read exclusively from the server environment: it is never
 * accepted from a request, never defaulted to a development value, and never
 * returned to the browser. Only the derived Paycrest payload leaves the server.
 *
 * Values are re-read at call time, so a deployment can rotate the account
 * without a code change. Missing or unusable configuration fails closed before
 * any Paycrest order can be attempted, and no error message ever repeats an
 * environment value.
 */

import "server-only";

import { validateNgnAccountIdentifier } from "@/lib/paycrest/recipient";

/** Stable failure contract: the caller must not attempt a Paycrest order. */
export const SETTLEMENT_CONFIG_MISSING = "SETTLEMENT_CONFIG_MISSING" as const;

export const SETTLEMENT_CONFIG_MISSING_MESSAGE =
  "Operating settlement account is not configured";

/** Memo sent to Paycrest when the deployment does not override it. */
export const DEFAULT_SETTLEMENT_MEMO = "Providus utility settlement";

export interface OperatingSettlementAccount {
  institutionCode: string;
  accountNumber: string;
  accountName: string;
  memo: string;
}

export type OperatingSettlementAccountResult =
  | { ok: true; data: OperatingSettlementAccount }
  | { ok: false; code: typeof SETTLEMENT_CONFIG_MISSING; message: string };

function missing(): OperatingSettlementAccountResult {
  return {
    ok: false,
    code: SETTLEMENT_CONFIG_MISSING,
    message: SETTLEMENT_CONFIG_MISSING_MESSAGE,
  };
}

function readEnv(name: string): string {
  const raw = process.env[name];
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Loads and validates the operating settlement account, or fails closed.
 *
 * Required: a non-empty institution code, a 10-digit NGN account number, and a
 * non-empty account name. The memo defaults to `DEFAULT_SETTLEMENT_MEMO`.
 */
export function getOperatingSettlementAccount(): OperatingSettlementAccountResult {
  const institutionCode = readEnv("PROVIDUS_SETTLEMENT_INSTITUTION_CODE");
  if (institutionCode === "") return missing();

  const accountCheck = validateNgnAccountIdentifier(
    readEnv("PROVIDUS_SETTLEMENT_ACCOUNT_NUMBER"),
  );
  if (!accountCheck.ok) return missing();

  const accountName = readEnv("PROVIDUS_SETTLEMENT_ACCOUNT_NAME");
  if (accountName === "") return missing();

  const memo = readEnv("PROVIDUS_SETTLEMENT_MEMO") || DEFAULT_SETTLEMENT_MEMO;

  return {
    ok: true,
    data: {
      institutionCode,
      accountNumber: accountCheck.data,
      accountName,
      memo,
    },
  };
}
