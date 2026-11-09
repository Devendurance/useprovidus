/**
 * B4A — Canonical ProvidusPay contract binding for B3 wallet_transfer intents.
 *
 * Preparation only: this module never signs, broadcasts, or executes anything.
 * It pins the exact function selectors a parallel track implements in Solidity —
 * do NOT rename functions, reorder params, or change types without coordinating
 * that track. Event shape is informational for future indexing.
 *
 * Functions:
 *   payNative(bytes32 intentId, address recipient, uint256 deadline) payable
 *   payToken(bytes32 intentId, address token, address recipient, uint256 amount, uint256 deadline)
 * Event:
 *   PaymentExecuted(bytes32 intentId, address payer, address recipient, address token, uint256 amount)
 */

import { getAddress, isAddress, type Address, type Hex } from "viem";

export const PAY_NATIVE_SIGNATURE =
  "payNative(bytes32,address,uint256)" as const;
export const PAY_TOKEN_SIGNATURE =
  "payToken(bytes32,address,address,uint256,uint256)" as const;
export const PAYMENT_EXECUTED_SIGNATURE =
  "PaymentExecuted(bytes32,address,address,address,uint256)" as const;

/**
 * Minimal ABI bound to the canonical selectors above. Hand-written on purpose:
 * no extra functions, no proxy/admin surface, no inferred artifacts.
 */
export const PROVIDUS_PAY_ABI = [
  {
    type: "function",
    name: "payNative",
    inputs: [
      { name: "intentId", type: "bytes32" },
      { name: "recipient", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "payToken",
    inputs: [
      { name: "intentId", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "PaymentExecuted",
    inputs: [
      { name: "intentId", type: "bytes32", indexed: true },
      { name: "payer", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
] as const;

/** Canonical ABI alias used by verification and calldata paths. */
export const PAYMENT_ABI = PROVIDUS_PAY_ABI;

const CONTRACT_ENV_BY_CHAIN: Record<number, string> = {
  677: "PROVIDUS_PAY_CONTRACT_677",
  968: "PROVIDUS_PAY_CONTRACT_968",
};

/**
 * Read the configured ProvidusPay contract for a chain.
 * Returns the checksummed address, or null when unset / invalid / unknown chain.
 * `env` is an optional override for deterministic tests; defaults to process.env.
 */
export function getPaymentContractAddress(
  chainId: number,
  env?: Record<string, string | undefined>,
): Address | null {
  const key = CONTRACT_ENV_BY_CHAIN[chainId];
  if (!key) return null;
  const source = env ?? process.env;
  const raw = source[key]?.trim();
  if (!raw || !isAddress(raw)) return null;
  return getAddress(raw);
}

/**
 * Canonical intent ID bytes for contract calls: 0x-prefixed terms fingerprint.
 * Validates strict 32 bytes (64 hex chars) — never silently truncates.
 */
export function intentIdBytes(intent: {
  termsFingerprint: string;
}): Hex {
  const fp = intent.termsFingerprint;
  if (typeof fp !== "string" || !/^[0-9a-fA-F]{64}$/.test(fp)) {
    throw new Error("Intent terms fingerprint is not 32 bytes of hex.");
  }
  return `0x${fp.toLowerCase()}` as Hex;
}
