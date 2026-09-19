"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { CashOutPayment } from "@/components/move/cash-out-payment";
import { CashOutRecipient } from "@/components/move/cash-out-recipient";
import { CashOutReview } from "@/components/move/cash-out-review";
import { ConnectWalletButton } from "@/components/ui/connect-wallet-button";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCorridorQuote } from "@/hooks/use-corridor-quote";
import { useCashOutOrder } from "@/hooks/use-cash-out-order";
import { usePaycrestSupport } from "@/hooks/use-paycrest-support";
import { useProvidusWallet } from "@/hooks/use-providus-wallet";
import { CANONICAL_CELO_USDC } from "@/lib/celo/usdc";
import {
  formatDecimalForDisplay,
  hasSufficientUsdcBalance,
} from "@/lib/money/decimal";
import {
  directionDescription,
  directionLabel,
  directionToSide,
  walletRoleForDirection,
  type MoveDirection,
} from "@/lib/money/direction";
import { validateUsdcAmount } from "@/lib/money/usdc-amount";
import {
  evaluateCashOutReviewReadiness,
  isQuoteFresh,
  type VerifiedRecipientBinding,
} from "@/lib/paycrest/recipient";
import { cn } from "@/lib/cn";

export function MoveMoneyPanel() {
  const [direction, setDirection] = useState<MoveDirection>("cash-out");
  const [intentChosen, setIntentChosen] = useState(false);
  const [amount, setAmount] = useState("");
  const [verifiedRecipient, setVerifiedRecipient] =
    useState<VerifiedRecipientBinding | null>(null);
  const wallet = useProvidusWallet();
  const orderFlow = useCashOutOrder();
  const support = usePaycrestSupport(true);
  const side = directionToSide(direction);

  const effectiveIntentChosen = intentChosen || Boolean(orderFlow.order);
  const effectiveDirection = orderFlow.order ? "cash-out" : direction;

  const transactionLocked =
    orderFlow.order != null ||
    orderFlow.isCreating ||
    orderFlow.state.kind === "confirming" ||
    orderFlow.state.kind === "unknown_outcome";

  const quoteEnabled =
    effectiveIntentChosen &&
    support.state.kind === "ready" &&
    amount.trim() !== "" &&
    validateUsdcAmount(amount.trim()).ok;

  const quote = useCorridorQuote({
    side,
    amount,
    enabled: quoteEnabled,
  });

  const amountValidation = useMemo(
    () => (amount.trim() === "" ? null : validateUsdcAmount(amount.trim())),
    [amount],
  );

  const balanceCheck = useMemo(() => {
    if (direction !== "cash-out") {
      return {
        comparable: false,
        sufficient: true,
        show: false,
        loaded: false,
      };
    }
    if (!amountValidation?.ok) {
      return {
        comparable: false,
        sufficient: true,
        show: false,
        loaded: wallet.usdcBalanceRaw !== null,
      };
    }
    if (wallet.status !== "connected") {
      return {
        comparable: false,
        sufficient: true,
        show: false,
        loaded: false,
      };
    }
    const result = hasSufficientUsdcBalance(
      amountValidation.data,
      wallet.usdcBalanceRaw,
      CANONICAL_CELO_USDC.decimals,
    );
    return {
      ...result,
      show: result.comparable && !result.sufficient,
      loaded: wallet.usdcBalanceRaw !== null && !wallet.balancesLoading,
    };
  }, [
    direction,
    amountValidation,
    wallet.status,
    wallet.usdcBalanceRaw,
    wallet.balancesLoading,
  ]);

  const quoteFresh =
    quote.state.kind === "available"
      ? isQuoteFresh(quote.state.quote.checkedAt)
      : false;

  const reviewReadiness = useMemo(() => {
    return evaluateCashOutReviewReadiness({
      directionIsCashOut: direction === "cash-out",
      walletReady: wallet.isReady,
      tokenCompatible: support.state.kind === "ready",
      amountValid: Boolean(amountValidation?.ok),
      quoteAvailable: quote.state.kind === "available",
      quoteCheckedAt:
        quote.state.kind === "available" ? quote.state.quote.checkedAt : null,
      balanceLoaded: balanceCheck.loaded,
      balanceSufficient:
        balanceCheck.loaded &&
        balanceCheck.comparable &&
        balanceCheck.sufficient,
      institutionSelected: Boolean(verifiedRecipient),
      verificationBound: Boolean(verifiedRecipient),
      pendingRequest:
        quote.isLoading ||
        support.state.kind === "loading" ||
        wallet.balancesLoading,
      quoteFresh,
    });
  }, [
    direction,
    wallet.isReady,
    wallet.balancesLoading,
    support.state.kind,
    amountValidation?.ok,
    quote.state,
    quote.isLoading,
    balanceCheck,
    verifiedRecipient,
    quoteFresh,
  ]);

  function handleDirectionChange(next: MoveDirection) {
    setDirection(next);
    setIntentChosen(true);
    setVerifiedRecipient(null);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
      <div className="space-y-6">
        <Card variant="surface">
          <CardTitle>Direction</CardTitle>
          <CardDescription>
            {effectiveIntentChosen
              ? "Live Paycrest estimates for Celo USDC and NGN. No money moves until you review and approve."
              : "Choose what you want to do first. You can change this before any payment begins."}
          </CardDescription>

          <div
            className="mt-5 grid grid-cols-2 gap-2"
            role="radiogroup"
            aria-label="What do you want to do?"
          >
            {(
              [
                { id: "buy-usdc" as const, hint: "NGN → USDC" },
                { id: "cash-out" as const, hint: "USDC → NGN" },
              ] as const
            ).map((opt) => {
              const selected = effectiveIntentChosen && effectiveDirection === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected || (!effectiveIntentChosen && opt.id === "cash-out") ? 0 : -1}
                  className={cn(
                    "rounded-[10px] border-ledger px-3 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green",
                    selected
                      ? "bg-provident-green text-white shadow-elevated"
                      : "bg-receipt-field text-ledger-stone hover:bg-ledger-edge/50",
                  )}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                    event.preventDefault();
                    handleDirectionChange(opt.id === "buy-usdc" ? "cash-out" : "buy-usdc");
                  }}
                  onClick={() => handleDirectionChange(opt.id)}
                  disabled={transactionLocked}
                >
                  <span className="block text-sm font-semibold">
                    {directionLabel(opt.id)}
                  </span>
                  <span
                    className={cn(
                      "mt-1 block font-proof text-[11px]",
                      selected ? "text-white/85" : "text-receipt-grey",
                    )}
                  >
                    {opt.hint}
                  </span>
                </button>
              );
            })}
          </div>

          {effectiveIntentChosen ? <dl className="mt-5 grid gap-3 border-t border-ledger-edge pt-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-receipt-grey">Corridor</dt>
              <dd className="font-medium text-ledger-stone text-right">
                {directionDescription(direction)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-receipt-grey">Network</dt>
              <dd className="font-proof text-[13px] text-ledger-stone">
                Celo mainnet · 42220
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-receipt-grey">Wallet role</dt>
              <dd className="text-right text-ledger-stone font-medium">
                {walletRoleForDirection(effectiveDirection)}
              </dd>
            </div>
          </dl> : null}
        </Card>

        {effectiveIntentChosen ? <Card variant="surface">
          <CardTitle>
            {effectiveDirection === "buy-usdc"
              ? "USDC you want to receive"
              : "USDC you want to cash out"}
          </CardTitle>
          <CardDescription>
            Enter the USDC amount for this estimate. Maximum 1,000,000 USDC, up
            to 6 decimal places.
          </CardDescription>

          <div className="mt-5">
            <Input
              id="usdc-amount"
              label="USDC amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="e.g. 100"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={transactionLocked}
              hint={
                effectiveDirection === "buy-usdc"
                  ? "How much USDC should arrive on Celo."
                  : "How much USDC to convert to NGN."
              }
              error={amountValidation !== null && !amountValidation.ok ? amountValidation.message : undefined}
              aria-invalid={
                amountValidation !== null && !amountValidation.ok
                  ? true
                  : undefined
              }
            />
          </div>
        </Card> : null}

        <CashOutRecipient
          enabled={effectiveIntentChosen && effectiveDirection === "cash-out"}
          locked={transactionLocked}
          onVerifiedChange={setVerifiedRecipient}
        />

        {effectiveIntentChosen ? <QuotePanel
          direction={effectiveDirection}
          quoteState={quote.state}
          onRefresh={() => quote.refresh()}
          onRefreshSupport={() => support.refresh()}
          supportState={support.state}
          walletStatus={wallet.status}
          isReady={wallet.isReady}
          balanceCheck={balanceCheck}
          quoteFresh={quoteFresh}
        /> : null}

        {orderFlow.order ? (
          <CashOutPayment
            order={orderFlow.order}
            transactionId={orderFlow.transactionId}
            walletAddress={wallet.address}
            isCeloMainnet={wallet.isCeloMainnet}
            usdcBalanceRaw={wallet.usdcBalanceRaw}
            usdcBalanceDisplay={
              wallet.usdcBalance ? `${wallet.usdcBalance.value} USDC` : null
            }
            onStartAgain={() => {
              orderFlow.reset();
              setVerifiedRecipient(null);
              setAmount("");
            }}
          />
        ) : intentChosen &&
        direction === "cash-out" &&
        verifiedRecipient &&
        quote.state.kind === "available" ? (
          <CashOutReview
            ready={reviewReadiness.ready}
            reasons={reviewReadiness.reasons}
            amount={quote.state.amount}
            rate={quote.state.quote.rate}
            estimatedNgn={quote.state.estimatedNgn}
            quoteCheckedAt={quote.state.quote.checkedAt}
            walletAddress={wallet.address}
            isCeloMainnet={wallet.isCeloMainnet}
            usdcBalanceRaw={wallet.usdcBalanceRaw}
            usdcBalanceDisplay={
              wallet.usdcBalance ? `${wallet.usdcBalance.value} USDC` : null
            }
            recipient={verifiedRecipient}
            tokenCompatible={support.state.kind === "ready"}
            onRefreshQuote={() => quote.refresh()}
            onRecipientInvalidate={() => setVerifiedRecipient(null)}
            onStartAgain={() => {
              setVerifiedRecipient(null);
              setAmount("");
            }}
            orderFlow={orderFlow}
          />
        ) : null}
      </div>

      <aside className="space-y-4">
        <Card variant="standard">
          <CardTitle>Wallet</CardTitle>
          <CardDescription>
            {intentChosen
              ? `${walletRoleForDirection(direction)}. MetaMask, Rabby, or OKX on Celo mainnet.`
              : "Connect only when your review is ready. MetaMask, Rabby, or OKX on Celo mainnet."}
          </CardDescription>

          {intentChosen ? <div className="mt-4">
            <ConnectWalletButton fullWidth showBalances={false} />
          </div> : null}

          {intentChosen && wallet.status === "disconnected" ? (
            <p className="mt-3 text-sm text-receipt-grey">
              Connect a wallet before cash-out review is ready.
            </p>
          ) : null}

          {intentChosen && wallet.status === "wrong-network" ? (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-ledger-stone" role="status">
                Switch to Celo mainnet. This flow is not ready on other
                networks.
              </p>
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
            </div>
          ) : null}

          {intentChosen && wallet.status === "connected" ? (
            <dl className="mt-4 space-y-2 border-t border-ledger-edge pt-4 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-receipt-grey">Address</dt>
                <dd className="font-proof text-[12px] text-ledger-stone">
                  {wallet.address
                    ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-receipt-grey">USDC balance</dt>
                <dd className="font-proof text-[13px] font-medium tabular-nums">
                  {wallet.balancesLoading
                    ? "…"
                    : wallet.usdcBalance
                      ? `${wallet.usdcBalance.value} USDC`
                      : wallet.balancesError
                        ? "Unavailable"
                        : "—"}
                </dd>
              </div>
              {wallet.balancesError ? (
                <p className="text-xs text-ledger-stone" role="status">
                  {wallet.balancesError}
                </p>
              ) : null}
            </dl>
          ) : null}
        </Card>

        <Card variant="flat">
          <CardTitle className="text-base">Order boundary</CardTitle>
          <CardDescription>
            Recipient verification does not create a Paycrest order, request a
            receive address, or move funds. After a fresh quote and verified
            recipient, Providus asks for explicit confirmation before creating
            the order and opening the wallet payment step.
          </CardDescription>
        </Card>
      </aside>
    </div>
  );
}

