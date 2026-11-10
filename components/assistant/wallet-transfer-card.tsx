"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { formatEther, getAddress, isAddress, type Hex } from "viem";
import type { WalletTransferAction, WalletTransferIntent as Draft } from "@/lib/assistant/types";
import type { WalletTransferIntent } from "@/lib/transfers/repository";
import type { TransferSubmission } from "@/lib/transfers/submissions";
import type { ExecutionPlan } from "@/lib/transfers/execution";
import { BOT_MAINNET, BOT_TESTNET } from "@/lib/chains/registry";
import { MAINNET_CONTRACT_ADDRESS } from "@/lib/transfers/mainnet";
import { walletApi as requestWalletApi, type WalletAuth } from "@/hooks/use-wallet-auth";
import { TokenApprovalCard } from "@/components/assistant/token-approval-card";
import { isSameWalletReviewContext, type WalletReviewContext } from "@/lib/transfers/review-context";
import { getWalletReviewContextRevision, publishWalletReviewContext, subscribeWalletReviewContextRevision } from "@/lib/transfers/review-context-revision";
import { useProvidusWallet } from "@/hooks/use-providus-wallet";
import { resolvePaymentCardView } from "@/lib/transfers/payment-card-view";
import type { PaymentCardView } from "@/lib/transfers/payment-card-view";
import type { ApprovalState } from "@/lib/wallet/transfer-execution";

type Status = { intent: WalletTransferIntent; submission: TransferSubmission | null; freshness: { fresh: boolean }; expired: boolean };
type PlanResponse = { plan: ExecutionPlan; intent: WalletTransferIntent };
const button = "min-h-11 rounded-lg border border-ledger-edge bg-clear-paper px-3 py-2 text-sm disabled:opacity-50";
const EXPECTED_CONTRACTS: Record<number, string> = {
  968: "0xbc6298701490ba211733F2Dc28deB7Df9835B7a4",
  677: MAINNET_CONTRACT_ADDRESS,
};
const EXPLORERS: Record<number, string> = {
  968: "https://scan.bohr.life",
  677: "https://scan.botchain.ai",
};
const CHAINS = { 968: BOT_TESTNET, 677: BOT_MAINNET } as const;
const primary = `${button} bg-provident-green text-white`;

