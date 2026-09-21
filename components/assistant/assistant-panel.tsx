"use client";

import { useAssistant } from "@/hooks/use-assistant";
import { MessageList } from "@/components/assistant/message-list";
import { AssistantComposer } from "@/components/assistant/assistant-composer";
import { IntentDraftCard } from "@/components/assistant/intent-draft-card";
import { PaymentInstructionsCard } from "@/components/assistant/payment-instructions-card";
import { cn } from "@/lib/cn";
import {
  Sparkles,
  RotateCcw,
  AlertTriangle,
  X,
  ShieldAlert,
  ReceiptText,
  Loader2,
} from "lucide-react";
import { useState } from "react";

export interface AssistantPanelProps {
  className?: string;
}

export function AssistantPanel({ className }: AssistantPanelProps) {
  const {
    messages,
    activeIntent,
    pending,
    error,
    send,
    reset,
    preview,
    previewLoading,
    previewError,
    asset,
    selectAsset,
    confirmedPayment,
    confirmPayment,
    refreshPreview,
    editIntent,
    paymentInstructions,
    preparingPayment,
    preparationError,
    depositStatus,
    depositHash,
    depositError,
    confirmDeposit,
    rehydratedTransactionId,
    rehydrating,
    rehydrationError,
    loadTransaction,
  } = useAssistant();
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [lookupId, setLookupId] = useState("");
  const [lookupDismissedFor, setLookupDismissedFor] = useState<string | null>(null);

  const displayError = error && error !== dismissedError ? error : null;

  const handleReset = () => {
    reset();
    setDismissedError(null);
    setLookupId("");
    setLookupDismissedFor(null);
  };

  return (
    <div
      className={cn(
        "flex flex-col rounded-[14px] border-ledger bg-clear-paper shadow-elevated overflow-hidden",
        className,
      )}
      aria-label="Providus Assistant Panel"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ledger bg-receipt-field px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-ledger bg-provident-green text-white shadow-none">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-base font-semibold text-ledger-stone sm:text-lg">
                Providus Assistant
              </h2>
              <span className="rounded border border-provident-green/40 bg-provident-green/10 px-1.5 py-0.5 font-proof text-[10px] font-semibold text-deep-provision">
                Live · payment preview
              </span>
            </div>
            <p className="font-proof text-[11px] text-receipt-grey">
              Describe airtime, review payment details, and track delivery
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {messages.length > 0 ? (
            <button
              type="button"
              onClick={handleReset}
              disabled={pending}
              aria-label="Reset conversation"
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-[8px] border border-ledger-edge bg-clear-paper px-2.5 py-1.5 font-display text-xs font-semibold text-ledger-stone shadow-none transition-all hover:border-ledger hover:shadow-base active:translate-x-px active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RotateCcw className="h-3.5 w-3.5 text-receipt-grey" />
              <span>Reset</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Payment asset selector: switching requests a fresh preview via selectAsset */}
      {activeIntent && activeIntent.type === "airtime" && activeIntent.readyForConfirmation && !paymentInstructions ? (
        <div className="border-b border-ledger-edge/80 bg-receipt-field/60 px-3 pt-3 sm:px-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-ledger-edge bg-clear-paper px-3 py-2">
            <span className="font-proof text-[11px] text-receipt-grey">
              Pay with:
            </span>
            <div className="flex items-center gap-1.5" role="group" aria-label="Payment asset">
              {(["USDC", "CNGN"] as const).map((symbol) => {
                const selected = asset === symbol;
                return (
                  <button
                    key={symbol}
                    type="button"
                    onClick={() => {
                      if (!selected && !previewLoading && !preparingPayment) selectAsset(symbol);
                    }}
                    disabled={previewLoading || preparingPayment || selected}
                    aria-pressed={selected}
                    className="inline-flex min-h-[30px] items-center rounded-[6px] border px-2.5 py-1 font-display text-[11px] font-semibold transition-all disabled:cursor-default border-ledger-edge bg-clear-paper text-receipt-grey hover:border-ledger hover:text-ledger-stone disabled:opacity-60 data-[selected=true]:border-ledger data-[selected=true]:bg-ledger-stone data-[selected=true]:text-clear-paper"
                    data-selected={selected}
                  >
                    {symbol === "CNGN" ? "cNGN" : symbol}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
      {/* Active Intent Draft Card Preview (Docked if active) */}
      {activeIntent ? (
        <div className="border-b border-ledger-edge/80 bg-receipt-field/60 p-3 sm:p-4">
          <IntentDraftCard
            intent={activeIntent}
            preview={preview}
            previewLoading={previewLoading}
            previewError={previewError}
            confirmedPayment={confirmedPayment}
            onConfirmPayment={confirmPayment}
            onRefreshPreview={refreshPreview}
            onEditIntent={editIntent}
            paymentInstructions={paymentInstructions}
            preparingPayment={preparingPayment}
            preparationError={preparationError}
            depositStatus={depositStatus}
            depositHash={depositHash}
            depositError={depositError}
            onDepositConfirmed={confirmDeposit}
          />
        </div>
      ) : null}
      {/* Rehydrated payment instructions (detached: no active intent required) */}
      {!activeIntent && paymentInstructions && lookupDismissedFor !== rehydratedTransactionId ? (
        <div className="border-b border-ledger-edge/80 bg-receipt-field/60 p-3 sm:p-4">
          <PaymentInstructionsCard
            instructions={paymentInstructions}
            preview={preview}
            status={depositStatus}
            depositStatus={depositStatus}
            depositHash={depositHash}
            depositError={depositError ?? rehydrationError}
            onDepositConfirmed={confirmDeposit}
            onBackToPreview={() => setLookupDismissedFor(rehydratedTransactionId)}
          />
        </div>
      ) : null}


      {/* Message List */}
      <MessageList
        messages={messages}
        pending={pending}
        onSelectSuggestion={send}
        className="bg-clear-paper"
      />
      {/* Explicit transaction lookup (resume an unfunded order after reload) */}
      <div className="mx-4 mb-2 rounded-[10px] border border-ledger-edge bg-receipt-field/70 p-3">
        <form
          aria-label="Resume a pending payment"
          onSubmit={(event) => {
            event.preventDefault();
            setLookupDismissedFor(null);
            void loadTransaction(lookupId.trim());
          }}
        >
          <label htmlFor="assistant-transaction-lookup" className="flex items-center gap-1.5 font-proof text-[11px] font-semibold text-ledger-stone">
            <ReceiptText className="h-3.5 w-3.5 text-quote-blue" aria-hidden="true" />
            <span>Resume a pending payment</span>
          </label>
          <p className="mt-1 font-proof text-[11px] leading-relaxed text-receipt-grey">
            Enter a payment ID to reload its payment instructions. Nothing is paid automatically.
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="assistant-transaction-lookup"
              type="text"
              value={lookupId}
              onChange={(event) => setLookupId(event.target.value)}
              placeholder="tx_airtime_…"
              autoComplete="off"
              spellCheck={false}
              disabled={rehydrating || pending}
              className="min-h-[38px] w-full flex-1 rounded-[8px] border border-ledger-edge bg-clear-paper px-2.5 py-1.5 font-mono text-xs text-ledger-stone placeholder:text-receipt-grey/70 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-provident-green disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={rehydrating || pending || lookupId.trim() === ""}
              className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-[8px] border border-ledger bg-clear-paper px-3.5 py-1.5 font-display text-xs font-semibold text-ledger-stone shadow-none transition-all hover:border-ledger hover:shadow-base active:translate-x-px active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
            >
              {rehydrating ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  <span>Loading…</span>
                </>
              ) : (
                <span>Load payment</span>
              )}
            </button>
          </div>
        </form>
        {rehydrationError ? (
          <p role="alert" className="mt-2 font-proof text-[11px] leading-relaxed text-loss-red">
            {rehydrationError}
          </p>
        ) : null}
      </div>


      {/* Error Alert Banner */}
      {displayError ? (
        <div
          role="alert"
          className="mx-4 mb-2 flex items-start justify-between gap-2 rounded-[10px] border border-loss-red/40 bg-loss-red/10 p-3 text-xs text-ledger-stone"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-loss-red mt-0.5" />
            <div>
              <p className="font-semibold text-loss-red">Assistant Notice</p>
              <p className="mt-0.5 text-receipt-grey">{displayError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDismissedError(displayError)}
            aria-label="Dismiss error"
            className="rounded p-1 text-receipt-grey hover:bg-loss-red/20 hover:text-loss-red transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {/* Safety Notice Footer */}
      <div className="border-t border-ledger-edge/60 bg-receipt-field/40 px-4 py-1.5 text-center">
        <p className="font-proof text-[10px] text-receipt-grey flex items-center justify-center gap-1">
          <ShieldAlert className="h-3 w-3 text-quote-blue" />
          <span>Your wallet stays in your control · every payment needs your explicit approval</span>
        </p>
      </div>

      {/* Composer */}
      <div className="border-t border-ledger bg-receipt-field p-3 sm:p-4">
        <AssistantComposer onSend={send} pending={pending} />
      </div>
    </div>
  );
}
