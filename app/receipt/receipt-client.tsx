"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowUpRight, ChevronDown, ExternalLink, LoaderCircle, Receipt, Search, X } from "lucide-react";
import { RouteStepper } from "@/components/providus/route-stepper";
import { useProvidusWallet } from "@/hooks/use-providus-wallet";
import type { ReceiptDetail, ReceiptListPage, ReceiptPreview } from "@/lib/receipts/types";

type ApiList = { ok: true; receipts: ReceiptPreview[]; nextCursor: string | null };
type ApiDetail = { ok: true; receipt: ReceiptDetail };

const NETWORK_FILTERS = [
  { value: "", label: "All networks" },
  { value: "bot-mainnet", label: "BOT Chain Mainnet" },
  { value: "celo", label: "Celo Mainnet" },
  { value: "bot-testnet", label: "BOT Chain Testnet (historical)" },
] as const;

const STATUS_FILTERS = [
  { value: "", label: "All statuses" },
  { value: "verified", label: "Verified" },
  { value: "pending", label: "Pending" },
  { value: "unknown", label: "Unknown" },
  { value: "failed", label: "Failed" },
  { value: "completed", label: "Completed" },
  { value: "settled", label: "Settled" },
  { value: "processing", label: "Processing" },
  { value: "refunded", label: "Refunded" },
] as const;

const TOKEN_FILTERS = [
  { value: "", label: "All tokens" },
  { value: "BOT", label: "BOT" },
  { value: "USDT", label: "USDT" },
  { value: "USDC", label: "USDC" },
  { value: "CNGN", label: "cNGN" },
] as const;

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function statusLabel(status: string): string {
  if (status === "verified") return "Verified";
  if (status === "unknown") return "Unknown";
  if (status === "pending" || status === "submitted") return "Pending";
  return status.slice(0, 1).toUpperCase() + status.slice(1);
}

function statusClass(status: string): string {
  if (status === "verified" || status === "completed") return "border-[#276645]/50 bg-[#276645]/10 text-[#174D31]";
  if (status === "failed" || status === "refunded") return "border-[#A33A35]/50 bg-[#A33A35]/10 text-[#7C2521]";
  if (status === "unknown") return "border-[#825500]/50 bg-[#825500]/10 text-[#604000]";
  return "border-[#4D5752]/30 bg-[#F5F2EA] text-[#3D4641]";
}

function walletHeaders(address: string | null | undefined): HeadersInit {
  return address ? { "x-providus-wallet": address } : {};
}

