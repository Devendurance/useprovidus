/**
 * Reusable readiness checks for future Move Money / x402 actions.
 * Does not redirect routes — callers disable execution and show messages.
 */

import type { Address } from "viem";
import { isCeloMainnetChainId } from "@/lib/wallet/celo";
import { isValidAddress } from "@/lib/wallet/format";
import type {
  ProvidusWalletState,
  WalletConnectionStatus,
  WalletReadiness,
} from "@/lib/wallet/types";

export function normalizeWalletStatus(input: {
  isConnected: boolean;
  isConnecting: boolean;
  isReconnecting: boolean;
  address: string | undefined;
  chainId: number | undefined;
}): WalletConnectionStatus {
  if (input.isConnecting) return "connecting";
  if (input.isReconnecting) return "reconnecting";
  if (!input.isConnected || !input.address) return "disconnected";
  if (!isCeloMainnetChainId(input.chainId ?? null)) return "wrong-network";
  return "connected";
}

export function getWalletReadiness(
  state: Pick<
    ProvidusWalletState,
    "status" | "address" | "isCeloMainnet" | "chainId"
  >,
): WalletReadiness {
  if (state.status === "connecting" || state.status === "reconnecting") {
    return {
      ready: false,
      reason: "CONNECTING",
      message: "Wallet connection is still pending.",
    };
  }
  if (state.status === "disconnected" || !state.address) {
    return {
      ready: false,
      reason: "DISCONNECTED",
      message: "Connect a wallet to continue.",
    };
  }
  if (!isValidAddress(state.address)) {
    return {
      ready: false,
      reason: "INVALID_ADDRESS",
      message: "Connected wallet address is not a valid EVM address.",
    };
  }
  if (state.status === "wrong-network" || !state.isCeloMainnet) {
    return {
      ready: false,
      reason: "WRONG_NETWORK",
      message: "Switch to Celo mainnet (chain ID 42220) to continue.",
    };
  }
  return { ready: true, address: state.address as Address };
}

/** True only when connected on Celo with a valid address. */
export function isWalletReadyForCeloActions(
  state: Pick<
    ProvidusWalletState,
    "status" | "address" | "isCeloMainnet" | "chainId"
  >,
): boolean {
  return getWalletReadiness(state).ready === true;
}
