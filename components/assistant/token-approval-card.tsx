"use client";

import { useState } from "react";
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
  return <p role="status">{enabled ? APPROVAL_LABELS[state] : "Token execution disabled until B9. No mainnet payment contract is configured."}</p>;
}

export function TokenApprovalCard({ enabled, plan, client, wallet, revalidate }: {
  enabled: boolean;
  plan?: ExecutionPlan;
  client?: PublicClient | undefined;
  wallet?: WalletClient | undefined;
  revalidate?: () => Promise<void>;
}) {
  const [state, setState] = useState<ApprovalState>("approval_required");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = Boolean(enabled && plan && client && wallet && revalidate && !busy && state !== "payment_ready");
  const onClick = async () => {
    if (!enabled || !plan || !client || !wallet || !revalidate || busy) return;
    setBusy(true); setError(null);
    try {
      await prepareTokenAllowance({ ...createTokenApprovalControls(plan, client, wallet, revalidate), onState: setState });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed. No payment was submitted.");
    } finally {
      setBusy(false);
    }
  };
  return <div className="rounded-lg border border-ledger-edge p-3" aria-label="Token allowance">
    <TokenApprovalStatus enabled={enabled} state={state} />
    <p>Token allowance and payment are separate wallet transactions. Only the exact payment amount is requested, never unlimited allowance.</p>
    <button className="min-h-11 rounded-lg border border-ledger-edge px-3 disabled:opacity-50" disabled={!ready} onClick={() => { void onClick(); }}>Approve exact token allowance</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
