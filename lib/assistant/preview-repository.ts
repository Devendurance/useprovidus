/**
 * Server-authoritative airtime preview persistence.
 *
 * A preview row is the only thing that can authorize payment preparation: the
 * browser receives the generated `prev_${uuid}` identifier and hands it back,
 * and the server re-reads every quote value from the row. Consumption is a
 * single conditional transition — `consumed_at IS NULL AND expires_at > now()
 * AND wallet_address = <normalized wallet>` — so a quote can be spent at most
 * once, only before it expires, and only by the wallet it was issued to.
 *
 * Two failure classes are distinguished and never merged:
 *   - `PREVIEW_NOT_USABLE` is a business outcome (missing, expired, consumed,
 *     or another wallet's preview) and is deliberately collapsed so callers
 *     cannot probe for the existence of other users' previews.
 *   - `PREVIEW_STORE_UNAVAILABLE` is an availability outcome; payment
 *     preparation must fail closed rather than fall back to a fresh quote.
 */

import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { airtimePreviews, type AirtimePreviewRecord } from "@/lib/db/schema";

export type { AirtimePreviewRecord };

/**
 * The quote fields a preview is created with. `id`, `consumedAt`,
 * `transactionId`, and `createdAt` are server-owned and cannot be supplied.
 */
export type AirtimePreviewRecordInput = Omit<
  AirtimePreviewRecord,
  "id" | "consumedAt" | "transactionId" | "createdAt"
>;

export type PreviewFailureCode =
  | "PREVIEW_NOT_USABLE"
  | "PREVIEW_STORE_UNAVAILABLE";

export type Result<T> =
  | { ok: true; preview: T }
  | { ok: false; code: PreviewFailureCode; message: string };

export interface PreviewRepository {
  createPreview(
    preview: AirtimePreviewRecordInput,
  ): Promise<Result<AirtimePreviewRecord>>;
  findById(previewId: string): Promise<AirtimePreviewRecord | null>;
  consumePreview(
    previewId: string,
    walletAddress: string,
    transactionId: string,
  ): Promise<Result<AirtimePreviewRecord>>;
  /**
   * Compensating rollback for a consumption whose gating transaction was never
   * created. Only the row still stamped with the exact `transactionId` is
   * reopened, so a release can never undo a later consumption or hand an
   * already-spent preview to a second caller. Returns whether a row was
   * released; expiry is deliberately left to `consumePreview`.
   */
  releasePreview(previewId: string, transactionId: string): Promise<boolean>;
}

export const PREVIEW_NOT_USABLE_MESSAGE =
  "Preview is missing, expired, already consumed, or belongs to another wallet";

export const PREVIEW_STORE_UNAVAILABLE_MESSAGE =
  "Preview persistence is unavailable; no payment can be prepared";

/** Wallet identity is case-insensitive: every copy is stored and matched lowercased. */
function normalizeWalletAddress(walletAddress: string): string {
  return walletAddress.trim().toLowerCase();
}

/**
 * In-memory implementation for tests and offline execution. Mirrors the
 * Drizzle semantics exactly: consumption is a check-then-write with no
 * interleaving point, so concurrent callers cannot both succeed.
 */
export class InMemoryPreviewRepository implements PreviewRepository {
  private records = new Map<string, AirtimePreviewRecord>();

  async createPreview(
    preview: AirtimePreviewRecordInput,
  ): Promise<Result<AirtimePreviewRecord>> {
    const id = `prev_${randomUUID()}`;
    const record: AirtimePreviewRecord = {
      ...preview,
      id,
      walletAddress: normalizeWalletAddress(preview.walletAddress),
      consumedAt: null,
      transactionId: null,
      createdAt: new Date().toISOString(),
    };
    this.records.set(id, record);
    return { ok: true, preview: { ...record } };
  }

  async findById(previewId: string): Promise<AirtimePreviewRecord | null> {
    const record = this.records.get(previewId);
    return record ? { ...record } : null;
  }

  async consumePreview(
    previewId: string,
    walletAddress: string,
    transactionId: string,
  ): Promise<Result<AirtimePreviewRecord>> {
    const record = this.records.get(previewId);
    const usable =
      record !== undefined &&
      record.consumedAt === null &&
      Date.parse(record.expiresAt) > Date.now() &&
      record.walletAddress === normalizeWalletAddress(walletAddress);
    if (!record || !usable) {
      return {
        ok: false,
        code: "PREVIEW_NOT_USABLE",
        message: PREVIEW_NOT_USABLE_MESSAGE,
      };
    }

    // The usability check and this write are one synchronous step, so the
    // second of two concurrent callers always observes `consumedAt` set.
    const consumed: AirtimePreviewRecord = {
      ...record,
      consumedAt: new Date().toISOString(),
      transactionId,
    };
    this.records.set(previewId, consumed);
    return { ok: true, preview: { ...consumed } };
  }

  /**
   * Compensating rollback. The record is reopened only while it still carries
   * the exact transaction it was consumed for, so a release that arrives after
   * a later consumption (or after the row was never bound at all) is refused.
   */
  async releasePreview(
    previewId: string,
    transactionId: string,
  ): Promise<boolean> {
    const record = this.records.get(previewId);
    if (!record || record.transactionId !== transactionId) return false;

    this.records.set(previewId, {
      ...record,
      consumedAt: null,
      transactionId: null,
    });
    return true;
  }

  /** Drops every stored preview; test/offline reset only. */
  clear(): void {
    this.records.clear();
  }
}

/**
 * Production Postgres implementation. Consumption is one conditional
 * `UPDATE ... RETURNING`, so the database — not application timing — decides
 * the single successful consumer.
 */
