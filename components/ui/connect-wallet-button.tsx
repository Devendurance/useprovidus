"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Unplug, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProvidusWallet } from "@/hooks/use-providus-wallet";
import { useWalletAuth } from "@/hooks/use-wallet-auth";
import { useHydrated } from "@/lib/wallet/hydration";
import { networkSetupCopy, WALLET_NETWORK_OPTIONS } from "@/lib/wallet/network";
import { truncateAddress } from "@/lib/wallet/format";
import type { SupportedWalletId } from "@/lib/wallet/supported-wallets";
import { cn } from "@/lib/cn";
import { BOT_MAINNET_STATUS } from "@/lib/product/positioning";

type ConnectWalletButtonProps = {
  className?: string;
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
  label?: string;
  showBalances?: boolean;
};

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const WALLET_PANEL_OPEN_EVENT = "providus-wallet-panel-open";

export function ConnectWalletButton({ className, size = "sm", fullWidth = false, label = "Connect wallet", showBalances = true }: ConnectWalletButtonProps) {
  const wallet = useProvidusWallet();
  const auth = useWalletAuth();
  const hydrated = useHydrated();
  const statusId = useId();
  const panelId = useId();
  const titleId = useId();
  const [panelOpen, setPanelOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousConnectedRef = useRef(false);

  const connectedHere = hydrated && Boolean(wallet.address) && (wallet.accountStatus === "connected" || wallet.accountStatus === "reconnecting");
  const showChooser = !connectedHere && (!hydrated || wallet.status === "disconnected" || wallet.status === "connecting" || !wallet.address);
  const truncated = wallet.address ? truncateAddress(wallet.address) : "Wallet";
  const activeNetwork = wallet.network;
  const switchTarget = "target" in wallet.networkSwitch ? wallet.networkSwitch.target : null;
  const confirmedTarget = wallet.networkSwitch.status === "confirmed" ? wallet.networkSwitch.target : null;
  const failedSwitch = wallet.networkSwitch.status === "failed" ? wallet.networkSwitch : null;
  const switching = wallet.networkSwitch.status === "requesting" || wallet.networkSwitch.status === "slow";

  function positionPanel() {
    if (typeof window === "undefined" || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.min(360, Math.max(260, window.innerWidth - 24));
    const panelHeight = panelRef.current?.getBoundingClientRect().height ?? 560;
    const preferredTop = rect.bottom + 8;
    const top = preferredTop + panelHeight > window.innerHeight - 12 ? Math.max(12, rect.top - panelHeight - 8) : preferredTop;
    const left = Math.min(Math.max(12, rect.right - width), Math.max(12, window.innerWidth - width - 12));
    setPosition({ top, left, width });
  }

  function closePanel(restoreFocus = true) {
    setPanelOpen(false);
    setPosition(null);
    if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  function togglePanel() {
    wallet.clearConnectError();
    if (panelOpen) closePanel();
    else {
      window.dispatchEvent(new CustomEvent(WALLET_PANEL_OPEN_EVENT, { detail: panelId }));
      setPanelOpen(true);
    }
  }

  function selectWallet(id: SupportedWalletId, installed: boolean) {
    if (!installed || wallet.isConnectPending) return;
    wallet.connectWithConnectorId(id);
  }

  useEffect(() => {
    if (panelOpen && !previousConnectedRef.current && connectedHere) closePanel();
    previousConnectedRef.current = connectedHere;
  }, [connectedHere, panelOpen]);

  useEffect(() => {
    if (!panelOpen) return;
    const closeAnotherWalletPanel = (event: Event) => {
      if ((event as CustomEvent<string>).detail === panelId) return;
      setPanelOpen(false);
      setPosition(null);
    };
    window.addEventListener(WALLET_PANEL_OPEN_EVENT, closeAnotherWalletPanel);
    return () => window.removeEventListener(WALLET_PANEL_OPEN_EVENT, closeAnotherWalletPanel);
  }, [panelOpen, panelId]);

  const refreshSession = auth.refreshSession;
  useEffect(() => {
    if (panelOpen && connectedHere) void refreshSession();
  }, [panelOpen, connectedHere, refreshSession]);

  useEffect(() => {
    if (!panelOpen) return;
    const frame = window.requestAnimationFrame(positionPanel);
    const update = () => positionPanel();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [panelOpen]);

  useEffect(() => {
    if (!panelOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePanel();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const frame = window.requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [panelOpen]);

  useEffect(() => {
    if (!panelOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) closePanel();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [panelOpen]);

  const trigger = (
    <Button ref={triggerRef} type="button" variant="ghost" size={size} fullWidth={fullWidth}
      className={cn("min-w-0 border-ledger bg-clear-paper shadow-base", className)}
      onClick={togglePanel} aria-expanded={panelOpen} aria-controls={panelId} aria-haspopup="dialog"
      aria-describedby={statusId} aria-busy={hydrated && wallet.isConnectPending}>
      {!hydrated ? <Wallet className="h-4 w-4 shrink-0" aria-hidden />
        : wallet.isConnectPending ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          : activeNetwork.kind === "unsupported" ? <AlertTriangle className="h-4 w-4 shrink-0 text-loss-red" aria-hidden />
            : connectedHere ? <CheckCircle2 className="h-4 w-4 shrink-0 text-provident-green" aria-hidden />
              : <Wallet className="h-4 w-4 shrink-0" aria-hidden />}
      <span className="truncate">{!hydrated ? label : wallet.isConnectPending ? "Connecting…" : connectedHere ? truncated : label}</span>
    </Button>
  );

  const panel = panelOpen ? (
    <>
      <div className="fixed inset-0 z-[70] bg-ledger-stone/20 sm:hidden" aria-hidden onPointerDown={() => closePanel()} />
      <div ref={panelRef} id={panelId} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="fixed inset-x-3 bottom-3 z-[71] max-h-[min(94svh,820px)] w-auto overflow-y-auto rounded-[10px] border-ledger bg-clear-paper p-3 shadow-prominent sm:inset-x-auto sm:bottom-auto sm:w-[min(360px,calc(100vw-24px))]"
        style={typeof window !== "undefined" && window.innerWidth >= 640 && position ? { top: position.top, left: position.left, width: position.width } : undefined}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p id={titleId} className="min-w-0 truncate text-sm font-semibold text-ledger-stone">
            {showChooser ? "Connect wallet" : activeNetwork.kind === "supported" ? `${activeNetwork.displayName} wallet` : activeNetwork.kind === "unsupported" ? "Unsupported network" : "Wallet connected"}
          </p>
          <button type="button" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-ledger-edge text-receipt-grey hover:bg-ledger-edge/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green" onClick={() => closePanel()} aria-label="Close wallet panel">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {showChooser ? (
          <>
            <p className="mb-3 text-xs text-receipt-grey">MetaMask, Rabby, or OKX only. Providus never selects a wallet automatically.</p>
            <ul className="flex flex-col gap-2" role="list">
              {wallet.walletOptions.map((option, index) => (
                <li key={option.id}>
                  <div className="flex items-stretch gap-2">
                    <button type="button" className={cn("flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-[10px] border-ledger px-3 py-2 text-left text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green", option.installed ? "bg-receipt-field text-ledger-stone hover:bg-ledger-edge/50" : "cursor-not-allowed bg-receipt-field/60 text-receipt-grey opacity-80")} disabled={!option.installed || wallet.isConnectPending} onClick={() => selectWallet(option.id, option.installed)} aria-label={option.installed ? `Connect with ${option.name}` : `${option.name} not installed`}>
                      <span className="flex min-w-0 items-center gap-2"><span className="font-proof text-[11px] text-receipt-grey" aria-hidden>{String(index + 1).padStart(2, "0")}</span><span className="truncate">{option.name}</span></span>
                      <span className="shrink-0 font-proof text-[11px] font-medium text-receipt-grey">{option.installed ? "Installed" : option.notInstalledLabel}</span>
                    </button>
                    {!option.installed ? <a href={option.installUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 shrink-0 items-center justify-center rounded-[10px] border border-ledger-edge px-3 text-xs font-semibold text-quote-blue hover:bg-ledger-edge/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green" onClick={(event) => event.stopPropagation()}>Install</a> : null}
                  </div>
                </li>
              ))}
            </ul>
            {wallet.isConnectPending ? <p className="mt-3 text-xs text-receipt-grey" role="status">Confirm the connection request in your wallet.</p> : null}
            {wallet.connectError ? <p role="alert" className="mt-3 rounded-[10px] border border-loss-red/40 bg-receipt-field px-3 py-2 text-xs font-medium text-loss-red">{wallet.connectError}</p> : null}
          </>
        ) : connectedHere ? (
          <>
            <div className="mb-3 space-y-2 rounded-[10px] bg-receipt-field px-3 py-2">
              <div>
                <p className="text-[11px] font-medium text-receipt-grey">Wallet address</p>
                <code className="block break-all font-proof text-xs text-ledger-stone">{wallet.address}</code>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                <span className="text-[11px] font-medium text-receipt-grey">Current network</span>
                <strong className="font-proof text-xs text-ledger-stone">
                  {activeNetwork.kind === "supported" ? `${activeNetwork.displayName} · Chain ID ${activeNetwork.chainId}` : activeNetwork.kind === "unsupported" ? `Unsupported network · Chain ID ${activeNetwork.chainId}` : "Network unavailable"}
                </strong>
              </div>
              <p className="text-[11px] text-receipt-grey">Connection: {wallet.accountStatus === "reconnecting" ? "Reconnecting" : "Connected"}</p>
            </div>

            <div className="mb-3 rounded-[10px] border border-ledger-edge bg-clear-paper px-3 py-2">
              <p className="text-[11px] font-medium text-receipt-grey">Authentication</p>
              <p className="mt-1 text-sm font-semibold text-ledger-stone" role="status" aria-live="polite">
                {auth.busy ? walletAuthStatusCopy["awaiting-signature"] : auth.statusCopy}
              </p>
              {auth.checking && !auth.busy ? <p className="mt-1 text-[11px] text-receipt-grey">Checking wallet verification…</p> : null}
              {auth.error ? <p role="alert" className="mt-2 text-xs text-loss-red">{auth.error}</p> : null}
              {auth.status === "authenticated" ? <p className="mt-1 text-[11px] text-receipt-grey">Payments still need review-card wallet approval.</p> : null}
            </div>

            {activeNetwork.kind === "supported" && activeNetwork.explorerAddressUrl ? <a href={activeNetwork.explorerAddressUrl} target="_blank" rel="noopener noreferrer" className="mb-3 inline-flex min-h-11 max-w-full items-center gap-2 text-sm font-semibold text-quote-blue underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green">View address on {activeNetwork.key === "celo" ? "Celoscan" : "BOT Scan"}<ExternalLink className="h-4 w-4 shrink-0" aria-hidden /></a> : <p className="mb-3 text-xs text-receipt-grey">No explorer is configured for this network.</p>}

            {showBalances ? <section className="mb-3 space-y-2 border-t border-ledger-edge pt-2" aria-label="Current network balance">
              <h3 className="text-xs font-semibold text-ledger-stone">Network balance</h3>
              {activeNetwork.kind === "supported" ? wallet.networkBalancesLoading ? <p className="font-proof text-[12px] text-receipt-grey" role="status">Reading {activeNetwork.nativeSymbol} balance…</p> : wallet.networkNativeBalance ? <dl className="font-proof text-[12px] text-ledger-stone"><dt className="text-receipt-grey">{activeNetwork.nativeSymbol}</dt><dd className="truncate font-medium tabular-nums">{wallet.networkNativeBalance.value} {wallet.networkNativeBalance.symbol}</dd></dl> : <p className="font-proof text-[12px] text-receipt-grey" role="status">{wallet.networkBalancesError ?? `${activeNetwork.nativeSymbol} balance is unavailable.`}</p> : <p className="font-proof text-[12px] text-receipt-grey">Balance unavailable on unsupported networks.</p>}
              {activeNetwork.kind === "supported" && activeNetwork.key === "celo" && wallet.usdcBalance ? <dl className="font-proof text-[12px] text-ledger-stone"><dt className="text-receipt-grey">USDC</dt><dd className="truncate font-medium tabular-nums">{wallet.usdcBalance.value} USDC</dd></dl> : null}
              {activeNetwork.kind === "supported" && activeNetwork.key === "celo" && wallet.balancesError ? <p className="text-[11px] text-receipt-grey" role="status">{wallet.balancesError}</p> : null}
            </section> : null}

            <section className="space-y-2 border-t border-ledger-edge pt-3" aria-labelledby={`${panelId}-networks`}>
              <div>
                <h3 id={`${panelId}-networks`} className="text-sm font-semibold text-ledger-stone">Switch network</h3>
                <p className="text-[11px] text-receipt-grey">Choose a network. Providus updates after your wallet confirms the switch.</p>
              </div>
              <ul className="space-y-2" role="list">
                {WALLET_NETWORK_OPTIONS.map((option) => {
                  const current = activeNetwork.kind === "supported" && activeNetwork.chainId === option.chainId;
                  const targetPending = switching && switchTarget === option.key;
                  const availability = option.key === "botMainnet" ? BOT_MAINNET_STATUS.networkLabel : option.key === "botTestnet" ? "Verified BOT Testnet transfers" : "Celo airtime and cash-out";
                  return <li key={option.key}>
                    <button type="button" disabled={current || wallet.isNetworkSwitchPending} aria-pressed={current} aria-label={current ? `${option.displayName}, current network` : `Switch to ${option.displayName}, chain ID ${option.chainId}`} onClick={() => { wallet.clearNetworkSwitchMessage(); void wallet.requestNetworkSwitch(option.key); }} className={cn("flex min-h-12 w-full items-center justify-between gap-3 rounded-[10px] border-ledger px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green", current ? "bg-provident-green/10 text-ledger-stone" : "bg-receipt-field text-ledger-stone hover:bg-ledger-edge/50", wallet.isNetworkSwitchPending && !targetPending && "opacity-60")}>
                      <span className="min-w-0"><span className="block truncate text-sm font-semibold">{option.displayName}</span><span className="block truncate font-proof text-[10px] text-receipt-grey">{availability} · {option.chainId}</span></span>
                      <span className="shrink-0 font-proof text-[11px] font-semibold text-receipt-grey">{current ? "Current" : targetPending ? "Switching…" : "Switch"}</span>
                    </button>
                  </li>;
                })}
              </ul>
              {activeNetwork.kind === "supported" && activeNetwork.key === "botMainnet" ? <p className="rounded-[8px] bg-receipt-field px-3 py-2 text-xs font-semibold text-ledger-stone" role="status">{BOT_MAINNET_STATUS.productionLabel}</p> : null}
              {wallet.networkSwitch.status === "requesting" ? <p className="text-xs text-receipt-grey" role="status">Confirm the network switch in your wallet.</p> : null}
              {wallet.networkSwitch.status === "slow" ? <p className="text-xs text-receipt-grey" role="status">Still waiting for wallet confirmation. Keep the wallet open. The active network changes only after confirmation.</p> : null}
              {confirmedTarget ? <p className="text-xs text-provident-green" role="status">Wallet confirmed {WALLET_NETWORK_OPTIONS.find((item) => item.key === confirmedTarget)?.displayName}.</p> : null}
              {failedSwitch ? <div className="space-y-2" role="alert"><p className="text-xs text-loss-red">{failedSwitch.message}</p>{failedSwitch.kind === "manual" ? <ul className="rounded-[8px] bg-receipt-field px-3 py-2 font-proof text-[11px] text-ledger-stone" aria-label="Manual network settings">{networkSetupCopy(failedSwitch.target).map((line) => <li key={line} className="break-all">{line}</li>)}</ul> : null}</div> : null}
              {activeNetwork.kind === "unsupported" ? <p className="text-xs text-loss-red" role="status">Switch to a supported network before using network-specific payment controls.</p> : null}
            </section>

            <Button type="button" variant="ghost" size="sm" fullWidth className="mt-3" onClick={() => wallet.disconnectWallet()} disabled={wallet.isDisconnectPending || wallet.isNetworkSwitchPending}><Unplug className="h-4 w-4" aria-hidden />{wallet.isDisconnectPending ? "Disconnecting…" : "Disconnect"}</Button>
          </>
        ) : null}
      </div>
    </>
  ) : null;

  return <div className={cn("relative inline-flex min-w-0 items-center", fullWidth && "w-full")}>{trigger}<div id={statusId} className="sr-only" role="status" aria-live="polite">{!hydrated ? "Wallet status loading." : connectedHere ? `Connected on ${activeNetwork.kind === "supported" ? `${activeNetwork.displayName} (chain ${activeNetwork.chainId})` : activeNetwork.kind === "unsupported" ? `an unsupported network (chain ${activeNetwork.chainId})` : "an unknown network"}: ${wallet.address}` : wallet.isConnectPending ? "Connecting wallet." : "Wallet disconnected."}</div>{typeof document !== "undefined" && panel ? createPortal(panel, document.body) : null}</div>;
}

const walletAuthStatusCopy = {
  "awaiting-signature": "Confirm sign-in in your wallet",
} as const;
