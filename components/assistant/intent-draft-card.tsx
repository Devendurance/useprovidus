"use client";

import type {
  PaymentIntent,
  AirtimePreview,
  ConfirmedAirtimePayment,
} from "@/lib/assistant/types";
import type { ConfirmedPaymentState } from "@/hooks/use-assistant";
import { AirtimePreviewCard } from "@/components/assistant/airtime-preview-card";
import { cn } from "@/lib/cn";
import {
  Smartphone,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Info,
  Clock,
} from "lucide-react";

export interface IntentDraftCardProps {
  intent: PaymentIntent | null;
  className?: string;
  preview?: AirtimePreview | null;
  previewLoading?: boolean;
  previewError?: string | null;
  confirmed?: boolean;
  confirmedPayment?: ConfirmedPaymentState | ConfirmedAirtimePayment | null;
  onConfirm?: () => void;
  onRefresh?: () => void;
  onEdit?: () => void;
  onConfirmPayment?: () => void;
  onRefreshPreview?: () => void;
  onEditIntent?: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  amountNgn: "Amount (₦)",
  phone: "Phone number",
  network: "Network provider",
};

export function IntentDraftCard({
  intent,
  className,
  preview,
  previewLoading = false,
  previewError = null,
  confirmed = false,
  confirmedPayment = null,
  onConfirm,
  onRefresh,
  onEdit,
  onConfirmPayment,
  onRefreshPreview,
  onEditIntent,
}: IntentDraftCardProps) {
  const handleConfirm = onConfirmPayment ?? onConfirm;
  const handleRefresh = onRefreshPreview ?? onRefresh;
  const handleEdit = onEditIntent ?? onEdit;
  if (!intent) {
    return null;
  }

  const hasPreviewContext =
    preview !== undefined ||
    previewLoading ||
    Boolean(previewError) ||
    Boolean(confirmedPayment) ||
    confirmed;

  // When intent is complete and preview/confirmation props are passed, render AirtimePreviewCard
  if (
    intent.type === "airtime" &&
    intent.readyForConfirmation &&
    hasPreviewContext
  ) {
    return (
      <AirtimePreviewCard
        preview={preview ?? null}
        loading={previewLoading}
        error={previewError}
        confirmed={confirmed}
        confirmedPayment={confirmedPayment}
        onConfirm={handleConfirm}
        onRefresh={handleRefresh}
        onEdit={handleEdit}
        onConfirmPayment={handleConfirm}
        onRefreshPreview={handleRefresh}
        onEditIntent={handleEdit}
        className={className}
      />
    );
  }

  if (intent.type !== "airtime") {
    return (
      <div
        className={cn(
          "rounded-[14px] border-ledger bg-clear-paper p-4 sm:p-5 shadow-elevated",
          className,
        )}
        aria-labelledby="unsupported-intent-title"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-ledger bg-rate-amber/15 text-rate-amber">
            <HelpCircle className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3
                id="unsupported-intent-title"
                className="font-display text-base font-semibold text-ledger-stone"
              >
                Unsupported Request: <span className="capitalize">{intent.type}</span>
              </h3>
              <span className="rounded border border-ledger-edge bg-receipt-field px-2 py-0.5 font-proof text-xs text-receipt-grey">
                Read-only preview
              </span>
            </div>
            <p className="mt-2 text-sm text-receipt-grey leading-relaxed">
              Providus conversational intent engine currently supports Nigerian airtime top-ups.
              Support for {intent.type} payments is not yet enabled on the Celo value ledger.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const {
    amountNgn,
    phone,
    network,
    networkConfirmed,
    missingFields,
    readyForConfirmation,
  } = intent;

  const formattedAmount = amountNgn
    ? `₦${Number(amountNgn).toLocaleString("en-NG")}`
    : null;

  return (
    <div
      className={cn(
        "rounded-[14px] border-ledger bg-clear-paper p-4 sm:p-5 shadow-elevated transition-all",
        className,
      )}
      aria-labelledby="airtime-intent-title"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ledger-edge/70 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-ledger bg-provident-green/10 text-provident-green">
            <Smartphone className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h3
              id="airtime-intent-title"
              className="font-display text-base font-semibold text-ledger-stone"
            >
              Airtime Payment Intent Draft
            </h3>
            <p className="font-proof text-[11px] text-receipt-grey">
              Read-only preview · upcoming capability
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {readyForConfirmation ? (
            <span className="inline-flex items-center gap-1 rounded border border-provident-green/40 bg-provident-green/10 px-2 py-0.5 font-proof text-xs font-semibold text-deep-provision">
              <CheckCircle2 className="h-3.5 w-3.5 text-provident-green" />
              Draft Complete
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded border border-rate-amber/40 bg-rate-amber/10 px-2 py-0.5 font-proof text-xs font-semibold text-rate-amber">
              <Clock className="h-3.5 w-3.5 text-rate-amber" />
              In Progress
            </span>
          )}
        </div>
      </div>

      {/* Field Grid */}
      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* Amount */}
        <div className="rounded-[10px] border border-ledger-edge bg-receipt-field p-3">
          <dt className="font-proof text-xs text-receipt-grey">Amount</dt>
          <dd className="mt-1">
            {formattedAmount ? (
              <span className="font-proof text-base font-semibold text-ledger-stone">
                {formattedAmount}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 font-proof text-xs text-rate-amber">
                <AlertCircle className="h-3.5 w-3.5" />
                Missing amount
              </span>
            )}
          </dd>
        </div>

        {/* Phone */}
        <div className="rounded-[10px] border border-ledger-edge bg-receipt-field p-3">
          <dt className="font-proof text-xs text-receipt-grey">Recipient Phone</dt>
          <dd className="mt-1">
            {phone ? (
              <span className="font-proof font-mono text-base font-semibold text-ledger-stone">
                {phone}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 font-proof text-xs text-rate-amber">
                <AlertCircle className="h-3.5 w-3.5" />
                Missing phone
              </span>
            )}
          </dd>
        </div>

        {/* Network & Confirmation State */}
        <div className="rounded-[10px] border border-ledger-edge bg-receipt-field p-3">
          <dt className="font-proof text-xs text-receipt-grey">Network Provider</dt>
          <dd className="mt-1 flex flex-col gap-1">
            {network ? (
              <div className="flex items-center gap-1.5">
                <span className="font-proof text-base font-semibold uppercase text-ledger-stone">
                  {network}
                </span>
                {networkConfirmed ? (
                  <span className="inline-flex items-center gap-1 rounded bg-provident-green/10 px-1.5 py-0.5 font-proof text-[10px] font-semibold text-provident-green border border-provident-green/30">
                    <CheckCircle2 className="h-3 w-3" />
                    Confirmed
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded bg-rate-amber/10 px-1.5 py-0.5 font-proof text-[10px] font-semibold text-rate-amber border border-rate-amber/30">
                    <AlertCircle className="h-3 w-3" />
                    Suggested
                  </span>
                )}
              </div>
            ) : (
              <span className="inline-flex items-center gap-1 font-proof text-xs text-rate-amber">
                <AlertCircle className="h-3.5 w-3.5" />
                Missing network
              </span>
            )}
          </dd>
        </div>
      </dl>

      {/* Unconfirmed Network Notice */}
      {network && !networkConfirmed ? (
        <div className="mt-3 flex items-start gap-2 rounded-[10px] border border-rate-amber/40 bg-rate-amber/10 p-3 text-xs text-ledger-stone">
          <Info className="h-4 w-4 shrink-0 text-rate-amber mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-semibold text-rate-amber">
              Network suggestion unconfirmed: {network.toUpperCase()}
            </p>
            <p className="mt-0.5 text-receipt-grey leading-relaxed">
              Mobile number portability means phone prefixes are not guaranteed. Please confirm
              by replying &quot;Yes&quot; or naming the network (e.g. &quot;MTN&quot; or &quot;Airtel&quot;) in chat.
            </p>
          </div>
        </div>
      ) : null}

      {/* Missing Fields List */}
      {missingFields && missingFields.length > 0 ? (
        <div className="mt-3 rounded-[10px] border border-ledger-edge bg-receipt-field p-3 text-xs">
          <p className="font-proof font-medium text-receipt-grey">
            Required before draft is complete:
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {missingFields.map((field) => (
              <li
                key={field}
                className="inline-flex items-center gap-1 rounded border border-rate-amber/30 bg-clear-paper px-2 py-0.5 font-proof text-xs text-rate-amber"
              >
                <AlertCircle className="h-3 w-3" />
                {FIELD_LABELS[field] || field}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Read-only informational notice; this surface does not execute payments. */}
      <div className="mt-3 flex items-center justify-between border-t border-ledger-edge/70 pt-3">
        <p className="text-xs text-receipt-grey flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5 text-quote-blue shrink-0" aria-hidden="true" />
          <span>
            {readyForConfirmation
              ? "All parameters validated. This draft is informational only — payment execution is not available yet."
              : "Draft is being refined through chat conversation."}
          </span>
        </p>
        <span className="font-proof text-[10px] text-receipt-grey uppercase tracking-wider">
          Informational only
        </span>
      </div>
    </div>
  );
}
