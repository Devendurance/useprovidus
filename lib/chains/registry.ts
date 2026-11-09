/**
 * B1 — Multichain backend foundation: typed chain registry.
 *
 * Celo mainnet config stays canonical in `@/lib/wallet/celo` — this registry
 * references it, never duplicates it. BOT Chain entries are read-only metadata
 * plus capability flags. BOT payments are NON-EXECUTABLE in this slice.
 *
 * Client-safe — no secrets. No database, no transfers, no Paycrest changes.
 */

import { defineChain, getAddress, type Address } from "viem";
import { CELO_CHAIN_ID, CELO_EXPLORER_URL } from "@/lib/wallet/celo";

/** Chain keys supported by the Providus backend. */
export type SupportedChainKey = "celo" | "botTestnet" | "botMainnet";

/**
 * BOT-chain asset symbols. Deliberately separate from Celo's Paycrest
 * `PaymentAssetSymbol` ("USDC" | "CNGN") — BOT transfer wiring lands in B2.
 */
export type BotChainAssetSymbol = "BOT" | "USDT";

export type BotAssetKind = "native" | "erc20";

export type BotChainAsset = {
  symbol: BotChainAssetSymbol;
  kind: BotAssetKind;
  /** Null for the native gas asset. */
  address: Address | null;
  /** Null when not verified against chain RPC. Never assumed. */
  decimals: number | null;
  chainKey: SupportedChainKey;
  /** B1 gate: always false. B2 flips per-asset when execution wiring lands. */
  executable: false;
};

export const BOT_TESTNET_CHAIN_ID = 968 as const;
export const BOT_MAINNET_CHAIN_ID = 677 as const;

export const BOT_TESTNET_RPC_URL = "https://rpc.bohr.life";
export const BOT_MAINNET_RPC_URL = "https://rpc.botchain.ai";

export const BOT_TESTNET_EXPLORER_URL = "https://scan.bohr.life";
export const BOT_MAINNET_EXPLORER_URL = "https://scan.botchain.ai";

export const BOT_TESTNET = defineChain({
  id: BOT_TESTNET_CHAIN_ID,
  name: "BOT Chain Testnet",
  nativeCurrency: { name: "test BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: [BOT_TESTNET_RPC_URL] } },
  blockExplorers: {
    default: { name: "BOT Scan", url: BOT_TESTNET_EXPLORER_URL },
  },
  testnet: true,
});

export const BOT_MAINNET = defineChain({
  id: BOT_MAINNET_CHAIN_ID,
  name: "BOT Chain",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: [BOT_MAINNET_RPC_URL] } },
  blockExplorers: {
    default: { name: "BOT Scan", url: BOT_MAINNET_EXPLORER_URL },
  },
  testnet: false,
});

/**
 * Official BOT Mainnet USDT contract.
 * Verified 2026-11-07 via public RPC (`rpc.botchain.ai`):
 * getBytecode present, readContract → symbol "USDT", name "Tether USD",
 * decimals 6, chainId 677.
 */
export const BOT_MAINNET_USDT_ADDRESS: Address = getAddress(
  "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C",
);

export const BOT_MAINNET_USDT_VERIFICATION = {
  method: "getBytecode + readContract(symbol/name/decimals) via public RPC",
  rpcUrl: BOT_MAINNET_RPC_URL,
  chainId: BOT_MAINNET_CHAIN_ID,
  symbol: "USDT",
  name: "Tether USD",
  decimals: 6,
  verifiedAt: "2026-11-07",
} as const;

/**
 * Do NOT assume the mainnet USDT address is USDT on testnet: the same address
 * on BOT Testnet serves a different token (WES, 18 decimals). Testnet therefore
 * lists native test BOT only.
 */
export const BOT_TESTNET_NATIVE: BotChainAsset = {
  symbol: "BOT",
  kind: "native",
  address: null,
  decimals: 18,
  chainKey: "botTestnet",
  executable: false,
};

export const BOT_MAINNET_NATIVE: BotChainAsset = {
  symbol: "BOT",
  kind: "native",
  address: null,
  decimals: 18,
  chainKey: "botMainnet",
  executable: false,
};

export const BOT_MAINNET_USDT: BotChainAsset = {
  symbol: "USDT",
  kind: "erc20",
  address: BOT_MAINNET_USDT_ADDRESS,
  decimals: BOT_MAINNET_USDT_VERIFICATION.decimals,
  chainKey: "botMainnet",
  executable: false,
};

const BOT_ASSETS_BY_CHAIN: Record<string, readonly BotChainAsset[]> = {
  botTestnet: [BOT_TESTNET_NATIVE],
  botMainnet: [BOT_MAINNET_NATIVE, BOT_MAINNET_USDT],
};

