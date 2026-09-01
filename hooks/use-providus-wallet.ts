"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useBalance,
  useConnect,
  useDisconnect,
  useReadContract,
  useSwitchChain,
} from "wagmi";
import { CELO_CHAIN_ID, isCeloMainnetChainId } from "@/lib/wallet/celo";
import { detectInstalledWallets } from "@/lib/wallet/connectors";
import { erc20BalanceOfAbi } from "@/lib/wallet/erc20";
import { formatTokenAmount } from "@/lib/wallet/format";
import {
  getWalletReadiness,
  normalizeWalletStatus,
} from "@/lib/wallet/guards";
import {
  isSupportedConnectorId,
  SUPPORTED_WALLETS,
  type SupportedWalletId,
} from "@/lib/wallet/supported-wallets";
import { getCeloUsdcConfig } from "@/lib/wallet/tokens";
import type { ProvidusWalletState } from "@/lib/wallet/types";

function mapUserError(err: unknown, fallback: string): string {
  if (!err) return fallback;
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "object" &&
          err !== null &&
          "shortMessage" in err &&
          typeof (err as { shortMessage?: unknown }).shortMessage === "string"
        ? (err as { shortMessage: string }).shortMessage
        : typeof err === "object" &&
            err !== null &&
            "message" in err &&
            typeof (err as { message?: unknown }).message === "string"
          ? (err as { message: string }).message
          : fallback;

  const lower = message.toLowerCase();
  if (
    lower.includes("user rejected") ||
    lower.includes("user denied") ||
    lower.includes("rejected the request")
  ) {
    return "Request rejected in the wallet.";
  }
  if (
    lower.includes("provider not found") ||
    lower.includes("connector not found")
  ) {
    return "Selected wallet is not available. Install it, then try again.";
  }
  if (lower.includes("resource unavailable") || lower.includes("already pending")) {
    return "A connection request is already pending in the wallet.";
  }
  if (lower.includes("unsupported") && lower.includes("chain")) {
    return "This wallet cannot switch to Celo mainnet automatically.";
  }
  return message || fallback;
}

/**
 * Normalized Providus wallet state for connect UI and future Paycrest / x402 flows.
 * Connect only via explicit MetaMask / Rabby / OKX selection — never auto-inject.
 */
