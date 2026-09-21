/**
 * Pure order helpers — reference generation, fee totals, response validation.
 * No network I/O. Safe for client and server tests.
 */

import { getAddress, isAddress, type Address } from "viem";
import {
  decimalStringsEqual,
  isNonNegativeUsdcDecimal,
  sumDecimalStrings,
  usdcToBaseUnits,
} from "@/lib/money/decimal";
import { validateUsdcAmount } from "@/lib/money/usdc-amount";
import { CANONICAL_CELO_USDC } from "@/lib/celo/usdc";
import type { CorridorToken } from "@/lib/paycrest/types";

/** Providus safety margin before Paycrest validUntil (ms). */
export const PAYMENT_EXPIRY_SAFETY_MS = 60_000;
export const CELO_GAS_SAFETY_BUFFER_MULTIPLIER = BigInt(125);

export type NormalizedProviderAccount = {
  network: "celo";
  receiveAddress: Address;
  validUntil: string;
};

export type NormalizedOrderRecipient = {
  institution: string;
  institutionName: string;
  accountIdentifierMasked: string;
  accountName: string;
};

export type NormalizedCashOutOrder = {
  id: string;
  reference: string;
  status: string;
  amount: string;
  /** Crypto asset for `amount`/`totalUsdcToSend`; absent = legacy USDC. */
  currency?: CorridorToken;
  rate: string | null;
  senderFee: string;
  transactionFee: string;
  totalUsdcToSend: string;
  providerAccount: NormalizedProviderAccount;
  recipient: NormalizedOrderRecipient;
  refundAddress: Address;
  createdAt: string;
};

export type OrderNormalizeResult =
  | { ok: true; order: NormalizedCashOutOrder }
  | { ok: false; code: "ORDER_RESPONSE_UNSAFE"; message: string };

/**
 * Non-sensitive unique reference. No wallet, account, amount, or PII.
 */
export function generateOrderReference(): string {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Node fallback
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { randomBytes } = require("node:crypto") as typeof import("node:crypto");
    const buf = randomBytes(12);
    for (let i = 0; i < 12; i++) bytes[i] = buf[i];
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `p4b_${hex}`;
}

export function computeTotalUsdcToSend(
  amount: string,
  senderFee: string,
  transactionFee: string,
): string {
  return sumDecimalStrings(amount, senderFee, transactionFee);
}

export function calculateMaxCeloGasFee(gasEstimate: bigint, maxFeePerGas: bigint): bigint {
  const gasNeeded = gasEstimate * maxFeePerGas;
  return (gasNeeded * CELO_GAS_SAFETY_BUFFER_MULTIPLIER) / BigInt(100);
}

export function canCoverCeloGas(
  nativeBalance: bigint | null,
  gasNeededWithBuffer: bigint
): { canCover: boolean; reason: string | null } {
  if (nativeBalance === null) {
    return { canCover: false, reason: "BALANCE_UNLOADED" };
  }
  if (nativeBalance < gasNeededWithBuffer) {
    return { canCover: false, reason: "INSUFFICIENT_CELO_GAS" };
  }
  return { canCover: true, reason: null };
}

export function namesMatchMaterially(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();
  return norm(a) === norm(b);
}

