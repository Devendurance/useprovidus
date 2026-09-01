/**
 * Canonical Circle-issued USDC on Celo mainnet.
 * Single authoritative source for wallet balances and Paycrest token matching.
 * Client-safe — no secrets.
 */

import { getAddress, isAddress, type Address } from "viem";
import { CELO_CHAIN_ID } from "@/lib/wallet/celo";

/** Unchecksummed form as commonly documented; checksum applied below. */
const CANONICAL_USDC_RAW = "0xcebA9300f2b948710d2653dD7B07f33A8B32118C";

if (!isAddress(CANONICAL_USDC_RAW)) {
  throw new Error("Canonical Celo USDC address failed validation");
}

/** EIP-55 checksummed Circle USDC on Celo mainnet. */
export const CANONICAL_CELO_USDC_ADDRESS: Address = getAddress(CANONICAL_USDC_RAW);

export type CanonicalCeloUsdc = {
  symbol: "USDC";
  decimals: 6;
  chainId: typeof CELO_CHAIN_ID;
  network: "celo";
  address: Address;
  /** Human source note — not used in runtime matching. */
  source: "Circle-issued USDC on Celo mainnet";
};

export const CANONICAL_CELO_USDC: CanonicalCeloUsdc = {
  symbol: "USDC",
  decimals: 6,
  chainId: CELO_CHAIN_ID,
  network: "celo",
  address: CANONICAL_CELO_USDC_ADDRESS,
  source: "Circle-issued USDC on Celo mainnet",
};

/** Always available — no env dependency. */
export function getCanonicalCeloUsdc(): CanonicalCeloUsdc {
  return CANONICAL_CELO_USDC;
}

/**
 * Compare a Paycrest (or other) contract address to the canonical Circle USDC.
 */
export function matchesCanonicalCeloUsdc(
  contractAddress: string,
  decimals?: number,
): {
  contractMatchesCanonical: boolean;
  decimalsMatchCanonical: boolean;
  tokenCompatible: boolean;
} {
  const contractMatchesCanonical =
    isAddress(contractAddress) &&
    getAddress(contractAddress) === CANONICAL_CELO_USDC_ADDRESS;

  const decimalsMatchCanonical =
    decimals === undefined
      ? true
      : decimals === CANONICAL_CELO_USDC.decimals;

  return {
    contractMatchesCanonical,
    decimalsMatchCanonical,
    tokenCompatible: contractMatchesCanonical && decimalsMatchCanonical,
  };
}
