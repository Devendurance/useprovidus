"use client";

import { useState, useEffect, useMemo, useContext } from "react";
import type { Address } from "viem";
import { WagmiContext, useSendTransaction } from "wagmi";
import {
  Coins,
  Copy,
  Check,
  Clock,
  ShieldCheck,
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  Wallet,
  Loader2,
  CheckCircle2,
  Tag,
} from "lucide-react";
import { CANONICAL_CELO_USDC } from "@/lib/celo/usdc";
import { CELO_CHAIN_ID, CELO_EXPLORER_URL } from "@/lib/wallet/celo";
import {
  ACTIVE_CELO_ATTRIBUTION_TAG,
  buildTaggedTransferCalldata,
} from "@/lib/celo/attribution";
import { formatDecimalForDisplay, usdcToBaseUnits } from "@/lib/money/decimal";
import { cn } from "@/lib/cn";

export interface PaymentInstructions {
  transactionId: string;
  receiveAddress: string;
  totalUsdcToSend: string;
  validUntil: string;
}

export type DepositProgressionStatus =
  | "pending"
  | "awaiting_deposit"
  | "submitting"
  | "verifying"
  | "settling"
  | "confirmed"
  | "error";

export interface PaymentInstructionsCardProps {
  instructions: PaymentInstructions;
  status?: DepositProgressionStatus;
  depositStatus?: DepositProgressionStatus;
  depositHash?: string | null;
  error?: string | null;
  depositError?: string | null;
  onPayWithConnectedWallet?: () => Promise<void> | void;
  onDepositConfirmed?: (celoTxHash: string) => Promise<{ ok: boolean; error?: string } | void>;
  onBackToPreview?: () => void;
  className?: string;
}

/** 60-second safety margin: deposit must be mined before validUntil */
export const PAYMENT_EXPIRY_SAFETY_MS = 60_000;

