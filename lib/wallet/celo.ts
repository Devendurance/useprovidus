/**
 * Authoritative Celo mainnet chain config for Providus.
 * Product flow is mainnet-only (chain ID 42220). No Sepolia.
 */

import { celo } from "viem/chains";

/** Canonical Celo mainnet from viem — RPC, explorer, native CELO. */
export const CELO_MAINNET = celo;

export const CELO_CHAIN_ID = celo.id; // 42220

export const CELO_EXPLORER_URL =
  celo.blockExplorers?.default.url ?? "https://celoscan.io";

export function addressExplorerUrl(address: string): string {
  return `${CELO_EXPLORER_URL}/address/${address}`;
}

export function isCeloMainnetChainId(chainId: number | null | undefined): boolean {
  return chainId === CELO_CHAIN_ID;
}
