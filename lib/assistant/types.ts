/**
 * Client-safe contracts for the conversational assistant.
 *
 * This module intentionally contains types only. Server-only implementation
 * belongs in the sibling assistant modules and route handlers.
 */

import type { PaymentAssetSymbol } from "@/lib/celo/assets";
import type { ConversationMessageView } from "@/lib/conversations/types";

export type PaymentNetwork = "mtn" | "airtel" | "glo" | "9mobile";

export type UnsupportedIntentType =
  | "data"
  | "electricity"
  | "cable"
  | "unsupported";

export type PaymentIntentType = "airtime" | "wallet_transfer" | UnsupportedIntentType;

export interface AirtimeIntent {
  type: "airtime";
  amountNgn?: string;
  phone?: string;
  network?: PaymentNetwork;
  networkConfirmed: boolean;
  missingFields: string[];
  readyForConfirmation: boolean;
}

/**
 * B6 — Conversational wallet-transfer draft (BOT Chain).
 *
 * Interpretation-only state: the model proposes candidate field values, the
 * app re-derives everything, and money facts come exclusively from the B1–B5
 * services at handoff time. `recipientAddress` is accepted only when the user
 * typed it (deterministic extraction) or when it was read from the owner's
 * saved recipients — never from model invention. `ownerAddress` binds the
 * draft to the verified SIWE session; a wallet switch invalidates the draft.
 */
export type WalletTransferAsset = "BOT" | "USDT";
export type WalletTransferChainId = 677 | 968;
export type WalletTransferPhase =
  | "collecting"
  | "awaiting_address"
  | "awaiting_recipient_confirmation"
  | "awaiting_save_decision"
  | "awaiting_payment_review"
  | "ready_for_wallet_authorization"
  | "cancelled";

export interface WalletTransferIntent {
  type: "wallet_transfer";
  ownerAddress?: string;
  recipientLabel?: string;
  recipientAddress?: string;
  addressSource?: "stated" | "saved" | null;
  recipientConfirmed?: boolean;
  savedRecipientVersion?: number;
  amount?: string;
  asset?: WalletTransferAsset;
  chainId?: WalletTransferChainId;
  phase: WalletTransferPhase;
  missingFields: string[];
  readyForConfirmation: boolean;
  preparedIntentId?: string;
  unsupportedReason?: string;
}

export interface AirtimePreview {
  intentFingerprint: string;
  amountNgn: string;
  phone: string;
  network: PaymentNetwork;
  asset?: PaymentAssetSymbol;
  amountUsdc: string;
  feeUsdc: "0";
  totalUsdc: string;
  rate: string;
  quotedAt: string;
  expiresAt: string;
}

export interface ConfirmedAirtimePayment {
  amountNgn: string;
  phone: string;
  network: PaymentNetwork;
  asset?: PaymentAssetSymbol;
  amountUsdc: string;
  feeUsdc: "0";
  totalUsdc: string;
  rate: string;
  quotedAt: string;
  expiresAt: string;
  intentFingerprint: string;
}

export interface UnsupportedIntent {
  type: UnsupportedIntentType;
  missingFields: string[];
  readyForConfirmation: false;
}

export type PaymentIntent = AirtimeIntent | WalletTransferIntent | UnsupportedIntent;

export interface UserConversationMessage {
  role: "user";
  content: string;
  timestamp: string;
  id?: string;
  sessionId?: string;
  turnId?: string;
  sequence?: number;
  turnStatus?: "pending" | "complete" | "failed" | "superseded";
  failureCode?: "assistant_unavailable" | "invalid_output" | "rate_limited" | null;
  intent?: never;
}

export interface AssistantConversationMessage {
  role: "assistant";
  content: string;
  timestamp: string;
  id?: string;
  sessionId?: string;
  turnId?: string;
  sequence?: number;
  intent?: PaymentIntent;
}

export type ConversationMessage =
  | UserConversationMessage
  | AssistantConversationMessage;

export type ChatAssistantTurn = {
  kind: "chat";
  message: AssistantConversationMessage & { intent?: never };
  action?: WalletTransferAction | null;
};

export type PaymentIntentAssistantTurn = {
  kind: "payment_intent";
  message: AssistantConversationMessage & { intent: PaymentIntent };
  intent: PaymentIntent;
  action?: WalletTransferAction | null;
};

export type AssistantTurn = ChatAssistantTurn | PaymentIntentAssistantTurn;

export interface AssistantChatRequest {
  message: string;
  walletTransferOwner?: string | null;
  history: ConversationMessage[];
  activeIntent: PaymentIntent | null;
  sessionId?: string;
  turnId?: string;
}

export type AssistantApiErrorCode =
  | "INVALID_REQUEST"
  | "BODY_TOO_LARGE"
  | "RATE_LIMITED"
  | "ASSISTANT_NOT_CONFIGURED"
  | "MODEL_UNAVAILABLE"
  | "MODEL_INVALID_OUTPUT"
  | "STATUS_UNAVAILABLE"
  | "NOT_AUTHENTICATED"
  | "NOT_FOUND"
  | "STORAGE_UNAVAILABLE"
  | "TURN_IN_PROGRESS"
  | "TURN_STALE";

export type AssistantChatResponse =
  | {
      ok: true;
      turn: AssistantTurn;
      activeIntent: PaymentIntent | null;
      persisted?: {
        userMessage: ConversationMessageView;
        assistantMessage: ConversationMessageView;
        replayed: boolean;
      };
    }
  | {
      ok: false;
      error: {
        code: AssistantApiErrorCode;
        message: string;
        retryable?: boolean;
      };
    };

export interface ModelIntentCandidate {
  type: PaymentIntentType;
  amountNgn?: string | null;
  phone?: string | null;
  network?: PaymentNetwork | null;
  /** B6 wallet-transfer candidates (interpretation only, always re-validated). */
  recipientLabel?: string | null;
  recipientAddress?: string | null;
  amount?: string | null;
  asset?: string | null;
  chain?: string | null;
}

export interface AssistantModelOutput {
  mode: "chat" | "payment_intent";
  reply: string;
  intent: ModelIntentCandidate | null;
}

/**
 * B6 — Structured, frontend-renderable assistant actions for wallet
 * transfers. Additive: existing Celo turns carry no `action` and render from
 * prose exactly as before. B7 renders confirmation/review cards from these.
 */
export type WalletTransferAction =
  | { type: "ask_missing_details"; missingFields: string[] }
  | { type: "ask_recipient_address"; recipientLabel: string }
  | { type: "confirm_recipient"; recipientLabel: string; recipientAddress: string; saved: boolean; chainId: number }
  | { type: "offer_save_recipient"; recipientLabel: string; recipientAddress: string; chainId: number }
  | { type: "review_payment"; preparedIntentId: string }
  | { type: "prepared_payment_intent"; preparedIntentId: string; recipientLabel: string; recipientAddress: string; chainId: number; asset: string; amountDisplay: string; amountBaseUnits: string; expiresAt: string; saved: boolean }
  | { type: "reject_unsupported_request"; reason: string }
  | { type: "cancelled" };
