/**
 * B5 — Durable submission ledger + bounded reconciliation.
 *
 * Extends (not rewrites) the B4B in-memory submission flow: the same
 * fingerprint-keyed idempotency, now backed by Postgres with atomic
 * constraints. Status authority: intent rows carry user intent
 * (pending/cancelled); submission rows carry chain fact
 * (submitted/confirmed/failed/unknown). Cancellation never deletes a
 * submission; a post-cancel confirmation is still recorded truthfully.
 *
 * Recovery model: every durable fact needed to resume lives in the row
 * (txHash + terms snapshot). A restarted server re-reads the row and
 * re-verifies against chain data — nothing in memory is authoritative.
 * Reads may be retried freely; broadcasts are never retried automatically.
 */

import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  transferSubmissions,
  type NewTransferSubmission,
  type TransferSubmission,
} from "@/lib/db/schema";
import type { DbClient } from "@/lib/db";
import type { WalletTransferIntent } from "@/lib/transfers/repository";
import {
  verifySubmissionOnChain,
  type ChainReader,
  type VerifierConfig,
} from "@/lib/transfers/verify";

export type { TransferSubmission, NewTransferSubmission };

export type SubmissionStatus = "submitted" | "confirmed" | "failed" | "unknown";

export type SubmissionStore = {
  insert(row: NewTransferSubmission): Promise<TransferSubmission>;
  findByIntent(intentId: string): Promise<TransferSubmission | null>;
  findByTxHash(txHash: string): Promise<TransferSubmission | null>;
  /** Conditional status transition; returns null when the row moved on. */
  transitionStatus(
    intentId: string,
    from: SubmissionStatus[],
    patch: Partial<Pick<TransferSubmission, "status" | "receiptStatus" | "blockNumber" | "blockHash" | "confirmations" | "failureReason" | "updatedAt" | "verifiedAt">>,
  ): Promise<TransferSubmission | null>;
};

function nowIso(): string {
  return new Date().toISOString();
}

function isConflict(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === "23505" || code === "DUPLICATE_SUBMISSION";
}

function conflict(message: string): Error {
  const err = new Error(message);
  (err as NodeJS.ErrnoException).code = "DUPLICATE_SUBMISSION";
  return err;
}

/* -------------------------------------------------------------------------- */
/* In-memory (tests) — synchronous ops, same atomicity contract as SQL        */
/* -------------------------------------------------------------------------- */

export type MemorySubmissionBacking = {
  byIntent: Map<string, TransferSubmission>;
  byTx: Map<string, TransferSubmission>;
};

export function createMemorySubmissionBacking(): MemorySubmissionBacking {
  return { byIntent: new Map(), byTx: new Map() };
}

/**
 * Pass one backing to two instances to simulate a server restart (or two
 * instances) against one shared database.
 */
