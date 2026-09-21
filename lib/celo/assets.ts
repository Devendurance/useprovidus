/**
 * Canonical payment assets supported on Celo mainnet.
 * Client-safe — no secrets.
 */

import { getAddress, type Address } from "viem";
import { CELO_CHAIN_ID } from "@/lib/wallet/celo";
import { CANONICAL_CELO_USDC_ADDRESS } from "@/lib/celo/usdc";

export type PaymentAssetSymbol = "USDC" | "CNGN";

export type PaymentAsset = {
  symbol: PaymentAssetSymbol;
  address: Address;
  decimals: 6;
  paycrestToken: PaymentAssetSymbol;
  displayName: string;
  network: "celo";
  chainId: typeof CELO_CHAIN_ID;
};

export const CANONICAL_CELO_CNGN_ADDRESS: Address = getAddress(
  "0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f",
);

export const CANONICAL_CELO_CNGN: PaymentAsset = {
  symbol: "CNGN",
  address: CANONICAL_CELO_CNGN_ADDRESS,
  decimals: 6,
  paycrestToken: "CNGN",
  displayName: "cNGN — Naira-backed stablecoin (Africa Stablecoin Consortium)",
  network: "celo",
  chainId: CELO_CHAIN_ID,
};

export const CANONICAL_CELO_USDC: PaymentAsset = {
  symbol: "USDC",
  address: CANONICAL_CELO_USDC_ADDRESS,
  decimals: 6,
  paycrestToken: "USDC",
  displayName: "USDC — USD Coin",
  network: "celo",
  chainId: CELO_CHAIN_ID,
};

export const SUPPORTED_PAYMENT_ASSETS: readonly PaymentAsset[] = [
  CANONICAL_CELO_USDC,
  CANONICAL_CELO_CNGN,
];

export function normalizePaymentAssetSymbol(
  value: unknown,
): PaymentAssetSymbol | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === "USDC" || normalized === "CNGN") return normalized;
  return null;
}

export function getPaymentAsset(symbol?: unknown): PaymentAsset {
  if (symbol === undefined || (typeof symbol === "string" && symbol.trim() === "")) {
    return CANONICAL_CELO_USDC;
  }

  const normalized = normalizePaymentAssetSymbol(symbol);
  if (normalized === null) {
    throw new Error("Unsupported Celo payment asset");
  }
  return normalized === "CNGN" ? CANONICAL_CELO_CNGN : CANONICAL_CELO_USDC;
}
