"use client";

import { useCallback, useEffect, useState } from "react";
import type { PublicClient, WalletClient } from "viem";
import { createTokenApprovalControls, prepareTokenAllowance, type ApprovalState } from "@/lib/wallet/transfer-execution";
import type { ExecutionPlan } from "@/lib/transfers/execution";

export const APPROVAL_LABELS: Record<ApprovalState, string> = {
  checking_allowance: "Checking token allowance",
  approval_required: "Separate token approval required",
  awaiting_token_approval: "Approve exact allowance in wallet",
  approval_confirming: "Waiting for token approval confirmation. Payment has not been sent.",
  payment_ready: "Allowance ready. Review and approve the payment separately.",
};

export function TokenApprovalStatus({ enabled, state }: { enabled: boolean; state: ApprovalState }) {
  return <p role="status">{enabled ? APPROVAL_LABELS[state] : "Token approval is unavailable for this payment."}</p>;
}

export function TokenApprovalCard({ enabled, plan, client, wallet, revalidate, reviewContextKey, onStateChange }: {
  enabled: boolean;
  plan?: ExecutionPlan;
  client?: PublicClient | undefined;
  wallet?: WalletClient | undefined;
  revalidate?: () => Promise<void>;
  reviewContextKey: string;
  onStateChange: (state: ApprovalState, reviewContextKey: string) => void;
}) {
  const [state, setState] = useState<ApprovalState>("approval_required");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const setApprovalState = useCallback((next: ApprovalState) => {
    setState(next);
    onStateChange(next, reviewContextKey);
  }, [onStateChange, reviewContextKey]);
  const canCheck = Boolean(enabled && plan && client && wallet && revalidate && !busy);
  const canApprove = Boolean(canCheck && !readFailed && state === "approval_required");

  useEffect(() => {
    if (!enabled || !plan || !client || !wallet || !revalidate) return;
    let active = true;
    const controls = createTokenApprovalControls(plan, client, wallet, revalidate);
    queueMicrotask(() => {
      if (!active) return;
      setReadFailed(false);
      setError(null);
      setApprovalState("checking_allowance");
      void prepareTokenAllowance({
        ...controls,
        approveExact: undefined,
        onState: (next) => {
          if (active) setApprovalState(next);
        },
      }).catch((err) => {
        if (!active) return;
        setReadFailed(true);
        setError(err instanceof Error ? err.message : "Could not check token allowance.");
      });
    });
    return () => { active = false; };
  }, [enabled, plan, client, wallet, revalidate, setApprovalState]);

  const checkAllowance = async () => {
    if (!enabled || !plan || !client || !wallet || !revalidate || busy) return;
    setBusy(true); setError(null);
    try {
      setReadFailed(false);
      await prepareTokenAllowance({
        ...createTokenApprovalControls(plan, client, wallet, revalidate),
        approveExact: undefined,
        onState: setApprovalState,
      });
    } catch (err) {
      setReadFailed(true);
      setError(err instanceof Error ? err.message : "Could not check token allowance.");
    } finally {
      setBusy(false);
    }
  };

  const approveAllowance = async () => {
    if (!enabled || !plan || !client || !wallet || !revalidate || !canApprove) return;
    setBusy(true); setError(null);
    try {
      await prepareTokenAllowance({
        ...createTokenApprovalControls(plan, client, wallet, revalidate),
        onState: setApprovalState,
      });
    } catch (err) {
      setApprovalState("approval_required");
      setError(err instanceof Error ? err.message : "Approval failed. No payment was submitted.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="space-y-2 border-t border-ledger-edge pt-3" aria-label="Token allowance">
    <TokenApprovalStatus enabled={enabled} state={state} />
    {state === "approval_required" ? <p>This is a separate wallet transaction. Providus requests only the exact payment amount, never an unlimited allowance. You will still confirm the payment separately.</p> : null}
    {readFailed ? <button className="min-h-11 rounded-lg border border-ledger-edge bg-clear-paper px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green disabled:opacity-50" disabled={!canCheck} onClick={() => { void checkAllowance(); }}>Retry allowance check</button> : null}
    {canApprove ? <button className="min-h-11 rounded-lg bg-provident-green px-4 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green disabled:opacity-50" disabled={busy} onClick={() => { void approveAllowance(); }}>Approve exact allowance in wallet</button> : null}
    {error && <p role="alert">{error}</p>}
  </div>;
}