export function createMemorySubmissionStore(
  shared: MemorySubmissionBacking = createMemorySubmissionBacking(),
): SubmissionStore {
  const byIntent = shared.byIntent;
  const byTx = shared.byTx;

  const toRow = (row: NewTransferSubmission): TransferSubmission => ({
    id: row.id,
    intentId: row.intentId,
    ownerAddress: row.ownerAddress,
    chainId: row.chainId,
    environment: row.environment,
    contractAddress: row.contractAddress,
    termsFingerprint: row.termsFingerprint,
    tokenAddress: row.tokenAddress ?? null,
    recipientAddress: row.recipientAddress,
    amountBaseUnits: row.amountBaseUnits,
    txHash: row.txHash ?? null,
    status: row.status ?? "submitted",
    receiptStatus: row.receiptStatus ?? null,
    blockNumber: row.blockNumber ?? null,
    blockHash: row.blockHash ?? null,
    confirmations: row.confirmations ?? null,
    failureReason: row.failureReason ?? null,
    createdAt: row.createdAt ?? nowIso(),
    updatedAt: row.updatedAt ?? nowIso(),
    verifiedAt: row.verifiedAt ?? null,
  });

  return {
    async insert(row: NewTransferSubmission): Promise<TransferSubmission> {
      if (byIntent.has(row.intentId)) throw conflict("Intent already has a submission.");
      if (row.txHash && byTx.has(row.txHash.toLowerCase())) {
        throw conflict("Transaction hash already claimed by another submission.");
      }
      const saved = toRow(row);
      byIntent.set(saved.intentId, saved);
      if (saved.txHash) byTx.set(saved.txHash.toLowerCase(), saved);
      return saved;
    },
    async findByIntent(intentId: string) {
      return byIntent.get(intentId) ?? null;
    },
    async findByTxHash(txHash: string) {
      return byTx.get(txHash.toLowerCase()) ?? null;
    },
    async transitionStatus(intentId, from, patch) {
      const current = byIntent.get(intentId);
      if (!current || !from.includes(current.status as SubmissionStatus)) return null;
      const next: TransferSubmission = { ...current, ...patch, updatedAt: patch.updatedAt ?? nowIso() };
      byIntent.set(intentId, next);
      if (next.txHash) byTx.set(next.txHash.toLowerCase(), next);
      return next;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Drizzle / Neon                                                             */
/* -------------------------------------------------------------------------- */

export function createDrizzleSubmissionStore(db: DbClient): SubmissionStore {
  return {
    async insert(row: NewTransferSubmission): Promise<TransferSubmission> {
      const [saved] = await db.insert(transferSubmissions).values(row).returning();
      if (!saved) throw new Error("Submission insert returned no row.");
      return saved;
    },
    async findByIntent(intentId: string) {
      const [row] = await db
        .select()
        .from(transferSubmissions)
        .where(eq(transferSubmissions.intentId, intentId))
        .limit(1);
      return row ?? null;
    },
    async findByTxHash(txHash: string) {
      const [row] = await db
        .select()
        .from(transferSubmissions)
        .where(eq(transferSubmissions.txHash, txHash))
        .limit(1);
      return row ?? null;
    },
    async transitionStatus(intentId, from, patch) {
      const [next] = await db
        .update(transferSubmissions)
        .set({ ...patch, updatedAt: nowIso() })
        .where(
          and(
            eq(transferSubmissions.intentId, intentId),
            inArray(transferSubmissions.status, [...from]),
          ),
        )
        .returning();
      return next ?? null;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Registration + reconciliation                                              */
/* -------------------------------------------------------------------------- */

export type SubmissionErrorCode =
  | "NOT_AUTHENTICATED"
  | "NOT_FOUND"
  | "INVALID_TX_HASH"
  | "CONFLICTING_SUBMISSION"
  | "INTENT_NOT_PENDING";

export class SubmissionError extends Error {
  readonly code: SubmissionErrorCode;
  constructor(code: SubmissionErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

export function isValidTxHash(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

/**
 * Register a candidate wallet-submitted hash for an intent. Atomic and
 * idempotent: same intent + same hash returns the existing row; a different
 * hash for an intent that already has one (or a hash claimed elsewhere)
 * fails closed — never a second payment.
 */
export async function registerSubmissionTx(
  store: SubmissionStore,
  args: {
    intent: WalletTransferIntent;
    ownerAddress: string;
    txHash: unknown;
    contractAddress: string;
    nowMs?: number;
  },
): Promise<{ submission: TransferSubmission; deduplicated: boolean }> {
  if (args.intent.ownerAddress !== args.ownerAddress) {
    throw new SubmissionError("NOT_FOUND", "Payment intent not found.");
  }
  if (!isValidTxHash(args.txHash)) {
    throw new SubmissionError("INVALID_TX_HASH", "Transaction hash is invalid.");
  }
  if (args.intent.status !== "pending" && args.intent.status !== "cancelled") {
    throw new SubmissionError("INTENT_NOT_PENDING", "Intent cannot accept a submission.");
  }
  const atIso = new Date(args.nowMs ?? Date.now()).toISOString();

  const byIntent = await store.findByIntent(args.intent.id);
  if (byIntent) {
    if (byIntent.txHash && byIntent.txHash.toLowerCase() === (args.txHash as string).toLowerCase()) {
      return { submission: byIntent, deduplicated: true };
    }
    throw new SubmissionError(
      "CONFLICTING_SUBMISSION",
      "This intent already has a different submitted transaction.",
    );
  }
  const byTx = await store.findByTxHash(args.txHash as string);
  if (byTx) {
    throw new SubmissionError(
      "CONFLICTING_SUBMISSION",
      "This transaction is already registered for another intent.",
    );
  }
  try {
    const submission = await store.insert({
      id: newId("sub"),
      intentId: args.intent.id,
      ownerAddress: args.ownerAddress,
      chainId: args.intent.chainId,
      environment: args.intent.environment,
      contractAddress: args.contractAddress,
      termsFingerprint: args.intent.termsFingerprint,
      tokenAddress: args.intent.tokenAddress,
      recipientAddress: args.intent.recipientAddress,
      amountBaseUnits: args.intent.amountBaseUnits,
      txHash: args.txHash as string,
      status: "submitted",
      createdAt: atIso,
      updatedAt: atIso,
    });
    return { submission, deduplicated: false };
  } catch (err) {
    if (isConflict(err)) {
      // Lost a concurrent race: return the winner instead of a second row.
      const winner = await store.findByIntent(args.intent.id);
      if (winner && winner.txHash?.toLowerCase() === (args.txHash as string).toLowerCase()) {
        return { submission: winner, deduplicated: true };
      }
      throw new SubmissionError(
        "CONFLICTING_SUBMISSION",
        "This intent already has a different submitted transaction.",
      );
    }
    throw err;
  }
}

export type ReconcileOutcome = "confirmed" | "failed" | "pending" | "unknown";

export type ReconcileResult = {
  submission: TransferSubmission | null;
  outcome: ReconcileOutcome;
  reason: string;
};

/**
 * Bounded, idempotent re-verification of a known submission. Never broadcasts.
 * Cancellation of the intent does not stop verification: a post-cancel
 * confirmation is recorded and reported truthfully.
 */
export async function reconcileSubmission(
  store: SubmissionStore,
  reader: ChainReader,
  config: VerifierConfig,
  args: { intent: WalletTransferIntent; nowMs?: number },
): Promise<ReconcileResult> {
  const submission = await store.findByIntent(args.intent.id);
  if (!submission || !submission.txHash) {
    return { submission, outcome: "unknown", reason: "NO_SUBMISSION" };
  }
  const verified = await verifySubmissionOnChain(reader, config, args.intent, submission.txHash);
  const atIso = new Date(args.nowMs ?? Date.now()).toISOString();

  if (verified.outcome === "confirmed" && verified.evidence) {
    const e = verified.evidence;
    const next = await store.transitionStatus(
      args.intent.id,
      ["submitted", "unknown"],
      {
        status: "confirmed",
        receiptStatus: e.receiptStatus,
        blockNumber: Number(e.blockNumber),
        blockHash: e.blockHash,
        confirmations: e.confirmations,
        failureReason: null,
        updatedAt: atIso,
        verifiedAt: atIso,
      },
    );
    return { submission: next ?? submission, outcome: "confirmed", reason: verified.reason };
  }
  if (verified.outcome === "failed") {
    const next = await store.transitionStatus(
      args.intent.id,
      ["submitted", "unknown"],
      { status: "failed", failureReason: verified.reason, updatedAt: atIso, verifiedAt: atIso },
    );
    return { submission: next ?? submission, outcome: "failed", reason: verified.reason };
  }
  if (verified.outcome === "unknown") {
    const next = await store.transitionStatus(
      args.intent.id,
      ["submitted"],
      { status: "unknown", failureReason: verified.reason, updatedAt: atIso },
    );
    return { submission: next ?? submission, outcome: "unknown", reason: verified.reason };
  }
  return { submission, outcome: "pending", reason: verified.reason };
}
