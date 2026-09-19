"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, Loader2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { useTransactionStatus } from "@/hooks/use-transaction-status";
import { useUsdcDeposit } from "@/hooks/use-usdc-deposit";
import { CANONICAL_CELO_USDC } from "@/lib/celo/usdc";
import { formatDecimalForDisplay } from "@/lib/money/decimal";
import {
  canPayOrder,
  isPaymentWindowOpen,
  PAYMENT_EXPIRY_SAFETY_MS,
  type NormalizedCashOutOrder,
} from "@/lib/paycrest/order";
import { CELO_EXPLORER_URL } from "@/lib/wallet/celo";
import { truncateAddress } from "@/lib/wallet/format";
import type { Address } from "viem";

type CashOutPaymentProps = {
  order: NormalizedCashOutOrder;
  transactionId?: string | null;
  walletAddress: Address | null;
  isCeloMainnet: boolean;
  usdcBalanceRaw: bigint | null;
  usdcBalanceDisplay: string | null;
  onStartAgain: () => void;
};

export function CashOutPayment({
  order,
  transactionId,
  walletAddress,
  isCeloMainnet,
  usdcBalanceRaw,
  usdcBalanceDisplay,
  onStartAgain,
}: CashOutPaymentProps) {
  const queryClient = useQueryClient();
  const txStatus = useTransactionStatus(transactionId);
  const deposit = useUsdcDeposit((confirmedHash) => {
    // Triggers a refetch in useProvidusWallet for both CELO and USDC
    queryClient.invalidateQueries();
    if (transactionId) {
      txStatus.confirmDeposit(confirmedHash);
    }
  });
  const [now, setNow] = useState(() => Date.now());
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const windowStatus = isPaymentWindowOpen(
    order.providerAccount.validUntil,
    now,
  );

  const payGate = canPayOrder({
    order,
    orderUnsafe: false,
    walletAddress,
    isCeloMainnet,
    usdcBalanceRaw,
    paymentPending: deposit.isSubmitting,
    paymentSubmitted: deposit.isSubmitted,
    nowMs: now,
  });

  const countdown = useMemo(() => {
    if (windowStatus.msRemaining == null) return "—";
    const s = Math.max(0, Math.floor(windowStatus.msRemaining / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }, [windowStatus.msRemaining]);

  const explorerTx =
    deposit.effectiveHash != null ? `${CELO_EXPLORER_URL}/tx/${deposit.effectiveHash}` : null;

  return (
    <Card variant="verdict">
      <p className="font-proof text-receipt-grey">Paycrest order · payment</p>
      <CardTitle className="mt-1">Deposit USDC on Celo</CardTitle>
      <CardDescription className="mt-2">
        Send the exact total to Paycrest before expiry. This confirms the Celo
        deposit only — not that NGN has been paid out.
      </CardDescription>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2 text-sm">
        <div>
          <dt className="text-xs text-receipt-grey">Order ID</dt>
          <dd className="font-proof text-[12px]">
            {order.id.length > 16
              ? `${order.id.slice(0, 8)}…${order.id.slice(-6)}`
              : order.id}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-receipt-grey">Status</dt>
          <dd className="font-medium">{order.status}</dd>
        </div>
        <div>
          <dt className="text-xs text-receipt-grey">Requested USDC</dt>
          <dd className="font-proof tabular-nums">{order.amount}</dd>
        </div>
        <div>
          <dt className="text-xs text-receipt-grey">Sender fee</dt>
          <dd className="font-proof tabular-nums">{order.senderFee}</dd>
        </div>
        <div>
          <dt className="text-xs text-receipt-grey">Transaction fee</dt>
          <dd className="font-proof tabular-nums">{order.transactionFee}</dd>
        </div>
        <div>
          <dt className="text-xs text-receipt-grey">Total USDC to send</dt>
          <dd className="font-display text-xl font-semibold tabular-nums text-provident-green">
            {formatDecimalForDisplay(order.totalUsdcToSend)}
          </dd>
        </div>
        {order.rate ? (
          <div>
            <dt className="text-xs text-receipt-grey">Returned rate</dt>
            <dd className="font-proof tabular-nums">{order.rate}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs text-receipt-grey">Network / token</dt>
          <dd className="text-sm">
            Celo · USDC ({CANONICAL_CELO_USDC.decimals} decimals)
          </dd>
        </div>
        <div>
          <dt className="text-xs text-receipt-grey">Paying wallet</dt>
          <dd className="font-proof text-[12px]">
            {walletAddress ? truncateAddress(walletAddress) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-receipt-grey">USDC balance</dt>
          <dd className="font-proof tabular-nums">{usdcBalanceDisplay ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-receipt-grey">Receive address</dt>
          <dd className="flex items-center gap-2 font-proof text-[12px]">
            {truncateAddress(order.providerAccount.receiveAddress)}
            <button
              type="button"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-ledger-edge text-quote-blue transition-colors hover:bg-ledger-edge/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green"
              aria-label="Copy receive address"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(order.providerAccount.receiveAddress);
                  setCopyState("copied");
                } catch {
                  setCopyState("error");
                }
              }}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
            </button>
            <span className="sr-only" role="status" aria-live="polite">
              {copyState === "copied"
                ? "Receive address copied."
                : copyState === "error"
                  ? "Could not copy the receive address. Select it manually."
                  : ""}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-receipt-grey">Valid until</dt>
          <dd className="font-proof text-[12px]">
            {new Date(order.providerAccount.validUntil).toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-receipt-grey">Time remaining</dt>
          <dd className="font-proof text-sm font-semibold tabular-nums">
            {countdown}
            {!windowStatus.open ? ` · ${windowStatus.reason}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-receipt-grey">Bank / name</dt>
          <dd className="text-sm">
            {order.recipient.institutionName} · {order.recipient.accountName}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-receipt-grey">Account</dt>
          <dd className="font-proof text-[12px]">
            {order.recipient.accountIdentifierMasked}
          </dd>
        </div>
      </dl>

      <p className="mt-4 rounded-[10px] border border-rate-amber/40 bg-receipt-field px-3 py-2 text-xs text-ledger-stone">
        Payment must complete at least{" "}
        {Math.round(PAYMENT_EXPIRY_SAFETY_MS / 1000)}s before Paycrest
        validUntil (Providus safety margin). Direct ERC-20 transfer only — no
        token approval.
      </p>

      {deposit.state.kind === "confirmed" || txStatus.isDepositConfirmed ? (
        <div
          className="mt-4 rounded-[10px] border border-provident-green/40 bg-receipt-field px-4 py-3"
          role="status"
        >
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 text-provident-green" />
            <div>
              <p className="text-sm font-semibold text-ledger-stone">
                Celo USDC deposit confirmed on-chain. This confirms the Celo deposit only — not that NGN has been paid out.
              </p>
              {explorerTx ? (
                <a
                  href={explorerTx}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-sm font-semibold text-quote-blue"
                >
                  View transaction on explorer
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Truthful Fiat Delivery Tracking */}
      {txStatus.isFiatFinal || txStatus.stage === "settled" ? (
        <div
          className="mt-4 rounded-[10px] border-2 border-provident-green bg-clear-paper p-4 shadow-base"
          role="status"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-provident-green shrink-0" />
            <div>
              <p className="text-sm font-bold text-ledger-stone">
                NGN payout confirmed delivered to recipient bank account!
              </p>
              <p className="mt-1 text-xs text-receipt-grey">
                Paycrest verified fiat finality. Funds have arrived at{" "}
                <span className="font-semibold text-ledger-stone">
                  {order.recipient.institutionName}
                </span>{" "}
                for{" "}
                <span className="font-semibold text-ledger-stone">
                  {order.recipient.accountName}
                </span>
                .
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={onStartAgain}
                >
                  Make another payment
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : txStatus.stage === "settling" || (txStatus.isDepositConfirmed && !txStatus.isFiatFinal) ? (
        <div
          className="mt-4 rounded-[10px] border border-quote-blue/40 bg-receipt-field p-4"
          role="status"
        >
          <div className="flex items-start gap-3">
            <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-quote-blue shrink-0" />
            <div>
              <p className="text-sm font-semibold text-ledger-stone">
                NGN settlement pending: Paycrest is processing bank delivery…
              </p>
              <p className="mt-1 text-xs text-receipt-grey">
                Your Celo deposit was confirmed. We are checking Paycrest Rails for bank credit. Do not send another payment.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {txStatus.stage === "failed" ? (
        <div
          className="mt-4 rounded-[10px] border border-loss-red/40 bg-receipt-field p-4"
          role="status"
        >
          <p className="text-sm font-semibold text-loss-red">
            Settlement failed: {txStatus.stageDescription}
          </p>
        </div>
      ) : null}

      {txStatus.stage === "recovery_required" ? (
        <div
          className="mt-4 rounded-[10px] border border-rate-amber/40 bg-receipt-field p-4"
          role="status"
        >
          <p className="text-sm font-semibold text-rate-amber">
            Recovery required: {txStatus.stageDescription}
          </p>
          <p className="mt-1 text-xs text-receipt-grey">
            Reference: {order.reference}. Keep this reference for support.
          </p>
        </div>
      ) : null}

      {deposit.state.kind === "reverted" ? (
        <div
          className="mt-4 rounded-[10px] border border-loss-red/40 bg-receipt-field px-4 py-3"
          role="status"
        >
          <p className="text-sm font-semibold text-loss-red">
            Transaction reverted on Celo mainnet.
          </p>
          {explorerTx ? (
            <a
              href={explorerTx}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-sm font-semibold text-loss-red underline"
            >
              View reverted transaction
            </a>
          ) : null}
        </div>
      ) : null}

      {deposit.state.kind === "submitted" ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-receipt-grey" role="status" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin" />
          Waiting for Celo transaction receipt…
        </p>
      ) : null}

      {deposit.state.kind === "error" ? (
        <p className="mt-3 text-sm text-loss-red" role="alert">
          {deposit.state.message}
        </p>
      ) : null}

      {deposit.state.kind === "confirming" ? (
        <div className="mt-4 space-y-3 rounded-[10px] border-ledger bg-receipt-field p-4" role="region" aria-labelledby="payment-confirm-heading">
          <p id="payment-confirm-heading" tabIndex={-1} className="text-sm font-semibold text-ledger-stone">
            Confirm payment of {order.totalUsdcToSend} USDC
          </p>
          <div className="text-xs text-receipt-grey flex flex-col gap-2">
            <p>
              Your wallet will send a direct USDC transfer to Paycrest. No
              approval step. Do not create another order.
            </p>
            <p className="flex items-center gap-1.5 text-ledger-stone bg-ledger-stone/5 p-2 rounded-md">
              <Info className="h-4 w-4" />
              Gas estimate is padded with a 25% safety buffer to prevent out-of-gas errors.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!payGate.canPay || !walletAddress}
              onClick={() => {
                if (walletAddress) {
                  deposit.simulateAndPay({ order, walletAddress });
                }
              }}
            >
              Send USDC now
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => deposit.cancelConfirm()}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {deposit.state.kind === "idle" || deposit.state.kind === "error" || deposit.state.kind === "reverted" ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!payGate.canPay}
            onClick={() => deposit.beginConfirm()}
          >
            Pay order with USDC
          </Button>
          {!windowStatus.open ? (
            <Button type="button" variant="secondary" size="sm" onClick={onStartAgain}>
              Start again
            </Button>
          ) : null}
        </div>
      ) : null}

      {!payGate.canPay && deposit.state.kind !== "confirmed" ? (
        <div className="mt-3 rounded-[10px] border border-rate-amber/40 bg-receipt-field px-3 py-2 text-xs text-ledger-stone" role="status">
          <p className="font-semibold">Payment not ready yet</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-receipt-grey">
            {payGate.reasons.map((reason) => (
              <li key={reason}>{paymentBlockerLabel(reason)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function paymentBlockerLabel(reason: string) {
  const labels: Record<string, string> = {
    WALLET: "Connect the wallet that will send the payment.",
    NETWORK: "Switch to Celo mainnet.",
    BALANCE: "Your USDC balance is not enough for this payment.",
    EXPIRED: "The payment window expired; start again for a fresh order.",
  };
  return labels[reason] ?? reason.replaceAll("_", " ").toLowerCase();
}
