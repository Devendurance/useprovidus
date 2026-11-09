"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { formatEther, getAddress, isAddress, type Hex } from "viem";
import type { WalletTransferAction, WalletTransferIntent as Draft } from "@/lib/assistant/types";
import type { WalletTransferIntent } from "@/lib/transfers/repository";
import type { TransferSubmission } from "@/lib/transfers/submissions";
import type { ExecutionPlan } from "@/lib/transfers/execution";
import { BOT_MAINNET, BOT_TESTNET } from "@/lib/chains/registry";
import { MAINNET_CONTRACT_ADDRESS } from "@/lib/transfers/test-mode";
import { walletApi as requestWalletApi, type WalletAuth } from "@/hooks/use-wallet-auth";
import { TokenApprovalCard } from "@/components/assistant/token-approval-card";
import { isSameWalletReviewContext, type WalletReviewContext } from "@/lib/transfers/review-context";
import { getWalletReviewContextRevision, publishWalletReviewContext, subscribeWalletReviewContextRevision } from "@/lib/transfers/review-context-revision";
import { useProvidusWallet } from "@/hooks/use-providus-wallet";

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
  const verified = submission?.status === "confirmed" && Boolean(submission.verifiedAt);
  const disabled = busy || pending;
  const needsAddress = action?.type === "ask_recipient_address";
  const recipientAction = action?.type === "confirm_recipient" || action?.type === "offer_save_recipient";
  const verifying = Boolean(submission?.txHash || recoveryHash);
  const phase = verified ? "Verified" : submission?.status === "failed" ? "Failed" : submission?.status === "unknown" ? "Status unknown / needs recheck" : verifying ? "Verifying transaction" : stage;

  return <section aria-label="Wallet payment" className="mx-3 my-3 space-y-3 rounded-xl border border-ledger-edge bg-receipt-field p-4 font-proof text-sm sm:mx-4">
    <h3 className="font-semibold text-ledger-stone">{verified ? "Verified on-chain receipt" : "Wallet payment"}</h3>
    {!draft && !action && <form className="space-y-2" onSubmit={event => { event.preventDefault(); void run(async () => {
      const lookup = lookupId.trim();
      if (!lookup) throw new Error("Enter a BOT payment ID.");
      const result = await walletApi<Status>(`/api/transfers/${encodeURIComponent(lookup)}/status`);
      setPlan(null); setGas(null); setRecoveryHash(null); setUncertainBroadcast(false); setId(lookup); setStatus(result);
    }); }}><label htmlFor="bot-payment-lookup">Resume a BOT payment by ID</label><input id="bot-payment-lookup" className="min-h-11 w-full rounded-lg border border-ledger-edge bg-clear-paper px-3" value={lookupId} onChange={event => setLookupId(event.target.value)} placeholder="pi_…" /><button className={button} disabled={disabled}>Load BOT payment</button></form>}
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
    {intent && <>
      <p className="text-xs font-semibold text-provident-green" role="status">{verified ? "Independently verified on-chain." : submission?.status === "unknown" ? "Status unknown. Recheck the transaction without resending." : submission?.status === "failed" ? "Verification failed. Review the reason below." : verifying ? "Step 4 of 4: Verifying transaction." : stage === "Awaiting wallet approval" ? "Step 3 of 4: Confirm the transaction in your wallet." : "Step 2 of 4: Review the recipient and payment details."}</p>
      <h4 className="text-xl font-semibold">{intent.amountDisplay} {intent.assetSymbol}</h4>
      <dl className="grid grid-cols-1 gap-1 [&>dd]:mb-2 [&>dd]:break-all [&>dt]:text-receipt-grey">
        <dt>Sending wallet</dt><dd>{intent.ownerAddress}</dd>
        <dt>Recipient</dt><dd>{intent.recipientLabel}</dd>
        <dt>Full recipient address</dt><dd data-testid="review-address">{intent.recipientAddress}</dd>
        <dt>Network</dt><dd>{intent.chainId === 968 ? "BOT Chain Testnet" : "BOT Chain Mainnet"} · Chain ID {intent.chainId}</dd>
        <dt>Asset contract</dt><dd>{intent.tokenAddress ?? "Native BOT"}</dd>
        <dt>Estimated network gas</dt><dd>{currentGas ? `${currentGas} BOT, estimate may change` : "Unavailable until RPC estimation succeeds"}</dd>
        <dt>Payment contract</dt><dd>{submission?.contractAddress ?? currentPlan?.to ?? "Execution disabled or unavailable"}</dd>
        <dt>Intent expiry</dt><dd>{intent.expiresAt}</dd>
        <dt>Payment status</dt><dd>{phase || intent.status}</dd>
        <dt>Payment reference</dt><dd>{intent.id}</dd>
      </dl>
      {!submission && !recoveryHash && intent.chainId !== 968 && intent.chainId !== 677 && <p role="status">Unsupported network. Switch to a supported BOT Chain network.</p>}
      {!submission && !recoveryHash && intent.chainId === 677 && !currentPlan && <p role="status">BOT Chain Mainnet: Payments coming soon. ERC-20 approval is separate from payment. Mainnet execution is disabled in this build.</p>}
      {intent.tokenAddress && <TokenApprovalCard enabled={false} />}
      {!submission && !recoveryHash && !uncertainBroadcast && (intent.chainId === 968 || intent.chainId === 677) && intent.status === "pending" && status.freshness.fresh && <>
        <p>Review these exact stored terms. Only approval in your wallet authorizes payment.</p>
        {chainId !== intent.chainId ? <button className={primary} disabled={disabled || providusWallet.isNetworkSwitchPending} onClick={() => void run(() => providusWallet.requestNetworkSwitch(intent.chainId === 677 ? "botMainnet" : "botTestnet"))}>Switch to {intent.chainId === 677 ? "BOT Chain Mainnet" : "BOT Chain Testnet"}</button> : currentPlan && currentGas ? <button className={primary} disabled={disabled} onClick={() => void run(authorize)}>Approve in wallet</button> : currentReviewError ? <button className={primary} disabled={disabled} onClick={() => { setReviewError(null); setReviewAttempt(value => value + 1); }}>Retry review and gas estimate</button> : <p className="text-xs text-receipt-grey" role="status">Reviewing payment details and estimating gas…</p>}
      </>}
      {!status.freshness.fresh && !submission && <p role="alert">Payment expired or saved recipient changed. Cancel and prepare a fresh payment.</p>}
    </>}
    {uncertainBroadcast && !recoveryHash && !submission && <form className="space-y-2" onSubmit={event => { event.preventDefault(); void run(async () => {
      if (!/^0x[0-9a-fA-F]{64}$/.test(input)) throw new Error("Enter the transaction hash from your wallet activity.");
      setRecoveryHash(input);
      localStorage.setItem(storageKey, JSON.stringify({ id, hash: input }));
      await walletApi(`${path}/submission`, { txHash: input }); await refresh();
    }); }}><p role="alert">The earlier wallet request may have broadcast. Check wallet activity. Do not send again.</p><label htmlFor="bot-recovery-hash">Transaction hash from wallet activity</label><input id="bot-recovery-hash" className="min-h-11 w-full rounded-lg border px-3" value={input} onChange={event => setInput(event.target.value)} /><button className={button} disabled={disabled}>Recover transaction</button></form>}
    {(submission?.txHash || recoveryHash) && <div className="space-y-2">
      <p className="break-all">Transaction hash {submission?.txHash ?? recoveryHash}</p>
      <a className="underline" href={`${EXPLORERS[intent?.chainId ?? 968] ?? EXPLORERS[968]}/tx/${submission?.txHash ?? recoveryHash}`} target="_blank" rel="noreferrer">View on {intent?.chainId === 677 ? "BOT Chain" : "BOT Testnet"} explorer</a>
      {submission && <p>{submission.confirmations ?? 0} confirmations {submission.verifiedAt ? `· Verified ${submission.verifiedAt}` : "· Awaiting independent verification"}</p>}
      {submission?.failureReason && <p role="alert">{submission.failureReason}</p>}
      <button className={button} disabled={disabled} onClick={() => void run(async () => {
        if (!submission && recoveryHash) await walletApi(`${path}/submission`, { txHash: recoveryHash });
        else await walletApi(`${path}/submission`, { recheck: true });
        await refresh();
      })}>Recheck payment, never resend</button>
      <p>On-chain verification proves a transfer to this address. It does not verify the recipient&apos;s real-world identity.</p>
    </div>}
    {phase && <p role="status" aria-live="polite">{phase}</p>}
    {error && <p role="alert" className="break-words text-red-700">{error}</p>}
    {!submission && !recoveryHash && !uncertainBroadcast && draft && <div className="flex flex-wrap gap-2">
      <button className={button} disabled={disabled} onClick={() => setEditing(!editing)}>Edit recipient</button>
      <button className={button} disabled={disabled} onClick={() => void run(async () => { if (id) await walletApi(path, undefined, "DELETE"); setPlan(null); await send("cancel"); })}>Cancel payment</button>
    </div>}
  </section>;
}

function message(error: unknown) { return error instanceof Error ? error.message : "Payment status unknown. Recheck without sending again."; }