export function PaymentInstructionsCard({
  instructions,
  status = "awaiting_deposit",
  depositStatus: propDepositStatus,
  depositHash = null,
  error = null,
  depositError = null,
  onPayWithConnectedWallet,
  onDepositConfirmed,
  onBackToPreview,
  className,
}: PaymentInstructionsCardProps) {
  const [copied, setCopied] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const depositStatus = propDepositStatus ?? status;
  const currentStatus = depositStatus;
  const displayError = depositError ?? error ?? localError;
  // Check if Wagmi context is available for direct wallet submission
  const wagmiContext = useContext(WagmiContext);
  const hasWagmi = Boolean(wagmiContext);

  // Wagmi sendTransaction hook (only safe if wagmiContext is present, but Wagmi hooks must be called unconditionally)
  // When wagmiContext is not mounted (e.g. unit testing/node), we gracefully catch or guard.
  const wagmiSend = useSendTransaction();

  // 1-second countdown interval
  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const validUntilMs = useMemo(() => {
    const parsed = Date.parse(instructions.validUntil);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [instructions.validUntil]);

  const msRemaining = validUntilMs - nowMs;
  const isExpired = msRemaining <= 0;
  const isInsideSafetyMargin = msRemaining > 0 && msRemaining <= PAYMENT_EXPIRY_SAFETY_MS;

  const countdownText = useMemo(() => {
    if (isExpired) return "Expired";
    const totalSeconds = Math.max(0, Math.floor(msRemaining / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }, [isExpired, msRemaining]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(instructions.receiveAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      setCopied(false);
    }
  };

  const isSubmitting =
    localSubmitting ||
    Boolean(wagmiSend?.isPending) ||
    depositStatus === "submitting";
  const isSettling = depositStatus === "settling" || depositStatus === "confirmed";
  const isVerifyingActive = depositStatus === "verifying" && !displayError;
  const isActionDisabled = Boolean(depositHash)
    ? isSettling || localSubmitting || isVerifyingActive
    : isExpired ||
      depositStatus === "submitting" ||
      depositStatus === "verifying" ||
      depositStatus === "settling" ||
      isSubmitting;

  // IMPORTANT: Explicit user click ONLY. Never auto-trigger wallet transactions.
  const handlePayClick = async () => {
    // 1. If depositHash already exists: NEVER send another transaction!
    // Re-verify the existing transaction receipt on Celo.
    if (depositHash) {
      if (isSettling || localSubmitting || isVerifyingActive) {
        return;
      }

      setLocalSubmitting(true);
      setLocalError(null);
      try {
        if (onDepositConfirmed) {
          await onDepositConfirmed(depositHash);
        }
      } catch (err) {
        setLocalError(
          err instanceof Error ? err.message : "Failed to verify deposit.",
        );
      } finally {
        setLocalSubmitting(false);
      }
      return;
    }

    // 2. Initial transfer: Only when NO depositHash exists
    if (
      isExpired ||
      depositStatus === "submitting" ||
      depositStatus === "verifying" ||
      depositStatus === "settling" ||
      isSubmitting
    ) {
      return;
    }

    setLocalError(null);
    // 1. If consumer supplied a custom handler, delegate to it
    if (onPayWithConnectedWallet) {
      setLocalSubmitting(true);
      try {
        await onPayWithConnectedWallet();
      } catch (err) {
        setLocalError(
          err instanceof Error ? err.message : "Failed to initiate payment.",
        );
        setLocalSubmitting(false);
      }
      return;
    }

    // 2. Direct Wagmi execution fallback
    if (!hasWagmi) {
      setLocalError(
        "No wallet provider connected. Please connect your Web3 wallet to pay.",
      );
      return;
    }

    setLocalSubmitting(true);
    try {
      const amountBaseUnits = usdcToBaseUnits(instructions.totalUsdcToSend, 6);
      const taggedCalldata = buildTaggedTransferCalldata(
        instructions.receiveAddress as Address,
        amountBaseUnits,
      );

      wagmiSend.sendTransaction(
        {
          to: CANONICAL_CELO_USDC.address,
          data: taggedCalldata,
          chainId: CELO_CHAIN_ID,
        },
        {
          onSuccess: async (txHash) => {
            try {
              if (onDepositConfirmed) {
                await onDepositConfirmed(txHash);
              }
            } catch (err) {
              setLocalError(
                err instanceof Error
                  ? err.message
                  : "Failed to confirm deposit.",
              );
            } finally {
              setLocalSubmitting(false);
            }
          },
          onError: (err) => {
            setLocalError(
              err instanceof Error
                ? err.message
                : "Transaction rejected in wallet.",
            );
            setLocalSubmitting(false);
          },
        },
      );
    } catch (err) {
      setLocalError(
        err instanceof Error
          ? err.message
          : "Failed to construct tagged transfer.",
      );
      setLocalSubmitting(false);
    }
  };

  // Status Progression Stepper Items
  const steps: Array<{
    id: DepositProgressionStatus;
    label: string;
    state: "complete" | "active" | "upcoming";
  }> = [
    {
      id: "pending",
      label: "Pending",
      state:
        currentStatus === "pending"
          ? "active"
          : "complete",
    },
    {
      id: "awaiting_deposit",
      label: "Awaiting Deposit",
      state:
        Boolean(depositHash)
          ? "complete"
          : currentStatus === "pending"
            ? "upcoming"
            : currentStatus === "awaiting_deposit" || currentStatus === "submitting"
              ? "active"
              : "complete",
    },
    {
      id: "verifying",
      label: "Verifying",
      state:
        currentStatus === "verifying" || (Boolean(depositHash) && currentStatus === "error")
          ? "active"
          : isSettling
            ? "complete"
            : "upcoming",
    },
    {
      id: "settling",
      label: "Settling",
      state:
        isSettling
          ? "active"
          : "upcoming",
    },
  ];

  return (
    <div
      className={cn(
        "rounded-[14px] border-ledger bg-clear-paper p-4 sm:p-5 shadow-base transition-all",
        isSettling && "border-provident-green/60 bg-provident-green/[0.02]",
        className,
      )}
      role="region"
      aria-label="Payment Instructions"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ledger-edge/70 pb-3">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-ledger transition-colors",
              isSettling
                ? "bg-provident-green text-white"
                : "bg-quote-blue/10 text-quote-blue",
            )}
          >
            {isSettling ? (
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Coins className="h-4 w-4" aria-hidden="true" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display text-base font-semibold text-ledger-stone">
                Payment Instructions
              </h3>
              <span className="rounded border border-ledger-edge bg-receipt-field px-1.5 py-0.5 font-proof text-[10px] text-receipt-grey">
                Server-Authoritative Order
              </span>
            </div>
            <p className="font-proof text-[11px] text-receipt-grey">
              Paycrest corridor deposit · Celo USDC
            </p>
          </div>
        </div>

        {/* Expiry Countdown Timer */}
        <div className="flex items-center gap-2">
          {isExpired ? (
            <span className="inline-flex items-center gap-1.5 rounded border border-loss-red/40 bg-loss-red/10 px-2 py-0.5 font-proof tabular-nums text-xs font-semibold text-loss-red">
              <Clock className="h-3.5 w-3.5" />
              Order Expired
            </span>
          ) : isInsideSafetyMargin ? (
            <span className="inline-flex items-center gap-1.5 rounded border border-rate-amber/40 bg-rate-amber/10 px-2 py-0.5 font-proof tabular-nums text-xs font-semibold text-rate-amber">
              <Clock className="h-3.5 w-3.5 animate-pulse" />
              Expires in {countdownText} (Safety margin)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded border border-quote-blue/40 bg-quote-blue/10 px-2 py-0.5 font-proof tabular-nums text-xs font-semibold text-quote-blue">
              <Clock className="h-3.5 w-3.5" />
              Valid for {countdownText}
            </span>
          )}
        </div>
      </div>

      {/* Status Progression Stepper */}
      <div className="mt-4 rounded-[10px] border border-ledger-edge bg-receipt-field/70 p-3">
        <div className="flex items-center justify-between text-[11px] font-proof text-receipt-grey">
          <span>Order Progression</span>
          <span className="font-semibold text-ledger-stone capitalize">
            {currentStatus.replace("_", " ")}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {steps.map((step) => {
            return (
              <div key={step.id} className="flex flex-col items-center text-center">
                <div
                  className={cn(
                    "h-1.5 w-full rounded-full transition-colors",
                    step.state === "complete"
                      ? "bg-provident-green"
                      : step.state === "active"
                        ? "bg-quote-blue animate-pulse"
                        : "bg-ledger-edge/60",
                  )}
                />
                <span
                  className={cn(
                    "mt-1.5 text-[10px] font-medium leading-tight font-proof",
                    step.state === "complete"
                      ? "text-provident-green font-semibold"
                      : step.state === "active"
                        ? "text-quote-blue font-bold"
                        : "text-receipt-grey",
                  )}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Payment Details Grid */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Authoritative USDC Amount Box */}
        <div className="rounded-[10px] border border-ledger-edge bg-receipt-field p-3.5">
          <div className="flex items-center justify-between">
            <span className="font-proof text-xs text-receipt-grey">
              Authoritative Amount to Send
            </span>
            <span className="inline-flex items-center gap-1 rounded bg-provident-green/10 px-1.5 py-0.5 font-proof text-[10px] font-bold text-provident-green border border-provident-green/30">
              <ShieldCheck className="h-3 w-3" />
              Exact Total
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-proof tabular-nums text-2xl font-bold text-ledger-stone">
              {formatDecimalForDisplay(instructions.totalUsdcToSend)}
            </span>
            <span className="font-proof text-sm text-receipt-grey">USDC</span>
          </div>
          <p className="mt-2 text-[11px] font-proof text-receipt-grey border-t border-ledger-edge/60 pt-2">
            Canonical Circle USDC on Celo ({CANONICAL_CELO_USDC.decimals} decimals). Do not send more or less.
          </p>
        </div>

        {/* Receive Address & Copy Box */}
        <div className="rounded-[10px] border border-ledger-edge bg-receipt-field p-3.5">
          <div className="flex items-center justify-between">
            <span className="font-proof text-xs text-receipt-grey">
              Paycrest Receive Address
            </span>
            <span className="font-proof text-[10px] text-receipt-grey">
              Corridor Destination
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 rounded-[8px] border border-ledger bg-clear-paper px-2.5 py-1.5">
            <code className="font-proof text-[12px] font-mono text-ledger-stone select-all truncate">
              {instructions.receiveAddress}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy receive address"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-ledger-edge text-quote-blue transition-colors hover:bg-receipt-field active:scale-95"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-provident-green" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          <p className="mt-2 text-[11px] font-proof text-receipt-grey border-t border-ledger-edge/60 pt-2 flex items-center justify-between">
            <span>{copied ? "Copied to clipboard!" : "Click icon to copy destination address"}</span>
            <span className="text-[10px] uppercase tracking-wider text-receipt-grey font-mono">
              Tx: {instructions.transactionId.slice(0, 10)}…
            </span>
          </p>
        </div>
      </div>

      {/* Attribution Indicator */}
      <div className="mt-3 flex items-center justify-between rounded-[10px] border border-quote-blue/30 bg-quote-blue/5 p-2.5 text-xs text-ledger-stone">
        <div className="flex items-center gap-2 font-proof">
          <Tag className="h-3.5 w-3.5 text-quote-blue" />
          <span className="text-receipt-grey">ERC-8021 Attribution:</span>
          <code className="rounded bg-clear-paper px-1.5 py-0.5 font-mono text-[11px] font-bold text-quote-blue border border-quote-blue/20">
            {ACTIVE_CELO_ATTRIBUTION_TAG}
          </code>
        </div>
        <span className="font-proof text-[10px] text-provident-green font-medium">
          ✓ Tagged Calldata
        </span>
      </div>

      {/* Error Alert */}
      {displayError ? (
        <div className="mt-3 flex items-start gap-2 rounded-[10px] border border-loss-red/40 bg-loss-red/10 p-3 text-xs text-ledger-stone">
          <AlertTriangle className="h-4 w-4 shrink-0 text-loss-red mt-0.5" />
          <div>
            <p className="font-semibold text-loss-red">Payment Notice</p>
            <p className="mt-0.5 text-receipt-grey">{displayError}</p>
          </div>
        </div>
      ) : null}

      {/* Safety Margin Warning */}
      {isInsideSafetyMargin && !isExpired ? (
        <div className="mt-3 flex items-start gap-2 rounded-[10px] border border-rate-amber/40 bg-rate-amber/10 p-3 text-xs text-ledger-stone">
          <Clock className="h-4 w-4 shrink-0 text-rate-amber mt-0.5" />
          <div>
            <p className="font-semibold text-rate-amber">Safety Margin Active</p>
            <p className="mt-0.5 text-receipt-grey">
              Less than 60 seconds remaining. Transfers must be included in a Celo block before the order expires to avoid settlement delays.
            </p>
          </div>
        </div>
      ) : null}

      {/* Broadcast / Awaiting Block Inclusion Notice with Hash */}
      {!isSettling && depositHash ? (
        <div className="mt-3 flex items-center justify-between rounded-[10px] border border-quote-blue/40 bg-quote-blue/10 p-3 text-xs text-ledger-stone">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-quote-blue shrink-0 animate-pulse" />
            <div>
              <p className="font-semibold text-quote-blue">Transaction Broadcast to Celo</p>
              <p className="font-proof text-receipt-grey text-[11px]">
                Tx: {depositHash.slice(0, 10)}…{depositHash.slice(-8)}
              </p>
            </div>
          </div>
          <a
            href={`${CELO_EXPLORER_URL}/tx/${depositHash}`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 font-proof text-xs font-semibold text-quote-blue hover:underline"
          >
            <span>Check on CeloScan</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      ) : null}

      {/* Settling / Confirmed Notice with Hash */}
      {isSettling && depositHash ? (
        <div className="mt-3 flex items-center justify-between rounded-[10px] border border-provident-green/40 bg-provident-green/10 p-3 text-xs text-ledger-stone">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-provident-green shrink-0" />
            <div>
              <p className="font-semibold text-deep-provision">Deposit Confirmed on Celo</p>
              <p className="font-proof text-receipt-grey text-[11px]">
                Server verified receipt. Paycrest is now settling the utility order.
              </p>
            </div>
          </div>
          <a
            href={`${CELO_EXPLORER_URL}/tx/${depositHash}`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 font-proof text-xs font-semibold text-quote-blue hover:underline"
          >
            <span>Explorer</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      ) : null}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ledger-edge/70 pt-3">
        <div>
          {onBackToPreview && depositStatus !== "confirmed" && !depositHash ? (
            <button
              type="button"
              onClick={onBackToPreview}
              disabled={
                depositStatus === "submitting" ||
                depositStatus === "verifying" ||
                depositStatus === "settling" ||
                isSubmitting
              }
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-ledger-edge bg-clear-paper px-3 py-1.5 font-display text-xs font-semibold text-receipt-grey transition-all hover:border-ledger hover:text-ledger-stone active:translate-x-0.5 active:translate-y-0.5 disabled:opacity-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to preview</span>
            </button>
          ) : null}
        </div>

        <div>
          {depositStatus === "confirmed" ? (
            <span className="inline-flex items-center gap-2 rounded-[8px] border border-provident-green/50 bg-provident-green/10 px-4 py-2 font-display text-xs font-semibold text-deep-provision">
              <CheckCircle2 className="h-4 w-4 text-provident-green" />
              <span>Settlement in progress</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={handlePayClick}
              disabled={isActionDisabled}
              className={cn(
                "inline-flex min-h-[38px] items-center gap-2 rounded-[8px] border border-ledger bg-provident-green px-4 py-2 font-display text-xs font-semibold text-white transition-all shadow-sticker active:translate-x-0.5 active:translate-y-0.5",
                "hover:bg-deep-provision",
                isActionDisabled &&
                  "opacity-50 cursor-not-allowed shadow-none active:translate-x-0 active:translate-y-0",
              )}
            >
              {depositHash ? (
                localSubmitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Verifying transaction on Celo...</span>
                  </>
                ) : depositStatus === "settling" ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Settling order...</span>
                  </>
                ) : isVerifyingActive ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Verifying on Celo...</span>
                  </>
                ) : depositStatus === "error" ? (
                  <>
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>Check on-chain receipt again</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>Check verification again</span>
                  </>
                )
              ) : depositStatus === "submitting" || isSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Confirm in wallet...</span>
                </>
              ) : depositStatus === "verifying" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Verifying on Celo...</span>
                </>
              ) : depositStatus === "settling" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Settling order...</span>
                </>
              ) : (
                <>
                  <Wallet className="h-3.5 w-3.5" />
                  <span>Pay with Connected Wallet</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