export type ChainRecord = {
  key: SupportedChainKey;
  chainId: number;
  rpcUrl: string | null;
  explorerUrl: string;
  isTestnet: boolean;
};

export const CHAIN_REGISTRY: Record<SupportedChainKey, ChainRecord> = {
  celo: {
    key: "celo",
    chainId: CELO_CHAIN_ID,
    rpcUrl: null, // Celo RPC is resolved by existing wallet/verify modules
    explorerUrl: CELO_EXPLORER_URL,
    isTestnet: false,
  },
  botTestnet: {
    key: "botTestnet",
    chainId: BOT_TESTNET_CHAIN_ID,
    rpcUrl: BOT_TESTNET_RPC_URL,
    explorerUrl: BOT_TESTNET_EXPLORER_URL,
    isTestnet: true,
  },
  botMainnet: {
    key: "botMainnet",
    chainId: BOT_MAINNET_CHAIN_ID,
    rpcUrl: BOT_MAINNET_RPC_URL,
    explorerUrl: BOT_MAINNET_EXPLORER_URL,
    isTestnet: false,
  },
};

const CHAIN_ID_TO_KEY: Record<number, SupportedChainKey> = {
  [CELO_CHAIN_ID]: "celo",
  [BOT_TESTNET_CHAIN_ID]: "botTestnet",
  [BOT_MAINNET_CHAIN_ID]: "botMainnet",
};

/** Strict chain lookup by key. */
export function getChainRecord(key: SupportedChainKey): ChainRecord {
  return CHAIN_REGISTRY[key];
}

/** Returns null for unknown chain IDs — never guesses. */
export function getChainById(chainId: number | null | undefined): ChainRecord | null {
  if (chainId === null || chainId === undefined) return null;
  const key = CHAIN_ID_TO_KEY[chainId];
  return key === undefined ? null : CHAIN_REGISTRY[key];
}

/** Throws on unknown chain IDs. Use when a valid network is required. */
export function assertSupportedChainId(
  chainId: number | null | undefined,
): ChainRecord {
  const record = getChainById(chainId);
  if (record === null) {
    throw new Error(`Unsupported chain ID: ${String(chainId)}`);
  }
  return record;
}

export function isSupportedChainId(
  chainId: number | null | undefined,
): boolean {
  return getChainById(chainId) !== null;
}

export function isBotChainKey(key: SupportedChainKey): boolean {
  return key === "botTestnet" || key === "botMainnet";
}

export function isBotChainId(chainId: number | null | undefined): boolean {
  const record = getChainById(chainId);
  return record !== null && isBotChainKey(record.key);
}

/** Mainnet/testnet isolation guard: BOT mainnet and testnet never mix. */
export function isSameNetworkTier(
  a: SupportedChainKey,
  b: SupportedChainKey,
): boolean {
  return CHAIN_REGISTRY[a].isTestnet === CHAIN_REGISTRY[b].isTestnet;
}

/** Native gas asset for a chain. Celo's native CELO is described, not paid. */
export function getNativeAsset(
  key: SupportedChainKey,
): { symbol: string; decimals: 18 } | BotChainAsset {
  if (key === "celo") return { symbol: "CELO", decimals: 18 };
  return key === "botMainnet" ? BOT_MAINNET_NATIVE : BOT_TESTNET_NATIVE;
}

/** ERC-20 contract for a BOT asset, or null when unsupported on that chain. */
export function getBotErc20Address(
  chainKey: SupportedChainKey,
  symbol: BotChainAssetSymbol,
): Address | null {
  const assets = BOT_ASSETS_BY_CHAIN[chainKey] ?? [];
  for (const asset of assets) {
    if (asset.symbol === symbol && asset.kind === "erc20" && asset.address !== null) {
      return asset.address;
    }
  }
  return null;
}

/** Capability check: is this symbol a known asset on this chain? */
export function isAssetSupportedOnChain(
  chainKey: SupportedChainKey,
  symbol: string,
): boolean {
  if (chainKey === "celo") return false; // Celo uses PaymentAssetSymbol path
  const assets = BOT_ASSETS_BY_CHAIN[chainKey] ?? [];
  return assets.some((asset) => asset.symbol === symbol);
}

/**
 * B1 execution gate — always false for BOT assets. No payment transactions
 * or contract deployments may flow from this registry until B2 wiring.
 */
export function isBotPaymentExecutable(): false {
  return false;
}

export function explorerAddressUrl(
  key: SupportedChainKey,
  address: string,
): string {
  return `${CHAIN_REGISTRY[key].explorerUrl}/address/${address}`;
}

export function explorerTxUrl(key: SupportedChainKey, txHash: string): string {
  return `${CHAIN_REGISTRY[key].explorerUrl}/tx/${txHash}`;
}