export class DrizzlePreviewRepository implements PreviewRepository {
  async createPreview(
    preview: AirtimePreviewRecordInput,
  ): Promise<Result<AirtimePreviewRecord>> {
    const db = getDb();
    if (!db) {
      return {
        ok: false,
        code: "PREVIEW_STORE_UNAVAILABLE",
        message: PREVIEW_STORE_UNAVAILABLE_MESSAGE,
      };
    }

    const id = `prev_${randomUUID()}`;
    try {
      const [row] = await db
        .insert(airtimePreviews)
        .values({
          ...preview,
          id,
          walletAddress: normalizeWalletAddress(preview.walletAddress),
        })
        .returning();
      if (!row) {
        return {
          ok: false,
          code: "PREVIEW_STORE_UNAVAILABLE",
          message: PREVIEW_STORE_UNAVAILABLE_MESSAGE,
        };
      }
      return { ok: true, preview: row };
    } catch (error) {
      console.error("[preview-repository] createPreview failed:", error);
      return {
        ok: false,
        code: "PREVIEW_STORE_UNAVAILABLE",
        message: PREVIEW_STORE_UNAVAILABLE_MESSAGE,
      };
    }
  }

  async findById(previewId: string): Promise<AirtimePreviewRecord | null> {
    const db = getDb();
    if (!db) return null;
    const [row] = await db
      .select()
      .from(airtimePreviews)
      .where(eq(airtimePreviews.id, previewId))
      .limit(1);
    return row ?? null;
  }

  async consumePreview(
    previewId: string,
    walletAddress: string,
    transactionId: string,
  ): Promise<Result<AirtimePreviewRecord>> {
    const db = getDb();
    if (!db) {
      return {
        ok: false,
        code: "PREVIEW_STORE_UNAVAILABLE",
        message: PREVIEW_STORE_UNAVAILABLE_MESSAGE,
      };
    }

    try {
      const [row] = await db
        .update(airtimePreviews)
        .set({ consumedAt: sql`now()`, transactionId })
        .where(
          and(
            eq(airtimePreviews.id, previewId),
            isNull(airtimePreviews.consumedAt),
            gt(airtimePreviews.expiresAt, sql`now()`),
            eq(
              airtimePreviews.walletAddress,
              normalizeWalletAddress(walletAddress),
            ),
          ),
        )
        .returning();

      // Zero rows is a business outcome: the row is absent, expired, already
      // consumed, or bound to another wallet. Nothing was mutated.
      if (!row) {
        return {
          ok: false,
          code: "PREVIEW_NOT_USABLE",
          message: PREVIEW_NOT_USABLE_MESSAGE,
        };
      }
      return { ok: true, preview: row };
    } catch (error) {
      console.error("[preview-repository] consumePreview failed:", error);
      return {
        ok: false,
        code: "PREVIEW_STORE_UNAVAILABLE",
        message: PREVIEW_STORE_UNAVAILABLE_MESSAGE,
      };
    }
  }

  /**
   * Compensating rollback in one conditional `UPDATE ... RETURNING id`: the
   * `transaction_id = <attempt>` predicate makes it impossible to reopen a row
   * that a different attempt (or a later consumption) now owns.
   */
  async releasePreview(
    previewId: string,
    transactionId: string,
  ): Promise<boolean> {
    const db = getDb();
    if (!db) return false;

    try {
      const rows = await db
        .update(airtimePreviews)
        .set({ consumedAt: null, transactionId: null })
        .where(
          and(
            eq(airtimePreviews.id, previewId),
            eq(airtimePreviews.transactionId, transactionId),
          ),
        )
        .returning({ id: airtimePreviews.id });
      return rows.length > 0;
    } catch (error) {
      console.error("[preview-repository] releasePreview failed:", error);
      return false;
    }
  }
}

/**
 * Wired when no database is configured outside tests. Every operation fails
 * closed: no preview is stored and no consumption is ever reported as
 * successful, so a misconfigured deployment cannot hand out payable quotes.
 */
export class FailClosedPreviewRepository implements PreviewRepository {
  async createPreview(): Promise<Result<AirtimePreviewRecord>> {
    return {
      ok: false,
      code: "PREVIEW_STORE_UNAVAILABLE",
      message: PREVIEW_STORE_UNAVAILABLE_MESSAGE,
    };
  }

  async findById(): Promise<AirtimePreviewRecord | null> {
    return null;
  }

  async consumePreview(): Promise<Result<AirtimePreviewRecord>> {
    return {
      ok: false,
      code: "PREVIEW_STORE_UNAVAILABLE",
      message: PREVIEW_STORE_UNAVAILABLE_MESSAGE,
    };
  }

  /** Nothing is ever stored here, so nothing can ever be released. */
  async releasePreview(): Promise<boolean> {
    return false;
  }
}

// Global singleton instance
let activeRepository: PreviewRepository | null = null;

export function getPreviewRepository(): PreviewRepository {
  if (activeRepository) {
    return activeRepository;
  }

  if (process.env.DATABASE_URL) {
    activeRepository = new DrizzlePreviewRepository();
    return activeRepository;
  }

  // In-memory previews are for unit tests only; they cannot span processes and
  // must never become the production persistence path.
  if (process.env.NODE_ENV === "test") {
    activeRepository = new InMemoryPreviewRepository();
    return activeRepository;
  }

  // Fail closed when DATABASE_URL is missing outside tests.
  return new FailClosedPreviewRepository();
}

export function setPreviewRepositoryForTesting(
  repo: PreviewRepository | null,
): void {
  activeRepository = repo;
}
