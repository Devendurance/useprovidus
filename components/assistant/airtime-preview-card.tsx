"use client";

import { useState, useEffect } from "react";
import type { AirtimePreview, ConfirmedAirtimePayment } from "@/lib/assistant/types";
import type { ConfirmedPaymentState } from "@/hooks/use-assistant";
import {
  PaymentInstructionsCard,
  type PaymentInstructions,
  type DepositProgressionStatus,
} from "@/components/assistant/payment-instructions-card";
import type { TransactionStage } from "@/lib/transactions/status";
import { formatDecimalForDisplay } from "@/lib/money/decimal";
import { cn } from "@/lib/cn";
import {
  Smartphone,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RefreshCw,
  Edit3,
  ArrowRight,
  ShieldCheck,
  Coins,
  Loader2,
} from "lucide-react";

export interface AirtimePreviewCardProps {
  preview: AirtimePreview | null;
  loading?: boolean;
  error?: string | null;
  confirmed?: boolean;
  confirmedPayment?: ConfirmedPaymentState | ConfirmedAirtimePayment | null;
  paymentInstructions?: PaymentInstructions | null;
  preparingPayment?: boolean;
  preparationError?: string | null;
  depositStatus?: DepositProgressionStatus;
  depositHash?: string | null;
  depositError?: string | null;
  onConfirm?: () => void;
  onRefresh?: () => void;
  onEdit?: () => void;
  onConfirmPayment?: () => void;
  onRefreshPreview?: () => void;
  onEditIntent?: () => void;
  onPayWithConnectedWallet?: () => Promise<void> | void;
  onDepositConfirmed?: (celoTxHash: string) => Promise<{ ok: boolean; error?: string } | void>;
  className?: string;
  stage?: TransactionStage;
  stageDescription?: string;
}
export function AirtimePreviewCard({
  preview,
  loading = false,
  error = null,
  confirmed = false,
  confirmedPayment = null,
  paymentInstructions = null,
  preparingPayment = false,
  preparationError = null,
  depositStatus = "awaiting_deposit",
  depositHash = null,
  depositError = null,
  onConfirm,
  onRefresh,
  onEdit,
  onConfirmPayment,
  onRefreshPreview,
  onEditIntent,
  onPayWithConnectedWallet,
  onDepositConfirmed,
  className,
  stage,
  stageDescription,
}: AirtimePreviewCardProps) {
  const handleConfirm = onConfirmPayment ?? onConfirm;
  const handleRefresh = onRefreshPreview ?? onRefresh;
  const handleEdit = onEditIntent ?? onEdit;
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [localPreparing, setLocalPreparing] = useState(false);
  // Live countdown timer for 60s TTL
  useEffect(() => {
    if (!preview?.expiresAt) {
      return;
    }
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [preview?.expiresAt]);

  // Resolve payment instructions from explicit prop or confirmedPayment state
  const effectiveInstructions: PaymentInstructions | null =
    paymentInstructions ??
    (confirmedPayment &&
    typeof confirmedPayment === "object" &&
    "paymentInstructions" in confirmedPayment &&
    confirmedPayment.paymentInstructions
      ? confirmedPayment.paymentInstructions
      : null);

  // When payment instructions are available, seamlessly present the payment instructions view
  if (effectiveInstructions) {
    return (
      <PaymentInstructionsCard
        instructions={effectiveInstructions}
        preview={preview}
        status={depositStatus}
        depositStatus={depositStatus}
        depositHash={depositHash}
        error={depositError}
        depositError={depositError}
        onPayWithConnectedWallet={onPayWithConnectedWallet}
        onDepositConfirmed={onDepositConfirmed}
        onBackToPreview={handleEdit}
        className={className}
        stage={stage}
        stageDescription={stageDescription}
      />
    );
  }
  const isPreparing = preparingPayment || localPreparing;
  const expiresAtMs = preview?.expiresAt ? Date.parse(preview.expiresAt) : 0;
  const isExpired =
    !preview || !Number.isFinite(expiresAtMs) || nowMs >= expiresAtMs;
  const secondsRemaining = Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));

  // Expiry strictly invalidates confirmation display: an expired quote can never display confirmed state
  const isConfirmed =
    !isExpired &&
    (confirmed === true ||
      Boolean(
        confirmedPayment &&
          ("confirmedForPayment" in confirmedPayment
            ? confirmedPayment.confirmedForPayment
            : true),
      ));

  // Format airtime amount in NGN using exact decimal string display
  const formattedNgn = preview?.amountNgn
    ? `₦${formatDecimalForDisplay(preview.amountNgn)}`
    : null;

  // Format rate: 1 USDC = ₦X,XXX without lossy Number conversions
  const formattedRate = preview?.rate
    ? `1 USDC = ₦${formatDecimalForDisplay(preview.rate)}`
    : null;

  const onConfirmClick = async () => {
    if (!handleConfirm || isPreparing || isExpired) {
      return;
    }
    try {
      setLocalPreparing(true);
      await handleConfirm();
    } finally {
      setLocalPreparing(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-[14px] border-ledger bg-clear-paper p-4 sm:p-5 shadow-base transition-all",
        isConfirmed && "border-provident-green/60 bg-provident-green/[0.02]",
        className,
      )}
      aria-labelledby="airtime-preview-title"
      role="region"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ledger-edge/70 pb-3">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-ledger transition-colors",
              isConfirmed
                ? "bg-provident-green text-white"
                : "bg-provident-green/10 text-provident-green",
            )}
          >
            {isConfirmed ? (
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Smartphone className="h-4 w-4" aria-hidden="true" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3
                id="airtime-preview-title"
                className="font-display text-base font-semibold text-ledger-stone"
              >
                Airtime Payment Preview
              </h3>
              <span className="rounded border border-ledger-edge bg-receipt-field px-1.5 py-0.5 font-proof text-[10px] text-receipt-grey">
                Quote guarantee
              </span>
            </div>
            <p className="font-proof text-[11px] text-receipt-grey">
              Deterministic inverse quote · Celo USDC
            </p>
          </div>
        </div>

        {/* Freshness / Status Badge */}
        <div className="flex items-center gap-2">
          {loading ? (
            <span className="inline-flex items-center gap-1.5 rounded border border-quote-blue/40 bg-quote-blue/10 px-2 py-0.5 font-proof text-xs font-semibold text-quote-blue">
              <Loader2 className="h-3 w-3 animate-spin" />
              Fetching quote...
            </span>
          ) : isPreparing ? (
            <span className="inline-flex items-center gap-1.5 rounded border border-quote-blue/40 bg-quote-blue/10 px-2 py-0.5 font-proof text-xs font-semibold text-quote-blue">
              <Loader2 className="h-3 w-3 animate-spin" />
              Preparing payment order...
            </span>
          ) : isExpired ? (
            <span className="inline-flex items-center gap-1.5 rounded border border-loss-red/40 bg-loss-red/10 px-2 py-0.5 font-proof tabular-nums text-xs font-semibold text-loss-red">
              <Clock className="h-3.5 w-3.5" />
              Quote expired — refresh needed to confirm
            </span>
          ) : isConfirmed ? (
            <span className="inline-flex items-center gap-1.5 rounded border border-provident-green/40 bg-provident-green/10 px-2.5 py-0.5 font-proof text-xs font-semibold text-deep-provision">
              <CheckCircle2 className="h-3.5 w-3.5 text-provident-green" />
              Preview confirmed
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded border border-quote-blue/40 bg-quote-blue/10 px-2 py-0.5 font-proof tabular-nums text-xs font-semibold text-quote-blue">
              <Clock className="h-3.5 w-3.5" />
              Expires in {secondsRemaining}s
            </span>
          )}
        </div>
      </div>

      {/* Loading Skeleton */}
      {loading && !preview ? (
        <div className="mt-4 flex flex-col items-center justify-center rounded-[10px] border border-ledger-edge bg-receipt-field/40 p-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-quote-blue mb-2" />
          <p className="font-display text-sm font-semibold text-ledger-stone">
            Generating inverse quote...
          </p>
          <p className="font-proof text-xs text-receipt-grey mt-0.5">
            Querying corridor rate from Paycrest for Celo USDC settlement
          </p>
        </div>
      ) : null}

      {/* Error state */}
      {error ? (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-[10px] border border-loss-red/40 bg-loss-red/10 p-3 text-xs text-ledger-stone">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-loss-red mt-0.5" />
            <div>
              <p className="font-semibold text-loss-red">Unable to fetch quote</p>
              <p className="mt-0.5 text-receipt-grey">{error}</p>
            </div>
          </div>
          {handleRefresh ? (
            <button
              type="button"
              onClick={handleRefresh}
              className="inline-flex items-center gap-1 rounded border border-loss-red/40 bg-clear-paper px-2.5 py-1 font-display text-xs font-semibold text-loss-red transition-all hover:bg-loss-red/10 active:translate-x-0.5 active:translate-y-0.5"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Preparation Error state */}
      {preparationError ? (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-[10px] border border-loss-red/40 bg-loss-red/10 p-3 text-xs text-ledger-stone">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-loss-red mt-0.5" />
            <div>
              <p className="font-semibold text-loss-red">Payment preparation failed</p>
              <p className="mt-0.5 text-receipt-grey">{preparationError}</p>
            </div>
          </div>
        </div>
      ) : null}

      {/* Preparation Spinner Notice */}
      {isPreparing ? (
        <div className="mt-4 flex items-center gap-2.5 rounded-[10px] border border-quote-blue/40 bg-quote-blue/10 p-3 text-xs text-ledger-stone">
          <Loader2 className="h-4 w-4 animate-spin text-quote-blue shrink-0" />
          <div>
            <span className="font-semibold text-quote-blue">
              Preparing payment order with Paycrest
            </span>
            <span className="text-receipt-grey ml-1.5">
              Locking corridor quote and generating deposit instructions...
            </span>
          </div>
        </div>
      ) : null}

      {/* Preview Content */}
      {preview ? (
        <>
          {/* Main Details Grid */}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* Airtime Intent Details */}
            <div className="rounded-[10px] border border-ledger-edge bg-receipt-field p-3.5">
              <div className="flex items-center justify-between">
                <span className="font-proof text-xs text-receipt-grey">
                  Airtime Amount
                </span>
                <span className="font-proof text-[10px] uppercase tracking-wider text-receipt-grey">
                  NGN Fiat
                </span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-proof tabular-nums text-2xl font-bold text-ledger-stone">
                  {formattedNgn}
                </span>
              </div>

              <div className="mt-3 border-t border-ledger-edge/60 pt-2.5 flex items-center justify-between text-xs">
                <div>
                  <span className="font-proof text-receipt-grey block">Recipient</span>
                  <span className="font-proof tabular-nums font-semibold text-ledger-stone">
                    {preview.phone}
                  </span>
                </div>
                <div>
                  <span className="font-proof text-receipt-grey block text-right">
                    Network
                  </span>
                  <span className="inline-flex items-center rounded border border-ledger bg-clear-paper px-2 py-0.5 font-display text-xs font-bold uppercase text-ledger-stone">
                    {preview.network}
                  </span>
                </div>
              </div>
            </div>

            {/* Celo Settlement Calculation */}
            <div className="rounded-[10px] border border-ledger-edge bg-receipt-field p-3.5">
              <div className="flex items-center justify-between">
                <span className="font-proof text-xs text-receipt-grey">
                  Settlement on Celo
                </span>
                <span className="inline-flex items-center gap-1 rounded bg-quote-blue/10 px-1.5 py-0.5 font-proof text-[10px] font-bold text-quote-blue border border-quote-blue/30">
                  <Coins className="h-3 w-3" />
                  USDC
                </span>
              </div>

              <div className="mt-1 flex items-baseline justify-between">
                <span className="font-proof text-xs text-receipt-grey">
                  Estimated base deposit:
                </span>
                <span className="font-proof tabular-nums text-xl font-bold text-ledger-stone">
                  {formatDecimalForDisplay(preview.amountUsdc)}{" "}
                  <span className="text-xs font-normal text-receipt-grey">USDC</span>
                </span>
              </div>

              {/* Breakdown */}
              <div className="mt-2.5 space-y-1 border-t border-ledger-edge/60 pt-2 text-[11px]">
                <div className="flex items-center justify-between font-proof">
                  <span className="text-receipt-grey">Estimated base deposit:</span>
                  <span className="font-proof tabular-nums text-ledger-stone">
                    {formatDecimalForDisplay(preview.amountUsdc)} USDC
                  </span>
                </div>
                <div className="flex items-center justify-between font-proof">
                  <span className="text-receipt-grey">Provider fee:</span>
                  <span className="font-proof text-receipt-grey text-right">
                    Finalized when payment order is created
                  </span>
                </div>
                <p className="font-proof text-[10px] text-receipt-grey">
                  Final amount shown before wallet approval
                </p>
                <div className="flex items-center justify-between font-proof border-t border-ledger-edge/40 pt-1 text-receipt-grey">
                  <span>Exchange Rate:</span>
                  <span className="font-proof tabular-nums text-ledger-stone">
                    {formattedRate}
                  </span>
                </div>
                <div className="flex items-center justify-between font-proof border-t border-ledger-edge/40 pt-1 text-receipt-grey">
                  <span>Quote Expiry:</span>
                  <span className="font-proof tabular-nums text-ledger-stone">
                    {preview.expiresAt ? (
                      isExpired ? (
                        <span className="text-loss-red font-semibold">
                          Expired
                        </span>
                      ) : (
                        <span>
                          {secondsRemaining}s remaining
                        </span>
                      )
                    ) : (
                      "Unknown"
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Stale Quote Warning & Refresh Notice: Expiry takes precedence */}
          {isExpired ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-loss-red/40 bg-loss-red/10 p-3 text-xs text-ledger-stone">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 shrink-0 text-loss-red" />
                <div>
                  <span className="font-semibold text-loss-red">
                    Quote expired — refresh needed to confirm
                  </span>
                  <span className="text-receipt-grey ml-1.5">
                    Rate guarantee has lapsed (60s TTL). Please refresh to recalculate before confirming.
                  </span>
                </div>
              </div>
              {handleRefresh ? (
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={loading || isPreparing}
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-ledger bg-clear-paper px-3 py-1.5 font-display text-xs font-semibold text-ledger-stone shadow-none transition-all hover:bg-receipt-field active:translate-x-0.5 active:translate-y-0.5 disabled:opacity-50"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                  Refresh quote
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Confirmed State Notice */}
          {isConfirmed ? (
            <div className="mt-3 flex items-start gap-2.5 rounded-[10px] border border-provident-green/40 bg-provident-green/10 p-3 text-xs text-ledger-stone">
              <ShieldCheck className="h-4 w-4 shrink-0 text-provident-green mt-0.5" />
              <div>
                <p className="font-semibold text-deep-provision">
                  Payment confirmed
                </p>
                <p className="mt-0.5 text-receipt-grey">
                  Payment preparation in progress. Deposit instructions will appear shortly.
                </p>
              </div>
            </div>
          ) : null}

          {/* Action Footer */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ledger-edge/70 pt-3">
            <div className="flex items-center gap-2">
              {handleEdit && !isConfirmed ? (
                <button
                  type="button"
                  onClick={handleEdit}
                  disabled={loading || isPreparing}
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-ledger-edge bg-clear-paper px-3 py-1.5 font-display text-xs font-semibold text-ledger-stone transition-all hover:border-ledger hover:bg-receipt-field active:translate-x-0.5 active:translate-y-0.5 disabled:opacity-50"
                >
                  <Edit3 className="h-3.5 w-3.5 text-receipt-grey" />
                  Edit details
                </button>
              ) : null}

              {handleRefresh && !isConfirmed && !isExpired ? (
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={loading || isPreparing}
                  aria-label="Refresh quote rate"
                  title="Fetch fresh quote from Paycrest"
                  className="inline-flex items-center gap-1 rounded-[8px] border border-ledger-edge bg-clear-paper px-2.5 py-1.5 font-display text-xs font-semibold text-receipt-grey transition-all hover:border-ledger hover:text-ledger-stone active:translate-x-0.5 active:translate-y-0.5 disabled:opacity-50"
                >
                  <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
                  Refresh
                </button>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              {isExpired ? (
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={loading || isPreparing || !handleRefresh}
                  className="inline-flex min-h-[38px] items-center gap-2 rounded-[8px] border border-ledger bg-provident-green px-4 py-2 font-display text-xs font-semibold text-white transition-all shadow-sticker active:translate-x-0.5 active:translate-y-0.5 hover:bg-deep-provision disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                  <span>Refresh quote</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onConfirmClick}
                  disabled={loading || isPreparing || !handleConfirm}
                  aria-disabled={loading || isPreparing || !handleConfirm}
                  className={cn(
                    "inline-flex min-h-[38px] items-center gap-2 rounded-[8px] border border-ledger bg-provident-green px-4 py-2 font-display text-xs font-semibold text-white transition-all shadow-sticker active:translate-x-0.5 active:translate-y-0.5",
                    "hover:bg-deep-provision",
                    (loading || isPreparing || !handleConfirm) &&
                      "opacity-50 cursor-not-allowed shadow-none active:translate-x-0 active:translate-y-0",
                  )}
                >
                  {isPreparing ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Preparing payment...</span>
                    </>
                  ) : (
                    <>
                      <span>Confirm Airtime Payment</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
