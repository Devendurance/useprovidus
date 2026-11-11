import { and, desc, eq } from "drizzle-orm";
import {
  assistantMemories,
  type AssistantMemory,
  type NewAssistantMemory,
} from "@/lib/db/schema";
import type { DbClient } from "@/lib/db";

export type SharedMemoryContent = Pick<
  AssistantMemory,
  "kind" | "label" | "normalizedLabel" | "value"
>;

export type SharedMemoryStore = {
  listByOwner(ownerAddress: string, limit?: number): Promise<AssistantMemory[]>;
  findByOwnerId(ownerAddress: string, id: string): Promise<AssistantMemory | null>;
  findByOwnerRequestId(ownerAddress: string, requestId: string): Promise<AssistantMemory | null>;
  findByOwnerLabel(ownerAddress: string, normalizedLabel: string): Promise<AssistantMemory | null>;
  insert(row: NewAssistantMemory): Promise<AssistantMemory>;
  updateIfVersion(
    ownerAddress: string,
    id: string,
    expectedVersion: number,
    content: SharedMemoryContent,
  ): Promise<AssistantMemory | null>;
  deleteIfVersion(ownerAddress: string, id: string, expectedVersion: number): Promise<boolean>;
};

function uniqueViolation(): Error {
  return Object.assign(new Error("Shared memory uniqueness conflict."), { code: "23505" });
}

function clone(row: AssistantMemory): AssistantMemory {
  return { ...row };
}

export function createMemorySharedMemoryStore(): SharedMemoryStore {
  const rows = new Map<string, AssistantMemory>();

  return {
    async listByOwner(ownerAddress, limit) {
      const owned = [...rows.values()]
        .filter((row) => row.ownerAddress === ownerAddress)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(clone);
      return typeof limit === "number" ? owned.slice(0, limit) : owned;
    },
    async findByOwnerId(ownerAddress, id) {
      const row = rows.get(id);
      return row?.ownerAddress === ownerAddress ? clone(row) : null;
    },
    async findByOwnerRequestId(ownerAddress, requestId) {
      const row = [...rows.values()].find(
        (entry) => entry.ownerAddress === ownerAddress && entry.requestId === requestId,
      );
      return row ? clone(row) : null;
    },
    async findByOwnerLabel(ownerAddress, normalizedLabel) {
      const row = [...rows.values()].find(
        (entry) => entry.ownerAddress === ownerAddress && entry.normalizedLabel === normalizedLabel,
      );
      return row ? clone(row) : null;
    },
    async insert(row) {
      if (
        [...rows.values()].some(
          (entry) =>
            entry.ownerAddress === row.ownerAddress &&
            (entry.requestId === row.requestId || entry.normalizedLabel === row.normalizedLabel),
        )
      ) {
        throw uniqueViolation();
      }
      const saved: AssistantMemory = {
        ...row,
        version: row.version ?? 1,
        createdAt: row.createdAt ?? new Date().toISOString(),
        updatedAt: row.updatedAt ?? new Date().toISOString(),
      };
      rows.set(saved.id, saved);
      return clone(saved);
    },
    async updateIfVersion(ownerAddress, id, expectedVersion, content) {
      const current = rows.get(id);
      if (
        !current ||
        current.ownerAddress !== ownerAddress ||
        current.version !== expectedVersion
      ) {
        return null;
      }
      if (
        [...rows.values()].some(
          (entry) =>
            entry.id !== id &&
            entry.ownerAddress === ownerAddress &&
            entry.normalizedLabel === content.normalizedLabel,
        )
      ) {
        throw uniqueViolation();
      }
      const updated: AssistantMemory = {
        ...current,
        ...content,
        version: expectedVersion + 1,
        updatedAt: new Date().toISOString(),
      };
      rows.set(id, updated);
      return clone(updated);
    },
    async deleteIfVersion(ownerAddress, id, expectedVersion) {
      const current = rows.get(id);
      if (
        !current ||
        current.ownerAddress !== ownerAddress ||
        current.version !== expectedVersion
      ) {
        return false;
      }
      return rows.delete(id);
    },
  };
}

export function createDrizzleSharedMemoryStore(db: DbClient): SharedMemoryStore {
  return {
    async listByOwner(ownerAddress, limit) {
      const query = db
        .select()
        .from(assistantMemories)
        .where(eq(assistantMemories.ownerAddress, ownerAddress))
        .orderBy(desc(assistantMemories.updatedAt), desc(assistantMemories.id));
      return typeof limit === "number" ? query.limit(limit) : query;
    },
    async findByOwnerId(ownerAddress, id) {
      const [row] = await db
        .select()
        .from(assistantMemories)
        .where(and(eq(assistantMemories.ownerAddress, ownerAddress), eq(assistantMemories.id, id)))
        .limit(1);
      return row ?? null;
    },
    async findByOwnerRequestId(ownerAddress, requestId) {
      const [row] = await db
        .select()
        .from(assistantMemories)
        .where(
          and(
            eq(assistantMemories.ownerAddress, ownerAddress),
            eq(assistantMemories.requestId, requestId),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async findByOwnerLabel(ownerAddress, normalizedLabel) {
      const [row] = await db
        .select()
        .from(assistantMemories)
        .where(
          and(
            eq(assistantMemories.ownerAddress, ownerAddress),
            eq(assistantMemories.normalizedLabel, normalizedLabel),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async insert(row) {
      const [saved] = await db.insert(assistantMemories).values(row).returning();
      if (!saved) throw new Error("Shared memory insert returned no row.");
      return saved;
    },
    async updateIfVersion(ownerAddress, id, expectedVersion, content) {
      const [updated] = await db
        .update(assistantMemories)
        .set({
          ...content,
          version: expectedVersion + 1,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(assistantMemories.ownerAddress, ownerAddress),
            eq(assistantMemories.id, id),
            eq(assistantMemories.version, expectedVersion),
          ),
        )
        .returning();
      return updated ?? null;
    },
    async deleteIfVersion(ownerAddress, id, expectedVersion) {
      const removed = await db
        .delete(assistantMemories)
        .where(
          and(
            eq(assistantMemories.ownerAddress, ownerAddress),
            eq(assistantMemories.id, id),
            eq(assistantMemories.version, expectedVersion),
          ),
        )
        .returning({ id: assistantMemories.id });
      return removed.length > 0;
    },
  };
}

export function isSharedMemoryUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isSharedMemoryUniqueViolation(error.cause);
}
