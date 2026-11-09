/**
 * B3 — Deterministic wallet_transfer PaymentIntent domain.
 *
 * Preparation only: this module never signs, broadcasts, or executes anything.
 * Every intent binds owner + recipient + chain + asset + exact amount + expiry
 * under an immutable SHA-256 terms fingerprint. Saved recipients are snapshotted
 * (id + version + address); staleness is detected by version, never by address
 * alone. Changing any payment-critical field means preparing a NEW intent.
 *
 * Chain/asset authority comes from the B1 registry plus B1-verified USDT facts.
 * Celo mainnet keeps its Paycrest cash_out/airtime flows: wallet_transfer
 * preparation on Celo is rejected, not repurposed.
 */

import { createHash, randomUUID } from "node:crypto";
import { getAddress, isAddress, type Address } from "viem";
import {
  BOT_MAINNET_USDT,
  BOT_MAINNET_USDT_ADDRESS,
  getChainById,
} from "@/lib/chains/registry";
import {
  getRecipient,
  resolveRecipient,
  RecipientError,
} from "@/lib/recipients/service";
import type { RecipientStore } from "@/lib/recipients/repository";
import { truncateAddress } from "@/lib/wallet/format";
import { parseTransferAmount, AmountError } from "@/lib/transfers/amounts";
import type {
  IntentStore,
  WalletTransferIntent,
} from "@/lib/transfers/repository";

export type TransferErrorCode =
  | "NOT_AUTHENTICATED"
  | "NOT_FOUND"
  | "INVALID_LABEL"
  | "INVALID_ADDRESS"
  | "UNSUPPORTED_CHAIN"
  | "UNSUPPORTED_ASSET"
  | "CELO_WALLET_TRANSFER_UNSUPPORTED"
  | "INTENT_ALREADY_CANCELLED"
  | "IDEMPOTENCY_CONFLICT";

