"use client";

import { useState } from "react";
import { prepareTokenAllowance, type ApprovalState } from "@/lib/wallet/transfer-execution";

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

export function TokenApprovalCard({ enabled, controls }: {
  enabled: boolean;
  controls?: Omit<Parameters<typeof prepareTokenAllowance>[0], "onState" | "approveExact"> & Pick<Parameters<typeof prepareTokenAllowance>[0], "approveExact">;
}) {
  const [state, setState] = useState<ApprovalState>("approval_required");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <div className="space-y-2 rounded-lg border border-ledger-edge p-3" aria-label="Token allowance">
    <TokenApprovalStatus enabled={enabled} state={state} />
    <p>Token allowance and payment are separate wallet transactions. Only the exact payment amount is requested, never unlimited allowance.</p>
    <button className="min-h-11 rounded-lg border border-ledger-edge px-3 disabled:opacity-50" disabled={!enabled || !controls || busy || state === "payment_ready"} onClick={async () => {
      if (!enabled || !controls || busy) return;
      setBusy(true); setError(null);
      try { await prepareTokenAllowance({ ...controls, onState: setState }); }
      catch (err) { setError(err instanceof Error ? err.message : "Approval failed. No payment was submitted."); }
      finally { setBusy(false); }
    }}>Approve exact token allowance</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
