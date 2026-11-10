import type { Address, Chain } from "viem";
import { CELO_MAINNET, CELO_CHAIN_ID } from "@/lib/wallet/celo";
import {
  BOT_MAINNET,
  BOT_MAINNET_CHAIN_ID,
  BOT_TESTNET,
  BOT_TESTNET_CHAIN_ID,
  CHAIN_REGISTRY,
  explorerAddressUrl,
  getChainById,
  getNativeAsset,
  type SupportedChainKey,
} from "@/lib/chains/registry";

export type SupportedWalletChainId = typeof CELO_CHAIN_ID | typeof BOT_MAINNET_CHAIN_ID | typeof BOT_TESTNET_CHAIN_ID;

export type WalletNetworkDefinition = {
  key: SupportedChainKey;
  chainId: SupportedWalletChainId;
  displayName: string;
  chain: Chain;
  nativeSymbol: string;
  rpcUrl: string;
  explorerUrl: string;
  isTestnet: boolean;
};

const NETWORKS: Record<SupportedChainKey, WalletNetworkDefinition> = {
  celo: {
    key: "celo",
    chainId: CELO_CHAIN_ID,
    displayName: "Celo Mainnet",
    chain: CELO_MAINNET,
    nativeSymbol: getNativeAsset("celo").symbol,
    rpcUrl: CELO_MAINNET.rpcUrls.default.http[0],
    explorerUrl: CHAIN_REGISTRY.celo.explorerUrl,
    isTestnet: false,
  },
  botMainnet: {
    key: "botMainnet",
    chainId: BOT_MAINNET_CHAIN_ID,
    displayName: "BOT Chain Mainnet",
    chain: BOT_MAINNET,
    nativeSymbol: getNativeAsset("botMainnet").symbol,
    rpcUrl: BOT_MAINNET.rpcUrls.default.http[0],
    explorerUrl: CHAIN_REGISTRY.botMainnet.explorerUrl,
    isTestnet: false,
  },
  botTestnet: {
    key: "botTestnet",
    chainId: BOT_TESTNET_CHAIN_ID,
    displayName: "BOT Chain Testnet",
    chain: BOT_TESTNET,
    nativeSymbol: getNativeAsset("botTestnet").symbol,
    rpcUrl: BOT_TESTNET.rpcUrls.default.http[0],
    explorerUrl: CHAIN_REGISTRY.botTestnet.explorerUrl,
    isTestnet: true,
  },
};

export const WALLET_NETWORK_OPTIONS: readonly WalletNetworkDefinition[] = [
  NETWORKS.celo,
  NETWORKS.botMainnet,
  NETWORKS.botTestnet,
];

/**
 * Networks offered to ordinary users in public UI. BOT Testnet is hidden
 * from public selection (B9C): backend execution for 968 is additionally
 * hard-disabled in production. Internal/dev tooling keeps the full list.
 */
export const PUBLIC_WALLET_NETWORK_OPTIONS: readonly WalletNetworkDefinition[] = [
  NETWORKS.celo,
  NETWORKS.botMainnet,
];

export type ActiveWalletNetwork =
  | { kind: "disconnected" }
  | { kind: "unsupported"; chainId: number }
  | (WalletNetworkDefinition & {
      kind: "supported";
      explorerAddressUrl: string | null;
    });

export function getWalletNetworkByKey(key: SupportedChainKey): WalletNetworkDefinition {
  return NETWORKS[key];
}

export function getWalletNetwork(
  chainId: number | null | undefined,
  address?: string | null,
): ActiveWalletNetwork {
  if (chainId === null || chainId === undefined) return { kind: "disconnected" };
  const record = getChainById(chainId);
  if (!record) return { kind: "unsupported", chainId };
  const network = NETWORKS[record.key];
  return {
    ...network,
    kind: "supported",
    explorerAddressUrl: address ? explorerAddressUrl(record.key, address) : null,
  };
}

export function getWalletNetworkSetup(key: SupportedChainKey) {
  const network = NETWORKS[key];
  return {
    chainId: network.chainId,
    chainIdHex: `0x${network.chainId.toString(16)}`,
    chainName: network.chain.name,
    rpcUrls: [network.rpcUrl],
    blockExplorerUrls: [network.explorerUrl],
    nativeCurrency: { ...network.chain.nativeCurrency },
  };
}

export function getWalletBalanceTarget(
  address: string | null | undefined,
  chainId: number | null | undefined,
): { address: Address; chainId: SupportedWalletChainId } | null {
  if (!address) return null;
  const record = getChainById(chainId);
  if (!record) return null;
  return {
    address: address as Address,
    chainId: NETWORKS[record.key].chainId,
  };
}