export class TransferError extends Error {
  readonly code: TransferErrorCode;
  constructor(code: TransferErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type TransferIntentStatus =
  | "pending"
  | "cancelled"
  | "approved"
  | "submitted"
  | "settled"
  | "failed";

export type ResolvedTransferAsset = {
  symbol: "BOT" | "USDT";
  kind: "native" | "erc20";
  /** Checksummed contract, or null for the native gas asset. */
  tokenAddress: Address | null;
  /** Verified on-chain decimals — never assumed. */
  decimals: number;
  environment: "mainnet" | "testnet";
};

export type RecipientInput =
  | { type: "saved"; label: string }
  | { type: "unsaved"; label?: string; address: string };

export const INTENT_TTL_MS = 15 * 60 * 1000;
const MAX_IDEMPOTENCY_KEY_CHARS = 64;

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function requireOwner(ownerAddress: string): Address {
  if (!ownerAddress || !isAddress(ownerAddress)) {
    throw new TransferError("NOT_AUTHENTICATED", "A verified wallet session is required.");
  }
  return getAddress(ownerAddress);
}

/**
 * Chain + asset capability gate. Symbol alone never implies support: every
 * branch pins the exact chain ID and, for USDT, the B1-verified contract and
 * decimals. The same address on BOT testnet is a different token (WES) and is
 * never accepted as USDT.
 */
export function resolveTransferAsset(chainId: unknown, symbol: unknown): ResolvedTransferAsset {
  const normalized = typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
  if (typeof chainId !== "number" || !Number.isInteger(chainId)) {
    throw new TransferError("UNSUPPORTED_CHAIN", "Chain ID is not supported.");
  }
  if (chainId === 42220) {
    throw new TransferError(
      "CELO_WALLET_TRANSFER_UNSUPPORTED",
      "Celo uses its existing cash-out and airtime flows; wallet transfers are not prepared on Celo.",
    );
  }
  if (chainId === 968) {
    if (normalized === "BOT") {
      return { symbol: "BOT", kind: "native", tokenAddress: null, decimals: 18, environment: "testnet" };
    }
    throw new TransferError(
      "UNSUPPORTED_ASSET",
      "Only native test BOT is supported on BOT testnet. USDT is not available there.",
    );
  }
  if (chainId === 677) {
    if (normalized === "BOT") {
      return { symbol: "BOT", kind: "native", tokenAddress: null, decimals: 18, environment: "mainnet" };
    }
    if (normalized === "USDT") {
      // Cross-checked against the B1-verified registry record.
      if (BOT_MAINNET_USDT.kind !== "erc20" || BOT_MAINNET_USDT.address === null) {
        throw new TransferError("UNSUPPORTED_ASSET", "USDT is not verified on BOT mainnet.");
      }
      return {
        symbol: "USDT",
        kind: "erc20",
        tokenAddress: getAddress(BOT_MAINNET_USDT_ADDRESS),
        decimals: BOT_MAINNET_USDT.decimals ?? 6,
        environment: "mainnet",
      };
    }
    throw new TransferError("UNSUPPORTED_ASSET", "Asset is not supported on BOT mainnet.");
  }
  if (getChainById(chainId) === null) {
    throw new TransferError("UNSUPPORTED_CHAIN", "Chain ID is not supported.");
  }
  throw new TransferError("UNSUPPORTED_ASSET", "Asset is not supported on this chain.");
}

export type ResolvedRecipient =
  | {
      source: "saved";
      savedRecipientId: string;
      savedRecipientVersion: number;
      address: Address;
      label: string;
    }
  | {
      source: "unsaved";
      savedRecipientId: null;
      savedRecipientVersion: null;
      address: Address;
      label: string;
    };

async function resolveIntentRecipient(
  recipientStore: RecipientStore,
  owner: Address,
  input: RecipientInput,
  chainId: number,
): Promise<ResolvedRecipient> {
  if (!input || typeof input !== "object" || (input.type !== "saved" && input.type !== "unsaved")) {
    throw new TransferError("INVALID_ADDRESS", "Recipient must be a saved label or an explicit wallet address.");
  }
  if (input.type === "saved") {
    try {
      const row = await resolveRecipient(recipientStore, {
        ownerAddress: owner,
        label: input.label,
        chainId,
      });
      return {
        source: "saved",
        savedRecipientId: row.id,
        savedRecipientVersion: row.version,
        address: getAddress(row.address),
        label: row.label,
      };
    } catch (err) {
      if (err instanceof RecipientError) {
        throw new TransferError(err.code as TransferErrorCode, err.message);
      }
      throw err;
    }
  }
  if (typeof input.address !== "string" || !isAddress(input.address)) {
    throw new TransferError("INVALID_ADDRESS", "Recipient wallet address is invalid.");
  }
  const address = getAddress(input.address);
  const label =
    typeof input.label === "string" && input.label.trim()
      ? input.label.trim().slice(0, 64)
      : truncateAddress(address);
  return { source: "unsaved", savedRecipientId: null, savedRecipientVersion: null, address, label };
}

/** Immutable binding of every payment-critical term. Any change → new intent. */
export function computeTermsFingerprint(args: {
  owner: string;
  chainId: number;
  assetKey: string;
  amountBaseUnits: string;
  recipientAddress: string;
  savedRecipientId: string | null;
  savedRecipientVersion: number | null;
  expiresAtIso: string;
}): string {
  const canonical = [
    "wallet_transfer/v1",
    args.owner,
    String(args.chainId),
    args.assetKey,
    args.amountBaseUnits,
    args.recipientAddress,
    args.savedRecipientId ?? "-",
    String(args.savedRecipientVersion ?? 0),
    args.expiresAtIso,
  ].join("\u001f");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function assetKeyFor(asset: ResolvedTransferAsset, chainId: number): string {
  return asset.tokenAddress ?? `native:${asset.symbol}:${chainId}`;
}

export type PrepareIntentArgs = {
  ownerAddress: string;
  recipient: RecipientInput;
  chainId: unknown;
  asset: unknown;
  amount: unknown;
  idempotencyKey?: unknown;
  nowMs?: number;
};

export type PreparedIntent = {
  intent: WalletTransferIntent;
  /** True when an identical earlier preparation was returned. */
  deduplicated: boolean;
  expired: boolean;
};

export async function prepareTransferIntent(
  intentStore: IntentStore,
  recipientStore: RecipientStore,
  args: PrepareIntentArgs,
): Promise<PreparedIntent> {
  const owner = requireOwner(args.ownerAddress);
  const nowMs = args.nowMs ?? Date.now();
  const chainId = args.chainId;
  if (typeof chainId !== "number" || !Number.isInteger(chainId)) {
    throw new TransferError("UNSUPPORTED_CHAIN", "Chain ID is not supported.");
  }
  const asset = resolveTransferAsset(chainId, args.asset);
  const parsed = parseTransferAmount(args.amount, asset.decimals);
  const recipient = await resolveIntentRecipient(recipientStore, owner, args.recipient, chainId);

  let idempotencyKey: string | null = null;
  if (args.idempotencyKey !== undefined && args.idempotencyKey !== null) {
    if (typeof args.idempotencyKey !== "string" || !args.idempotencyKey.trim()) {
      throw new TransferError("NOT_FOUND", "Idempotency key must be a non-empty string.");
    }
    if (args.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_CHARS) {
      throw new TransferError("NOT_FOUND", "Idempotency key is too long.");
    }
    idempotencyKey = args.idempotencyKey;
  }

  const atIso = new Date(nowMs).toISOString();
  const expiresAtIso = new Date(nowMs + INTENT_TTL_MS).toISOString();
  const fingerprint = computeTermsFingerprint({
    owner,
    chainId,
    assetKey: assetKeyFor(asset, chainId),
    amountBaseUnits: parsed.baseUnits.toString(),
    recipientAddress: recipient.address,
    savedRecipientId: recipient.savedRecipientId,
    savedRecipientVersion: recipient.savedRecipientVersion,
    expiresAtIso,
  });

  if (idempotencyKey) {
    const existing = await intentStore.findByOwnerIdempotencyKey(owner, idempotencyKey);
    if (existing) {
      if (existing.termsFingerprint !== fingerprint) {
        throw new TransferError(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was already used for different payment terms.",
        );
      }
      return { intent: existing, deduplicated: true, expired: Date.parse(existing.expiresAt) <= nowMs };
    }
  }

  // Client-controlled status is impossible: status is always 'pending' here.
  const intent = await intentStore.insertIntent({
    id: newId("wti"),
    ownerAddress: owner,
    recipientSource: recipient.source,
    savedRecipientId: recipient.savedRecipientId,
    savedRecipientVersion: recipient.savedRecipientVersion,
    recipientAddress: recipient.address,
    recipientLabel: recipient.label,
    chainId,
    environment: asset.environment,
    assetSymbol: asset.symbol,
    tokenAddress: asset.tokenAddress,
    assetDecimals: asset.decimals,
    amountDisplay: parsed.display,
    amountBaseUnits: parsed.baseUnits.toString(),
    status: "pending",
    approvalVersion: 1,
    termsFingerprint: fingerprint,
    idempotencyKey,
    createdAt: atIso,
    expiresAt: expiresAtIso,
    updatedAt: atIso,
  });
  return { intent, deduplicated: false, expired: false };
}

export type IntentFreshness =
  | { fresh: true; expired: false }
  | { fresh: false; expired: boolean; staleReason: "EXPIRED" | "RECIPIENT_REMOVED" | "RECIPIENT_VERSION_CHANGED" | "RECIPIENT_ADDRESS_CHANGED" };

/**
 * Freshness re-check for a pending intent. Saved-recipient staleness is
 * detected by VERSION first (address comparison is a secondary tripwire, never
 * the primary signal). Unsaved recipients have no version to go stale.
 */
export async function checkIntentFreshness(
  intentStore: IntentStore,
  recipientStore: RecipientStore,
  args: { ownerAddress: string; id: string; nowMs?: number },
): Promise<{ intent: WalletTransferIntent; expired: boolean; freshness: IntentFreshness }> {
  const owner = requireOwner(args.ownerAddress);
  const nowMs = args.nowMs ?? Date.now();
  const intent = await intentStore.findIntentById(args.id);
  if (!intent || intent.ownerAddress !== owner) {
    throw new TransferError("NOT_FOUND", "Payment intent not found.");
  }
  const expired = Date.parse(intent.expiresAt) <= nowMs;
  if (expired) {
    return { intent, expired: true, freshness: { fresh: false, expired: true, staleReason: "EXPIRED" } };
  }
  if (intent.recipientSource !== "saved" || !intent.savedRecipientId) {
    return { intent, expired: false, freshness: { fresh: true, expired: false } };
  }
  // NOTE: recipient reads go through the B2 service so ownership enforcement
  // stays in one place. Version is the primary staleness signal; the address
  // comparison below is a secondary tripwire only.
  let current;
  try {
    current = await getRecipient(recipientStore, { ownerAddress: owner, id: intent.savedRecipientId });
  } catch {
    return { intent, expired: false, freshness: { fresh: false, expired: false, staleReason: "RECIPIENT_REMOVED" } };
  }
  if (current.version !== intent.savedRecipientVersion) {
    return { intent, expired: false, freshness: { fresh: false, expired: false, staleReason: "RECIPIENT_VERSION_CHANGED" } };
  }
  if (getAddress(current.address) !== getAddress(intent.recipientAddress)) {
    return { intent, expired: false, freshness: { fresh: false, expired: false, staleReason: "RECIPIENT_ADDRESS_CHANGED" } };
  }
  return { intent, expired: false, freshness: { fresh: true, expired: false } };
}

export async function getTransferIntent(
  intentStore: IntentStore,
  args: { ownerAddress: string; id: string; nowMs?: number },
): Promise<{ intent: WalletTransferIntent; expired: boolean }> {
  const owner = requireOwner(args.ownerAddress);
  const intent = await intentStore.findIntentById(args.id);
  if (!intent || intent.ownerAddress !== owner) {
    throw new TransferError("NOT_FOUND", "Payment intent not found.");
  }
  return { intent, expired: Date.parse(intent.expiresAt) <= (args.nowMs ?? Date.now()) };
}

export async function listTransferIntents(
  intentStore: IntentStore,
  ownerAddress: string,
): Promise<WalletTransferIntent[]> {
  const owner = requireOwner(ownerAddress);
  return intentStore.listByOwner(owner);
}

export async function cancelTransferIntent(
  intentStore: IntentStore,
  args: { ownerAddress: string; id: string; nowMs?: number },
): Promise<WalletTransferIntent> {
  const owner = requireOwner(args.ownerAddress);
  const intent = await intentStore.findIntentById(args.id);
  if (!intent || intent.ownerAddress !== owner) {
    throw new TransferError("NOT_FOUND", "Payment intent not found.");
  }
  if (intent.status === "cancelled") return intent;
  if (intent.status !== "pending") {
    throw new TransferError("INTENT_ALREADY_CANCELLED", "Only pending intents can be cancelled.");
  }
  const atIso = new Date(args.nowMs ?? Date.now()).toISOString();
  const next = await intentStore.cancelPendingIntent(intent.id, atIso);
  if (!next) {
    throw new TransferError("NOT_FOUND", "Payment intent not found.");
  }
  return next;
}

export { AmountError };