export function useProvidusWallet() {
  const usdc = getCeloUsdcConfig();
  const [localError, setLocalError] = useState<string | null>(null);

  const {
    address,
    chainId,
    isConnected,
    isConnecting,
    isReconnecting,
    status: accountStatus,
    connector,
  } = useAccount();

  const {
    connect,
    connectors,
    isPending: isConnectPending,
    error: connectErrorRaw,
    reset: resetConnect,
  } = useConnect();

  const { disconnect, isPending: isDisconnectPending } = useDisconnect();

  const {
    switchChain,
    isPending: isSwitchPending,
    error: switchErrorRaw,
    reset: resetSwitch,
  } = useSwitchChain();

  const status = normalizeWalletStatus({
    isConnected,
    isConnecting: isConnecting || isConnectPending,
    isReconnecting,
    address,
    chainId,
  });

  const onCelo = isCeloMainnetChainId(chainId ?? null);
  const canReadBalances =
    Boolean(address) && onCelo && (status === "connected" || status === "reconnecting");

  const nativeBalanceQuery = useBalance({
    address,
    chainId: CELO_CHAIN_ID,
    query: {
      enabled: canReadBalances,
      staleTime: 30_000,
      refetchInterval: false,
      retry: 1,
    },
  });

  const usdcBalanceQuery = useReadContract({
    address: usdc.address,
    abi: erc20BalanceOfAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: CELO_CHAIN_ID,
    query: {
      enabled: canReadBalances && Boolean(address),
      staleTime: 30_000,
      refetchInterval: false,
      retry: 1,
    },
  });

  const nativeRaw =
    canReadBalances && nativeBalanceQuery.data?.value !== undefined
      ? nativeBalanceQuery.data.value
      : null;

  const usdcRaw =
    canReadBalances && typeof usdcBalanceQuery.data === "bigint"
      ? usdcBalanceQuery.data
      : null;

  const balancesLoading =
    canReadBalances &&
    (nativeBalanceQuery.isLoading ||
      nativeBalanceQuery.isFetching ||
      usdcBalanceQuery.isLoading ||
      usdcBalanceQuery.isFetching);

  let balancesError: string | null = null;
  if (canReadBalances && nativeBalanceQuery.isError) {
    balancesError = "Could not read CELO balance.";
  } else if (canReadBalances && usdcBalanceQuery.isError) {
    balancesError = "Could not read USDC balance.";
  }

  const connectErrorCombined =
    localError ??
    (connectErrorRaw
      ? mapUserError(connectErrorRaw, "Could not connect wallet.")
      : null);

  const state: ProvidusWalletState = useMemo(
    () => ({
      status:
        status === "reconnecting" && address
          ? onCelo
            ? "connected"
            : "wrong-network"
          : status === "reconnecting"
            ? "connecting"
            : status,
      address: address ?? null,
      chainId: chainId ?? null,
      isCeloMainnet: onCelo,
      isReady:
        (status === "connected" ||
          (status === "reconnecting" && Boolean(address) && onCelo)) &&
        onCelo &&
        Boolean(address),
      nativeBalance:
        nativeRaw !== null
          ? {
              value: formatTokenAmount(nativeRaw, 18, { maxFractional: 4 }),
              symbol: "CELO" as const,
            }
          : null,
      usdcBalance:
        usdcRaw !== null
          ? {
              value: formatTokenAmount(usdcRaw, usdc.decimals, {
                maxFractional: 4,
              }),
              symbol: "USDC" as const,
            }
          : null,
      nativeBalanceRaw: nativeRaw,
      usdcBalanceRaw: usdcRaw,
      balancesLoading,
      balancesError,
      usdcConfigured: true,
      connectError: connectErrorCombined,
      switchError: switchErrorRaw
        ? mapUserError(switchErrorRaw, "Could not switch network.")
        : null,
    }),
    [
      status,
      address,
      chainId,
      onCelo,
      nativeRaw,
      usdcRaw,
      usdc,
      balancesLoading,
      balancesError,
      connectErrorCombined,
      switchErrorRaw,
    ],
  );

  const readiness = getWalletReadiness(state);

  // Re-scan extensions after mount / ethereum injection without sync setState-in-effect.
  const [providerScan, setProviderScan] = useState(0);
  useEffect(() => {
    const bump = () => setProviderScan((n) => n + 1);
    const onAnnounce = () => bump();
    window.addEventListener("ethereum#initialized", onAnnounce);
    const t = window.setTimeout(bump, 0);
    const t2 = window.setTimeout(bump, 500);
    return () => {
      window.removeEventListener("ethereum#initialized", onAnnounce);
      window.clearTimeout(t);
      window.clearTimeout(t2);
    };
  }, [isConnected]);

  const installed = useMemo(() => {
    void providerScan;
    if (typeof window === "undefined") {
      return { metaMask: false, rabby: false, okx: false } as Record<
        SupportedWalletId,
        boolean
      >;
    }
    return detectInstalledWallets();
  }, [providerScan]);

  const walletOptions = useMemo(
    () =>
      SUPPORTED_WALLETS.map((w) => ({
        ...w,
        installed: installed[w.id],
        connectorAvailable: connectors.some((c) => c.id === w.connectorId),
      })),
    [connectors, installed],
  );

  /**
   * @deprecated Do not auto-connect. Use open chooser + connectWithConnectorId.
   * Kept as no-op safe guard if called.
   */
  const connectWallet = useCallback(() => {
    setLocalError(
      "Choose MetaMask, Rabby, or OKX Wallet to connect. Automatic browser wallet selection is disabled.",
    );
  }, []);

  const connectWithConnectorId = useCallback(
    (connectorId: string) => {
      setLocalError(null);
      resetConnect();
      resetSwitch();

      if (isConnectPending || isConnecting) {
        setLocalError("A connection request is already pending.");
        return;
      }

      if (!isSupportedConnectorId(connectorId)) {
        setLocalError(
          "Unsupported wallet. Providus only supports MetaMask, Rabby, and OKX Wallet.",
        );
        return;
      }

      const id = connectorId as SupportedWalletId;
      if (!installed[id]) {
        setLocalError(
          `${SUPPORTED_WALLETS.find((w) => w.id === id)?.name ?? "Wallet"} is not installed.`,
        );
        return;
      }

      const connector = connectors.find((c) => c.id === id);
      if (!connector) {
        setLocalError("Selected wallet connector is unavailable.");
        return;
      }

      // Connect only the chosen connector — no fallback to other wallets on failure.
      connect(
        { connector, chainId: CELO_CHAIN_ID },
        {
          onError: () => {
            // intentionally no auto-retry with another connector
          },
        },
      );
    },
    [
      connect,
      connectors,
      installed,
      isConnectPending,
      isConnecting,
      resetConnect,
      resetSwitch,
    ],
  );

  function disconnectWallet() {
    setLocalError(null);
    resetConnect();
    resetSwitch();
    disconnect();
  }

  function switchToCelo() {
    resetSwitch();
    if (isSwitchPending) return;
    // Targets the currently connected connector's provider only.
    switchChain({ chainId: CELO_CHAIN_ID });
  }

  function clearConnectError() {
    setLocalError(null);
    resetConnect();
  }

  return {
    ...state,
    readiness,
    walletOptions,
    activeConnectorId: connector?.id ?? null,
    connectors: connectors.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    isConnectPending: isConnectPending || isConnecting,
    isDisconnectPending,
    isSwitchPending,
    accountStatus,
    connectWallet,
    connectWithConnectorId,
    disconnectWallet,
    switchToCelo,
    clearConnectError,
  };
}

export type UseProvidusWalletReturn = ReturnType<typeof useProvidusWallet>;
