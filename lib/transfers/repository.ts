/**
 * B3 — wallet_transfer PaymentIntent storage behind a narrow interface.
 *
 * Memory implementation for deterministic tests; Drizzle implementation for
 * Neon. Owner-scoped reads only; the only mutation is pending → cancelled.
 * Payment-critical terms are immutable: no update path exists for them.
 */

import { and, eq, isNotNull } from "drizzle-orm";
import {
  walletTransferIntents,
  type NewWalletTransferIntent,
  type WalletTransferIntent,
} from "@/lib/db/schema";
import type { DbClient } from "@/lib/db";

export type { WalletTransferIntent, NewWalletTransferIntent };

export type IntentStore = {
  insertIntent(row: NewWalletTransferIntent): Promise<WalletTransferIntent>;
  findIntentById(id: string): Promise<WalletTransferIntent | null>;
  findByOwnerIdempotencyKey(owner: string, key: string): Promise<WalletTransferIntent | null>;
  listByOwner(owner: string): Promise<WalletTransferIntent[]>;
  /** The ONLY mutation: pending → cancelled. Returns null when not pending. */
  cancelPendingIntent(id: string, nowIso: string): Promise<WalletTransferIntent | null>;
};

function nowIso(): string {
  return new Date().toISOString();
}

/* -------------------------------------------------------------------------- */
/* In-memory (tests)                                                          */
/* -------------------------------------------------------------------------- */

export function createMemoryIntentStore(): IntentStore {
  const intents = new Map<string, WalletTransferIntent>();

  const toRow = (row: NewWalletTransferIntent): WalletTransferIntent => ({
    id: row.id,
    ownerAddress: row.ownerAddress,
    recipientSource: row.recipientSource,
    savedRecipientId: row.savedRecipientId ?? null,
    savedRecipientVersion: row.savedRecipientVersion ?? null,
    recipientAddress: row.recipientAddress,
    recipientLabel: row.recipientLabel,
    chainId: row.chainId,
    environment: row.environment,
    assetSymbol: row.assetSymbol,
    tokenAddress: row.tokenAddress ?? null,
    assetDecimals: row.assetDecimals,
    amountDisplay: row.amountDisplay,
    amountBaseUnits: row.amountBaseUnits,
    status: row.status ?? "pending",
    approvalVersion: row.approvalVersion ?? 1,
    termsFingerprint: row.termsFingerprint,
    idempotencyKey: row.idempotencyKey ?? null,
    createdAt: row.createdAt ?? nowIso(),
    expiresAt: row.expiresAt,
    updatedAt: row.updatedAt ?? nowIso(),
  });

  return {
    async insertIntent(row: NewWalletTransferIntent): Promise<WalletTransferIntent> {
      if (row.idempotencyKey) {
        for (const existing of intents.values()) {
          if (
            existing.ownerAddress === row.ownerAddress &&
            existing.idempotencyKey === row.idempotencyKey
          ) {
            const conflict = new Error("Duplicate idempotency key for owner.");
            (conflict as NodeJS.ErrnoException).code = "DUPLICATE_IDEMPOTENCY_KEY";
            throw conflict;
          }
        }
      }
      const saved = toRow(row);
      intents.set(saved.id, saved);
      return saved;
    },
    async findIntentById(id: string): Promise<WalletTransferIntent | null> {
      return intents.get(id) ?? null;
    },
    async findByOwnerIdempotencyKey(owner: string, key: string): Promise<WalletTransferIntent | null> {
      for (const existing of intents.values()) {
        if (existing.ownerAddress === owner && existing.idempotencyKey === key) {
          return existing;
        }
      }
      return null;
    },
    async listByOwner(owner: string): Promise<WalletTransferIntent[]> {
      return [...intents.values()].filter((i) => i.ownerAddress === owner);
    },
    async cancelPendingIntent(id: string, atIso: string): Promise<WalletTransferIntent | null> {
      const current = intents.get(id);
      if (!current || current.status !== "pending") return null;
      const next: WalletTransferIntent = { ...current, status: "cancelled", updatedAt: atIso };
      intents.set(id, next);
      return next;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Drizzle / Neon                                                             */
/* -------------------------------------------------------------------------- */

export function createDrizzleIntentStore(db: DbClient): IntentStore {
  return {
    async insertIntent(row: NewWalletTransferIntent): Promise<WalletTransferIntent> {
      const [saved] = await db.insert(walletTransferIntents).values(row).returning();
      if (!saved) throw new Error("Intent insert returned no row.");
      return saved;
    },
    async findIntentById(id: string): Promise<WalletTransferIntent | null> {
      const [row] = await db
        .select()
        .from(walletTransferIntents)
        .where(eq(walletTransferIntents.id, id))
        .limit(1);
      return row ?? null;
    },
    async findByOwnerIdempotencyKey(owner: string, key: string): Promise<WalletTransferIntent | null> {
      const [row] = await db
        .select()
        .from(walletTransferIntents)
        .where(
          and(
            eq(walletTransferIntents.ownerAddress, owner),
            eq(walletTransferIntents.idempotencyKey, key),
            isNotNull(walletTransferIntents.idempotencyKey),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async listByOwner(owner: string): Promise<WalletTransferIntent[]> {
      return db
        .select()
        .from(walletTransferIntents)
        .where(eq(walletTransferIntents.ownerAddress, owner));
    },
    async cancelPendingIntent(id: string, atIso: string): Promise<WalletTransferIntent | null> {
      const [next] = await db
        .update(walletTransferIntents)
        .set({ status: "cancelled", updatedAt: atIso })
        .where(
          and(
            eq(walletTransferIntents.id, id),
            eq(walletTransferIntents.status, "pending"),
          ),
        )
        .returning();
      return next ?? null;
    },
  };
}
