"use client";

import { createPortal } from "react-dom";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  Unplug,
  Wallet,
  X,
} from "lucide-react";
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
  /** Show CELO/USDC balances when connected on Celo (default true). */
  showBalances?: boolean;
};

type PopoverPlacement = {
  top: number;
  left: number;
};

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const NOOP_SUBSCRIBE = () => () => {};
const CLIENT_HYDRATED = () => true;
const SERVER_HYDRATED = () => false;

export function ConnectWalletButton({
  className,
  size = "sm",
  fullWidth = false,
  label = "Connect wallet",
  showBalances = true,
}: ConnectWalletButtonProps) {
  const wallet = useProvidusWallet();
  const hydrated = useSyncExternalStore(
    NOOP_SUBSCRIBE,
    CLIENT_HYDRATED,
    SERVER_HYDRATED,
  );
  const statusId = useId();
  const panelId = useId();
  const [panelOpen, setPanelOpen] = useState(false);
  const [placement, setPlacement] = useState<PopoverPlacement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousStatusRef = useRef(wallet.status);

  const shell = cn(
    "inline-flex h-11 min-h-11 items-center",
    fullWidth && "w-full",
  );

  const displayedStatus = hydrated ? wallet.status : "disconnected";
  const displayedConnectPending = hydrated && wallet.isConnectPending;
  const displayedConnectError = hydrated ? wallet.connectError : null;
  const isChooserState =
    displayedStatus === "disconnected" || displayedStatus === "connecting";
  const isWrongNetwork = displayedStatus === "wrong-network";
  const isConnected = displayedStatus === "connected";

  function openPanel() {
    if (displayedStatus === "disconnected") {
      wallet.clearConnectError();
    }
    setPanelOpen(true);
  }

  function closePanel() {
    setPanelOpen(false);
    triggerRef.current?.focus();
  }

  function selectWallet(id: SupportedWalletId, installed: boolean) {
    if (!installed || wallet.isConnectPending) return;
    wallet.connectWithConnectorId(id);
  }

  function disconnect() {
    closePanel();
    wallet.disconnectWallet();
  }

  // A successful connect or network switch closes the details panel. Opening
  // an already-connected trigger does not close it because this only responds
  // to a status transition.
  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = wallet.status;

    const completedConnection =
      previousStatus !== "connected" && wallet.status === "connected";
    const completedWrongNetworkConnection =
      previousStatus === "connecting" && wallet.status === "wrong-network";

    if (
      panelOpen &&
      (completedConnection || completedWrongNetworkConnection)
    ) {
      closePanel();
    }
  }, [panelOpen, wallet.status]);

  // Keep the popover attached to the trigger while the page scrolls or the
  // viewport changes. The panel itself is fixed, so it never contributes to
  // the header's layout height.
  useEffect(() => {
    if (!panelOpen || typeof window === "undefined") return;

    let frame = 0;
    function positionPanel() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const isMobile = window.matchMedia("(max-width: 639px)").matches;
        if (isMobile) {
          setPlacement(null);
          return;
        }

        const trigger = triggerRef.current;
        if (!trigger) return;

        const triggerRect = trigger.getBoundingClientRect();
        const panelWidth =
          panelRef.current?.getBoundingClientRect().width ??
          Math.min(360, window.innerWidth - 24);
        const panelHeight =
          panelRef.current?.getBoundingClientRect().height ?? 420;
        const gutter = 12;
        const gap = 10;
        const maxLeft = Math.max(
          gutter,
          window.innerWidth - panelWidth - gutter,
        );
        const left = Math.min(
          Math.max(gutter, triggerRect.right - panelWidth),
          maxLeft,
        );
        const belowTop = triggerRect.bottom + gap;
        const aboveTop = triggerRect.top - panelHeight - gap;
        const top =
          belowTop + panelHeight <= window.innerHeight - gutter
            ? belowTop
            : Math.max(gutter, aboveTop);

        setPlacement({ top, left });
      });
    }

    positionPanel();
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
    };
  }, [panelOpen]);

  // Focus the panel on open, trap Tab navigation within it, and provide the
  // expected Escape-to-close behavior for both the desktop popover and the
  // mobile bottom sheet.
  useEffect(() => {
    if (!panelOpen) return;

    const panel = panelRef.current;
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePanel();
        return;
      }

      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [panelOpen]);

  const truncated = wallet.address
    ? truncateAddress(wallet.address)
    : "Wallet";
  const triggerLabel = isWrongNetwork
    ? "Wrong network"
    : displayedConnectPending
      ? "Connecting…"
      : isConnected
        ? truncated
        : label;
  const statusText = isWrongNetwork
    ? "Wrong network. Switch to Celo mainnet to use Providus payments."
    : isConnected
      ? `Connected on Celo: ${wallet.address ?? "wallet"}.`
      : displayedConnectPending
        ? "Connecting. Confirm the request in your wallet."
        : displayedConnectError
          ? `Connection error: ${displayedConnectError}`
          : "";

  const panel = panelOpen ? (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[90] cursor-default border-0 bg-transparent p-0 max-sm:bg-ink/20"
        onClick={closePanel}
        aria-label="Close wallet details"
      />
      <div
        id={panelId}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${panelId}-title`}
        className="fixed z-[100] max-h-[calc(100dvh-24px)] w-[min(360px,calc(100vw-24px))] overflow-y-auto rounded-[8px] border-2 border-ink bg-cream p-3 text-ink max-sm:inset-x-3 max-sm:bottom-3 max-sm:left-3 max-sm:top-auto max-sm:w-auto"
        style={placement ?? undefined}
      >
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p
              id={`${panelId}-title`}
              className="text-sm font-semibold text-ink"
            >
              {isChooserState
                ? "Connect wallet"
                : isWrongNetwork
                  ? "Wallet needs attention"
                  : "Wallet connected"}
            </p>
            <p className="mt-1 break-words text-xs text-receipt-grey">
              {isChooserState
                ? "Choose a wallet deliberately."
                : isWrongNetwork
                  ? "Switch networks before using Providus payments."
                  : "Manage this wallet session."}
            </p>
          </div>
          <button
            type="button"
            ref={closeRef}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] border-2 border-sage-line text-receipt-grey hover:bg-sage-line/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            onClick={closePanel}
            aria-label="Close wallet details"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {isChooserState ? (
          <>
            <p className="mb-3 text-xs text-receipt-grey">
              MetaMask, Rabby, or OKX only. No automatic wallet selection.
            </p>
            <ul className="flex flex-col gap-2" role="list">
              {wallet.walletOptions.map((option, index) => (
                <li key={option.id}>
                  <div className="flex items-stretch gap-2">
                    <button
                      type="button"
                      className={cn(
                        "flex min-h-11 flex-1 items-center justify-between gap-2 rounded-[8px] border-2 border-ink px-3 py-2 text-left text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                        option.installed
                          ? "bg-cream text-ink hover:bg-sage-line/50"
                          : "cursor-not-allowed bg-cream/60 text-receipt-grey opacity-80",
                      )}
                      disabled={!option.installed || wallet.isConnectPending}
                      onClick={() => selectWallet(option.id, option.installed)}
                      aria-label={
                        option.installed
                          ? `Connect with ${option.name}`
                          : `${option.name} not installed`
                      }
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-sans text-[11px] text-receipt-grey">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        {option.name}
                      </span>
                      <span className="font-sans text-[11px] font-medium text-receipt-grey">
                        {option.installed ? "Installed" : option.notInstalledLabel}
                      </span>
                    </button>
                    {!option.installed ? (
                      <a
                        href={option.installUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-11 shrink-0 items-center justify-center rounded-[8px] border-2 border-sage-line px-3 text-xs font-semibold text-focus hover:bg-sage-line/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        onClick={(event) => event.stopPropagation()}
                      >
                        Install
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            {displayedConnectPending ? (
              <p className="mt-3 text-xs text-receipt-grey" role="status">
                Confirm the request in the selected wallet only…
              </p>
            ) : null}
            {displayedConnectError ? (
              <p
                role="alert"
                className="mt-3 rounded-[8px] border-2 border-error/40 bg-cream px-3 py-2 text-xs font-medium text-error"
              >
                {displayedConnectError}
              </p>
            ) : null}
          </>
        ) : (
          <>
            {isWrongNetwork ? (
              <div className="space-y-2">
                <p
                  className="flex items-start gap-2 text-xs font-medium text-error"
                  role="status"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>Switch to Celo mainnet to use Providus payments.</span>
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    fullWidth
                    onClick={() => wallet.switchToCelo()}
                    disabled={wallet.isSwitchPending}
                  >
                    {wallet.isSwitchPending ? "Switching…" : "Switch to Celo"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    fullWidth
                    onClick={disconnect}
                    disabled={wallet.isDisconnectPending}
                  >
                    <Unplug className="h-4 w-4" aria-hidden />
                    Disconnect
                  </Button>
                </div>
                {wallet.switchError ? (
                  <p className="text-xs text-error" role="alert">
                    {wallet.switchError}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 rounded-[8px] border-2 border-sage-line px-3 py-2">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden />
                  <span className="min-w-0 flex-1 break-all font-sans text-[13px] tracking-tight">
                    {wallet.address ?? truncated}
                  </span>
                  {wallet.address ? (
                    <a
                      href={addressExplorerUrl(wallet.address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] border-2 border-sage-line text-focus hover:bg-sage-line/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                      aria-label="View address on Celoscan"
                    >
                      <ExternalLink className="h-4 w-4" aria-hidden />
                    </a>
                  ) : null}
                </div>
                {showBalances ? (
                  <div className="space-y-1 border-t border-sage-line pt-2">
                    {wallet.balancesLoading ? (
                      <p className="font-sans text-[12px] text-receipt-grey">
                        Reading balances…
                      </p>
                    ) : (
                      <dl className="grid grid-cols-2 gap-2 font-sans text-[12px] text-ink">
                        <div>
                          <dt className="text-receipt-grey">CELO</dt>
                          <dd className="font-medium tabular-nums">
                            {wallet.nativeBalance?.value ?? "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-receipt-grey">USDC</dt>
                          <dd className="font-medium tabular-nums">
                            {wallet.usdcBalance?.value ??
                              (wallet.usdcConfigured ? "—" : "n/a")}
                          </dd>
                        </div>
                      </dl>
                    )}
                    {wallet.balancesError ? (
                      <p className="text-[11px] text-warning" role="status">
                        {wallet.balancesError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  fullWidth
                  onClick={disconnect}
                  disabled={wallet.isDisconnectPending}
                >
                  <Unplug className="h-4 w-4" aria-hidden />
                  Disconnect
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  ) : null;

  return (
    <div className={shell}>
      <Button
        type="button"
        ref={triggerRef}
        variant="ghost"
        size={size}
        fullWidth={fullWidth}
        className={cn(
          "h-11 min-h-11 max-w-full border-2 border-ink bg-cream",
          isWrongNetwork && "border-error text-error hover:bg-error/10",
          className,
        )}
        onClick={() => (panelOpen ? closePanel() : openPanel())}
        aria-expanded={panelOpen}
        aria-controls={panelId}
        aria-haspopup="dialog"
        aria-describedby={statusId}
        disabled={displayedConnectPending}
        aria-busy={displayedConnectPending}
      >
        {displayedConnectPending ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
        ) : isWrongNetwork ? (
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        ) : isConnected ? (
          <span className="h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden />
        ) : (
          <Wallet className="h-4 w-4 shrink-0" aria-hidden />
        )}
        <span className="truncate">{triggerLabel}</span>
      </Button>

      <div id={statusId} className="sr-only" role="status" aria-live="polite">
        {statusText}
      </div>

      {panel && typeof document !== "undefined"
        ? createPortal(panel, document.body)
        : null}
    </div>
  );
}