export function ReceiptClient() {
  const searchParams = useSearchParams();
  const wallet = useProvidusWallet();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [network, setNetwork] = useState("");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState("");
  const [receipts, setReceipts] = useState<ReceiptPreview[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const nextCursorRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const txParam = searchParams.get("tx")?.trim();
    if (!txParam) return null;
    return txParam.startsWith("bot:") || txParam.startsWith("celo:") ? txParam : `celo:${txParam}`;
  });
  const [detail, setDetail] = useState<ReceiptDetail | null>(null);

  const [detailError, setDetailError] = useState<string | null>(null);
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const loadReceipts = useCallback(async (mode: "replace" | "more" = "replace") => {
    const requestId = ++listRequestRef.current;
    const cursor = mode === "more" ? nextCursorRef.current : null;
    if (mode === "more" && !cursor) return;
    if (mode === "replace") {
      nextCursorRef.current = null;
      setNextCursor(null);
      setReceipts([]);
      setLoading(true);
    }
    else setLoadingMore(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (network) params.set("network", network);
      if (token) params.set("token", token);
      if (status) params.set("status", status);
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/receipts?${params.toString()}`, {
        cache: "no-store",
        headers: { Accept: "application/json", ...walletHeaders(wallet.address) },
      });
      if (requestId !== listRequestRef.current) return;
      if (!response.ok) {
        if (response.status === 401) {
          setError("Connect and sign in with the wallet that owns these payments to view receipts.");
        } else if (response.status === 429) {
          setError("Too many receipt requests. Wait a moment, then try again.");
        } else {
          setError(`Receipts could not be loaded (HTTP ${response.status}).`);
        }
        if (mode === "replace") setReceipts([]);
        return;
      }
      const payload = (await response.json()) as ApiList;
      if (requestId !== listRequestRef.current) return;
      const page: ReceiptListPage = { receipts: payload.receipts, nextCursor: payload.nextCursor };
      setReceipts((current) => mode === "more" ? [...current, ...page.receipts] : page.receipts);
      nextCursorRef.current = page.nextCursor;
      setNextCursor(page.nextCursor);
    } catch {
      if (requestId !== listRequestRef.current) return;
      setError("Network error while loading receipts. Check your connection and retry.");
    } finally {
      if (requestId === listRequestRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [network, search, status, token, wallet.address]);

  useEffect(() => {
    // This effect starts a fresh owner-scoped read whenever the wallet or filter changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadReceipts("replace");
  }, [loadReceipts]);

  const restoreReceiptFocus = useCallback(() => {
    window.requestAnimationFrame(() => {
      const trigger = triggerRef.current;
      if (trigger?.isConnected) trigger.focus();
      else headingRef.current?.focus();
    });
  }, []);

  const closeReceipt = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
    restoreReceiptFocus();
  }, [restoreReceiptFocus]);
  const openReceipt = useCallback((id: string, trigger: HTMLElement) => {
    triggerRef.current = trigger;
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const requestId = ++detailRequestRef.current;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();

    const headers = { Accept: "application/json", ...walletHeaders(wallet.address) };
    void fetch(`/api/receipts/${encodeURIComponent(selectedId)}`, { cache: "no-store", headers })
      .then(async (response) => {
        if (requestId !== detailRequestRef.current) return;
        if (!response.ok) {
          if (response.status === 404) setDetailError("This receipt is not available for the signed-in wallet.");
          else if (response.status === 401) setDetailError("Sign in with the wallet that owns this receipt.");
          else setDetailError(`Receipt details could not be loaded (HTTP ${response.status}).`);
          return;
        }
        const payload = (await response.json()) as ApiDetail;
        if (requestId === detailRequestRef.current) setDetail(payload.receipt);
      })
      .catch(() => {
        if (requestId === detailRequestRef.current) setDetailError("Network error while loading this receipt.");
      })

    return () => {
      detailRequestRef.current += 1;
    };
  }, [selectedId, wallet.address]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog?.open) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const html = document.documentElement;
    const previousBodyStyle = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow };
    const previousHtmlOverflow = html.style.overflow;
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    html.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => dialog.querySelector<HTMLElement>("[data-dialog-initial-focus]")?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      body.style.position = previousBodyStyle.position;
      body.style.top = previousBodyStyle.top;
      body.style.width = previousBodyStyle.width;
      body.style.overflow = previousBodyStyle.overflow;
      html.style.overflow = previousHtmlOverflow;
      window.scrollTo(0, scrollY);
    };
  }, [selectedId]);



  const resetFilters = useMemo(() => !search && !network && !token && !status, [network, search, status, token]);

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearch(searchInput.trim());
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const items = [...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.offsetParent !== null);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };

  const onDialogClose = () => {
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
    restoreReceiptFocus();
  };
  return (
    <main className="container-providus py-8 sm:py-12">
      <div className="max-w-3xl">
        <p className="font-proof text-receipt-grey">Prove · payment history</p>
        <h1 ref={headingRef} tabIndex={-1} className="mt-2 font-display text-3xl font-semibold tracking-tight text-ledger-stone sm:text-4xl focus:outline-none">
          Your receipts
        </h1>
        <p className="mt-3 max-w-2xl leading-relaxed text-receipt-grey">
          Find a payment, check its recorded status, and open the evidence stored for your wallet.
        </p>
      </div>

      <RouteStepper current="receipt" className="mt-7" />

      <section aria-label="Receipt history" className="mt-8 max-w-5xl">
        <form onSubmit={submitSearch} className="grid gap-3 rounded-[8px] border border-ledger-edge bg-clear-paper p-4 sm:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,auto))_auto] sm:items-end">
          <div className="min-w-0">
            <label htmlFor="receipt-search" className="mb-1 block text-xs font-semibold text-ledger-stone">Search receipts</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-receipt-grey" aria-hidden="true" />
              <input
                id="receipt-search"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Recipient, amount, or transaction hash"
                className="min-h-11 w-full rounded-[8px] border border-ledger-edge bg-white pl-9 pr-3 text-base text-ledger-stone placeholder:text-receipt-grey focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              />
            </div>
          </div>
          <FilterSelect id="receipt-network" label="Network" value={network} onChange={setNetwork} options={NETWORK_FILTERS} />
          <FilterSelect id="receipt-token" label="Token" value={token} onChange={setToken} options={TOKEN_FILTERS} />
          <FilterSelect id="receipt-status" label="Status" value={status} onChange={setStatus} options={STATUS_FILTERS} />
          <button type="submit" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] border border-ink bg-ink px-4 text-sm font-semibold text-cream hover:bg-cream hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            {loading ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
            Search
          </button>
          {!resetFilters ? (
            <button type="button" className="min-h-11 text-sm font-medium text-quote-blue underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:col-span-full sm:justify-self-start" onClick={() => { setSearchInput(""); setSearch(""); setNetwork(""); setToken(""); setStatus(""); }}>
              Clear filters
            </button>
          ) : null}
        </form>

        <p className="mt-4 text-xs leading-relaxed text-receipt-grey">
          Payment records only. Token approvals are separate wallet actions and aren’t stored as receipt history.
        </p>

        {error ? (
          <div role="alert" className="mt-4 flex items-start gap-2 rounded-[8px] border border-loss-red/40 bg-loss-red/10 p-3 text-sm text-loss-red">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
            <button type="button" className="ml-auto min-h-11 shrink-0 px-2 font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" onClick={() => void loadReceipts("replace")}>Retry</button>
          </div>
        ) : null}

        {loading && receipts.length === 0 ? (
          <div role="status" className="mt-6 rounded-[8px] border border-ledger-edge bg-clear-paper p-6 text-sm text-receipt-grey">
            <LoaderCircle className="mr-2 inline h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Loading wallet receipts…
          </div>
        ) : null}

        {!loading && !error && receipts.length === 0 ? (
          <div className="mt-6 rounded-[8px] border border-dashed border-ledger-edge bg-clear-paper p-6 sm:p-8">
            <div className="flex items-start gap-3">
              <Receipt className="mt-1 h-5 w-5 shrink-0 text-provident-green" aria-hidden="true" />
              <div>
                <h2 className="font-display text-xl font-semibold text-ledger-stone">{resetFilters ? "No receipts found for this wallet" : "No receipts match these filters"}</h2>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-receipt-grey">
                  {resetFilters ? "Once a payment is recorded, its available evidence will appear here." : "Try a different search or clear the filters to see other recorded payments."}
                </p>
                {resetFilters ? <a className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-[8px] border border-ink bg-ink px-4 text-sm font-semibold text-cream hover:bg-cream hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" href="/dashboard">Go to dashboard <ArrowUpRight className="h-4 w-4" aria-hidden="true" /></a> : null}
              </div>
            </div>
          </div>
        ) : null}

        {receipts.length > 0 ? (
          <div className="mt-5 overflow-hidden rounded-[8px] border border-ledger-edge bg-clear-paper">
            <ul className="divide-y divide-ledger-edge" aria-label="Payment receipts">
              {receipts.map((receipt) => (
                <li key={receipt.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-5 sm:px-5">
                  <div className="min-w-0">
                    <p className="break-words font-display text-lg font-semibold tabular-nums text-ledger-stone">{receipt.amount} {receipt.token}</p>
                    <p className="mt-0.5 truncate text-sm text-receipt-grey">To {receipt.recipientName}</p>
                    <p className="mt-1 break-all font-mono text-xs text-receipt-grey">{receipt.recipientAddress ?? "Recipient address unavailable in this record"}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-receipt-grey sm:block sm:space-y-1">
                    <span className="block font-medium text-ledger-stone">{receipt.network}</span>
                    <span className="block">{formatDate(receipt.createdAt)}</span>
                    {receipt.verifiedAt ? <span className="block">Verified {formatDate(receipt.verifiedAt)}</span> : null}
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(receipt.status)}`}>
                      {statusLabel(receipt.status)}
                    </span>
                    <button type="button" onClick={(event) => openReceipt(receipt.id, event.currentTarget)} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-[8px] px-3 text-sm font-semibold text-quote-blue underline underline-offset-4 hover:bg-quote-blue/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                      View receipt <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {nextCursor ? (
              <div className="border-t border-ledger-edge p-4 text-center">
                <button type="button" disabled={loadingMore} onClick={() => void loadReceipts("more")} className="inline-flex min-h-11 items-center gap-2 rounded-[8px] border border-ledger bg-white px-4 text-sm font-semibold text-ledger-stone hover:bg-receipt-field disabled:cursor-wait disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                  {loadingMore ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                  {loadingMore ? "Loading…" : "Load more receipts"}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <dialog
        ref={dialogRef}
        aria-labelledby="receipt-dialog-title"
        aria-describedby="receipt-dialog-description"
        onClose={onDialogClose}
        onCancel={(event) => { event.preventDefault(); closeReceipt(); }}
        onClick={(event) => { if (event.target === event.currentTarget) closeReceipt(); }}
        onKeyDown={handleDialogKeyDown}
        className="fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none overflow-y-auto bg-transparent p-0 text-left text-ledger-stone backdrop:bg-ink/55"
      >
        <section className="relative mx-auto mt-[max(0.75rem,env(safe-area-inset-top))] max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-2xl overflow-x-hidden overflow-y-auto rounded-[8px] border border-ledger-edge bg-clear-paper p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] shadow-2xl sm:mt-[5vh] sm:max-h-[min(90dvh,900px)] sm:p-6">
          <div className="flex items-start justify-between gap-4 border-b border-ledger-edge pb-4">
            <div>
              <p className="font-proof text-xs text-receipt-grey">Prove · receipt details</p>
              <h2 id="receipt-dialog-title" className="mt-1 font-display text-2xl font-semibold text-ledger-stone">Payment receipt</h2>
              <p id="receipt-dialog-description" className="mt-1 text-sm text-receipt-grey">Recorded payment details from the selected wallet’s ledger.</p>
            </div>
            <button type="button" data-dialog-initial-focus aria-label="Close receipt" onClick={closeReceipt} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] border border-ledger-edge bg-white text-ledger-stone hover:bg-receipt-field focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {selectedId && !detail && !detailError ? <p role="status" className="py-8 text-sm text-receipt-grey"><LoaderCircle className="mr-2 inline h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Loading receipt evidence…</p> : null}
          {detailError ? <p role="alert" className="my-5 rounded-[8px] border border-loss-red/40 bg-loss-red/10 p-3 text-sm text-loss-red">{detailError}</p> : null}
          {detail ? <ReceiptEvidence receipt={detail} /> : null}
        </section>
      </dialog>
    </main>
  );
}

type FilterOption = { value: string; label: string };

function FilterSelect(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly FilterOption[];
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={props.id} className="mb-1 block text-xs font-semibold text-ledger-stone">{props.label}</label>
      <select id={props.id} value={props.value} onChange={(event) => props.onChange(event.target.value)} className="min-h-11 w-full rounded-[8px] border border-ledger-edge bg-white px-3 text-base text-ledger-stone focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
        {props.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}

function EvidenceRow(props: { label: string; value: string | number | null; mono?: boolean }) {
  return (
    <div className="grid gap-1 border-b border-ledger-edge/60 py-3 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)] sm:gap-4">
      <dt className="text-xs font-semibold text-receipt-grey">{props.label}</dt>
      <dd className={`min-w-0 break-all text-sm text-ledger-stone ${props.mono ? "font-mono" : ""}`}>{props.value ?? "Unavailable in the stored record"}</dd>
    </div>
  );
}

function ReceiptEvidence({ receipt }: { receipt: ReceiptDetail }) {
  const evidenceRows = [
    { label: "Sending wallet", value: receipt.payerAddress, mono: true },
    { label: "Recipient", value: receipt.recipientName },
    { label: "Recipient address", value: receipt.recipientAddress, mono: true },
    { label: "Amount and token", value: `${receipt.amount} ${receipt.token}` },
    { label: "Network", value: `${receipt.network} · chain ${receipt.chainId}` },
    { label: "Payment contract", value: receipt.paymentContract, mono: true },
    ...(receipt.tokenContract ? [{ label: "Token contract", value: receipt.tokenContract, mono: true }] : []),
    { label: "Transaction hash", value: receipt.txHash, mono: true },
    { label: "Block number", value: receipt.blockNumber },
    { label: "Confirmation count", value: receipt.confirmationCount },
    { label: "Status evidence", value: receipt.statusEvidence },
    { label: "Recorded at", value: formatDate(receipt.createdAt) },
    { label: "Verified at", value: receipt.verifiedAt ? formatDate(receipt.verifiedAt) : null },
    { label: "Actual gas fee", value: receipt.actualGasFee },
  ];

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-ledger-edge bg-receipt-field p-4">
        <div>
          <p className="font-display text-xl font-semibold tabular-nums text-ledger-stone">{receipt.amount} {receipt.token}</p>
          <p className="mt-1 text-sm text-receipt-grey">To {receipt.recipientName}</p>
        </div>
        <span className={`inline-flex min-h-8 items-center rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(receipt.status)}`}>{statusLabel(receipt.status)}</span>
      </div>
      <dl className="mt-3">
        {evidenceRows.map((row) => <EvidenceRow key={row.label} label={row.label} value={row.value} mono={row.mono} />)}
      </dl>
      <div className="mt-5 flex flex-wrap gap-3">
        {receipt.txHash && receipt.explorerUrl ? (
          <a href={receipt.explorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-[8px] border border-ink bg-ink px-4 text-sm font-semibold text-cream hover:bg-cream hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            Open transaction explorer <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        ) : <span className="inline-flex min-h-11 items-center text-sm text-receipt-grey">No transaction hash is recorded.</span>}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-receipt-grey">Gas, block, and confirmation details appear only when the stored payment evidence contains them. Celo receipt records may not include on-chain detail fields.</p>
    </div>
  );
}
