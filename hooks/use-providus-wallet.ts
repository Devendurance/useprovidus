"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  useAccount,
  useBalance,
  useConnect,
  useDisconnect,
  useReadContract,
  useSwitchChain,
} from "wagmi";
import { CELO_CHAIN_ID, isCeloMainnetChainId } from "@/lib/wallet/celo";
import { describeWalletNetworkError, getWalletBalanceTarget, getWalletNetwork, getWalletNetworkByKey, shouldReadNetworkBalance, switchWalletNetwork } from "@/lib/wallet/network";
import {
  beginWalletNetworkSwitch,
  clearWalletNetworkSwitchMessage,
  finishWalletNetworkSwitch,
  getWalletNetworkSwitchServerSnapshot,
  getWalletNetworkSwitchSnapshot,
  subscribeWalletNetworkSwitch,
} from "@/lib/wallet/network-switch-state";
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
    switchChainAsync,
    isPending: isWagmiSwitchPending,
    error: switchErrorRaw,
    reset: resetSwitch,
  } = useSwitchChain();

  const switchSnapshot = useSyncExternalStore(
    subscribeWalletNetworkSwitch,
    getWalletNetworkSwitchSnapshot,
    getWalletNetworkSwitchServerSnapshot,
  );

  const status = normalizeWalletStatus({
    isConnected,
    isConnecting: isConnecting || isConnectPending,
    isReconnecting,
    address,
    chainId,
  });

  const onCelo = isCeloMainnetChainId(chainId ?? null);
  const network = getWalletNetwork(chainId ?? null, address);
  const networkBalanceTarget = getWalletBalanceTarget(address, chainId);
  const canReadNetworkBalance = shouldReadNetworkBalance(address, chainId, isConnected || isReconnecting);
  const canReadBalances = canReadNetworkBalance && onCelo;

  const nativeBalanceQuery = useBalance({
    address: networkBalanceTarget?.address,
    chainId: networkBalanceTarget?.chainId ?? CELO_CHAIN_ID,
    query: {
      enabled: canReadNetworkBalance,
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

  const networkNativeBalance = network.kind === "supported" && canReadNetworkBalance && nativeBalanceQuery.data?.value !== undefined
    ? { value: formatTokenAmount(nativeBalanceQuery.data.value, network.chain.nativeCurrency.decimals, { maxFractional: 4 }), symbol: network.nativeSymbol }
    : null;
  const networkBalancesLoading = canReadNetworkBalance && (nativeBalanceQuery.isLoading || nativeBalanceQuery.isFetching);
  const networkBalancesError = canReadNetworkBalance && nativeBalanceQuery.isError && network.kind === "supported"
    ? `Could not read ${network.nativeSymbol} balance. The wallet is still connected.`
    : null;
  const switchState = switchSnapshot.state;
  const isNetworkSwitchPending = switchSnapshot.pending || isWagmiSwitchPending;
  const switchError = switchState.status === "failed"
    ? switchState.message
    : switchErrorRaw
      ? describeWalletNetworkError(switchErrorRaw).message
      : null;

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
      switchError,
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
      switchError,
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
      clearWalletNetworkSwitchMessage();

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

      // Preserve the wallet's current network. Switching is always a separate action.
      connect(
        { connector },
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
    clearWalletNetworkSwitchMessage();
    disconnect();
  }

  const requestNetworkSwitch = useCallback(async (key: "celo" | "botMainnet" | "botTestnet") => {
    const target = getWalletNetworkByKey(key);
    if (chainId === target.chainId) {
      clearWalletNetworkSwitchMessage();
      return;
    }
    const request = beginWalletNetworkSwitch(key);
    if (request === null) return;
    resetSwitch();
    try {
      if (!connector || !isConnected) throw Object.assign(new Error("Wallet disconnected"), { code: 4900 });
      await switchWalletNetwork(key, {
        switchChainAsync: ({ chainId: requestedChainId }) => switchChainAsync({ chainId: requestedChainId }),
        getChainId: () => connector.getChainId(),
      });
      finishWalletNetworkSwitch(request, { status: "confirmed", target: key });
    } catch (error) {
      if (connector && isConnected) {
        try {
          if (await connector.getChainId() === target.chainId) {
            finishWalletNetworkSwitch(request, { status: "confirmed", target: key });
            return;
          }
        } catch {
          // Report the original switch failure if the provider cannot confirm its state.
        }
      }
      const result = describeWalletNetworkError(error);
      finishWalletNetworkSwitch(request, { status: "failed", target: key, ...result });
    }
  }, [chainId, connector, isConnected, resetSwitch, switchChainAsync]);

  const switchToCelo = useCallback(() => requestNetworkSwitch("celo"), [requestNetworkSwitch]);

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
    isSwitchPending: isNetworkSwitchPending,
    isNetworkSwitchPending,
    network,
    networkNativeBalance,
    networkBalancesLoading,
    networkBalancesError,
    networkSwitch: switchState,
    requestNetworkSwitch,
    clearNetworkSwitchMessage: clearWalletNetworkSwitchMessage,
    accountStatus,
    connectWallet,
    connectWithConnectorId,
    disconnectWallet,
    switchToCelo,
    clearConnectError,
  };
}

export type UseProvidusWalletReturn = ReturnType<typeof useProvidusWallet>;
