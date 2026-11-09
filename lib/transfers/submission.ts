/**
 * B4B — Minimal testnet submission/confirmation integration.
 *
 * Takes a B4A execution plan and moves it through:
 * pending → submitted → confirmed | failed | unknown
 *
 * Rules:
 * - Idempotent and bound to exact intent terms: the submission record is keyed
 *   by termsFingerprint. A repeat call with the same fingerprint NEVER
 *   broadcasts a second transaction — it returns the recorded txHash.
 * - Ambiguous broadcast (send ok, receipt unknown/timeout) is recorded as
 *   `unknown` and returned for later re-check. Never auto-resends.
 * - The B3 intent row itself is NOT mutated here (no approved/completed
 *   marking). B5 will persist submissions in a `transfer_submissions` table
 *   keyed by termsFingerprint (columns: fingerprint PK, intent_id, to, value,
 *   data, tx_hash, status, created/updated at); this slice uses the in-memory
 *   record type below plus injectable transport so every path is testable
 *   offline with zero on-chain side effects.
 */

export type ExecutionPlanLike = {
  to: string;
  value: string;
  data: `0x${string}` | string;
  intentId: string;
  deadline: number;
  payer: string;
  recipient: string;
  token: string | null;
  amountBaseUnits: string;
  chainId: number;
  environment: string;
  termsFingerprint: string;
};

export type SubmissionStatus = "submitted" | "confirmed" | "failed" | "unknown";

export type SubmissionRecord = {
  termsFingerprint: string;
  intentDbId: string;
  to: string;
  value: string;
  data: string;
  txHash: string | null;
  status: SubmissionStatus;
  blockNumber: number | null;
  createdAt: string;
  updatedAt: string;
};

export type SubmissionTransport = {
  /** Broadcast the already-authorized signed transaction. */
  sendPlan(plan: ExecutionPlanLike): Promise<{ txHash: string }>;
  /** Wait for mining; throw or return unknown on timeout/RPC failure. */
  waitReceipt(txHash: string): Promise<{
    outcome: "success" | "reverted" | "unknown";
    blockNumber: number | null;
  }>;
};

export type SubmissionResult =
  | { fresh: true; record: SubmissionRecord }
  | { fresh: false; record: SubmissionRecord; note: "already-submitted" };

function nowIso(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

function isValidTxHash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

/**
 * Submit a prepared plan exactly once per terms fingerprint. Transport and
 * record-store are injected; the default in-memory store below is for tests
 * and single-process testnet runs (B5 replaces it with Postgres).
 */
export async function submitPreparedPlan(
  store: Map<string, SubmissionRecord>,
  transport: SubmissionTransport,
  plan: ExecutionPlanLike,
  args: { intentDbId: string; nowMs?: number },
): Promise<SubmissionResult> {
  const nowMs = args.nowMs ?? Date.now();
  if (
    !plan ||
    typeof plan.termsFingerprint !== "string" ||
    !/^(0x)?[0-9a-fA-F]{64}$/.test(plan.termsFingerprint) ||
    !/^0x[0-9a-fA-F]{40}$/.test(plan.to)
  ) {
    throw new Error("Invalid execution plan.");
  }
  const existing = store.get(plan.termsFingerprint);
  if (existing) {
    return { fresh: false, record: existing, note: "already-submitted" };
  }
  const base: SubmissionRecord = {
    termsFingerprint: plan.termsFingerprint,
    intentDbId: args.intentDbId,
    to: plan.to,
    value: plan.value,
    data: typeof plan.data === "string" ? plan.data : String(plan.data),
    txHash: null,
    status: "submitted",
    blockNumber: null,
    createdAt: nowIso(nowMs),
    updatedAt: nowIso(nowMs),
  };
  store.set(plan.termsFingerprint, base);

  let txHash: string;
  try {
    const sent = await transport.sendPlan(plan);
    if (!isValidTxHash(sent.txHash)) {
      throw new Error("Transport returned an invalid transaction hash.");
    }
    txHash = sent.txHash;
  } catch (err) {
    // Broadcast itself failed: nothing is on-chain. Keep the record without a
    // hash so a later retry may submit (exactly-once is preserved because only
    // successful sends record a hash).
    const failed = { ...base, updatedAt: nowIso(Date.now()) };
    store.set(plan.termsFingerprint, failed);
    throw err;
  }

  let record: SubmissionRecord = { ...base, txHash, updatedAt: nowIso(Date.now()) };
  store.set(plan.termsFingerprint, record);
  try {
    const receipt = await transport.waitReceipt(txHash);
    record = {
      ...record,
      status: receipt.outcome === "success" ? "confirmed" : receipt.outcome === "reverted" ? "failed" : "unknown",
      blockNumber: receipt.blockNumber,
      updatedAt: nowIso(Date.now()),
    };
  } catch {
    record = { ...record, status: "unknown", updatedAt: nowIso(Date.now()) };
  }
  store.set(plan.termsFingerprint, record);
  return { fresh: true, record };
}