export function isPaymentWindowOpen(
  validUntilIso: string,
  nowMs: number = Date.now(),
  safetyMs: number = PAYMENT_EXPIRY_SAFETY_MS,
): { open: boolean; reason: string | null; msRemaining: number | null } {
  const t = Date.parse(validUntilIso);
  if (Number.isNaN(t)) {
    return { open: false, reason: "INVALID_EXPIRY", msRemaining: null };
  }
  const msRemaining = t - nowMs;
  if (msRemaining <= 0) {
    return { open: false, reason: "EXPIRED", msRemaining: 0 };
  }
  if (msRemaining <= safetyMs) {
    return { open: false, reason: "SAFETY_MARGIN", msRemaining };
  }
  return { open: true, reason: null, msRemaining };
}

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function dig(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (k in obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

/**
 * Normalize and validate a raw Paycrest create-order response for payment.
 */
export function normalizeCashOutOrderResponse(
  raw: unknown,
  expected: {
    amount: string;
    refundAddress: string;
    institution: string;
    institutionName: string;
    accountName: string;
    accountIdentifierMasked: string;
    reference: string;
    /** Asset expected from the frozen preview; absent = USDC. */
    currency?: CorridorToken;
  },
): OrderNormalizeResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      code: "ORDER_RESPONSE_UNSAFE",
      message: "Order response is not an object",
    };
  }

  const root = raw as Record<string, unknown>;
  const data =
    root.data && typeof root.data === "object" && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : root;

  const id =
    asString(dig(data, "id", "orderId", "order_id")) ??
    asString(dig(root, "id"));
  if (!id) {
    return {
      ok: false,
      code: "ORDER_RESPONSE_UNSAFE",
      message: "Missing order id",
    };
  }

  const status =
    asString(dig(data, "status", "orderStatus")) ?? "initiated";

  const amountRaw = dig(data, "amount", "receiveAmount", "cryptoAmount");
  if (amountRaw === undefined || amountRaw === null) {
    return {
      ok: false,
      code: "ORDER_RESPONSE_UNSAFE",
      message: "Missing required amount",
    };
  }
  const amount = asString(amountRaw);
  if (!amount) {
    return {
      ok: false,
      code: "ORDER_RESPONSE_UNSAFE",
      message: "Missing required amount",
    };
  }
  const amountCheck = validateUsdcAmount(amount);
  if (!amountCheck.ok) {
    return {
      ok: false,
      code: "ORDER_RESPONSE_UNSAFE",
      message: amountCheck.message,
    };
  }

  if (!decimalStringsEqual(amount, expected.amount)) {
    return {
      ok: false,
      code: "ORDER_RESPONSE_UNSAFE",
      message: `Order amount mismatch (returned ${amount}, expected ${expected.amount})`,
    };
  }

  const senderFeeRaw = dig(data, "senderFee", "sender_fee");
  const transactionFeeRaw = dig(data, "transactionFee", "transaction_fee", "networkFee");

  if (senderFeeRaw === undefined || senderFeeRaw === null || transactionFeeRaw === undefined || transactionFeeRaw === null) {
    return {
      ok: false,
      code: "ORDER_RESPONSE_UNSAFE",
      message: "Missing required senderFee or transactionFee",
    };
  }

  const senderFee = asString(senderFeeRaw);
  const transactionFee = asString(transactionFeeRaw);

  if (senderFee === null || transactionFee === null) {
    return {
      ok: false,
      code: "ORDER_RESPONSE_UNSAFE",
      message: "Missing required senderFee or transactionFee",
    };
  }

  if (!isNonNegativeUsdcDecimal(senderFee, 6)) {
    return {
      ok: false,
      code: "ORDER_RESPONSE_UNSAFE",
      message: "Invalid senderFee",
    };
  }
  if (!isNonNegativeUsdcDecimal(transactionFee, 6)) {
    return {
      ok: false,
      code: "ORDER_RESPONSE_UNSAFE",
      message: "Invalid transactionFee",
    };
  }

  let totalUsdcToSend: string;
  try {
    totalUsdcToSend = computeTotalUsdcToSend(amount, senderFee, transactionFee);
  } catch {
    return {
      ok: false,
      code: "ORDER_RESPONSE_UNSAFE",
      message: "Could not compute total USDC",
    };
  }

  const rate = asString(dig(data, "rate", "exchangeRate", "fxRate"));

  let providerRaw = dig(data, "providerAccount", "provider_account", "receive");
  if (!providerRaw || typeof providerRaw !== "object") {
    providerRaw = {
      receiveAddress: dig(data, "receiveAddress", "receive_address", "address"),
      validUntil: dig(data, "validUntil", "valid_until", "expiresAt", "expiry"),
      network: dig(data, "network"),
    };
  }
  const prov = providerRaw as Record<string, unknown>;
  const receiveRaw = asString(
    dig(prov, "receiveAddress", "receive_address", "address", "accountNumber"),
  );
  const validUntil = asString(
    dig(prov, "validUntil", "valid_until", "expiresAt", "expiry"),
  );
  const networkRaw = asString(dig(prov, "network", "chain")) ?? "celo";

  if (!receiveRaw || !isAddress(receiveRaw)) {
    return {
      ok: false,
      code: "ORDER_RESPONSE_UNSAFE",
      message: "Missing or invalid receiveAddress",
    };
  }
  if (!validUntil || Number.isNaN(Date.parse(validUntil))) {
    return {
      ok: false,
      code: "ORDER_RESPONSE_UNSAFE",
      message: "Missing or invalid validUntil",
    };
  }
  if (Date.parse(validUntil) <= Date.now()) {
    return {
      ok: false,
      code: "ORDER_RESPONSE_UNSAFE",
      message: "validUntil is not in the future",
    };
  }
  if (networkRaw.toLowerCase() !== "celo") {
    return {
      ok: false,
      code: "ORDER_RESPONSE_UNSAFE",
      message: "Unexpected provider network",
    };
  }

  if (!isAddress(expected.refundAddress)) {
    return {
      ok: false,
      code: "ORDER_RESPONSE_UNSAFE",
      message: "Invalid refund address",
    };
  }

  const expectedCurrency: CorridorToken = expected.currency ?? "USDC";
  const reportedCurrency = asString(
    dig(data, "token", "currency", "cryptoCurrency", "fromCurrency"),
  );
  if (
    reportedCurrency &&
    reportedCurrency.toUpperCase() !== expectedCurrency.toUpperCase()
  ) {
    return {
      ok: false,
      code: "ORDER_RESPONSE_UNSAFE",
      message: "Unexpected order currency",
    };
  }

  const createdAt = new Date().toISOString();

  return {
    ok: true,
    order: {
      id,
      reference: expected.reference,
      status,
      amount,
      // Additive-optional like every other asset field: absent is the legacy
      // USDC default, so a USDC order keeps its exact normalized shape and the
      // cash-out API response is unchanged. Only a non-USDC order states it.
      ...(expectedCurrency === "USDC" ? {} : { currency: expectedCurrency }),
      rate,
      senderFee,
      transactionFee,
      totalUsdcToSend,
      providerAccount: {
        network: "celo",
        receiveAddress: getAddress(receiveRaw),
        validUntil,
      },
      recipient: {
        institution: expected.institution,
        institutionName: expected.institutionName,
        accountIdentifierMasked: expected.accountIdentifierMasked,
        accountName: expected.accountName,
      },
      refundAddress: getAddress(expected.refundAddress),
      createdAt,
    },
  };
}

