"use client";

import { useId, useState } from "react";
import {
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

export function ConnectWalletButton({
  className,
  size = "sm",
  fullWidth = false,
  label = "Connect wallet",
  showBalances = true,
}: ConnectWalletButtonProps) {
  const wallet = useProvidusWallet();
  const statusId = useId();
  const chooserId = useId();
  const [chooserOpen, setChooserOpen] = useState(false);

  const shell = cn(
    "relative inline-flex flex-col items-stretch",
    fullWidth && "w-full",
  );

  function openChooser() {
    wallet.clearConnectError();
    setChooserOpen(true);
    // Does not call connect — user must pick a wallet.
  }

  function closeChooser() {
    setChooserOpen(false);
  }

  function selectWallet(id: SupportedWalletId, installed: boolean) {
    if (!installed || wallet.isConnectPending) return;
    wallet.connectWithConnectorId(id);
  }

  // Keep chooser visible while a connection is pending after user selection
  const showChooser =
    wallet.status === "disconnected" || wallet.status === "connecting";

  if (showChooser) {
    return (
      <div className={shell}>
        <Button
          type="button"
          variant="ghost"
          size={size}
          fullWidth={fullWidth}
          className={cn("border-ledger bg-clear-paper shadow-base", className)}
          onClick={openChooser}
          aria-expanded={chooserOpen}
          aria-controls={chooserId}
          disabled={wallet.isConnectPending}
          aria-busy={wallet.isConnectPending}
        >
          {wallet.isConnectPending ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          ) : (
            <Wallet className="h-4 w-4 shrink-0" aria-hidden />
          )}
          {wallet.isConnectPending ? "Connecting…" : label}
        </Button>

        {chooserOpen ? (
          <div
            id={chooserId}
            role="dialog"
            aria-label="Choose a wallet"
            className="absolute left-0 right-0 top-full z-30 mt-2 min-w-[260px] rounded-[14px] border-ledger bg-clear-paper p-3 shadow-prominent sm:left-auto sm:right-0 sm:w-[300px]"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ledger-stone">
                Connect wallet
              </p>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-ledger-edge text-receipt-grey hover:bg-ledger-edge/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green"
                onClick={closeChooser}
                aria-label="Close wallet chooser"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <p className="mb-3 text-xs text-receipt-grey">
              MetaMask, Rabby, or OKX only. Choose deliberately — no automatic
              selection.
            </p>
            <ul className="flex flex-col gap-2" role="list">
              {wallet.walletOptions.map((option, index) => (
                <li key={option.id}>
                  <div className="flex items-stretch gap-2">
                    <button
                      type="button"
                      className={cn(
                        "flex min-h-11 flex-1 items-center justify-between gap-2 rounded-[10px] border-ledger px-3 py-2 text-left text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green",
                        option.installed
                          ? "bg-receipt-field text-ledger-stone hover:bg-ledger-edge/50"
                          : "cursor-not-allowed bg-receipt-field/60 text-receipt-grey opacity-80",
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
                        <span className="font-proof text-[11px] text-receipt-grey">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        {option.name}
                      </span>
                      <span className="font-proof text-[11px] font-medium text-receipt-grey">
                        {option.installed ? "Installed" : option.notInstalledLabel}
                      </span>
                    </button>
                    {!option.installed ? (
                      <a
                        href={option.installUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-11 shrink-0 items-center justify-center rounded-[10px] border border-ledger-edge px-3 text-xs font-semibold text-quote-blue hover:bg-ledger-edge/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green"
                        // Opening install link must not trigger wallet connect
                        onClick={(e) => e.stopPropagation()}
                      >
                        Install
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            {wallet.isConnectPending ? (
              <p className="mt-3 text-xs text-receipt-grey" role="status" id={statusId}>
                Confirm the request in the selected wallet only…
              </p>
            ) : null}
            {wallet.connectError ? (
              <p
                role="alert"
                className="mt-3 rounded-[10px] border border-loss-red/40 bg-receipt-field px-3 py-2 text-xs font-medium text-loss-red"
              >
                {wallet.connectError}
              </p>
            ) : null}
          </div>
        ) : wallet.connectError ? (
          <p
            role="alert"
            className="absolute left-0 right-0 top-full z-20 mt-2 rounded-[10px] border border-loss-red/40 bg-clear-paper px-3 py-2 text-left text-xs font-medium text-loss-red shadow-elevated sm:min-w-[220px]"
          >
            {wallet.connectError}
          </p>
        ) : null}
      </div>
    );
  }

  // Connected or wrong-network
  const truncated = wallet.address
    ? truncateAddress(wallet.address)
    : "Wallet";

  return (
    <div className={shell}>
      <div
        className={cn(
          "flex flex-col gap-2 rounded-[10px] border-ledger bg-clear-paper p-2 shadow-base",
          fullWidth && "w-full",
          className,
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex min-h-11 flex-1 items-center gap-2 rounded-[10px] px-3 py-2 text-left text-sm font-semibold text-ledger-stone"
            aria-describedby={statusId}
          >
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                wallet.status === "connected"
                  ? "bg-provident-green"
                  : "bg-rate-amber",
              )}
              aria-hidden
            />
            <span className="font-proof text-[13px] tracking-tight">
              {truncated}
            </span>
          </div>
          {wallet.address && wallet.status === "connected" ? (
            <a
              href={addressExplorerUrl(wallet.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-ledger-edge text-quote-blue hover:bg-ledger-edge/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green"
              aria-label="View address on Celoscan"
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          ) : null}
        </div>

        {wallet.status === "wrong-network" ? (
          <div className="space-y-2 px-1 pb-1">
            <p className="text-xs font-medium text-rate-amber" role="status">
              Switch to Celo mainnet to use Providus payments.
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
                onClick={() => wallet.disconnectWallet()}
                disabled={wallet.isDisconnectPending}
              >
                <Unplug className="h-4 w-4" aria-hidden />
                Disconnect
              </Button>
            </div>
            {wallet.switchError ? (
              <p className="text-xs text-loss-red" role="alert">
                {wallet.switchError}
              </p>
            ) : null}
          </div>
        ) : null}

        {wallet.status === "connected" && showBalances ? (
          <div className="space-y-1 border-t border-ledger-edge px-1 pb-1 pt-2">
            {wallet.balancesLoading ? (
              <p className="font-proof text-[12px] text-receipt-grey">
                Reading balances…
              </p>
            ) : (
              <dl className="grid grid-cols-2 gap-2 font-proof text-[12px] text-ledger-stone">
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
              <p className="text-[11px] text-rate-amber" role="status">
                {wallet.balancesError}
              </p>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              fullWidth
              className="mt-1"
              onClick={() => wallet.disconnectWallet()}
              disabled={wallet.isDisconnectPending}
            >
              <Unplug className="h-4 w-4" aria-hidden />
              Disconnect
            </Button>
          </div>
        ) : null}

        {wallet.status === "connected" && !showBalances ? (
          <div className="px-1 pb-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              fullWidth
              onClick={() => wallet.disconnectWallet()}
              disabled={wallet.isDisconnectPending}
            >
              <Unplug className="h-4 w-4" aria-hidden />
              Disconnect
            </Button>
          </div>
        ) : null}
      </div>

      <div id={statusId} className="sr-only" role="status">
        {wallet.status === "connected"
          ? `Connected on Celo: ${wallet.address}`
          : `Connected on unsupported network. Switch to Celo.`}
      </div>
    </div>
  );
}
