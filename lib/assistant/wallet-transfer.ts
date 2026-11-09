/**
 * B6 — Deterministic wallet-transfer conversation handoff.
 *
 * Server-only. The model only ever produces candidate field values; every
 * decision here is recomputed from the sanitized draft, the verified session
 * owner, and the B1–B5 services:
 *
 * - recipient lookup goes through the B2 service (owner-scoped, chain-scoped);
 * - amounts/chain/assets go through the B3 service (exact, no floats);
 * - terms are snapshotted into an immutable B3 PaymentIntent;
 * - the assistant NEVER signs, broadcasts, approves, or marks anything paid.
 *
 * A textual "yes" confirms conversation state only. Preparing an intent is
 * not a transfer, and no handoff path calls submission or broadcast code.
 */

import "server-only";

import { getAddress, isAddress } from "viem";
import { isAffirmativeConfirmation } from "@/lib/assistant/resolve";
import {
  extractAddressCandidates,
  isWalletCancelMessage,
  walletMissingFields,
  type WalletMissingField,
} from "@/lib/assistant/validation";
import type {
  WalletTransferAction,
  WalletTransferAsset,
  WalletTransferChainId,
  WalletTransferIntent,
} from "@/lib/assistant/types";
import {
  changeRecipientAddress,
  resolveRecipient,
  saveRecipient,
  RecipientError,
} from "@/lib/recipients/service";
import type { RecipientStore } from "@/lib/recipients/repository";
import {
  cancelTransferIntent,
  checkIntentFreshness,
  getTransferIntent,
  prepareTransferIntent,
  TransferError,
} from "@/lib/transfers/service";
import { AmountError } from "@/lib/transfers/amounts";
import type { IntentStore } from "@/lib/transfers/repository";

export interface WalletHandoffInput {
  intentStore: IntentStore;
  recipientStore: RecipientStore;
  /** Verified SIWE session owner, or null when logged out. */
  ownerAddress: string | null;
  draft: WalletTransferIntent;
  userMessage: string;
  nowMs?: number;
}

export interface WalletHandoffResult {
  reply: string;
  /** Null clears the conversation draft (cancelled). */
  draft: WalletTransferIntent | null;
  action: WalletTransferAction | null;
}

