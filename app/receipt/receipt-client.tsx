"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Receipt, Search, ExternalLink, CheckCircle2, AlertTriangle, Tag } from "lucide-react";
import { RouteStepper } from "@/components/providus/route-stepper";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { RouteCheckCTA } from "@/components/ui/route-check-cta";
import { useProvidusWallet } from "@/hooks/use-providus-wallet";
import { formatDecimalForDisplay } from "@/lib/money/decimal";
import { CELO_EXPLORER_URL } from "@/lib/wallet/celo";
import { ACTIVE_CELO_ATTRIBUTION_TAG } from "@/lib/celo/attribution";
import type { PublicTransactionDto } from "@/lib/transactions/types";
import { isReceiptComplete } from "@/lib/transactions/receipt";

export function ReceiptClient() {
  const searchParams = useSearchParams();
  const txParam = searchParams.get("tx")?.trim() || "";
  const [txIdInput, setTxIdInput] = useState(txParam);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    transaction: PublicTransactionDto;
    stage: string;
    stageLabel: string;
    stageDescription: string;
    isFiatFinal: boolean;
    isFiatDelivered: boolean;
    isAirtimeDelivered: boolean;
  } | null>(null);

  const wallet = useProvidusWallet();
  const [, startTransition] = useTransition();
  const receiptRequestRef = useRef(0);

  const loadReceipt = async (id: string) => {
    if (!id) return;
    const requestId = ++receiptRequestRef.current;
    const connectedWallet = typeof wallet.address === "string" ? wallet.address : "";
    if (connectedWallet === "") {
      // A receipt read is owner-scoped, so it is answered only to the wallet that
      // owns the transaction. While disconnected there is no context to send and
      // nothing safe to display.
      setLoading(false);
      setError("Connect the wallet that owns this transaction to view its receipt.");
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const query = new URLSearchParams({
        scope: "receipt",
        walletAddress: connectedWallet,
      });
      const res = await fetch(
        `/api/transactions/${encodeURIComponent(id)}?${query.toString()}`,
        {
          cache: "no-store",
          headers: { Accept: "application/json" }
        }
      );
      if (requestId !== receiptRequestRef.current) return;
      if (!res.ok) {
        if (res.status === 404) {
          setError("Transaction not found. Please verify the transaction ID.");
        } else if (res.status === 401) {
          setError("Connect the wallet that owns this transaction to view its receipt.");
        } else if (res.status === 403) {
          setError("Access restricted: connected wallet does not match transaction owner.");
        } else if (res.status === 400) {
          setError("Could not verify the connected wallet for this receipt.");
        } else {
          setError(`Could not load receipt (HTTP ${res.status}).`);
        }
        setData(null);
        return;
      }
      if (requestId !== receiptRequestRef.current) return;
      const json = await res.json();
      if (requestId !== receiptRequestRef.current) return;
      if (json.ok && json.transaction) {
        const nextTx = json.transaction as PublicTransactionDto;
        // The server already refused a mismatched wallet; this second check keeps
        // the UI from rendering a receipt the connected wallet does not own.
        const ownerWallet = typeof nextTx.walletAddress === "string" ? nextTx.walletAddress : "";
        const ownerMismatch =
          ownerWallet === "" ||
          connectedWallet.toLowerCase() !== ownerWallet.toLowerCase();
        if (ownerMismatch) {
          setError("Access restricted: connected wallet does not match transaction owner.");
          setData(null);
          return;
        }
        setData(json);
      } else {
        setError("Invalid response format.");
        setData(null);
      }
    } catch {
      if (requestId !== receiptRequestRef.current) return;
      setError("Network error loading transaction receipt.");
    } finally {
      if (requestId === receiptRequestRef.current) {
        setLoading(false);
      }
    }
  };
  // Re-fetch whenever the selected transaction OR the connected wallet identity changes,
  // so a receipt loaded while disconnected is re-validated after connect/switch.
  useEffect(() => {
    if (txParam) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional single hydration fetch
      void loadReceipt(txParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txParam, wallet.address]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const id = txIdInput.trim();
    if (!id) return;
    startTransition(() => {
      window.history.replaceState(null, "", `/receipt?tx=${encodeURIComponent(id)}`);
    });
    void loadReceipt(id);
  };

  const tx = data?.transaction;
  const isAirtime = tx?.type === "airtime";
  const fulfilment = tx?.fulfilment;
  const isCompleted = isReceiptComplete(
    tx?.type,
    data?.isFiatFinal,
    data?.isAirtimeDelivered,
  );

  return (
    <div className="container-providus py-10 sm:py-14">
      <div className="max-w-2xl">
        <p className="font-proof text-receipt-grey">Proof surface · verifiable receipts</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ledger-stone sm:text-4xl">
          What actually happened?
        </h1>
        <p className="mt-3 text-receipt-grey leading-relaxed">
          Verifiable proof for shipped airtime + cash-out payments. Follow the
          evidence from Celo payment through fiat delivery and fulfilment.
        </p>

        {/* Transaction Lookup Search */}
        <form onSubmit={handleSearch} className="mt-6 flex gap-2">
          <label htmlFor="receipt-transaction-id" className="sr-only">
            Transaction ID
          </label>
          <div className="relative flex-1">
            <input
              id="receipt-transaction-id"
              type="text"
              value={txIdInput}
              onChange={(e) => setTxIdInput(e.target.value)}
              placeholder="Look up transaction (e.g. tx_...)"
              className="w-full rounded-[8px] border border-ledger bg-clear-paper px-3 py-2 text-xs font-mono text-ledger-stone placeholder:text-receipt-grey shadow-sticker focus:outline-none focus:ring-1 focus:ring-quote-blue"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !txIdInput.trim()}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-[8px] border border-ledger bg-provident-green px-4 py-2 font-display text-xs font-semibold text-white shadow-sticker transition-all hover:bg-deep-provision disabled:opacity-50"
          >
            <Search className="h-3.5 w-3.5" />
            <span>{loading ? "Searching..." : "Find"}</span>
          </button>
        </form>

        {error ? (
          <div role="alert" className="mt-3 flex items-center gap-2 rounded-[8px] border border-loss-red/40 bg-loss-red/10 p-3 text-xs text-loss-red">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
      </div>

      <RouteStepper current="receipt" className="mt-8" />

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card variant="verdict" className="flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Outcome</CardTitle>
            <span className="rounded-full border border-ledger-edge bg-receipt-field px-3 py-1 font-proof text-[12px] text-receipt-grey">
              {tx ? (isCompleted ? "DELIVERED" : tx.status.toUpperCase()) : "EMPTY"}
            </span>
          </div>
          <CardDescription className="mt-2">
            A data-minimised proof surface populated strictly from verified
            payment evidence.
          </CardDescription>

          <div className="mt-8 rounded-[10px] border border-dashed border-ledger-edge bg-receipt-field px-4 py-8 text-center">
            <p className="font-display text-2xl font-semibold tracking-tight text-ledger-stone sm:text-3xl">
              {tx ? (isCompleted ? "Delivered & Verified" : data?.stageLabel || "Processing") : "Verified result"}
            </p>
            <p className="mt-2 font-proof text-receipt-grey">
              {tx ? (data?.stageDescription || "Payment records confirmed.") : "— · no verified transaction selected"}
            </p>
          </div>

          <dl className="mt-6 grid gap-3 border-t border-ledger-edge pt-6 sm:grid-cols-2">
            <div>
              <dt className="font-proof text-receipt-grey">Celo payment</dt>
              <dd className="mt-0.5 text-sm font-semibold text-ledger-stone">
                {tx?.celoTxHash ? "Confirmed on-chain" : "—"}
              </dd>
            </div>
            <div>
              <dt className="font-proof text-receipt-grey">Fiat delivery</dt>
              <dd className="mt-0.5 text-sm font-semibold text-ledger-stone">
                {data?.isFiatFinal ? "Confirmed delivered" : "—"}
              </dd>
            </div>
            <div>
              <dt className="font-proof text-receipt-grey">Airtime fulfilment</dt>
              <dd className="mt-0.5 text-sm font-semibold text-ledger-stone">
                {data?.isAirtimeDelivered ? "Airtime delivered (200)" : isAirtime ? "Pending" : "N/A (Cash-out)"}
              </dd>
            </div>
            <div>
              <dt className="font-proof text-receipt-grey">Proof status</dt>
              <dd className="mt-0.5 text-sm font-semibold text-ledger-stone">
                {isCompleted ? "Authoritative & complete" : tx ? "Pending confirmation" : "—"}
              </dd>
            </div>
          </dl>
        </Card>
        {tx ? (
          <Card variant="standard" className="flex flex-col p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ledger-edge pb-3">
              <div>
                <span className="font-proof text-[10px] text-receipt-grey uppercase tracking-wider">
                  {isAirtime ? "Airtime Top-Up" : "Cash-Out"}
                </span>
                <CardTitle className="text-xl mt-0.5">
                  {tx.amountNgn ? `₦${formatDecimalForDisplay(tx.amountNgn)}` : `${tx.amountUsdc} USDC`}
                </CardTitle>
              </div>
              <div className="flex items-center gap-2">
                {isCompleted ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-provident-green/40 bg-provident-green/10 px-3 py-1 font-display text-xs font-semibold text-deep-provision">
                    <CheckCircle2 className="h-3.5 w-3.5 text-provident-green" />
                    <span>Delivered</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-ledger-edge bg-receipt-field px-3 py-1 font-display text-xs font-semibold text-receipt-grey capitalize">
                    {tx.status}
                  </span>
                )}
              </div>
            </div>

            <dl className="mt-4 space-y-2.5 text-xs font-proof">
              {isAirtime && tx.metadata?.phoneMasked ? (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-ledger-edge/40 py-1">
                  <dt className="text-receipt-grey">Recipient (masked)</dt>
                  <dd className="text-right font-semibold text-ledger-stone">
                    {tx.metadata.phoneMasked} {tx.metadata.network ? `(${String(tx.metadata.network).toUpperCase()})` : ""}
                  </dd>
                </div>
              ) : null}
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-ledger-edge/40 py-1">
                <dt className="text-receipt-grey">Celo USDC paid</dt>
                <dd className="text-right font-semibold text-ledger-stone tabular-nums">
                  {tx.metadata?.totalUsdcToSend ? `${tx.metadata.totalUsdcToSend} USDC` : `${tx.amountUsdc} USDC`}
                </dd>
              </div>

              {tx.celoTxHash ? (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-ledger-edge/40 py-1">
                  <dt className="text-receipt-grey">Celo payment</dt>
                  <dd className="flex justify-self-end font-mono text-quote-blue hover:underline">
                    <a
                      href={`${CELO_EXPLORER_URL}/tx/${tx.celoTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1"
                    >
                      <span>{tx.celoTxHash.slice(0, 8)}...{tx.celoTxHash.slice(-6)}</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </dd>
                </div>
              ) : null}

              {tx.paycrestOrderId ? (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-ledger-edge/40 py-1">
                  <dt className="text-receipt-grey">Fiat delivery order</dt>
                  <dd className="max-w-[65%] break-all text-right font-mono text-ledger-stone">{tx.paycrestOrderId.slice(0, 8)}...</dd>
                </div>
              ) : null}

              {tx.paycrestReference ? (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-ledger-edge/40 py-1">
                  <dt className="text-receipt-grey">Fiat delivery reference</dt>
                  <dd className="max-w-[65%] break-all text-right font-mono text-ledger-stone">{tx.paycrestReference}</dd>
                </div>
              ) : null}
              {tx.paycrestStatus ? (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-ledger-edge/40 py-1">
                  <dt className="text-receipt-grey">Fiat delivery status</dt>
                  <dd className="max-w-[65%] break-all text-right font-mono text-ledger-stone capitalize">{tx.paycrestStatus}</dd>
                </div>
              ) : null}
              {fulfilment?.orderId ? (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-ledger-edge/40 py-1">
                  <dt className="text-receipt-grey">Airtime fulfilment order</dt>
                  <dd className="max-w-[65%] break-all text-right font-mono font-semibold text-ledger-stone">{fulfilment.orderId}</dd>
                </div>
              ) : null}
              {fulfilment?.fulfilledAt ? (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-ledger-edge/40 py-1">
                  <dt className="text-receipt-grey">Airtime delivered</dt>
                  <dd className="text-right text-ledger-stone">{new Date(fulfilment.fulfilledAt).toLocaleString()}</dd>
                </div>
              ) : null}
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-ledger-edge/40 py-1">
                <dt className="text-receipt-grey">Transaction ID</dt>
                <dd className="max-w-[65%] break-all text-right font-mono font-semibold text-ledger-stone select-all">{tx.id}</dd>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-ledger-edge/40 py-1">
                <dt className="text-receipt-grey">Created at</dt>
                <dd className="text-right text-ledger-stone">{new Date(tx.createdAt).toLocaleString()}</dd>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-ledger-edge/40 py-1">
                <dt className="text-receipt-grey">Updated at</dt>
                <dd className="text-right text-ledger-stone">{new Date(tx.updatedAt).toLocaleString()}</dd>
              </div>
            </dl>

            <div className="mt-4 flex items-center justify-between rounded-[8px] border border-quote-blue/20 bg-quote-blue/5 p-2.5 text-[11px] font-proof text-ledger-stone">
              <div className="flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5 text-quote-blue" />
                <span>Attribution tag:</span>
                <code className="font-mono font-bold text-quote-blue">{ACTIVE_CELO_ATTRIBUTION_TAG}</code>
              </div>
              {/* Static configuration, not proof of a tagged transfer: the tag is
                  what Providus appends when a deposit is signed. */}
              <span className="text-receipt-grey font-semibold">Attribution configured</span>
            </div>
          </Card>
        ) : (
          <EmptyState
            variant="surface"
            icon={<Receipt className="h-5 w-5" />}
            title="No payment proof selected"
            description="Enter an explicit Providus transaction ID above to inspect the verified payment and delivery evidence."
            action={<RouteCheckCTA />}
          />
        )}
      </div>
    </div>
  );
}
