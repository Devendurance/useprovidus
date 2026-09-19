"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Unplug, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProvidusWallet } from "@/hooks/use-providus-wallet";
import { addressExplorerUrl } from "@/lib/wallet/celo";
import { truncateAddress } from "@/lib/wallet/format";
import type { SupportedWalletId } from "@/lib/wallet/supported-wallets";
import { cn } from "@/lib/cn";

type ConnectWalletButtonProps = {
  className?: string;
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
  label?: string;
  showBalances?: boolean;
};

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ConnectWalletButton({ className, size = "sm", fullWidth = false, label = "Connect wallet", showBalances = true }: ConnectWalletButtonProps) {
  const wallet = useProvidusWallet();
  const statusId = useId();
  const panelId = useId();
  const titleId = useId();
  const [panelOpen, setPanelOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousStatusRef = useRef(wallet.status);

  const showChooser = wallet.status === "disconnected" || wallet.status === "connecting";
  const truncated = wallet.address ? truncateAddress(wallet.address) : "Wallet";

  function positionPanel() {
    if (typeof window === "undefined" || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.min(360, Math.max(260, window.innerWidth - 24));
    const panelHeight = panelRef.current?.getBoundingClientRect().height ?? 420;
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
    else setPanelOpen(true);
  }

  function selectWallet(id: SupportedWalletId, installed: boolean) {
    if (!installed || wallet.isConnectPending) return;
    wallet.connectWithConnectorId(id);
  }

  useEffect(() => {
    if (panelOpen && previousStatusRef.current !== "connected" && wallet.status === "connected") closePanel();
    previousStatusRef.current = wallet.status;
  }, [wallet.status, panelOpen]);

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
      aria-describedby={statusId} aria-busy={wallet.isConnectPending}>
      {wallet.isConnectPending ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
        : wallet.status === "wrong-network" ? <AlertTriangle className="h-4 w-4 shrink-0 text-loss-red" aria-hidden />
          : wallet.status === "connected" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-provident-green" aria-hidden />
            : <Wallet className="h-4 w-4 shrink-0" aria-hidden />}
      <span className="truncate">{wallet.isConnectPending ? "Connecting…" : wallet.status === "wrong-network" ? "Wrong network" : wallet.status === "connected" ? truncated : label}</span>
    </Button>
  );

  const panel = panelOpen ? (
    <>
      <div className="fixed inset-0 z-[70] bg-ledger-stone/20 sm:hidden" aria-hidden onPointerDown={() => closePanel()} />
      <div ref={panelRef} id={panelId} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="fixed inset-x-3 bottom-3 z-[71] max-h-[min(82svh,680px)] w-auto overflow-y-auto rounded-[10px] border-ledger bg-clear-paper p-3 shadow-prominent sm:inset-x-auto sm:bottom-auto sm:w-[min(360px,calc(100vw-24px))]"
        style={position ? { top: position.top, left: position.left, width: position.width } : undefined}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p id={titleId} className="text-sm font-semibold text-ledger-stone">{showChooser ? "Connect wallet" : wallet.status === "wrong-network" ? "Wallet needs Celo" : "Wallet connected"}</p>
          <button type="button" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-ledger-edge text-receipt-grey hover:bg-ledger-edge/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green" onClick={() => closePanel()} aria-label="Close wallet panel">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {showChooser ? (
          <>
            <p className="mb-3 text-xs text-receipt-grey">MetaMask, Rabby, or OKX only. Choose deliberately — no automatic selection.</p>
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
            {wallet.isConnectPending ? <p className="mt-3 text-xs text-receipt-grey" role="status">Confirm the request in the selected wallet only…</p> : null}
            {wallet.connectError ? <p role="alert" className="mt-3 rounded-[10px] border border-loss-red/40 bg-receipt-field px-3 py-2 text-xs font-medium text-loss-red">{wallet.connectError}</p> : null}
          </>
        ) : (
          <>
            <div className="mb-3 flex min-w-0 items-center gap-2 rounded-[10px] bg-receipt-field px-3 py-2 text-sm font-semibold text-ledger-stone">
              {wallet.status === "wrong-network" ? <AlertTriangle className="h-4 w-4 shrink-0 text-loss-red" aria-hidden /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-provident-green" aria-hidden />}<span className="truncate font-proof">{truncated}</span>
            </div>
            {wallet.status === "connected" && wallet.address ? <a href={addressExplorerUrl(wallet.address)} target="_blank" rel="noopener noreferrer" className="mb-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-quote-blue underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green">View address on Celoscan <ExternalLink className="h-4 w-4" aria-hidden /></a> : null}
            {wallet.status === "wrong-network" ? <div className="space-y-2 pb-1"><p className="text-xs font-medium text-loss-red" role="status">Switch to Celo mainnet to use Providus payments.</p><Button type="button" variant="primary" size="sm" fullWidth onClick={() => wallet.switchToCelo()} disabled={wallet.isSwitchPending}>{wallet.isSwitchPending ? "Switching…" : "Switch to Celo"}</Button>{wallet.switchError ? <p className="text-xs text-loss-red" role="alert">{wallet.switchError}</p> : null}</div> : null}
            {wallet.status === "connected" && showBalances ? <div className="space-y-2 border-t border-ledger-edge pt-2">{wallet.balancesLoading ? <p className="font-proof text-[12px] text-receipt-grey" role="status">Reading balances…</p> : <dl className="grid min-w-0 grid-cols-2 gap-2 font-proof text-[12px] text-ledger-stone"><div className="min-w-0"><dt className="text-receipt-grey">CELO</dt><dd className="truncate font-medium tabular-nums">{wallet.nativeBalance?.value ?? "—"}</dd></div><div className="min-w-0"><dt className="text-receipt-grey">USDC</dt><dd className="truncate font-medium tabular-nums">{wallet.usdcBalance?.value ?? (wallet.usdcConfigured ? "—" : "n/a")}</dd></div></dl>}{wallet.balancesError ? <p className="text-[11px] text-ledger-stone" role="status">{wallet.balancesError}</p> : null}</div> : null}
            <Button type="button" variant="ghost" size="sm" fullWidth className="mt-3" onClick={() => wallet.disconnectWallet()} disabled={wallet.isDisconnectPending}><Unplug className="h-4 w-4" aria-hidden />{wallet.isDisconnectPending ? "Disconnecting…" : "Disconnect"}</Button>
          </>
        )}
      </div>
    </>
  ) : null;

  return <div className={cn("relative inline-flex min-w-0 items-center", fullWidth && "w-full")}>{trigger}<div id={statusId} className="sr-only" role="status" aria-live="polite">{wallet.status === "connected" ? `Connected on Celo: ${wallet.address}` : wallet.status === "wrong-network" ? "Wrong network. Switch to Celo to use Providus payments." : wallet.isConnectPending ? "Connecting wallet." : "Wallet disconnected."}</div>{typeof document !== "undefined" && panel ? createPortal(panel, document.body) : null}</div>;
}
