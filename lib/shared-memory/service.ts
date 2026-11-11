import "server-only";

import { getAddress, isAddress } from "viem";
import { randomUUID } from "node:crypto";
import type { AssistantMemory } from "@/lib/db/schema";
import {
  isSharedMemoryUniqueViolation,
  type SharedMemoryContent,
  type SharedMemoryStore,
} from "@/lib/shared-memory/repository";

export type SharedMemoryKind = "fact" | "preference";

export type SharedMemoryView = Pick<
  AssistantMemory,
  "id" | "kind" | "label" | "value" | "version" | "createdAt" | "updatedAt"
>;

export type SharedMemoryDraft = {
  requestId: string;
  kind: SharedMemoryKind;
  label: string;
  value: string;
};

export type SharedMemoryUpdate = {
  expectedVersion: number;
  kind: SharedMemoryKind;
  label: string;
  value: string;
};

export type PromptMemory = Pick<SharedMemoryContent, "kind" | "label" | "value">;

export class SharedMemoryError extends Error {
  constructor(
    readonly code:
      | "INVALID_OWNER"
      | "INVALID_MEMORY"
      | "DUPLICATE_LABEL"
      | "REQUEST_ID_REUSED"
      | "NOT_FOUND"
      | "STALE_VERSION",
    message: string,
  ) {
    super(message);
    this.name = "SharedMemoryError";
  }
}

const MAX_LABEL_CHARS = 48;
const MAX_VALUE_CHARS = 300;
const MAX_PROMPT_MEMORIES = 8;
const MAX_PROMPT_CHARS = 1_800;
const SENSITIVE_VALUE = /\b(?:private\s*key|seed\s*phrase|recovery\s*phrase|mnemonic|wallet\s*signature|SIWE\s*signature|API\s*key|password|bearer\s+token|authentication\s+token)\b|0x[a-f0-9]{40,}|\b[a-f0-9]{64}\b|\b[a-f0-9]{128,}\b/i;

function codePointLength(value: string): number {
  return [...value].length;
}

function requireOwner(ownerAddress: string): string {
  if (!isAddress(ownerAddress)) {
    throw new SharedMemoryError("INVALID_OWNER", "A verified wallet owner is required.");
  }
  return getAddress(ownerAddress);
}

function normalizeLabel(value: unknown): string {
  if (typeof value !== "string") {
    throw new SharedMemoryError("INVALID_MEMORY", "Add a short name for this memory.");
  }
  const label = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  const length = codePointLength(label);
  if (length < 1 || length > MAX_LABEL_CHARS) {
    throw new SharedMemoryError("INVALID_MEMORY", `The name must be 1 to ${MAX_LABEL_CHARS} characters.`);
  }
  return label;
}

function normalizeValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new SharedMemoryError("INVALID_MEMORY", "Add the fact or preference you want to remember.");
  }
  const normalized = value
    .normalize("NFKC")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const length = codePointLength(normalized);
  if (length < 1 || length > MAX_VALUE_CHARS) {
    throw new SharedMemoryError("INVALID_MEMORY", `The memory must be 1 to ${MAX_VALUE_CHARS} characters.`);
  }
  if (SENSITIVE_VALUE.test(`${label}\n${normalized}`)) {
    throw new SharedMemoryError(
      "INVALID_MEMORY",
      "Don’t save wallet keys, recovery phrases, signatures, passwords, API keys, or wallet addresses here.",
    );
  }
  return normalized;
}

async function assertSafeMemoryText(fields: readonly string[]): Promise<void> {
  const { containsBip39RecoveryPhrase } = await import("./recovery-phrase");
  if (containsBip39RecoveryPhrase(fields)) {
    throw new SharedMemoryError(
      "INVALID_MEMORY",
      "Don’t save wallet keys, recovery phrases, signatures, passwords, API keys, or wallet addresses here.",
    );
  }
}

function normalizeKind(value: unknown): SharedMemoryKind {
  if (value !== "fact" && value !== "preference") {
    throw new SharedMemoryError("INVALID_MEMORY", "Choose a fact or preference.");
  }
  return value;
}

function requireExpectedVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new SharedMemoryError("INVALID_MEMORY", "Refresh this memory before changing it.");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new SharedMemoryError("INVALID_MEMORY", "The memory request contains an unsupported field.");
  }
}

export function parseSharedMemoryDraft(value: unknown): SharedMemoryDraft {
  if (!isRecord(value)) {
    throw new SharedMemoryError("INVALID_MEMORY", "Enter a memory to save.");
  }
  requireOnlyKeys(value, ["requestId", "kind", "label", "value"]);
  const requestId = value.requestId;
  if (
    typeof requestId !== "string" ||
    requestId.length < 12 ||
    requestId.length > 128 ||
    !/^[a-zA-Z0-9_-]+$/.test(requestId)
  ) {
    throw new SharedMemoryError("INVALID_MEMORY", "Refresh the form and try saving again.");
  }
  const label = normalizeLabel(value.label);
  return {
    requestId,
    kind: normalizeKind(value.kind),
    label,
    value: normalizeValue(value.value, label),
  };
}

export function parseSharedMemoryUpdate(value: unknown): SharedMemoryUpdate {
  if (!isRecord(value)) {
    throw new SharedMemoryError("INVALID_MEMORY", "Enter the changes to save.");
  }
  requireOnlyKeys(value, ["expectedVersion", "kind", "label", "value"]);
  const label = normalizeLabel(value.label);
  return {
    expectedVersion: requireExpectedVersion(value.expectedVersion),
    kind: normalizeKind(value.kind),
    label,
    value: normalizeValue(value.value, label),
  };
}

