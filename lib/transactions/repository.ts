import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { agentTransactions } from "@/lib/db/schema";
import { sanitizeFailureReason } from "@/lib/transactions/sanitization";
import {
  ALLOWED_TRANSITIONS_BY_TYPE,
  isTerminalStatus,
  validateStatusTransition,
} from "@/lib/transactions/transitions";
import type {
  BindPaycrestOrderInput,
  CreateTransactionInput,
  TransactionRecord,
  TransactionStatus,
  UpdateTransactionStatusInput,
} from "@/lib/transactions/types";

export interface TransactionRepository {
  create(
    input: CreateTransactionInput,
  ): Promise<
    | { ok: true; record: TransactionRecord; reused: boolean }
    | { ok: false; code: string; message: string }
  >;
  findById(id: string): Promise<TransactionRecord | null>;
  findByIdempotencyKey(key: string): Promise<TransactionRecord | null>;
  findByPaycrestReference(reference: string): Promise<TransactionRecord | null>;
  findByPaycrestOrderId(orderId: string): Promise<TransactionRecord | null>;
  bindPaycrestOrder(
    input: BindPaycrestOrderInput,
  ): Promise<
    | { ok: true; record: TransactionRecord }
    | { ok: false; code: string; message: string }
  >;
  bindCeloTxHash(input: {
    id: string;
    celoTxHash: string;
  }): Promise<
    | { ok: true; record: TransactionRecord }
    | { ok: false; code: string; message: string }
  >;
  updateStatus(
    id: string,
    update: UpdateTransactionStatusInput,
  ): Promise<
    | { ok: true; record: TransactionRecord; isNoop: boolean }
    | { ok: false; code: string; message: string }
  >;
}

