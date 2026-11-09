/**
 * B2 — Recipient storage behind a narrow interface.
 *
 * - `MemoryRecipientStore`: deterministic in-memory implementation used by
 *   self-checks (no database required).
 * - `DrizzleRecipientStore`: Neon PostgreSQL implementation used by routes.
 *   Construct with `getDb()`; never touches a production database unless the
 *   caller runs migrations there (B2 does not).
 *
 * Both enforce the same active-row uniqueness contract; the database additionally
 * enforces it via the partial unique index in migration 0003.
 */

import { and, eq } from "drizzle-orm";
import {
  recipientAddressAudits,
  savedRecipients,
  type NewRecipientAddressAudit,
  type NewSavedRecipient,
  type RecipientAddressAudit,
  type SavedRecipient,
} from "@/lib/db/schema";
import type { DbClient } from "@/lib/db";

export type RecipientStore = {
  insertRecipient(row: NewSavedRecipient): Promise<SavedRecipient>;
  updateRecipient(
    id: string,
    patch: Partial<Pick<SavedRecipient, "label" | "normalizedLabel" | "address" | "version" | "isActive" | "deletedAt" | "updatedAt">>,
  ): Promise<SavedRecipient | null>;
  findRecipientById(id: string): Promise<SavedRecipient | null>;
  findActiveByOwnerLabelChain(
    ownerAddress: string,
    normalizedLabel: string,
    chainId: number,
  ): Promise<SavedRecipient | null>;
  listActiveByOwner(ownerAddress: string): Promise<SavedRecipient[]>;
  insertAudit(row: NewRecipientAddressAudit): Promise<RecipientAddressAudit>;
  listAuditsByRecipient(recipientId: string): Promise<RecipientAddressAudit[]>;
};

function nowIso(): string {
  return new Date().toISOString();
}

/* -------------------------------------------------------------------------- */
/* In-memory (tests)                                                          */
/* -------------------------------------------------------------------------- */

export function createMemoryRecipientStore(): RecipientStore {
  const recipients = new Map<string, SavedRecipient>();
  const audits: RecipientAddressAudit[] = [];

  const toRow = (row: NewSavedRecipient): SavedRecipient => ({
    id: row.id,
    ownerAddress: row.ownerAddress,
    label: row.label,
    normalizedLabel: row.normalizedLabel,
    recipientType: row.recipientType ?? "wallet",
    chainId: row.chainId,
    address: row.address,
    version: row.version ?? 1,
    isActive: row.isActive ?? true,
    createdAt: row.createdAt ?? nowIso(),
    updatedAt: row.updatedAt ?? nowIso(),
    deletedAt: row.deletedAt ?? null,
  });

  return {
    async insertRecipient(row: NewSavedRecipient): Promise<SavedRecipient> {
      for (const existing of recipients.values()) {
        if (
          existing.isActive &&
          existing.ownerAddress === row.ownerAddress &&
          existing.normalizedLabel === row.normalizedLabel &&
          existing.chainId === row.chainId
        ) {
          const conflict = new Error("Duplicate active recipient label for owner + chain.");
          (conflict as NodeJS.ErrnoException).code = "DUPLICATE_LABEL";
          throw conflict;
        }
      }
      const saved = toRow(row);
      recipients.set(saved.id, saved);
      return saved;
    },
    async updateRecipient(id, patch) {
      const current = recipients.get(id);
      if (!current) return null;
      if (patch.normalizedLabel !== undefined && patch.isActive !== false) {
        for (const existing of recipients.values()) {
          if (
            existing.id !== id &&
            existing.isActive &&
            existing.ownerAddress === current.ownerAddress &&
            existing.normalizedLabel === patch.normalizedLabel &&
            existing.chainId === current.chainId
          ) {
            const conflict = new Error("Duplicate active recipient label for owner + chain.");
            (conflict as NodeJS.ErrnoException).code = "DUPLICATE_LABEL";
            throw conflict;
          }
        }
      }
      const next: SavedRecipient = {
        ...current,
        ...patch,
        updatedAt: patch.updatedAt ?? nowIso(),
      };
      recipients.set(id, next);
      return next;
    },
    async findRecipientById(id) {
      return recipients.get(id) ?? null;
    },
    async findActiveByOwnerLabelChain(ownerAddress, normalizedLabel, chainId) {
      for (const existing of recipients.values()) {
        if (
          existing.isActive &&
          existing.ownerAddress === ownerAddress &&
          existing.normalizedLabel === normalizedLabel &&
          existing.chainId === chainId
        ) {
          return existing;
        }
      }
      return null;
    },
    async listActiveByOwner(ownerAddress) {
      return [...recipients.values()].filter(
        (r) => r.isActive && r.ownerAddress === ownerAddress,
      );
    },
    async insertAudit(row: NewRecipientAddressAudit) {
      const audit: RecipientAddressAudit = {
        id: row.id,
        recipientId: row.recipientId,
        ownerAddress: row.ownerAddress,
        chainId: row.chainId,
        oldAddress: row.oldAddress ?? null,
        newAddress: row.newAddress ?? null,
        oldVersion: row.oldVersion,
        newVersion: row.newVersion,
        reason: row.reason,
        createdAt: row.createdAt ?? nowIso(),
      };
      audits.push(audit);
      return audit;
    },
    async listAuditsByRecipient(recipientId) {
      return audits.filter((a) => a.recipientId === recipientId);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Drizzle / Neon                                                             */
/* -------------------------------------------------------------------------- */

export function createDrizzleRecipientStore(db: DbClient): RecipientStore {
  return {
    async insertRecipient(row: NewSavedRecipient): Promise<SavedRecipient> {
      const [saved] = await db.insert(savedRecipients).values(row).returning();
      if (!saved) throw new Error("Recipient insert returned no row.");
      return saved;
    },
    async updateRecipient(id, patch) {
      const [next] = await db
        .update(savedRecipients)
        .set({ ...patch, updatedAt: nowIso() })
        .where(eq(savedRecipients.id, id))
        .returning();
      return next ?? null;
    },
    async findRecipientById(id) {
      const [row] = await db
        .select()
        .from(savedRecipients)
        .where(eq(savedRecipients.id, id))
        .limit(1);
      return row ?? null;
    },
    async findActiveByOwnerLabelChain(ownerAddress, normalizedLabel, chainId) {
      const [row] = await db
        .select()
        .from(savedRecipients)
        .where(
          and(
            eq(savedRecipients.ownerAddress, ownerAddress),
            eq(savedRecipients.normalizedLabel, normalizedLabel),
            eq(savedRecipients.chainId, chainId),
            eq(savedRecipients.isActive, true),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async listActiveByOwner(ownerAddress) {
      return db
        .select()
        .from(savedRecipients)
        .where(
          and(
            eq(savedRecipients.ownerAddress, ownerAddress),
            eq(savedRecipients.isActive, true),
          ),
        );
    },
    async insertAudit(row: NewRecipientAddressAudit) {
      const [audit] = await db.insert(recipientAddressAudits).values(row).returning();
      if (!audit) throw new Error("Audit insert returned no row.");
      return audit;
    },
    async listAuditsByRecipient(recipientId) {
      return db
        .select()
        .from(recipientAddressAudits)
        .where(eq(recipientAddressAudits.recipientId, recipientId));
    },
  };
}
