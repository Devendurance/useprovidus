/**
 * B9C.0 — Local-only BOT Mainnet browser-test gate.
 *
 * Production mainnet execution stays disabled: this module activates ONLY when
 * ALL of the following hold:
 * - NOT a production build (NODE_ENV === "production" fails closed),
 * - PROVIDUS_MAINNET_TEST_MODE is exactly "1" (explicit local opt-in),
 * - PROVIDUS_MAINNET_TEST_PAYER and PROVIDUS_MAINNET_TEST_RECIPIENT are set
 *   to valid, distinct EVM addresses (user-designated, never invented).
 *
 * Scope of the allowance (server-enforced, never client-trustable):
 * - chain 677 only, native BOT only, exactly 0.01 BOT (10^16 base units),
 * - owner (SIWE session) must equal the designated payer,
 * - recipient must equal the designated recipient,
 * - contract must equal the audited mainnet deployment below.
 * Everything else on 677 keeps failing closed exactly as before.
 */

import { getAddress, isAddress, type Address } from "viem";

/** Audited canonical ProvidusPay deployment on BOT Mainnet (B9B.3). */
export const MAINNET_CONTRACT_ADDRESS: Address = getAddress(
  "0xd373b0377F17D38707C610f39820297CF4cfCF60",
);

/** The only mainnet test payments this mode permits (B9C.2 adds USDT). */
export const MAINNET_TEST_TERMS_NATIVE = {
  chainId: 677,
  assetSymbol: "BOT",
  amountBaseUnits: "10000000000000000",
  tokenAddress: null,
} as const;

export const MAINNET_USDT_ADDRESS: Address = getAddress(
  "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C",
);

export const MAINNET_TEST_TERMS_USDT = {
  chainId: 677,
  assetSymbol: "USDT",
  amountBaseUnits: "1000000",
  tokenAddress: "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C",
} as const;

export type MainnetTestConfig = {
  payer: Address;
  recipient: Address;
};

function readEnv(name: string): string | null {
  const value = process.env[name];
  return value === undefined ? null : value;
}

/**
 * Returns the test-mode binding, or null when test mode is unavailable.
 * Never throws for missing config — callers fail closed on null.
 */
export function getMainnetTestConfig(): MainnetTestConfig | null {
  if (process.env.NODE_ENV === "production") return null;
  if (readEnv("PROVIDUS_MAINNET_TEST_MODE") !== "1") return null;
  const payerRaw = readEnv("PROVIDUS_MAINNET_TEST_PAYER");
  const recipientRaw = readEnv("PROVIDUS_MAINNET_TEST_RECIPIENT");
  if (!payerRaw || !recipientRaw || !isAddress(payerRaw) || !isAddress(recipientRaw)) {
    return null;
  }
  const payer = getAddress(payerRaw);
  const recipient = getAddress(recipientRaw);
  if (payer === recipient) return null;
  return { payer, recipient };
}

export function isMainnetTestMode(): boolean {
  return getMainnetTestConfig() !== null;
}
