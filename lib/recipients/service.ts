/**
 * B2 — Trusted recipient operations. Backend only, no AI, no transfers.
 *
 * Every operation takes the authenticated `ownerAddress` explicitly; routes
 * must derive it from the verified wallet session, NEVER from request data.
 * Reads and mutations are ownership-checked, so one wallet can never see or
 * mutate another wallet's recipients (unknown IDs and foreign IDs both return
 * NOT_FOUND — no owner leakage).
 *
 * Chain isolation: resolution is always (owner, normalized label, chainId).
 * The same label on different chains holds independent addresses.
 */

import { randomUUID } from "node:crypto";
import { getAddress, isAddress, type Address } from "viem";
import { getChainById } from "@/lib/chains/registry";
import { truncateAddress } from "@/lib/wallet/format";
import type { SavedRecipient } from "@/lib/db/schema";
import type { RecipientStore } from "@/lib/recipients/repository";

export type RecipientErrorCode =
  | "NOT_AUTHENTICATED"
  | "NOT_FOUND"
  | "INVALID_LABEL"
  | "INVALID_ADDRESS"
  | "UNSUPPORTED_CHAIN"
  | "DUPLICATE_LABEL"
  | "STALE_VERSION";

export class RecipientError extends Error {
  readonly code: RecipientErrorCode;
  constructor(code: RecipientErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export const RECIPIENT_TYPE_WALLET = "wallet" as const;
const MAX_LABEL_CHARS = 64;

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Canonical label form for duplicate detection and chain-scoped resolution.
 * Unicode-normalized, trimmed, inner whitespace collapsed, lowercased.
 * Display `label` is preserved separately — normalization never rewrites it.
 */
export function normalizeRecipientLabel(value: unknown): string {
  if (typeof value !== "string") {
    throw new RecipientError("INVALID_LABEL", "Recipient label must be a string.");
  }
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) {
    throw new RecipientError("INVALID_LABEL", "Recipient label must not be empty.");
  }
  if (normalized.length > MAX_LABEL_CHARS) {
    throw new RecipientError(
      "INVALID_LABEL",
      `Recipient label must be ${MAX_LABEL_CHARS} characters or fewer.`,
    );
  }
  return normalized;
}

function requireOwner(ownerAddress: string): Address {
  if (!ownerAddress || !isAddress(ownerAddress)) {
    throw new RecipientError("NOT_AUTHENTICATED", "A verified wallet session is required.");
  }
  return getAddress(ownerAddress);
}

function requireSupportedChain(chainId: unknown): number {
  if (typeof chainId !== "number" || !Number.isInteger(chainId) || getChainById(chainId) === null) {
    throw new RecipientError("UNSUPPORTED_CHAIN", "Chain ID is not supported.");
  }
  return chainId;
}

function requireWalletAddress(address: unknown): Address {
  if (typeof address !== "string" || !isAddress(address)) {
    throw new RecipientError("INVALID_ADDRESS", "Recipient wallet address is invalid.");
  }
  return getAddress(address);
}

function isDuplicateError(err: unknown): boolean {
  if (err instanceof RecipientError && err.code === "DUPLICATE_LABEL") return true;
  const code = (err as NodeJS.ErrnoException | null)?.code;
  // Postgres unique violation from the partial unique index (race safety).
  return code === "23505" || code === "DUPLICATE_LABEL";
}

export type RecipientView = SavedRecipient;

export type RecipientSummary = {
  id: string;
  label: string;
  chainId: number;
  /** Masked for compact display; full address only in the owner confirmation view. */
  maskedAddress: string;
  version: number;
};

/** Compact list display — never exposes full addresses in bulk. */
export function toRecipientSummary(recipient: SavedRecipient): RecipientSummary {
  return {
    id: recipient.id,
    label: recipient.label,
    chainId: recipient.chainId,
    maskedAddress: truncateAddress(recipient.address),
    version: recipient.version,
  };
}

/* -------------------------------------------------------------------------- */
/* Operations                                                                 */
/* -------------------------------------------------------------------------- */

export async function saveRecipient(
  store: RecipientStore,
  args: { ownerAddress: string; label: unknown; chainId: unknown; address: unknown },
): Promise<RecipientView> {
  const owner = requireOwner(args.ownerAddress);
  const chainId = requireSupportedChain(args.chainId);
  const walletAddress = requireWalletAddress(args.address);
  const normalized = normalizeRecipientLabel(args.label);
  const label = (args.label as string).normalize("NFKC").trim().replace(/\s+/g, " ");
  const at = nowIso();

  const existing = await store.findActiveByOwnerLabelChain(owner, normalized, chainId);
  if (existing) {
    throw new RecipientError("DUPLICATE_LABEL", "A recipient with this label already exists on this chain.");
  }
  try {
    const saved = await store.insertRecipient({
      id: newId("rcp"),
      ownerAddress: owner,
      label,
      normalizedLabel: normalized,
      recipientType: RECIPIENT_TYPE_WALLET,
      chainId,
      address: walletAddress,
      version: 1,
      isActive: true,
      createdAt: at,
      updatedAt: at,
    });
    await store.insertAudit({
      id: newId("rcpa"),
      recipientId: saved.id,
      ownerAddress: owner,
      chainId,
      oldAddress: null,
      newAddress: walletAddress,
      oldVersion: 0,
      newVersion: 1,
      reason: "create",
      createdAt: at,
    });
    return saved;
  } catch (err) {
    if (isDuplicateError(err)) {
      throw new RecipientError("DUPLICATE_LABEL", "A recipient with this label already exists on this chain.");
    }
    throw err;
  }
}

export async function listRecipients(
  store: RecipientStore,
  ownerAddress: string,
): Promise<RecipientView[]> {
  const owner = requireOwner(ownerAddress);
  return store.listActiveByOwner(owner);
}

export async function getRecipient(
  store: RecipientStore,
  args: { ownerAddress: string; id: string },
): Promise<RecipientView> {
  const owner = requireOwner(args.ownerAddress);
  const row = await store.findRecipientById(args.id);
  // Foreign or missing IDs are indistinguishable: no owner leakage.
  if (!row || !row.isActive || row.ownerAddress !== owner) {
    throw new RecipientError("NOT_FOUND", "Recipient not found.");
  }
  return row;
}

/** Chain-scoped resolution for the returning-user payment flow. */
export async function resolveRecipient(
  store: RecipientStore,
  args: { ownerAddress: string; label: unknown; chainId: unknown },
): Promise<RecipientView> {
  const owner = requireOwner(args.ownerAddress);
  const chainId = requireSupportedChain(args.chainId);
  const normalized = normalizeRecipientLabel(args.label);
  const row = await store.findActiveByOwnerLabelChain(owner, normalized, chainId);
  if (!row) {
    throw new RecipientError("NOT_FOUND", "No saved recipient with this label on this chain.");
  }
  return row;
}

export async function renameRecipient(
  store: RecipientStore,
  args: { ownerAddress: string; id: string; newLabel: unknown; expectedVersion: number },
): Promise<RecipientView> {
  const current = await getRecipient(store, { ownerAddress: args.ownerAddress, id: args.id });
  if (args.expectedVersion !== current.version) {
    throw new RecipientError("STALE_VERSION", "Recipient changed since you last read it. Refresh and retry.");
  }
  const normalized = normalizeRecipientLabel(args.newLabel);
  const label = (args.newLabel as string).normalize("NFKC").trim().replace(/\s+/g, " ");
  if (normalized === current.normalizedLabel) return current;
  try {
    const next = await store.updateRecipient(current.id, {
      label,
      normalizedLabel: normalized,
      version: current.version + 1,
      updatedAt: nowIso(),
    });
    if (!next) throw new RecipientError("NOT_FOUND", "Recipient not found.");
    return next;
  } catch (err) {
    if (isDuplicateError(err)) {
      throw new RecipientError("DUPLICATE_LABEL", "A recipient with this label already exists on this chain.");
    }
    throw err;
  }
}

/**
 * Authenticated address change with optimistic concurrency. The old
 * (id, version, address) tuple stays in the audit trail, and B3 payment
 * intents must snapshot rather than live-read — snapshots are never rewritten.
 */
export async function changeRecipientAddress(
  store: RecipientStore,
  args: { ownerAddress: string; id: string; newAddress: unknown; expectedVersion: number },
): Promise<RecipientView> {
  const current = await getRecipient(store, { ownerAddress: args.ownerAddress, id: args.id });
  if (args.expectedVersion !== current.version) {
    throw new RecipientError("STALE_VERSION", "Recipient changed since you last read it. Refresh and retry.");
  }
  const walletAddress = requireWalletAddress(args.newAddress);
  if (walletAddress === current.address) return current;
  const at = nowIso();
  const next = await store.updateRecipient(current.id, {
    address: walletAddress,
    version: current.version + 1,
    updatedAt: at,
  });
  if (!next) throw new RecipientError("NOT_FOUND", "Recipient not found.");
  await store.insertAudit({
    id: newId("rcpa"),
    recipientId: next.id,
    ownerAddress: next.ownerAddress,
    chainId: next.chainId,
    oldAddress: current.address,
    newAddress: walletAddress,
    oldVersion: current.version,
    newVersion: next.version,
    reason: "address_change",
    createdAt: at,
  });
  return next;
}

export async function removeRecipient(
  store: RecipientStore,
  args: { ownerAddress: string; id: string },
): Promise<{ id: string; deleted: true }> {
  const current = await getRecipient(store, { ownerAddress: args.ownerAddress, id: args.id });
  const at = nowIso();
  await store.updateRecipient(current.id, {
    isActive: false,
    deletedAt: at,
    updatedAt: at,
  });
  await store.insertAudit({
    id: newId("rcpa"),
    recipientId: current.id,
    ownerAddress: current.ownerAddress,
    chainId: current.chainId,
    oldAddress: current.address,
    newAddress: null,
    oldVersion: current.version,
    newVersion: current.version,
    reason: "delete",
    createdAt: at,
  });
  return { id: current.id, deleted: true };
}

/** Ownership-checked audit history for a recipient. */
export async function getRecipientHistory(
  store: RecipientStore,
  args: { ownerAddress: string; id: string },
) {
  const current = await store.findRecipientById(args.id);
  const owner = requireOwner(args.ownerAddress);
  if (!current || current.ownerAddress !== owner) {
    throw new RecipientError("NOT_FOUND", "Recipient not found.");
  }
  return store.listAuditsByRecipient(args.id);
}
