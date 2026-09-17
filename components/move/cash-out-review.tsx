"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { CashOutPayment } from "@/components/move/cash-out-payment";
import { useCashOutOrder } from "@/hooks/use-cash-out-order";
import { formatDecimalForDisplay } from "@/lib/money/decimal";
import {
  isQuoteFresh,
  maskAccountIdentifier,
  PROVIDUS_QUOTE_FRESHNESS_MS,
  type VerifiedRecipientBinding,
} from "@/lib/paycrest/recipient";
import { truncateAddress } from "@/lib/wallet/format";
import type { Address } from "viem";

type CashOutReviewProps = {
  ready: boolean;
  reasons: string[];
  amount: string;
  rate: string;
  estimatedNgn: string;
  quoteCheckedAt: string;
  walletAddress: Address | null;
  isCeloMainnet: boolean;
  usdcBalanceRaw: bigint | null;
  usdcBalanceDisplay: string | null;
  recipient: VerifiedRecipientBinding;
  tokenCompatible: boolean;
  onRefreshQuote: () => void;
  onRecipientInvalidate: () => void;
  onStartAgain: () => void;
};

export function CashOutReview({
  ready,
  reasons,
  amount,
  rate,
  estimatedNgn,
  quoteCheckedAt,
  walletAddress,
  isCeloMainnet,
  usdcBalanceRaw,
  usdcBalanceDisplay,
  recipient,
  tokenCompatible,
  onRefreshQuote,
  onRecipientInvalidate,
  onStartAgain,
}: CashOutReviewProps) {
  const fresh = isQuoteFresh(quoteCheckedAt);
  const orderFlow = useCashOutOrder();
  const [locked, setLocked] = useState(false);

  const formLocked = locked || orderFlow.order != null || orderFlow.isCreating;

  if (orderFlow.order) {
    return (
      <CashOutPayment
        order={orderFlow.order}
        walletAddress={walletAddress}
        isCeloMainnet={isCeloMainnet}
        usdcBalanceRaw={usdcBalanceRaw}
        usdcBalanceDisplay={usdcBalanceDisplay}
        onStartAgain={() => {
          orderFlow.reset();
          setLocked(false);
          onStartAgain();
        }}
      />
    );
  }

  return (
    <Card variant="verdict">
      <p className="font-sans text-receipt-grey">Cash-out review</p>
      <CardTitle className="mt-1">Create order & deposit USDC</CardTitle>
      <CardDescription className="mt-2">
        Pre-order quote is an estimate. Creating an order starts a time-limited
        Paycrest payment window. Continue immediately after creation.
      </CardDescription>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2 text-sm">
        <div>
          <dt className="text-xs text-receipt-grey">USDC to cash out</dt>
          <dd className="font-sans text-xl font-semibold tabular-nums">
            {amount}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-receipt-grey">
            Pre-order estimated NGN (not final)
          </dt>
          <dd className="font-sans text-xl font-semibold tabular-nums text-success">
            ₦{formatDecimalForDisplay(estimatedNgn, { maxFractional: 2 })}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-receipt-grey">Source network</dt>
          <dd className="font-medium">Celo mainnet</dd>
        </div>
        <div>
          <dt className="text-xs text-receipt-grey">Pre-order rate (estimate)</dt>
          <dd className="font-sans tabular-nums">{rate}</dd>
        </div>
        <div>
          <dt className="text-xs text-receipt-grey">Refund / source wallet</dt>
          <dd className="font-sans text-[12px]">
            {walletAddress ? truncateAddress(walletAddress) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-receipt-grey">USDC balance</dt>
          <dd className="font-sans tabular-nums">
            {usdcBalanceDisplay ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-receipt-grey">Quote checked</dt>
          <dd className="font-sans text-[12px]">
            {new Date(quoteCheckedAt).toLocaleString()}
            {!fresh ? " · refresh needed" : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-receipt-grey">Canonical USDC</dt>
          <dd className="text-sm font-medium">
            {tokenCompatible ? "Compatible" : "Mismatch"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-receipt-grey">Bank</dt>
          <dd className="font-medium">{recipient.institutionName}</dd>
        </div>
        <div>
          <dt className="text-xs text-receipt-grey">Account name</dt>
          <dd className="font-medium">{recipient.accountName}</dd>
        </div>
        <div>
          <dt className="text-xs text-receipt-grey">Account</dt>
          <dd className="font-sans text-[12px]">
            {maskAccountIdentifier(recipient.accountIdentifier)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-receipt-grey">Verified</dt>
          <dd className="font-sans text-[12px]">
            {new Date(recipient.verifiedAt).toLocaleString()}
          </dd>
        </div>
      </dl>

      <p className="mt-4 rounded-[8px] border-2 border-warning/40 bg-cream px-3 py-2 text-xs text-warning">
        Creating an order starts a time-limited payment window. Paycrest returns
        final rate, fees, receive address and expiry. Pre-order quote (refresh
        every {Math.round(PROVIDUS_QUOTE_FRESHNESS_MS / 1000)}s) is not
        guaranteed.
      </p>

      {!fresh ? (
        <div className="mt-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onRefreshQuote}
            disabled={formLocked}
          >
            Refresh quote
          </Button>
        </div>
      ) : null}

      {!ready ? (
        <p className="mt-3 text-sm text-receipt-grey" role="status">
          Review not ready
          {reasons.length > 0 ? `: ${reasons.join(", ")}` : ""}.
        </p>
      ) : null}

      {orderFlow.state.kind === "unknown_outcome" ? (
        <div className="mt-4 rounded-[8px] border-2 border-error/40 bg-cream px-4 py-3">
          <p className="text-sm font-semibold text-error">
            Order creation outcome unknown
          </p>
          <p className="mt-1 text-xs text-receipt-grey">
            {orderFlow.state.message} Do not press Create again immediately.
            {orderFlow.state.reference
              ? ` Reference: ${orderFlow.state.reference}`
              : ""}
          </p>
        </div>
      ) : null}

      {orderFlow.state.kind === "error" ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-error" role="alert">
            {orderFlow.state.message}
            {orderFlow.state.code ? ` (${orderFlow.state.code})` : ""}
          </p>
          {orderFlow.state.validationDetails &&
          orderFlow.state.validationDetails.length > 0 ? (
            <ul className="space-y-1 rounded-[8px] border-2 border-error/30 bg-cream p-3 text-xs text-error">
              {orderFlow.state.validationDetails.map((detail, idx) => (
                <li key={idx} className="font-sans">
                  Field: <span className="font-semibold">{detail.field}</span> —{" "}
                  {detail.message}
                </li>
              ))}
            </ul>
          ) : orderFlow.state.code === "PAYCREST_ORDER_REJECTED" ||
            orderFlow.state.code === "PAYCREST_VALIDATION_FAILED" ? (
            <p className="text-xs text-receipt-grey">
              Paycrest rejected the request without returning a safe field-level
              reason.
            </p>
          ) : null}
          {orderFlow.state.diagnosticId ? (
            <p className="text-xs text-receipt-grey font-sans">
              Diagnostic: {orderFlow.state.diagnosticId}
            </p>
          ) : null}
          {orderFlow.state.reference ? (
            <p className="text-xs text-receipt-grey font-sans">
              Reference: {orderFlow.state.reference}
            </p>
          ) : null}
          {orderFlow.state.code === "RECIPIENT_CHANGED" ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                orderFlow.reset();
                onRecipientInvalidate();
              }}
            >
              Re-verify recipient
            </Button>
          ) : null}
        </div>
      ) : null}

      {orderFlow.state.kind === "confirming" ? (
        <div className="mt-4 space-y-3 rounded-[8px] border-2 border-ink bg-cream p-4">
          <p className="text-sm font-semibold text-ink">
            Confirm: create cash-out order for {amount} USDC?
          </p>
          <p className="text-xs text-receipt-grey">
            This calls Paycrest and starts a payment window. Continue
            immediately after creation. Bank: {recipient.institutionName} ·{" "}
            {recipient.accountName} ·{" "}
            {maskAccountIdentifier(recipient.accountIdentifier)}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!walletAddress || orderFlow.isCreating}
              onClick={() => {
                if (!walletAddress) return;
                setLocked(true);
                void orderFlow.createOrder({
                  amount,
                  recipient,
                  refundAddress: walletAddress,
                });
              }}
            >
              {orderFlow.isCreating ? "Creating…" : "Yes, create order"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={orderFlow.isCreating}
              onClick={() => orderFlow.cancelConfirm()}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {orderFlow.state.kind === "creating" ? (
        <p className="mt-4 text-sm text-receipt-grey">Creating Paycrest order…</p>
      ) : null}

      {orderFlow.state.kind === "idle" ||
      (orderFlow.state.kind === "error" &&
        orderFlow.state.code !== "ORDER_CREATION_OUTCOME_UNKNOWN") ? (
        <div className="mt-4">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!ready || !fresh || formLocked}
            onClick={() => orderFlow.beginConfirm()}
          >
            Create cash-out order
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