export function shouldReadNetworkBalance(
  address: string | null | undefined,
  chainId: number | null | undefined,
  connected: boolean,
): boolean {
  return connected && getWalletBalanceTarget(address, chainId) !== null;
}

export class WalletNetworkConfirmationError extends Error {
  readonly kind = "unconfirmed";
  readonly targetChainId: number;
  readonly actualChainId: number;

  constructor(targetChainId: number, actualChainId: number) {
    super(`Wallet did not confirm chain ${targetChainId}. Active chain is ${actualChainId}.`);
    this.name = "WalletNetworkConfirmationError";
    this.targetChainId = targetChainId;
    this.actualChainId = actualChainId;
  }
}

export type WalletNetworkSwitchAdapter = {
  switchChainAsync(input: { chainId: SupportedWalletChainId }): Promise<unknown>;
  getChainId(): Promise<number>;
};

function networkWasAddedButNotSelected(error: unknown): boolean {
  const { text } = errorParts(error);
  return text.includes("user rejected switch after adding network");
}

/** Calls the existing connector's switch action once, then checks provider truth. */
export async function switchWalletNetwork(
  key: SupportedChainKey,
  adapter: WalletNetworkSwitchAdapter,
): Promise<WalletNetworkDefinition> {
  const target = NETWORKS[key];
  try {
    await adapter.switchChainAsync({ chainId: target.chainId });
  } catch (error) {
    // wagmi's injected connector handles 4902 by adding the configured B1
    // chain. Some wallets leave the old chain active after accepting that
    // prompt, so ask the existing connector to switch once more. Other
    // rejections and failures end here without repeating a wallet prompt.
    if (!networkWasAddedButNotSelected(error)) throw error;
    await adapter.switchChainAsync({ chainId: target.chainId });
  }
  const activeChainId = await adapter.getChainId();
  if (activeChainId !== target.chainId) {
    throw new WalletNetworkConfirmationError(target.chainId, activeChainId);
  }
  return target;
}

export type WalletNetworkErrorKind = "rejected" | "manual" | "disconnected" | "unavailable" | "failed";

function errorParts(error: unknown): { code?: number; text: string } {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  let code: number | undefined;
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current === "object") {
      const item = current as { code?: unknown; message?: unknown; shortMessage?: unknown; name?: unknown; cause?: unknown };
      if (typeof item.code === "number") code ??= item.code;
      if (typeof item.message === "string") parts.push(item.message);
      if (typeof item.shortMessage === "string") parts.push(item.shortMessage);
      if (typeof item.name === "string") parts.push(item.name);
      current = item.cause;
    } else if (typeof current === "string") {
      parts.push(current);
      break;
    } else break;
  }
  return { code, text: parts.join(" ").toLowerCase() };
}

export function describeWalletNetworkError(error: unknown): { kind: WalletNetworkErrorKind; message: string } {
  const { code, text } = errorParts(error);
  if (code === 4001 || text.includes("user rejected") || text.includes("user denied") || text.includes("request rejected")) {
    return { kind: "rejected", message: "The network request was declined in your wallet. Choose a network to try again." };
  }
  if (code === 4900 || code === 4901 || text.includes("provider not found") || text.includes("connector not found") || text.includes("disconnected")) {
    return { kind: "disconnected", message: "The wallet disconnected before the network changed. Reconnect it to continue." };
  }
  if (code === 4200 || code === -32601 || text.includes("not supported") || text.includes("unsupported method") || text.includes("cannot switch")) {
    return { kind: "manual", message: "This wallet cannot switch networks automatically. Add or select the network manually, then check the active chain here." };
  }
  if (code === -32000 || text.includes("rpc") || text.includes("timeout") || text.includes("unavailable") || text.includes("network error")) {
    return { kind: "unavailable", message: "The wallet or network is unavailable right now. Your active network has not changed." };
  }
  return { kind: "failed", message: "The wallet did not confirm this network switch. Check the wallet and try again." };
}

export function networkSetupCopy(key: SupportedChainKey): string[] {
  const setup = getWalletNetworkSetup(key);
  const network = NETWORKS[key];
  return [
    `Network: ${network.displayName}`,
    `Chain ID: ${setup.chainId}`,
    `RPC URL: ${network.rpcUrl}`,
    `Native token: ${network.nativeSymbol}`,
    `Explorer: ${network.explorerUrl}`,
  ];
}