export function parseSharedMemoryDelete(value: unknown): { expectedVersion: number } {
  if (!isRecord(value)) {
    throw new SharedMemoryError("INVALID_MEMORY", "Refresh this memory before deleting it.");
  }
  requireOnlyKeys(value, ["expectedVersion"]);
  return { expectedVersion: requireExpectedVersion(value.expectedVersion) };
}

function toView(row: AssistantMemory): SharedMemoryView {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    value: row.value,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function contentFrom(input: Pick<SharedMemoryDraft, "kind" | "label" | "value">): SharedMemoryContent {
  return {
    kind: input.kind,
    label: input.label,
    normalizedLabel: input.label.normalize("NFKC").toLowerCase(),
    value: input.value,
  };
}

function matchesDraft(row: AssistantMemory, draft: SharedMemoryDraft): boolean {
  const content = contentFrom(draft);
  return (
    row.kind === content.kind &&
    row.normalizedLabel === content.normalizedLabel &&
    row.value === content.value
  );
}

export async function listSharedMemories(
  store: SharedMemoryStore,
  ownerAddress: string,
): Promise<SharedMemoryView[]> {
  const owner = requireOwner(ownerAddress);
  return (await store.listByOwner(owner)).map(toView);
}

export async function createSharedMemory(
  store: SharedMemoryStore,
  ownerAddress: string,
  draft: SharedMemoryDraft,
): Promise<SharedMemoryView> {
  const owner = requireOwner(ownerAddress);
  await assertSafeMemoryText([draft.label, draft.value]);
  const content = contentFrom(draft);
  const existingRequest = await store.findByOwnerRequestId(owner, draft.requestId);
  if (existingRequest) {
    if (matchesDraft(existingRequest, draft)) return toView(existingRequest);
    throw new SharedMemoryError("REQUEST_ID_REUSED", "This save request was already used for another memory.");
  }
  if (await store.findByOwnerLabel(owner, content.normalizedLabel)) {
    throw new SharedMemoryError("DUPLICATE_LABEL", "A memory with this name already exists.");
  }

  const now = new Date().toISOString();
  try {
    return toView(await store.insert({
      id: `mem_${randomUUID()}`,
      ownerAddress: owner,
      requestId: draft.requestId,
      ...content,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }));
  } catch (error) {
    if (!isSharedMemoryUniqueViolation(error)) throw error;
    const racedRequest = await store.findByOwnerRequestId(owner, draft.requestId);
    if (racedRequest && matchesDraft(racedRequest, draft)) return toView(racedRequest);
    const duplicateLabel = await store.findByOwnerLabel(owner, content.normalizedLabel);
    if (duplicateLabel) {
      throw new SharedMemoryError("DUPLICATE_LABEL", "A memory with this name already exists.");
    }
    throw new SharedMemoryError("REQUEST_ID_REUSED", "This save request was already used for another memory.");
  }
}

export async function updateSharedMemory(
  store: SharedMemoryStore,
  ownerAddress: string,
  id: string,
  update: SharedMemoryUpdate,
): Promise<SharedMemoryView> {
  const owner = requireOwner(ownerAddress);
  await assertSafeMemoryText([update.label, update.value]);
  const current = await store.findByOwnerId(owner, id);
  if (!current) throw new SharedMemoryError("NOT_FOUND", "Memory not found.");
  const content = contentFrom(update);
  const sameContent =
    current.kind === content.kind &&
    current.normalizedLabel === content.normalizedLabel &&
    current.value === content.value;
  if (sameContent) return toView(current);
  try {
    const updated = await store.updateIfVersion(owner, id, update.expectedVersion, content);
    if (updated) return toView(updated);
    const latest = await store.findByOwnerId(owner, id);
    if (!latest) throw new SharedMemoryError("NOT_FOUND", "Memory not found.");
    const latestMatches =
      latest.kind === content.kind &&
      latest.normalizedLabel === content.normalizedLabel &&
      latest.value === content.value;
    if (latestMatches) return toView(latest);
    throw new SharedMemoryError("STALE_VERSION", "This memory changed elsewhere. Reload it before saving.");
  } catch (error) {
    if (isSharedMemoryUniqueViolation(error)) {
      throw new SharedMemoryError("DUPLICATE_LABEL", "A memory with this name already exists.");
    }
    throw error;
  }
}

export async function deleteSharedMemory(
  store: SharedMemoryStore,
  ownerAddress: string,
  id: string,
  expectedVersion: number,
): Promise<void> {
  const owner = requireOwner(ownerAddress);
  if (await store.deleteIfVersion(owner, id, expectedVersion)) return;
  const current = await store.findByOwnerId(owner, id);
  if (!current) return;
  if (current.version !== expectedVersion) {
    throw new SharedMemoryError("STALE_VERSION", "This memory changed elsewhere. Reload it before deleting.");
  }
}

export async function readPromptMemories(
  store: SharedMemoryStore,
  ownerAddress: string,
): Promise<PromptMemory[]> {
  const owner = requireOwner(ownerAddress);
  const rows = await store.listByOwner(owner, MAX_PROMPT_MEMORIES);
  const memories: PromptMemory[] = [];
  let usedChars = 2;
  for (const row of rows) {
    if (memories.length >= MAX_PROMPT_MEMORIES) break;
    const memory = { kind: row.kind, label: row.label, value: row.value };
    const size = JSON.stringify(memory).length + (memories.length === 0 ? 0 : 1);
    if (usedChars + size > MAX_PROMPT_CHARS) continue;
    memories.push(memory);
    usedChars += size;
  }
  return memories;
}
