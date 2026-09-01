import type { Address } from "viem";

export type WalletConnectionStatus =
  | "disconnected"
  | "connecting"
  | "reconnecting"
  | "wrong-network"
  | "connected";

export type FormattedBalance = {
  /** Human-readable decimal string (from formatUnits). */
  value: string;
  /** Raw on-chain amount. */
  raw: bigint;
  symbol: "CELO" | "USDC";
  decimals: number;
};

export type ProvidusWalletState = {
  status: WalletConnectionStatus;
  address: Address | null;
  chainId: number | null;
  isCeloMainnet: boolean;
  /** True when connected on Celo and ready for future Paycrest / x402 actions. */
  isReady: boolean;
  nativeBalance: {
    value: string;
    symbol: "CELO";
  } | null;
  usdcBalance: {
    value: string;
    symbol: "USDC";
  } | null;
  /** Raw balances when available (for future precise logic). */
  nativeBalanceRaw: bigint | null;
  usdcBalanceRaw: bigint | null;
  balancesLoading: boolean;
  balancesError: string | null;
  usdcConfigured: boolean;
  connectError: string | null;
  switchError: string | null;
};

export type WalletReadiness =
  | { ready: true; address: Address }
  | {
      ready: false;
      reason:
        | "DISCONNECTED"
        | "CONNECTING"
        | "WRONG_NETWORK"
        | "INVALID_ADDRESS"
        | "LOADING";
      message: string;
    };