function QuotePanel({
  direction,
  quoteState,
  onRefresh,
  onRefreshSupport,
  supportState,
  walletStatus,
  isReady,
  balanceCheck,
  quoteFresh,
}: {
  direction: MoveDirection;
  quoteState: ReturnType<typeof useCorridorQuote>["state"];
  onRefresh: () => void;
  onRefreshSupport: () => void;
  supportState: ReturnType<typeof usePaycrestSupport>["state"];
  walletStatus: string;
  isReady: boolean;
  balanceCheck: {
    show: boolean;
    sufficient: boolean;
    comparable: boolean;
    loaded: boolean;
  };
  quoteFresh: boolean;
}) {
  if (supportState.kind === "loading") {
    return (
      <Card variant="surface">
        <div className="flex items-center gap-2 text-sm text-receipt-grey" role="status" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Verifying Celo USDC with Paycrest…
        </div>
      </Card>
    );
  }

  if (supportState.kind === "error") {
    return (
      <Card variant="surface">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-loss-red" aria-hidden />
          <div>
            <CardTitle className="text-base">Support check failed</CardTitle>
            <CardDescription className="mt-1">
              {supportState.message} ({supportState.code})
            </CardDescription>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={onRefreshSupport}
            >
              Retry
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  if (supportState.kind === "mismatch") {
    return (
      <Card variant="surface">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-loss-red" aria-hidden />
          <div>
            <CardTitle className="text-base">Token configuration mismatch</CardTitle>
            <CardDescription className="mt-1">
              Paycrest’s Celo USDC configuration does not match Providus’s
              supported token. Quotes are disabled until compatibility is
              confirmed.
            </CardDescription>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={onRefreshSupport}
            >
              Re-check compatibility
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card variant="verdict">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-proof text-receipt-grey">Live quote</p>
          <CardTitle className="mt-1">{directionLabel(direction)}</CardTitle>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={quoteState.kind === "loading" || quoteState.kind === "idle"}
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          {direction === "buy-usdc" ? "Refresh availability" : "Refresh quote"}
        </Button>
      </div>

      {walletStatus === "disconnected" ? (
        <p className="mt-3 text-sm text-receipt-grey" role="status">
          Wallet disconnected — connect before review is ready.
        </p>
      ) : null}
      {walletStatus === "wrong-network" ? (
        <p className="mt-3 text-sm text-ledger-stone" role="status">
          Wrong network — switch to Celo. Not executable.
        </p>
      ) : null}

      {quoteState.kind === "idle" ? (
        <CardDescription className="mt-4">
          Enter a USDC amount to request a live Paycrest quote.
        </CardDescription>
      ) : null}

      {quoteState.kind === "invalid_amount" ? (
        <p className="mt-4 text-sm text-loss-red" role="alert">
          {quoteState.message}
        </p>
      ) : null}

      {quoteState.kind === "loading" ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-receipt-grey" role="status" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Fetching live quote for {quoteState.amount} USDC…
        </div>
      ) : null}

      {quoteState.kind === "no_provider" ? (
        <div className="mt-4 space-y-3">
          {direction === "buy-usdc" ? (
            <>
              <p className="text-sm font-semibold text-ledger-stone">
                Buying USDC on Celo is temporarily unavailable
              </p>
              <p className="text-sm text-receipt-grey">
                Live Paycrest liquidity has no provider for NGN → USDC on Celo.
                Providus did not switch you to another network. No bank fields
                apply to Buy USDC.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-ledger-stone">
                Cash out temporarily unavailable
              </p>
              <p className="text-sm text-receipt-grey">
                No live provider for USDC → NGN on Celo right now.
              </p>
            </>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={onRefresh}>
            Retry / refresh availability
          </Button>
        </div>
      ) : null}

      {quoteState.kind === "error" ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm font-semibold text-loss-red" role="alert">
            {quoteState.message}
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={onRefresh}>
            Try again
          </Button>
        </div>
      ) : null}

      {quoteState.kind === "available" ? (
        <div className="mt-4 space-y-4">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-receipt-grey">USDC amount</dt>
              <dd className="font-display text-2xl font-semibold tracking-tight tabular-nums">
                {quoteState.amount}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-receipt-grey">
                {direction === "buy-usdc"
                  ? "Estimated NGN required"
                  : "Estimated NGN to receive"}
              </dt>
              <dd className="font-display text-2xl font-semibold tracking-tight tabular-nums text-provident-green">
                ₦
                {formatDecimalForDisplay(quoteState.estimatedNgn, {
                  maxFractional: 2,
                })}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-receipt-grey">Rate (NGN per USDC)</dt>
              <dd className="font-proof text-sm font-medium tabular-nums">
                {quoteState.quote.rate}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-receipt-grey">Quote freshness</dt>
              <dd className="text-sm font-medium">
                {quoteFresh
                  ? `Updated ${formatQuoteTime(quoteState.quote.checkedAt)} · refreshes after 60s`
                  : "Stale · refresh before review"}
              </dd>
            </div>
          </dl>

          <p className="rounded-[10px] border border-rate-amber/40 bg-receipt-field px-3 py-2 text-xs text-ledger-stone">
            Rates change. No funds have moved. Fees are not final until order
            creation (next step).
          </p>

          {balanceCheck.show ? (
            <p className="text-sm font-semibold text-loss-red" role="alert">
              Insufficient USDC balance for this cash-out amount.
            </p>
          ) : null}

          {!isReady ? (
            <p className="text-sm text-receipt-grey">
              Connect on Celo to treat this flow as ready.
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function formatQuoteTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return `${date.toISOString().slice(11, 16)} UTC`;
}