export function canPayOrder(input: {
  order: NormalizedCashOutOrder | null;
  orderUnsafe: boolean;
  walletAddress: string | null;
  isCeloMainnet: boolean;
  usdcBalanceRaw: bigint | null;
  celoBalanceRaw?: bigint | null;
  paymentPending: boolean;
  paymentSubmitted: boolean;
  simulatedSuccess?: boolean;
  simulationError?: string;
  gasCheckPassed?: boolean;
  gasError?: string;
  nowMs?: number;
}): { canPay: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.order) {
    reasons.push("NO_ORDER");
    return { canPay: false, reasons };
  }
  if (input.orderUnsafe) reasons.push("ORDER_UNSAFE");
  if (!input.walletAddress) reasons.push("WALLET");
  if (
    input.walletAddress &&
    getAddress(input.walletAddress) !== input.order.refundAddress
  ) {
    reasons.push("WALLET_CHANGED");
  }
  if (!input.isCeloMainnet) reasons.push("WRONG_NETWORK");
  if (input.paymentPending) reasons.push("PAYMENT_PENDING");
  if (input.paymentSubmitted) reasons.push("ALREADY_SUBMITTED");

  const window = isPaymentWindowOpen(
    input.order.providerAccount.validUntil,
    input.nowMs ?? Date.now(),
  );
  if (!window.open && window.reason) reasons.push(window.reason);

  if (input.usdcBalanceRaw === null) {
    reasons.push("BALANCE_UNLOADED");
  } else {
    try {
      const needed = usdcToBaseUnits(
        input.order.totalUsdcToSend,
        CANONICAL_CELO_USDC.decimals,
      );
      if (input.usdcBalanceRaw < needed) reasons.push("INSUFFICIENT_USDC");
    } catch {
      reasons.push("BALANCE_CHECK_FAILED");
    }
  }

  if (input.celoBalanceRaw === null) {
    reasons.push("BALANCE_UNLOADED");
  }

  if (input.gasCheckPassed === false) {
    if (input.gasError) reasons.push(input.gasError);
    else reasons.push("INSUFFICIENT_CELO_GAS");
  }
  
  if (input.simulatedSuccess === false) {
    if (input.simulationError) reasons.push(input.simulationError);
    else reasons.push("SIMULATION_FAILED");
  }

  return { canPay: reasons.length === 0, reasons };
}