export function WalletTransferCard({ auth, action, draft, send, pending }: {
  auth: WalletAuth; action: WalletTransferAction | null; draft: Draft | null;
  send: (message: string) => Promise<void>; pending: boolean;
}) {
  const { address, chainId } = useAccount();
  const { data: wallet } = useWalletClient();
  const providusWallet = useProvidusWallet();
  const testnetClient = usePublicClient({ chainId: 968 });
  const mainnetClient = usePublicClient({ chainId: 677 });
  const actionId = action && "preparedIntentId" in action ? action.preparedIntentId : null;
  const [id, setId] = useState<string | null>(actionId);
  const [status, setStatus] = useState<Status | null>(null);
  const [plan, setPlan] = useState<ExecutionPlan | null>(null);
  const [planContext, setPlanContext] = useState<WalletReviewContext | null>(null);
  const [gas, setGas] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<{ key: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [lookupId, setLookupId] = useState("");
  const [editing, setEditing] = useState(false);
  const [addressConfirmed, setAddressConfirmed] = useState(false);
  const [recoveryHash, setRecoveryHash] = useState<string | null>(null);
  const [uncertainBroadcast, setUncertainBroadcast] = useState(false);
  const [reviewAttempt, setReviewAttempt] = useState(0);
  const [tokenAllowance, setTokenAllowance] = useState<{ reviewContextKey: string; state: ApprovalState } | null>(null);
  const mounted = useRef(true);
  const lock = useRef(false);
  // Public clients per chain (unconditional hooks); selection is plan-driven.
  const client = status?.intent?.chainId === 677 ? mainnetClient : testnetClient;
  const currentWallet = useRef({ address, chainId, owner: auth.owner });
  useEffect(() => { currentWallet.current = { address, chainId, owner: auth.owner }; }, [address, chainId, auth.owner]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const contextRevision = useSyncExternalStore(
    subscribeWalletReviewContextRevision,
    getWalletReviewContextRevision,
    () => 0,
  );
  const walletContextKey = address && chainId !== undefined && auth.owner
    ? `${auth.owner.toLowerCase()}:${address.toLowerCase()}:${chainId}`
    : null;
  useEffect(() => { publishWalletReviewContext(walletContextKey); }, [walletContextKey]);
  const storageKey = `providus:bot-payment:${auth.owner?.toLowerCase()}`;
  const path = id ? `/api/transfers/${encodeURIComponent(id)}` : "";
  const walletApi = useCallback(<T,>(requestPath: string, body?: unknown, method?: string) => requestWalletApi<T>(requestPath, body, method, auth.owner), [auth.owner]);
  const reviewIntentId = status?.intent.id;
  const reviewTermsFingerprint = status?.intent.termsFingerprint;
  const reviewContext = useMemo<WalletReviewContext | null>(() => reviewIntentId && reviewTermsFingerprint && address && auth.owner ? {
    owner: auth.owner,
    address,
    chainId: chainId ?? 0,
    intentId: reviewIntentId,
    termsFingerprint: reviewTermsFingerprint,
    contextRevision,
  } : null, [reviewIntentId, reviewTermsFingerprint, address, chainId, auth.owner, contextRevision]);
  const reviewContextKey = reviewContext ? `${reviewContext.owner.toLowerCase()}:${reviewContext.address.toLowerCase()}:${reviewContext.chainId}:${reviewContext.intentId}:${reviewContext.termsFingerprint}:${reviewContext.contextRevision}` : null;
  const planIsCurrent = isSameWalletReviewContext(planContext, reviewContext);
  const currentPlan = planIsCurrent ? plan : null;
  const currentGas = planIsCurrent ? gas : null;
  const currentReviewError = reviewError?.key === reviewContextKey ? reviewError.message : null;

  const refresh = useCallback(async () => {
    if (!path || !auth.owner) return;
    const result = await walletApi<Status>(`${path}/status`);
    if (mounted.current) setStatus(result);
  }, [path, auth.owner, walletApi]);
  const revalidateAllowance = useCallback(async () => { await refresh(); }, [refresh]);
  const onTokenAllowanceState = useCallback((state: ApprovalState, key: string) => {
    setTokenAllowance((current) => current?.reviewContextKey === key && current.state === state ? current : { reviewContextKey: key, state });
  }, []);

  useEffect(() => {
    if (!auth.owner || id || draft || action) return;
    let alive = true;
    void (async () => {
      try {
        const local = JSON.parse(localStorage.getItem(storageKey) ?? "null");
        if (local?.id) { if (alive) { setId(local.id); setRecoveryHash(local.hash ?? null); setUncertainBroadcast(Boolean(local.signingStarted && !local.hash)); } return; }
        const rows = await walletApi<{ intents: { intent: WalletTransferIntent }[] }>("/api/transfers");
        for (const row of rows.intents.slice(0, 10)) {
          const existing = await walletApi<Status>(`/api/transfers/${encodeURIComponent(row.intent.id)}/status`);
          if (existing.submission) { if (alive) { setId(row.intent.id); setStatus(existing); } break; }
        }
      } catch (err) { if (alive) setError(message(err)); }
    })();
    return () => { alive = false; };
  }, [auth.owner, id, storageKey, draft, action, walletApi]);

  useEffect(() => {
    if (!id || !auth.owner) return;
    let alive = true;
    const tick = async () => {
      try {
        const result = await walletApi<Status>(`${path}/status`);
        if (!alive) return;
        setStatus(result);
        if (result.submission && !["confirmed", "failed"].includes(result.submission.status)) {
          await walletApi(`${path}/submission`, { recheck: true });
          if (alive) await refresh();
        }
      } catch (err) { if (alive) setError(message(err)); }
    };
    void tick();
    const timer = setInterval(tick, 12_000);
    return () => { alive = false; clearInterval(timer); };
  }, [id, auth.owner, path, refresh, walletApi]);

  const canEstimate = Boolean(status && reviewContext && address?.toLowerCase() === auth.owner?.toLowerCase() && chainId === status.intent.chainId && !status.submission && status.freshness.fresh && (status.intent.chainId === 968 || status.intent.chainId === 677) && status.intent.status === "pending");
  useEffect(() => {
    if (!canEstimate || !reviewContext) return;
    let alive = true;
    const isCurrent = () => alive && getWalletReviewContextRevision() === reviewContext.contextRevision;
    void (async () => {
      try {
        const response = await walletApi<PlanResponse>(`${path}/execution`, {});
        if (!isCurrent()) return;
        if (response.intent.termsFingerprint !== reviewContext.termsFingerprint || response.plan.termsFingerprint !== reviewContext.termsFingerprint || response.plan.chainId !== reviewContext.chainId) throw new Error("Payment terms or network changed. Review again.");
        const expected = EXPECTED_CONTRACTS[response.plan.chainId];
        if (!expected || response.plan.to.toLowerCase() !== expected.toLowerCase()) throw new Error("Payment network or contract is unavailable.");
        setPlan(response.plan);
        setPlanContext(reviewContext);
        if (!client) throw new Error("BOT Testnet RPC is unavailable. Retry the review shortly.");
        const units = await client.estimateGas({ account: response.plan.payer, to: response.plan.to, data: response.plan.data, value: BigInt(response.plan.value) });
        const price = await client.getGasPrice();
        if (isCurrent()) setGas(formatEther(units * price));
      } catch (err) {
        if (isCurrent()) setReviewError({ key: reviewContextKey ?? "", message: message(err) });
      }
    })();
    return () => { alive = false; };
  }, [canEstimate, client, path, reviewAttempt, walletApi, reviewContext, reviewContextKey]);

  async function run(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { await task(); } catch (err) { if (mounted.current) setError(message(err)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }

  async function execute() {
    if (!id || !status || !currentPlan || !currentGas || !wallet || !client || recoveryHash || uncertainBroadcast || status.submission || !isSameWalletReviewContext(planContext, reviewContext) || getWalletReviewContextRevision() !== reviewContext?.contextRevision) throw new Error("Recheck payment before signing.");
    const remembered = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (remembered?.id === id && (remembered.hash || remembered.signingStarted)) throw new Error("An earlier wallet request may have broadcast. Recover it without resending.");
    setStage("Preparing");
    const reviewed = status.intent;
    const fresh = await walletApi<PlanResponse>(`${path}/execution`, {});
    if (fresh.intent.termsFingerprint !== reviewed.termsFingerprint || fresh.plan.termsFingerprint !== currentPlan.termsFingerprint) throw new Error("Payment terms changed. Review again.");
    if (fresh.plan.chainId !== fresh.intent?.chainId && fresh.plan.chainId !== status?.intent.chainId) throw new Error("Payment network or contract is unavailable.");
    if (!EXPECTED_CONTRACTS[fresh.plan.chainId] || fresh.plan.to.toLowerCase() !== EXPECTED_CONTRACTS[fresh.plan.chainId].toLowerCase()) throw new Error("Payment network or contract is unavailable.");
    const checkWallet = async () => {
      const live = currentWallet.current;
      if (!mounted.current || getWalletReviewContextRevision() !== reviewContext?.contextRevision || !live.owner || live.owner.toLowerCase() !== fresh.plan.payer.toLowerCase() || live.address?.toLowerCase() !== fresh.plan.payer.toLowerCase() || live.chainId !== fresh.plan.chainId || (await wallet.getChainId()) !== fresh.plan.chainId || (await wallet.getAddresses())[0]?.toLowerCase() !== fresh.plan.payer.toLowerCase()) throw new Error("Wallet or network changed. Reconnect and review again.");
    };
    await checkWallet();
    const tx = { account: fresh.plan.payer, to: fresh.plan.to, data: fresh.plan.data, value: BigInt(fresh.plan.value) };
    const units = await client.estimateGas(tx);
    const price = await client.getGasPrice();
    const balance = await client.getBalance({ address: fresh.plan.payer });
    if (balance < tx.value + units * price * BigInt(12) / BigInt(10)) throw new Error("Insufficient BOT for payment and estimated gas.");
    const session = await walletApi<{ address: string }>("/api/auth/session");
    if (session.address.toLowerCase() !== fresh.plan.payer.toLowerCase()) throw new Error("Authenticated wallet changed. Sign in again.");
    const final = await walletApi<PlanResponse>(`${path}/execution`, {});
    if (final.plan.data !== fresh.plan.data || final.plan.value !== fresh.plan.value || final.plan.to !== fresh.plan.to) throw new Error("Payment changed. Review again.");
    await checkWallet();
    if (Date.now() >= fresh.plan.deadline * 1000) throw new Error("Payment expired. Start a new payment.");
    setStage("Awaiting wallet approval");
    localStorage.setItem(storageKey, JSON.stringify({ id, signingStarted: true }));
    setUncertainBroadcast(true);
    let hash: Hex;
    try { hash = await wallet.sendTransaction({ ...tx, chain: CHAINS[fresh.plan.chainId as 968 | 677] }); }
    catch (err) {
      if (/rejected|denied/i.test(message(err))) { localStorage.removeItem(storageKey); if (mounted.current) { setUncertainBroadcast(false); setStage("Wallet request rejected. No payment submitted."); } }
      else if (mounted.current) setStage("Status unknown / needs recheck");
      throw err;
    }
    if (mounted.current) { setRecoveryHash(hash); setStage("Submitted"); }
    try { localStorage.setItem(storageKey, JSON.stringify({ id, hash })); }
    catch { if (mounted.current) setError(`Keep this transaction hash for recovery: ${hash}`); }
    await walletApi(`${path}/submission`, { txHash: hash });
    if (mounted.current) await refresh();
  }

  async function authorize() {
    if (!navigator.locks) throw new Error("This browser cannot safely coordinate wallet requests. Use a current browser.");
    await navigator.locks.request(`providus-payment:${auth.owner}:${id}`, { ifAvailable: true }, async paymentLock => {
      if (!paymentLock) throw new Error("This payment is open for wallet approval in another tab. Recheck without resending.");
      await execute();
    });
  }

  async function save() {
    if (!draft?.recipientAddress || !draft.chainId || !draft.recipientLabel) return;
    await walletApi("/api/recipients", { label: draft.recipientLabel, chainId: draft.chainId, address: draft.recipientAddress });
    await send("yes, save");
  }

  async function edit() {
    if (!isAddress(input)) throw new Error("Enter a valid full EVM address.");
    if (status?.submission || recoveryHash || uncertainBroadcast) throw new Error("A submitted payment cannot be edited. Recheck its status.");
    if (id) await walletApi(path, undefined, "DELETE");
    setPlan(null); setStatus(null); setId(null);
    await send(getAddress(input));
  }

  if (!auth.owner) return draft ? <div className="p-4 font-proof text-sm" role="status">Sign in with your connected wallet before continuing this payment.</div> : null;
  const intent = status?.intent;
  const submission = status?.submission;
  const disabled = busy || pending;
  const needsAddress = action?.type === "ask_recipient_address";
  const recipientAction = action?.type === "confirm_recipient" || action?.type === "offer_save_recipient";
  const tokenRequired = Boolean(intent?.tokenAddress);
  const allowanceState = tokenAllowance?.reviewContextKey === reviewContextKey ? tokenAllowance.state : null;
  const view = intent && status ? resolvePaymentCardView({
    submission: submission ?? null,
    freshnessFresh: status.freshness.fresh,
    intentExpired: status.expired,
    intentPending: intent.status === "pending",
    intentCancelled: intent.status === "cancelled",
    recoveryHash,
    uncertainBroadcast,
    pendingWalletConfirmation: busy && stage === "Awaiting wallet approval",
    paymentPreparationPending: busy && stage === "Preparing",
    supportedNetwork: intent.chainId === 968 || intent.chainId === 677,
    accountMatches: Boolean(address && auth.owner && address.toLowerCase() === auth.owner.toLowerCase()),
    networkMatches: chainId === intent.chainId,
    hasPlan: Boolean(currentPlan),
    hasGas: Boolean(currentGas),
    reviewError: Boolean(currentReviewError),
    tokenRequired,
    allowanceState,
  }) : null;

  if (!draft && !action && !intent && !uncertainBroadcast && !recoveryHash) {
    return <details className="mx-4 mb-2 rounded-lg border border-ledger-edge bg-receipt-field px-3 py-2 font-proof text-sm">
      <summary className="min-h-11 cursor-pointer py-2 font-semibold text-ledger-stone focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green">Find a BOT payment</summary>
      <form className="space-y-2 pb-2" onSubmit={event => { event.preventDefault(); void run(async () => {
        const lookup = lookupId.trim();
        if (!lookup) throw new Error("Enter a BOT payment ID.");
        const result = await walletApi<Status>(`/api/transfers/${encodeURIComponent(lookup)}/status`);
        setPlan(null); setGas(null); setRecoveryHash(null); setUncertainBroadcast(false); setId(lookup); setStatus(result);
      }); }}>
        <label htmlFor="bot-payment-lookup">Payment ID</label>
        <input id="bot-payment-lookup" className="min-h-11 w-full rounded-lg border border-ledger-edge bg-clear-paper px-3" value={lookupId} onChange={event => setLookupId(event.target.value)} placeholder="pi_…" />
        <button className={button} disabled={disabled}>Load payment</button>
      </form>
      {error ? <p role="alert" className="break-words text-red-700">{error}</p> : null}
    </details>;
  }

  const currentHash = submission?.txHash ?? recoveryHash;
  const isVerified = view?.kind === "verified";
  const currentViewLabel = view ? paymentStatusLabel(view) : null;

  return <section aria-label="Wallet payment" className="mx-3 my-2 space-y-3 rounded-lg border border-ledger-edge bg-receipt-field p-3 font-proof text-sm sm:mx-4">
    {!intent ? <h3 className="font-semibold text-ledger-stone">Wallet payment</h3> : null}
    {action?.type === "reject_unsupported_request" && <p role="alert">{action.reason}</p>}
    {action?.type === "ask_missing_details" && <p>Provide {action.missingFields.join(", ")} in the chat to continue.</p>}
    {action?.type === "cancelled" && <p>Payment cancelled. Nothing was authorized by chat.</p>}
    {recipientAction && !intent && <>
      <p className="text-xs font-semibold text-provident-green" role="status">Step 1 of 4: Confirm the recipient.</p>
      <p>{action.recipientLabel} · {action.chainId === 968 ? "BOT Chain Testnet" : "BOT Chain Mainnet"} ({action.chainId})</p>
      <p className="break-all rounded-lg border border-ledger-edge bg-clear-paper p-3" data-testid="recipient-address">{action.recipientAddress}</p>
      <p>A saved address is a convenience, not a verified identity. Check the full address.</p>
      {!addressConfirmed ? <button className={primary} disabled={disabled} onClick={() => action.type === "confirm_recipient" ? void run(() => send("yes")) : setAddressConfirmed(true)}>Confirm recipient</button> : action.type === "offer_save_recipient" && <div className="flex flex-wrap gap-2"><button className={button} disabled={disabled} onClick={() => void run(save)}>Save for future payments</button><button className={primary} disabled={disabled} onClick={() => void run(() => send("no"))}>Continue without saving</button></div>}
    </>}
    {(needsAddress || editing) && <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void run(editing ? edit : async () => { if (!isAddress(input)) throw new Error("Enter a valid EVM address."); await send(getAddress(input)); }); }}>
      <label htmlFor="bot-recipient-address">{editing ? "New recipient address" : `Wallet address for ${needsAddress ? action.recipientLabel : "recipient"}`}</label>
      <input id="bot-recipient-address" className="min-h-11 w-full rounded-lg border border-ledger-edge bg-clear-paper px-3" value={input} onChange={event => setInput(event.target.value)} autoComplete="off" required />
      <button className={button} disabled={disabled} type="submit">{editing ? "Update and review again" : "Review address"}</button>
    </form>}
    {intent && view ? <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ledger-stone" role="status" aria-live="polite">{currentViewLabel}</p>
        {isVerified ? <span className="rounded-full bg-provident-green/10 px-2.5 py-1 text-xs font-semibold text-provident-green">Verified</span> : null}
      </div>
      <div>
        <h3 className="text-2xl font-semibold tracking-tight text-ledger-stone">
          {view.kind === "verified" ? "Sent" : view.kind === "failed" ? "Payment failed" : view.kind === "unknown" ? "Payment status unknown for" : view.kind === "verification_pending" ? "Checking" : view.kind === "cancelled" ? "Cancelled payment" : view.kind === "stale" ? "Changed payment" : view.kind === "expired" ? "Expired payment" : view.kind === "unsupported" ? "Unavailable payment" : "Pay"} {intent.amountDisplay} {intent.assetSymbol}
        </h3>
        <p className="mt-1 text-sm text-receipt-grey">To {intent.recipientLabel}</p>
        {!isVerified ? <p className="mt-1 break-all text-xs text-ledger-stone" data-testid="review-address">{intent.recipientAddress}</p> : null}
        <p className="mt-2 text-xs font-semibold text-ledger-stone">{intent.chainId === 968 ? "BOT Chain Testnet" : "BOT Chain Mainnet"}</p>
        {!isVerified ? <p className="mt-1 text-xs text-receipt-grey">Valid until {intent.expiresAt}</p> : null}
      </div>
      {view.kind === "review" && view.nextAction !== "check_allowance" && view.nextAction !== "approve_allowance" && view.nextAction !== "await_allowance_wallet" && view.nextAction !== "verify_allowance" ? <p className="text-xs leading-5 text-receipt-grey">{paymentStatusMessage(view.nextAction)}</p> : null}
      {view.kind === "failed" ? <p role="alert" className="text-sm text-loss-red">{view.reason ?? "The transaction failed verification."} No payment retry is available from this card.</p> : null}
      {view.kind === "unknown" ? <p role="alert" className="text-sm text-loss-red">{view.reason ?? (view.needsHashRecovery ? "Check your wallet activity and recover the existing transaction hash. Do not send again." : "The transaction status is unknown. Recheck the existing transaction without resending.")}</p> : null}
      {view.kind === "cancelled" ? <p role="status" className="text-sm text-receipt-grey">This payment was cancelled. No new wallet authorization is available from this intent.</p> : null}
      {view.kind === "stale" ? <p role="status" className="text-sm text-receipt-grey">Payment details changed after review. Ask Providus to prepare a fresh payment before authorizing anything.</p> : null}
      {view.kind === "expired" ? <p role="status" className="text-sm text-receipt-grey">This payment intent expired. Ask Providus to prepare a fresh payment.</p> : null}
      {view.kind === "unsupported" ? <p role="status" className="text-sm text-receipt-grey">This payment uses an unsupported network. No transaction can be sent from this intent.</p> : null}
      {view.kind === "verified" ? <Link href={intent ? { pathname: "/receipt", query: { tx: `bot:${intent.id}` } } : "/receipt"} className={`${primary} inline-flex min-h-11 items-center justify-center rounded-lg px-4 no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green`}>View receipt</Link> : null}
      {view.kind === "review" && intent.tokenAddress && currentPlan && (currentPlan.chainId === 677 || currentPlan.chainId === 968) && view.nextAction !== "switch_network" && view.nextAction !== "retry_review" && view.nextAction !== "prepare_review" ? <TokenApprovalCard
        key={reviewContextKey ?? "stale-review"}
        enabled={Boolean(currentPlan.token && reviewContextKey)}
        plan={currentPlan}
        client={client ?? undefined}
        wallet={wallet ?? undefined}
        revalidate={revalidateAllowance}
        reviewContextKey={reviewContextKey ?? ""}
        onStateChange={onTokenAllowanceState}
      /> : null}
      {view.kind === "review" && view.nextAction === "switch_network" ? <button type="button" className={primary} disabled={disabled || providusWallet.isNetworkSwitchPending} onClick={() => void run(() => providusWallet.requestNetworkSwitch(intent.chainId === 677 ? "botMainnet" : "botTestnet"))}>Switch to {intent.chainId === 677 ? "BOT Chain Mainnet" : "BOT Chain Testnet"}</button> : null}
      {view.kind === "review" && view.nextAction === "retry_review" ? <button type="button" className={primary} disabled={disabled} onClick={() => { setReviewError(null); setReviewAttempt(value => value + 1); }}>Retry payment review</button> : null}
      {view.kind === "review" && view.nextAction === "confirm_payment" ? <button type="button" className={primary} disabled={disabled} onClick={() => void run(authorize)}>Confirm payment in wallet</button> : null}
      {view.kind === "review" && view.nextAction === "check_allowance" ? <p className="text-xs text-receipt-grey" role="status">Checking the exact token allowance before showing the next action.</p> : null}
      {view.kind === "review" && view.nextAction === "await_allowance_wallet" ? <p className="text-xs text-receipt-grey" role="status">Waiting for the separate token approval in your wallet. Payment has not been sent.</p> : null}
      {view.kind === "review" && view.nextAction === "verify_allowance" ? <p className="text-xs text-receipt-grey" role="status">Token approval submitted. Waiting for confirmation. Payment has not been sent.</p> : null}
      {view.kind === "review" && view.nextAction === "await_payment_wallet" ? <p className="text-xs text-receipt-grey" role="status">Waiting for your wallet response. No payment was submitted until you approve it.</p> : null}
      {view.kind === "review" && view.nextAction === "connect_wallet" ? <p className="text-xs text-receipt-grey" role="status">Connect the wallet used to sign in before continuing this payment.</p> : null}
      {view.kind === "review" && view.nextAction === "prepare_review" ? <p className="text-xs text-receipt-grey" role="status">Preparing the exact payment terms and current gas estimate…</p> : null}
      {view.kind === "review" && view.nextAction === "prepare_payment" ? <p className="text-xs text-receipt-grey" role="status">Checking payment terms before opening your wallet…</p> : null}
    </> : null}
    {view?.kind === "unknown" && view.needsHashRecovery ? <form className="space-y-2" onSubmit={event => { event.preventDefault(); void run(async () => {
      if (!/^0x[0-9a-fA-F]{64}$/.test(input)) throw new Error("Enter the transaction hash from your wallet activity.");
      setRecoveryHash(input);
      localStorage.setItem(storageKey, JSON.stringify({ id, hash: input }));
      await walletApi(`${path}/submission`, { txHash: input }); await refresh();
    }); }}><p role="alert">A wallet request may have broadcast. Check wallet activity and recover the existing hash. Do not send again.</p><label htmlFor="bot-recovery-hash">Transaction hash from wallet activity</label><input id="bot-recovery-hash" className="min-h-11 w-full rounded-lg border border-ledger-edge bg-clear-paper px-3" value={input} onChange={event => setInput(event.target.value)} /><button className={primary} disabled={disabled}>Recover existing transaction</button></form> : null}
    {(view?.kind === "verification_pending" || (view?.kind === "unknown" && !view.needsHashRecovery)) ? <div className="flex flex-wrap items-center gap-3">
      {currentHash ? <a className="underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green" href={`${EXPLORERS[intent?.chainId ?? 968] ?? EXPLORERS[968]}/tx/${currentHash}`} target="_blank" rel="noreferrer">View transaction</a> : null}
      <button className={button} disabled={disabled} onClick={() => void run(async () => {
        if (recoveryHash && !submission?.txHash) await walletApi(`${path}/submission`, { txHash: recoveryHash });
        await walletApi(`${path}/submission`, { recheck: true });
        await refresh();
      })}>Recheck status</button>
    </div> : null}
    {view ? <details className="border-t border-ledger-edge pt-2">
      <summary className="min-h-11 cursor-pointer py-2 text-xs font-semibold text-ledger-stone focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green">{isVerified ? "Transaction proof" : "Payment details"}</summary>
      <dl className="grid grid-cols-1 gap-1 break-all pb-2 text-xs [&>dd]:mb-2 [&>dt]:text-receipt-grey">
        <dt>Current status</dt><dd>{currentViewLabel}</dd>
        <dt>Payment reference</dt><dd>{intent?.id}</dd>
        <dt>Chain ID</dt><dd>{intent?.chainId}</dd>
        <dt>Sending wallet</dt><dd>{intent?.ownerAddress}</dd>
        <dt>Recipient address</dt><dd>{intent?.recipientAddress}</dd>
        <dt>Asset contract</dt><dd>{intent?.tokenAddress ?? "Native BOT"}</dd>
        {submission?.contractAddress ?? currentPlan?.to ? <><dt>Payment contract</dt><dd>{submission?.contractAddress ?? currentPlan?.to}</dd></> : null}
        {currentGas ? <><dt>Estimated network gas</dt><dd>{currentGas} BOT, estimate may change</dd></> : null}
        {currentPlan ? <><dt>Call value</dt><dd>{currentPlan.value}</dd><dt>Contract call data</dt><dd>{currentPlan.data}</dd></> : null}
        {allowanceState ? <><dt>Token allowance state</dt><dd>{allowanceState}</dd></> : null}
        {currentHash ? <><dt>Transaction hash</dt><dd>{currentHash}</dd><dt>Explorer</dt><dd><a className="underline" href={`${EXPLORERS[intent?.chainId ?? 968] ?? EXPLORERS[968]}/tx/${currentHash}`} target="_blank" rel="noreferrer">Open on {intent?.chainId === 677 ? "BOT Chain" : "BOT Testnet"}</a></dd></> : null}
        {submission?.blockNumber != null ? <><dt>Block</dt><dd>{submission.blockNumber}</dd></> : null}
        {submission?.confirmations != null ? <><dt>Confirmations</dt><dd>{submission.confirmations}</dd></> : null}
        {submission?.verifiedAt ? <><dt>Verified at</dt><dd>{submission.verifiedAt}</dd></> : null}
        {submission?.failureReason ? <><dt>Verification detail</dt><dd>{submission.failureReason}</dd></> : null}
      </dl>
    </details> : null}
    {error ? <p role="alert" className="break-words text-red-700">{error}</p> : null}
    {view?.kind === "review" && !submission && !recoveryHash && !uncertainBroadcast && draft ? <div className="flex flex-wrap gap-2 border-t border-ledger-edge pt-2">
      <button type="button" className={button} disabled={disabled} onClick={() => setEditing(!editing)}>Edit recipient</button>
      <button type="button" className={button} disabled={disabled} onClick={() => void run(async () => { if (id) await walletApi(path, undefined, "DELETE"); setPlan(null); await send("cancel"); })}>Cancel payment</button>
    </div> : null}
  </section>;
}

function message(error: unknown) { return error instanceof Error ? error.message : "Payment status unknown. Recheck without sending again."; }

function paymentStatusLabel(view: PaymentCardView): string {
  switch (view.kind) {
    case "verified": return "Payment verified";
    case "failed": return "Payment failed";
    case "unknown": return "Payment status unknown";
    case "verification_pending": return "Verification in progress";
    case "cancelled": return "Payment cancelled";
    case "stale": return "Payment details changed";
    case "expired": return "Payment review expired";
    case "unsupported": return "Network unavailable";
    case "review":
      switch (view.nextAction) {
        case "switch_network": return "Switch network to continue";
        case "connect_wallet": return "Reconnect the signing wallet";
        case "prepare_payment": return "Preparing payment";
        case "retry_review": return "Payment review needs attention";
        case "prepare_review": return "Preparing payment review";
        case "check_allowance": return "Checking token allowance";
        case "approve_allowance": return "Token approval required";
        case "await_allowance_wallet": return "Token approval awaiting your wallet";
        case "verify_allowance": return "Checking token approval";
        case "confirm_payment": return "Ready for payment approval";
        case "await_payment_wallet": return "Payment awaiting your wallet";
      }
  }
}

function paymentStatusMessage(action: Extract<PaymentCardView, { kind: "review" }> ["nextAction"]): string {
  switch (action) {
    case "switch_network": return "Switch to the payment network before reviewing this transfer.";
    case "connect_wallet": return "Connect the wallet that owns this payment before continuing.";
    case "prepare_payment": return "Preparing the payment details. No wallet request has been opened.";
    case "retry_review": return "The payment terms or gas estimate could not be checked. Review again before authorizing anything.";
    case "prepare_review": return "Checking the payment terms and current gas estimate before showing a wallet action.";
    case "check_allowance": return "Checking the exact token allowance before showing an approval or payment action.";
    case "approve_allowance": return "This token needs a separate, exact allowance approval. Payment will still require its own wallet confirmation.";
    case "await_allowance_wallet": return "Approve the exact token allowance in your wallet. Payment has not been sent.";
    case "verify_allowance": return "Checking the separate token approval. Payment has not been sent.";
    case "confirm_payment": return "Review the full recipient address and amount. Your wallet will ask you to authorize the payment.";
    case "await_payment_wallet": return "Waiting for your wallet response. Payment is submitted only after you approve it.";
  }
}