const SAVE_NO_PATTERNS = /^(no|nope|no thanks|skip|dont save|don't save|do not save|not now|later)\.?$/i;

function chainName(chainId: WalletTransferChainId): string {
  return chainId === 677 ? "BOT Chain" : "BOT Chain Testnet";
}

function bindDraftOwner(
  draft: WalletTransferIntent,
  ownerAddress: string | null,
): WalletTransferIntent | { switched: true } {
  if (!ownerAddress) return draft;
  const owner = getAddress(ownerAddress);
  if (!draft.ownerAddress) return { ...draft, ownerAddress: owner };
  if (getAddress(draft.ownerAddress) !== owner) return { switched: true };
  return draft;
}

function missingQuestion(missing: WalletMissingField[]): string {
  const parts: string[] = [];
  if (missing.includes("recipient")) parts.push("who to pay");
  if (missing.includes("amount")) parts.push("how much");
  if (missing.includes("asset")) parts.push("which asset (BOT or USDT)");
  if (missing.includes("chain")) parts.push("which network (BOT Chain or BOT Chain Testnet)");
  return `To prepare this transfer I still need ${parts.join(", ")}.`;
}

export async function advanceWalletTransfer({
  intentStore,
  recipientStore,
  ownerAddress,
  draft,
  userMessage,
  nowMs,
}: WalletHandoffInput): Promise<WalletHandoffResult> {
  const now = nowMs ?? Date.now();
  const bound = bindDraftOwner(draft, ownerAddress);
  if ("switched" in bound) {
    return {
      reply: "You switched wallets, so I cleared the previous transfer draft. What would you like to do?",
      draft: null,
      action: { type: "cancelled" },
    };
  }
  let working: WalletTransferIntent = bound;

  if (isWalletCancelMessage(userMessage)) {
    if (ownerAddress && working.preparedIntentId) {
      try {
        await cancelTransferIntent(intentStore, { ownerAddress, id: working.preparedIntentId, nowMs: now });
      } catch (error) {
        if (!(error instanceof TransferError) || (error.code !== "NOT_FOUND" && error.code !== "INTENT_ALREADY_CANCELLED")) throw error;
      }
    }
    return {
      reply: "Payment draft cancelled. A transaction already approved in your wallet can still settle. Recheck its recorded status.",
      draft: null,
      action: { type: "cancelled" },
    };
  }

  if (!ownerAddress) {
    return {
      reply: "To look up recipients and prepare this transfer, connect your wallet first. Your draft is saved: just say the word once connected.",
      draft: working,
      action: { type: "ask_missing_details", missingFields: ["wallet_connection"] },
    };
  }
  const owner = getAddress(ownerAddress);

  // A freshly pasted address always wins, except when it amends a saved
  // recipient pending confirmation — that edit path below performs the
  // version-checked B2 update instead of downgrading to stated.
  const typedNow = extractAddressCandidates(userMessage);
  const currentAddr = working.recipientAddress ? getAddress(working.recipientAddress) : null;
  if (typedNow.length > 0 && typedNow[0] !== currentAddr && working.addressSource !== "saved") {
    const withAddress: WalletTransferIntent = {
      ...working,
      recipientAddress: typedNow[0],
      addressSource: "stated",
      recipientConfirmed: true,
      savedRecipientVersion: undefined,
      preparedIntentId: undefined,
    };
    const missing = walletMissingFields({
      recipientLabel: withAddress.recipientLabel,
      amount: withAddress.amount,
      asset: withAddress.asset,
      chainId: withAddress.chainId,
      recipientAddress: withAddress.recipientAddress,
    });
    working = {
      ...withAddress,
      missingFields: missing,
      readyForConfirmation: missing.length === 0,
      phase: "awaiting_save_decision",
    };
  }

  // Terms still missing (label, amount, asset, or network): ask, no DB reads.
  const missingTerms = working.missingFields.filter((f) => f !== "address");
  if (missingTerms.length > 0) {
    return {
      reply: missingQuestion(missingTerms as WalletMissingField[]),
      draft: working,
      action: { type: "ask_missing_details", missingFields: missingTerms },
    };
  }
  const chainId = working.chainId as WalletTransferChainId;
  const label = working.recipientLabel as string;

  // No address yet: resolve the saved recipient for this owner + chain.
  if (!working.recipientAddress) {
    let saved: Awaited<ReturnType<typeof resolveRecipient>> | null = null;
    try {
      saved = await resolveRecipient(recipientStore, {
        ownerAddress: owner,
        label,
        chainId,
      });
    } catch (err) {
      if (!(err instanceof RecipientError) || err.code !== "NOT_FOUND") throw err;
      saved = null;
    }
    if (saved) {
      const confirmed: WalletTransferIntent = {
        ...working,
        recipientAddress: saved.address,
        addressSource: "saved",
        recipientConfirmed: false,
        savedRecipientVersion: saved.version,
        missingFields: [],
        readyForConfirmation: false,
        phase: "awaiting_recipient_confirmation",
      };
      return {
        reply: `I found ${saved.label} in your ${chainName(chainId)} recipients. Saved address:\n${saved.address}\nWould you like to use this address? Reply yes to use it, edit to change it, or cancel.`,
        draft: confirmed,
        action: {
          type: "confirm_recipient",
          recipientLabel: saved.label,
          recipientAddress: saved.address,
          saved: true,
          chainId,
        },
      };
    }
    return {
      reply: `I don't have a ${chainName(chainId)} wallet address saved for ${label} yet. What's his address? Paste the full 0x address.`,
      draft: { ...working, phase: "awaiting_address" },
      action: { type: "ask_recipient_address", recipientLabel: label },
    };
  }

  const address = getAddress(working.recipientAddress);

  // Saved address shown but not yet confirmed: explicit yes uses it.
  if (working.addressSource === "saved" && !working.recipientConfirmed) {
    const typed = extractAddressCandidates(userMessage);
    if (typed.length > 0 && typed[0] !== address) {
      return editToAddress(intentStore, recipientStore, owner, working, typed[0], now);
    }
    if (isAffirmativeConfirmation(userMessage)) {
      const withConfirm: WalletTransferIntent = {
        ...working,
        recipientConfirmed: true,
        phase: "awaiting_payment_review",
      };
      return prepareReview(intentStore, recipientStore, owner, withConfirm, now);
    }
    return {
      reply: `Just to confirm: use ${address} for ${label} on ${chainName(chainId)}? Reply yes to use it, edit to change it, or cancel.`,
      draft: working,
      action: {
        type: "confirm_recipient",
        recipientLabel: label,
        recipientAddress: address,
        saved: true,
        chainId,
      },
    };
  }

  // Stated address, save decision pending: explicit yes saves, explicit no skips.
  if (
    working.addressSource === "stated" &&
    working.recipientConfirmed &&
    !working.preparedIntentId
  ) {
    const typed = extractAddressCandidates(userMessage);
    if (typed.length > 0 && typed[0] !== address) {
      return editToAddress(intentStore, recipientStore, owner, working, typed[0], now);
    }
    if (isAffirmativeConfirmation(userMessage) || /^(?:yes[, ]+)?(?:please )?save(?: (?:it|this address|for future payments|for next time))?[.!]?$/i.test(userMessage.trim())) {
      try {
        const saved = await saveRecipient(recipientStore, {
          ownerAddress: owner,
          label,
          chainId,
          address,
        });
        const withSave: WalletTransferIntent = {
          ...working,
          addressSource: "saved",
          savedRecipientVersion: saved.version,
          phase: "awaiting_payment_review",
        };
        return prepareReview(intentStore, recipientStore, owner, withSave, now);
      } catch (err) {
        if (err instanceof RecipientError && err.code === "DUPLICATE_LABEL") {
          // Already saved (e.g. other tab): resolve and continue as saved.
          const existing = await resolveRecipient(recipientStore, { ownerAddress: owner, label, chainId });
          const withSave: WalletTransferIntent = {
            ...working,
            recipientAddress: existing.address,
            addressSource: "saved",
            savedRecipientVersion: existing.version,
            phase: "awaiting_payment_review",
          };
          return prepareReview(intentStore, recipientStore, owner, withSave, now);
        }
        throw err;
      }
    }
    if (SAVE_NO_PATTERNS.test(userMessage.trim())) {
      return prepareReview(intentStore, recipientStore, owner, working, now);
    }
    return {
      reply: `Address for ${label} on ${chainName(chainId)}:\n${address}\nWould you like me to save it as ${label} for next time? Reply yes to save or no to continue without saving.`,
      draft: { ...working, phase: "awaiting_save_decision" },
      action: {
        type: "offer_save_recipient",
        recipientLabel: label,
        recipientAddress: address,
        chainId,
      },
    };
  }

  // Stated address not yet confirmed (e.g. forged draft): ask, never prepare.
  if (working.addressSource !== "saved" && !working.recipientConfirmed) {
    return {
      reply: `Use ${address} for ${label} on ${chainName(chainId)}? Reply yes to use it, edit to change it, or cancel.`,
      draft: working,
      action: {
        type: "confirm_recipient",
        recipientLabel: label,
        recipientAddress: address,
        saved: false,
        chainId,
      },
    };
  }

  // Review / ready states: re-validate freshness, then report review.
  return prepareReview(intentStore, recipientStore, owner, working, now);
}

/** Explicit address edit: version-checked B2 update, draft rebinding, fresh terms. */
async function editToAddress(
  intentStore: IntentStore,
  recipientStore: RecipientStore,
  owner: string,
  draft: WalletTransferIntent,
  newAddress: string,
  now: number,
): Promise<WalletHandoffResult> {
  const label = draft.recipientLabel as string;
  const chainId = draft.chainId as WalletTransferChainId;
  if (draft.addressSource !== "saved" || draft.savedRecipientVersion === undefined) {
    const edited: WalletTransferIntent = {
      ...draft,
      recipientAddress: newAddress,
      addressSource: "stated",
      recipientConfirmed: true,
      savedRecipientVersion: undefined,
      preparedIntentId: undefined,
      readyForConfirmation: false,
      phase: "awaiting_save_decision",
    };
    return {
      reply: `Updated address for ${label} on ${chainName(chainId)}:\n${newAddress}\nWould you like me to save it? Reply yes to save or no to continue without saving.`,
      draft: edited,
      action: { type: "offer_save_recipient", recipientLabel: label, recipientAddress: newAddress, chainId },
    };
  }
  try {
    const updated = await changeRecipientAddress(recipientStore, {
      ownerAddress: owner,
      id: (await resolveRecipient(recipientStore, { ownerAddress: owner, label, chainId })).id,
      newAddress,
      expectedVersion: draft.savedRecipientVersion,
    });
    const edited: WalletTransferIntent = {
      ...draft,
      recipientAddress: updated.address,
      recipientConfirmed: true,
      savedRecipientVersion: updated.version,
      preparedIntentId: undefined,
      readyForConfirmation: false,
      phase: "awaiting_payment_review",
    };
    return prepareReview(intentStore, recipientStore, owner, edited, now);
  } catch (err) {
    if (err instanceof RecipientError && (err.code === "STALE_VERSION" || err.code === "NOT_FOUND")) {
      const cleared: WalletTransferIntent = {
        ...draft,
        recipientAddress: undefined,
        addressSource: null,
        recipientConfirmed: false,
        savedRecipientVersion: undefined,
        preparedIntentId: undefined,
        missingFields: ["address"],
        readyForConfirmation: false,
        phase: "awaiting_address",
      };
      return {
        reply: `That saved recipient changed since we started, so I dropped the old address rather than guess. What's the correct ${chainName(chainId)} address for ${label}?`,
        draft: cleared,
        action: { type: "ask_recipient_address", recipientLabel: label },
      };
    }
    throw err;
  }
}

/**
 * Deterministic handoff: resolves the current saved version, validates terms
 * through the B3 service, snapshots them into an immutable PaymentIntent, and
 * returns a human-reviewable summary. Never approves, never submits.
 */
async function prepareReview(
  intentStore: IntentStore,
  recipientStore: RecipientStore,
  owner: string,
  draft: WalletTransferIntent,
  now: number,
): Promise<WalletHandoffResult> {
  const label = draft.recipientLabel as string;
  const amount = draft.amount as string;
  const asset = draft.asset as WalletTransferAsset;
  const chainId = draft.chainId as WalletTransferChainId;

  if (!draft.recipientConfirmed || !draft.recipientAddress) {
    const ask: WalletTransferIntent = {
      ...draft, missingFields: ["address"], readyForConfirmation: false, phase: "awaiting_address",
    };
    return {
      reply: `Before I prepare anything: use ${draft.recipientAddress ?? "which address"} for ${label} on ${chainName(chainId)}? Reply yes to confirm, or paste a different address.`,
      draft: ask,
      action: { type: "ask_recipient_address", recipientLabel: label },
    };
  }

  // Reuse an already-prepared intent when terms are unchanged and fresh.
  if (draft.preparedIntentId) {
    try {
      const existing = await getTransferIntent(intentStore, { ownerAddress: owner, id: draft.preparedIntentId, nowMs: now });
      if (Date.parse(existing.intent.expiresAt) > now) {
        const freshness = await checkIntentFreshness(intentStore, recipientStore, {
          ownerAddress: owner, id: draft.preparedIntentId, nowMs: now,
        });
        if (freshness.freshness.fresh) {
          return reviewResult(existing.intent, draft, true);
        }
      }
    } catch {
      // Fall through: prepare fresh terms below.
    }
  }

  let recipient: { type: "saved"; label: string } | { type: "unsaved"; label: string; address: string };
  if (draft.addressSource === "saved") {
    // Re-resolve the authoritative version at preparation time: the snapshot
    // pins the version the user confirmed, and any drift fails loudly.
    let current;
    try {
      current = await resolveRecipient(recipientStore, { ownerAddress: owner, label, chainId });
    } catch (err) {
      if (err instanceof RecipientError && err.code === "NOT_FOUND") {
        const cleared: WalletTransferIntent = {
          ...draft,
          recipientAddress: undefined,
          addressSource: null,
          recipientConfirmed: false,
          savedRecipientVersion: undefined,
          preparedIntentId: undefined,
          missingFields: ["address"],
          readyForConfirmation: false,
          phase: "awaiting_address",
        };
        return {
          reply: `${label} is no longer saved on ${chainName(chainId)}. What's the correct address?`,
          draft: cleared,
          action: { type: "ask_recipient_address", recipientLabel: label },
        };
      }
      throw err;
    }
    if (draft.savedRecipientVersion !== undefined && current.version !== draft.savedRecipientVersion) {
      const reconfirm: WalletTransferIntent = {
        ...draft,
        recipientAddress: current.address,
        savedRecipientVersion: current.version,
        recipientConfirmed: false,
        preparedIntentId: undefined,
        readyForConfirmation: false,
        phase: "awaiting_recipient_confirmation",
      };
      return {
        reply: `The saved address for ${label} changed since we started. Current saved address:\n${current.address}\nWould you like to use this address? Reply yes to use it, edit to change it, or cancel.`,
        draft: reconfirm,
        action: {
          type: "confirm_recipient",
          recipientLabel: label,
          recipientAddress: current.address,
          saved: true,
          chainId,
        },
      };
    }
    recipient = { type: "saved", label };
  } else {
    if (!draft.recipientAddress || !isAddress(draft.recipientAddress)) {
      const cleared: WalletTransferIntent = {
        ...draft, missingFields: ["address"], readyForConfirmation: false, phase: "awaiting_address",
      };
      return {
        reply: `I need a valid ${chainName(chainId)} address for ${label}. What's the full 0x address?`,
        draft: cleared,
        action: { type: "ask_recipient_address", recipientLabel: label },
      };
    }
    recipient = { type: "unsaved", label, address: getAddress(draft.recipientAddress) };
  }

  try {
    const prepared = await prepareTransferIntent(intentStore, recipientStore, {
      ownerAddress: owner,
      recipient,
      chainId,
      asset,
      amount,
      nowMs: now,
    });
    const ready: WalletTransferIntent = {
      ...draft,
      recipientAddress: prepared.intent.recipientAddress,
      addressSource: prepared.intent.recipientSource === "saved" ? "saved" : "stated",
      recipientConfirmed: true,
      savedRecipientVersion: prepared.intent.savedRecipientVersion ?? draft.savedRecipientVersion,
      preparedIntentId: prepared.intent.id,
      missingFields: [],
      readyForConfirmation: true,
      phase: "ready_for_wallet_authorization",
      unsupportedReason: undefined,
    };
    return reviewResult(prepared.intent, ready, false);
  } catch (err) {
    if (err instanceof TransferError || err instanceof AmountError) {
      const code = err.code;
      if (code === "UNSUPPORTED_ASSET" || code === "UNSUPPORTED_CHAIN" || code === "CELO_WALLET_TRANSFER_UNSUPPORTED") {
        const rejected: WalletTransferIntent = { ...draft, unsupportedReason: err.message, phase: "collecting" };
        return {
          reply: `${err.message} I support native BOT and USDT on BOT Chain, and native test BOT on BOT Chain Testnet. What would you like to change?`,
          draft: rejected,
          action: { type: "reject_unsupported_request", reason: err.message },
        };
      }
      if (code === "ZERO_AMOUNT" || code === "INVALID_AMOUNT" || code === "EXCESS_PRECISION" || code === "AMOUNT_TOO_LARGE") {
        const retry: WalletTransferIntent = { ...draft, amount: undefined, missingFields: ["amount"], readyForConfirmation: false, preparedIntentId: undefined, phase: "collecting" };
        return {
          reply: `That amount doesn't work: ${err.message} How much should I prepare?`,
          draft: retry,
          action: { type: "ask_missing_details", missingFields: ["amount"] },
        };
      }
      if (code === "NOT_FOUND") {
        const cleared: WalletTransferIntent = {
          ...draft,
          recipientAddress: undefined,
          addressSource: null,
          recipientConfirmed: false,
          savedRecipientVersion: undefined,
          preparedIntentId: undefined,
          missingFields: ["address"],
          readyForConfirmation: false,
          phase: "awaiting_address",
        };
        return {
          reply: `I couldn't find ${label} on ${chainName(chainId)} anymore. What's the correct address?`,
          draft: cleared,
          action: { type: "ask_recipient_address", recipientLabel: label },
        };
      }
    }
    if (err instanceof RecipientError && err.code === "NOT_FOUND") {
      const cleared: WalletTransferIntent = {
        ...draft,
        recipientAddress: undefined,
        addressSource: null,
        recipientConfirmed: false,
        savedRecipientVersion: undefined,
        preparedIntentId: undefined,
        missingFields: ["address"],
        readyForConfirmation: false,
        phase: "awaiting_address",
      };
      return {
        reply: `I couldn't find ${label} on ${chainName(chainId)} anymore. What's the correct address?`,
        draft: cleared,
        action: { type: "ask_recipient_address", recipientLabel: label },
      };
    }
    throw err;
  }
}

function reviewResult(
  intent: {
    id: string;
    recipientLabel: string;
    recipientAddress: string;
    chainId: number;
    environment: string;
    assetSymbol: string;
    tokenAddress: string | null;
    amountDisplay: string;
    amountBaseUnits: string;
    expiresAt: string;
    recipientSource: string;
    savedRecipientVersion: number | null;
  },
  draft: WalletTransferIntent,
  reused: boolean,
): WalletHandoffResult {
  const chainLabel = intent.chainId === 677 ? "BOT Chain (677)" : "BOT Chain Testnet (968)";
  const lines = [
    `${reused ? "Still ready" : "Ready"} for wallet review — nothing has been sent or approved:`,
    `Pay ${intent.recipientLabel} (${intent.recipientSource === "saved" ? "saved" : "unsaved"})`,
    `To: ${intent.recipientAddress}`,
    `Network: ${chainLabel}`,
    `Asset: ${intent.assetSymbol}${intent.tokenAddress ? ` (${intent.tokenAddress})` : " (native)"}`,
    `Amount: ${intent.amountDisplay} (${intent.amountBaseUnits} base units)`,
    `Intent: ${intent.id}${intent.savedRecipientVersion !== null && intent.savedRecipientVersion !== undefined ? ` (recipient v${intent.savedRecipientVersion})` : ""}`,
    `Expires: ${intent.expiresAt}`,
    `To complete this you'll approve it in your own wallet. Reply with changes anytime, or cancel to stop.`,
  ];
  return {
    reply: lines.join("\n"),
    draft,
    action: {
      type: "prepared_payment_intent",
      preparedIntentId: intent.id,
      recipientLabel: intent.recipientLabel,
      recipientAddress: intent.recipientAddress,
      chainId: intent.chainId,
      asset: intent.assetSymbol,
      amountDisplay: intent.amountDisplay,
      amountBaseUnits: intent.amountBaseUnits,
      expiresAt: intent.expiresAt,
      saved: intent.recipientSource === "saved",
    },
  };
}