function generateTransactionId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `tx_${crypto.randomUUID()}`;
  }
  return `tx_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}
const PAYCREST_HAPPY_PATH_RANK: Record<string, number> = {
  initiated: 1,
  deposited: 2,
  pending: 3,
  fulfilling: 4,
  fulfilled: 5,
  validated: 6, // fiat delivery confirmed
  settling: 7, // escrow settlement broadcast
  settled: 8, // protocol fully complete
};

export function shouldAdvancePaycrestStatus(
  currentStatus: string | null | undefined,
  incomingStatus: string | null | undefined,
): boolean {
  if (!incomingStatus) return false;
  if (!currentStatus) return true;
  const curr = currentStatus.toLowerCase().trim();
  const inc = incomingStatus.toLowerCase().trim();
  if (curr === inc) return false;

  // Terminal states: settled, refunded, cancelled, expired can never transition
  if (
    curr === "settled" ||
    curr === "refunded" ||
    curr === "cancelled" ||
    curr === "expired"
  ) {
    return false;
  }

  // Once fiat delivery is confirmed (validated / settling), reject stale pre-fiat or refund statuses
  if (curr === "validated" || curr === "settling") {
    if (inc === "settling" && curr === "validated") return true;
    if (inc === "settled") return true;
    return false;
  }

  // Once in refunding, only refunded can advance it; cannot be revived to happy path (validated, settled, etc.)
  if (curr === "refunding") {
    return inc === "refunded";
  }
  // Refund branch from pre-fiat fulfillment failure:
  // deposited / pending / fulfilling / fulfilled -> refunding -> refunded
  if (inc === "refunding") {
    return (
      curr === "initiated" ||
      curr === "deposited" ||
      curr === "pending" ||
      curr === "fulfilling" ||
      curr === "fulfilled"
    );
  }

  if (inc === "refunded") {
    return (
      curr === "initiated" ||
      curr === "deposited" ||
      curr === "pending" ||
      curr === "fulfilling" ||
      curr === "fulfilled" ||
      curr === "refunding"
    );
  }

  // Cancellation or expiration before deposit
  if (inc === "cancelled" || inc === "expired") {
    return curr === "initiated" || curr === "deposited" || curr === "pending";
  }

  // Happy path forward progression: strictly advancing rank
  const currentRank = PAYCREST_HAPPY_PATH_RANK[curr] ?? 0;
  const incomingRank = PAYCREST_HAPPY_PATH_RANK[inc] ?? 0;
  return incomingRank > currentRank;
}


/**
 * In-Memory repository implementation used strictly for unit tests, offline execution,
 * or when explicitly injected via `setTransactionRepositoryForTesting`.
 */
export class InMemoryTransactionRepository implements TransactionRepository {
  private records = new Map<string, TransactionRecord>();

  async create(
    input: CreateTransactionInput,
  ): Promise<
    | { ok: true; record: TransactionRecord; reused: boolean }
    | { ok: false; code: string; message: string }
  > {
    const existing = await this.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return { ok: true, record: existing, reused: true };
    }

    const byRef = await this.findByPaycrestReference(input.paycrestReference);
    if (byRef) {
      return { ok: true, record: byRef, reused: true };
    }

    const id = input.id ?? generateTransactionId();
    const timestamp = nowIso();

    const record: TransactionRecord = {
      id,
      idempotencyKey: input.idempotencyKey,
      type: input.type ?? "cash_out",
      status: "pending",
      walletAddress: input.walletAddress.toLowerCase(),
      amountUsdc: input.amountUsdc,
      amountNgn: input.amountNgn ?? null,
      celoTxHash: null,
      paycrestOrderId: input.paycrestOrderId ?? null,
      paycrestReference: input.paycrestReference,
      paycrestStatus: input.paycrestStatus ?? "initiated",
      receiveAddress: input.receiveAddress ?? null,
      validUntil: input.validUntil ?? null,
      failureCode: null,
      failureReason: null,
      metadata: input.metadata ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.records.set(id, record);
    return { ok: true, record, reused: false };
  }

  async findById(id: string): Promise<TransactionRecord | null> {
    return this.records.get(id) ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<TransactionRecord | null> {
    for (const record of this.records.values()) {
      if (record.idempotencyKey === key) return record;
    }
    return null;
  }

  async findByPaycrestReference(
    reference: string,
  ): Promise<TransactionRecord | null> {
    for (const record of this.records.values()) {
      if (record.paycrestReference === reference) return record;
    }
    return null;
  }

  async findByPaycrestOrderId(
    orderId: string,
  ): Promise<TransactionRecord | null> {
    for (const record of this.records.values()) {
      if (record.paycrestOrderId === orderId) return record;
    }
    return null;
  }

  async bindPaycrestOrder(
    input: BindPaycrestOrderInput,
  ): Promise<
    | { ok: true; record: TransactionRecord }
    | { ok: false; code: string; message: string }
  > {
    const record = await this.findById(input.id);
    if (!record) {
      return {
        ok: false,
        code: "TRANSACTION_NOT_FOUND",
        message: `Transaction ${input.id} not found`,
      };
    }

    if (isTerminalStatus(record.status, record.type)) {
      return {
        ok: false,
        code: "ILLEGAL_TRANSITION",
        message: `Cannot bind Paycrest order to terminal transaction '${record.status}'`,
      };
    }

    const updated: TransactionRecord = {
      ...record,
      paycrestOrderId: input.paycrestOrderId,
      receiveAddress: input.receiveAddress,
      validUntil: input.validUntil ?? record.validUntil,
      paycrestStatus: input.paycrestStatus ?? record.paycrestStatus,
      metadata: {
        ...(record.metadata ?? {}),
        ...(input.metadata ?? {}),
      },
      updatedAt: nowIso(),
    };

    this.records.set(input.id, updated);
    return { ok: true, record: updated };
  }

  async bindCeloTxHash(input: {
    id: string;
    celoTxHash: string;
  }): Promise<
    | { ok: true; record: TransactionRecord }
    | { ok: false; code: string; message: string }
  > {
    const record = await this.findById(input.id);
    if (!record) {
      return {
        ok: false,
        code: "TRANSACTION_NOT_FOUND",
        message: `Transaction ${input.id} not found`,
      };
    }

    if (!/^0x[a-fA-F0-9]{64}$/.test(input.celoTxHash)) {
      return {
        ok: false,
        code: "INVALID_TRANSACTION_HASH",
        message: "Celo transaction hash must be a 66-character hex string",
      };
    }

    if (
      record.celoTxHash &&
      record.celoTxHash.toLowerCase() === input.celoTxHash.toLowerCase()
    ) {
      return { ok: true, record };
    }

    const validation = validateStatusTransition(
      record.status,
      "settling",
      record.type,
    );
    if (!validation.allowed) {
      return {
        ok: false,
        code: "ILLEGAL_TRANSITION",
        message:
          validation.reason ??
          `Cannot bind tx hash when status is '${record.status}'`,
      };
    }

    const updated: TransactionRecord = {
      ...record,
      celoTxHash: input.celoTxHash,
      status: "settling",
      updatedAt: nowIso(),
    };

    this.records.set(record.id, updated);
    return { ok: true, record: updated };
  }

  async updateStatus(
    id: string,
    update: UpdateTransactionStatusInput,
  ): Promise<
    | { ok: true; record: TransactionRecord; isNoop: boolean }
    | { ok: false; code: string; message: string }
  > {
    const record = await this.findById(id);
    if (!record) {
      return {
        ok: false,
        code: "TRANSACTION_NOT_FOUND",
        message: `Transaction ${id} not found`,
      };
    }

    const validation = validateStatusTransition(
      record.status,
      update.status,
      record.type,
    );
    if (!validation.allowed) {
      return {
        ok: false,
        code: "ILLEGAL_TRANSITION",
        message: validation.reason ?? "Illegal transition",
      };
    }

    if (validation.isNoop) {
      if (
        shouldAdvancePaycrestStatus(
          record.paycrestStatus,
          update.paycrestStatus,
        )
      ) {
        const updated: TransactionRecord = {
          ...record,
          paycrestStatus: update.paycrestStatus!,
          updatedAt: nowIso(),
        };
        this.records.set(id, updated);
        return { ok: true, record: updated, isNoop: false };
      }
      return { ok: true, record, isNoop: true };
    }

    const nextPaycrestStatus = shouldAdvancePaycrestStatus(
      record.paycrestStatus,
      update.paycrestStatus,
    )
      ? update.paycrestStatus!
      : record.paycrestStatus;

    const updated: TransactionRecord = {
      ...record,
      status: update.status,
      paycrestStatus: nextPaycrestStatus,
      celoTxHash: update.celoTxHash ?? record.celoTxHash,
      failureCode: update.failureCode ?? record.failureCode,
      failureReason: update.failureReason
        ? sanitizeFailureReason(update.failureReason)
        : record.failureReason,
      updatedAt: nowIso(),
    };

    this.records.set(id, updated);
    return { ok: true, record: updated, isNoop: false };
  }
}

/**
 * Production Drizzle repository implementation backed by Postgres.
 * Performs conditional, atomic SQL updates to eliminate race conditions.
 */
export class DrizzleTransactionRepository implements TransactionRepository {
  async create(
    input: CreateTransactionInput,
  ): Promise<
    | { ok: true; record: TransactionRecord; reused: boolean }
    | { ok: false; code: string; message: string }
  > {
    const db = getDb();
    if (!db) {
      return {
        ok: false,
        code: "DATABASE_UNAVAILABLE",
        message: "Database connection is not configured",
      };
    }

    const existing = await this.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return { ok: true, record: existing, reused: true };
    }

    const byRef = await this.findByPaycrestReference(input.paycrestReference);
    if (byRef) {
      return { ok: true, record: byRef, reused: true };
    }

    const id = input.id ?? generateTransactionId();
    const timestamp = nowIso();

    try {
      const [inserted] = await db
        .insert(agentTransactions)
        .values({
          id,
          idempotencyKey: input.idempotencyKey,
          type: input.type ?? "cash_out",
          status: "pending",
          walletAddress: input.walletAddress.toLowerCase(),
          amountUsdc: input.amountUsdc,
          amountNgn: input.amountNgn ?? null,
          celoTxHash: null,
          paycrestOrderId: input.paycrestOrderId ?? null,
          paycrestReference: input.paycrestReference,
          paycrestStatus: input.paycrestStatus ?? "initiated",
          receiveAddress: input.receiveAddress ?? null,
          validUntil: input.validUntil ?? null,
          failureCode: null,
          failureReason: null,
          metadata: input.metadata ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();

      return {
        ok: true,
        record: this.mapRow(inserted),
        reused: false,
      };
    } catch (err) {
      const checkKey = await this.findByIdempotencyKey(input.idempotencyKey);
      if (checkKey) {
        return { ok: true, record: checkKey, reused: true };
      }
      return {
        ok: false,
        code: "DATABASE_INSERT_ERROR",
        message:
          err instanceof Error ? err.message : "Failed to persist transaction",
      };
    }
  }

  async findById(id: string): Promise<TransactionRecord | null> {
    const db = getDb();
    if (!db) return null;
    const [row] = await db
      .select()
      .from(agentTransactions)
      .where(eq(agentTransactions.id, id))
      .limit(1);
    return row ? this.mapRow(row) : null;
  }

  async findByIdempotencyKey(key: string): Promise<TransactionRecord | null> {
    const db = getDb();
    if (!db) return null;
    const [row] = await db
      .select()
      .from(agentTransactions)
      .where(eq(agentTransactions.idempotencyKey, key))
      .limit(1);
    return row ? this.mapRow(row) : null;
  }

  async findByPaycrestReference(
    reference: string,
  ): Promise<TransactionRecord | null> {
    const db = getDb();
    if (!db) return null;
    const [row] = await db
      .select()
      .from(agentTransactions)
      .where(eq(agentTransactions.paycrestReference, reference))
      .limit(1);
    return row ? this.mapRow(row) : null;
  }

  async findByPaycrestOrderId(
    orderId: string,
  ): Promise<TransactionRecord | null> {
    const db = getDb();
    if (!db) return null;
    const [row] = await db
      .select()
      .from(agentTransactions)
      .where(eq(agentTransactions.paycrestOrderId, orderId))
      .limit(1);
    return row ? this.mapRow(row) : null;
  }

  async bindPaycrestOrder(
    input: BindPaycrestOrderInput,
  ): Promise<
    | { ok: true; record: TransactionRecord }
    | { ok: false; code: string; message: string }
  > {
    const db = getDb();
    if (!db) {
      return {
        ok: false,
        code: "DATABASE_UNAVAILABLE",
        message: "Database connection is not configured",
      };
    }

    const timestamp = nowIso();

    // Atomic conditional update: only update if not already terminal
    const [updated] = await db
      .update(agentTransactions)
      .set({
        paycrestOrderId: input.paycrestOrderId,
        receiveAddress: input.receiveAddress,
        validUntil: input.validUntil ?? undefined,
        paycrestStatus: input.paycrestStatus ?? undefined,
        metadata: input.metadata
          ? sql`coalesce(${agentTransactions.metadata}, '{}'::jsonb) || ${JSON.stringify(input.metadata)}::jsonb`
          : undefined,
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(agentTransactions.id, input.id),
          inArray(agentTransactions.status, ["pending", "settling"]),
        ),
      )
      .returning();

    if (updated) {
      return { ok: true, record: this.mapRow(updated) };
    }

    const current = await this.findById(input.id);
    if (!current) {
      return {
        ok: false,
        code: "TRANSACTION_NOT_FOUND",
        message: `Transaction ${input.id} not found`,
      };
    }
    if (isTerminalStatus(current.status, current.type)) {
      return {
        ok: false,
        code: "ILLEGAL_TRANSITION",
        message: `Cannot bind Paycrest order to terminal transaction '${current.status}'`,
      };
    }

    return {
      ok: false,
      code: "ILLEGAL_TRANSITION",
      message: `Cannot bind Paycrest order when transaction status is '${current.status}'`,
    };
  }

  async bindCeloTxHash(input: {
    id: string;
    celoTxHash: string;
  }): Promise<
    | { ok: true; record: TransactionRecord }
    | { ok: false; code: string; message: string }
  > {
    if (!/^0x[a-fA-F0-9]{64}$/.test(input.celoTxHash)) {
      return {
        ok: false,
        code: "INVALID_TRANSACTION_HASH",
        message: "Celo transaction hash must be a 66-character hex string",
      };
    }

    const db = getDb();
    if (!db) {
      return {
        ok: false,
        code: "DATABASE_UNAVAILABLE",
        message: "Database connection is not configured",
      };
    }

    const timestamp = nowIso();

    // Atomic conditional update: only transition from pending to settling,
    // or keep settling if hash matches
    const [updated] = await db
      .update(agentTransactions)
      .set({
        celoTxHash: input.celoTxHash,
        status: "settling",
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(agentTransactions.id, input.id),
          inArray(agentTransactions.status, ["pending", "settling"]),
        ),
      )
      .returning();

    if (updated) {
      return { ok: true, record: this.mapRow(updated) };
    }

    const current = await this.findById(input.id);
    if (!current) {
      return {
        ok: false,
        code: "TRANSACTION_NOT_FOUND",
        message: `Transaction ${input.id} not found`,
      };
    }

    if (
      current.celoTxHash &&
      current.celoTxHash.toLowerCase() === input.celoTxHash.toLowerCase()
    ) {
      return { ok: true, record: current };
    }
    const validation = validateStatusTransition(
      current.status,
      "settling",
      current.type,
    );
    return {
      ok: false,
      code: "ILLEGAL_TRANSITION",
      message:
        validation.reason ??
        `Cannot bind tx hash when status is '${current.status}'`,
    };
  }

  async updateStatus(
    id: string,
    update: UpdateTransactionStatusInput,
  ): Promise<
    | { ok: true; record: TransactionRecord; isNoop: boolean }
    | { ok: false; code: string; message: string }
  > {
    const db = getDb();
    if (!db) {
      return {
        ok: false,
        code: "DATABASE_UNAVAILABLE",
        message: "Database connection is not configured",
      };
    }

    const current = await this.findById(id);
    if (!current) {
      return {
        ok: false,
        code: "TRANSACTION_NOT_FOUND",
        message: `Transaction ${id} not found`,
      };
    }

    const validation = validateStatusTransition(
      current.status,
      update.status,
      current.type,
    );
    if (!validation.allowed) {
      return {
        ok: false,
        code: "ILLEGAL_TRANSITION",
        message: validation.reason ?? "Illegal transition",
      };
    }

    const timestamp = nowIso();

    if (validation.isNoop) {
      // Idempotent no-op; only advance upstream status if it represents true progression
      if (
        shouldAdvancePaycrestStatus(
          current.paycrestStatus,
          update.paycrestStatus,
        )
      ) {
        const [metaUpdated] = await db
          .update(agentTransactions)
          .set({
            paycrestStatus: update.paycrestStatus!,
            updatedAt: timestamp,
          })
          .where(eq(agentTransactions.id, id))
          .returning();
        return {
          ok: true,
          record: this.mapRow(metaUpdated),
          isNoop: false,
        };
      }
      return { ok: true, record: current, isNoop: true };
    }

    const nextPaycrestStatus = shouldAdvancePaycrestStatus(
      current.paycrestStatus,
      update.paycrestStatus,
    )
      ? update.paycrestStatus!
      : (current.paycrestStatus ?? undefined);

    // Determine legal previous statuses for target status for this transaction's type
    const typeTransitions =
      ALLOWED_TRANSITIONS_BY_TYPE[current.type] ??
      ALLOWED_TRANSITIONS_BY_TYPE.cash_out;
    const allowedPrevious: TransactionStatus[] = (
      Object.keys(typeTransitions) as TransactionStatus[]
    ).filter((s) => typeTransitions[s]?.[update.status] === true);

    const sanitizedReason = update.failureReason
      ? sanitizeFailureReason(update.failureReason)
      : undefined;

    // Atomic conditional status update
    const [updated] = await db
      .update(agentTransactions)
      .set({
        status: update.status,
        paycrestStatus: nextPaycrestStatus,
        celoTxHash: update.celoTxHash ?? undefined,
        failureCode: update.failureCode ?? undefined,
        failureReason: sanitizedReason ?? undefined,
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(agentTransactions.id, id),
          eq(agentTransactions.type, current.type),
          inArray(agentTransactions.status, allowedPrevious),
        ),
      )
      .returning();

    if (updated) {
      return {
        ok: true,
        record: this.mapRow(updated),
        isNoop: false,
      };
    }

    // If 0 rows updated, reload to provide specific failure explanation
    const reloaded = await this.findById(id);
    if (!reloaded) {
      return {
        ok: false,
        code: "TRANSACTION_NOT_FOUND",
        message: `Transaction ${id} not found`,
      };
    }

    if (isTerminalStatus(reloaded.status, reloaded.type)) {
      return {
        ok: false,
        code: "ILLEGAL_TRANSITION",
        message: `Cannot transition from terminal status '${reloaded.status}' to '${update.status}'`,
      };
    }

    return {
      ok: false,
      code: "ILLEGAL_TRANSITION",
      message: `Illegal transition from '${reloaded.status}' to '${update.status}'`,
    };
  }

  private mapRow(
    row: typeof agentTransactions.$inferSelect,
  ): TransactionRecord {
    return {
      id: row.id,
      idempotencyKey: row.idempotencyKey,
      type: row.type as "cash_out" | "airtime",
      status: row.status as TransactionStatus,
      walletAddress: row.walletAddress,
      amountUsdc: row.amountUsdc,
      amountNgn: row.amountNgn,
      celoTxHash: row.celoTxHash,
      paycrestOrderId: row.paycrestOrderId,
      paycrestReference: row.paycrestReference,
      paycrestStatus: row.paycrestStatus,
      receiveAddress: row.receiveAddress,
      validUntil: row.validUntil,
      failureCode: row.failureCode,
      failureReason: row.failureReason,
      metadata: row.metadata,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

class FailClosedTransactionRepository implements TransactionRepository {
  async create(): Promise<{ ok: false; code: string; message: string }> {
    return {
      ok: false,
      code: "DATABASE_UNAVAILABLE",
      message:
        "Database is unavailable. Configure DATABASE_URL in server environment.",
    };
  }

  async findById(): Promise<TransactionRecord | null> {
    return null;
  }

  async findByIdempotencyKey(): Promise<TransactionRecord | null> {
    return null;
  }

  async findByPaycrestReference(): Promise<TransactionRecord | null> {
    return null;
  }

  async findByPaycrestOrderId(): Promise<TransactionRecord | null> {
    return null;
  }

  async bindPaycrestOrder(): Promise<{
    ok: false;
    code: string;
    message: string;
  }> {
    return {
      ok: false,
      code: "DATABASE_UNAVAILABLE",
      message: "Database is unavailable",
    };
  }

  async bindCeloTxHash(): Promise<{
    ok: false;
    code: string;
    message: string;
  }> {
    return {
      ok: false,
      code: "DATABASE_UNAVAILABLE",
      message: "Database is unavailable",
    };
  }

  async updateStatus(): Promise<{
    ok: false;
    code: string;
    message: string;
  }> {
    return {
      ok: false,
      code: "DATABASE_UNAVAILABLE",
      message: "Database is unavailable",
    };
  }
}

// Global singleton instance
let activeRepository: TransactionRepository | null = null;

export function getTransactionRepository(): TransactionRepository {
  if (activeRepository) {
    return activeRepository;
  }

  if (process.env.DATABASE_URL) {
    activeRepository = new DrizzleTransactionRepository();
    return activeRepository;
  }

  // Allow InMemoryTransactionRepository ONLY in test environments
  if (process.env.NODE_ENV === "test") {
    activeRepository = new InMemoryTransactionRepository();
    return activeRepository;
  }

  // Fail closed in production/dev when DATABASE_URL is missing
  return new FailClosedTransactionRepository();
}

export function setTransactionRepositoryForTesting(
  repo: TransactionRepository | null,
): void {
  activeRepository = repo;
}
