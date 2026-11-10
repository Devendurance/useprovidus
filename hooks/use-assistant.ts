"use client";

import { useState, useCallback, useRef, useEffect, useContext } from "react";
import { WagmiContext } from "wagmi";
import type {
  ConversationMessage,
  PaymentIntent,
  AirtimeIntent,
  AirtimePreview,
  ConfirmedAirtimePayment,
  AssistantChatRequest,
  AssistantChatResponse,
  UserConversationMessage,
} from "@/lib/assistant/types";
import type {
  ConversationMessageView,
  ConversationSummary,
} from "@/lib/conversations/types";
import { normalizePaymentAssetSymbol, type PaymentAssetSymbol } from "@/lib/celo/assets";
import { isSameWalletAddress, normalizeWalletAddress } from "@/lib/auth/wallet-ui-state";
import type {
  PaymentInstructions,
  DepositProgressionStatus,
} from "@/components/assistant/payment-instructions-card";
import {
  decimalStringsEqual,
  isNonNegativeUsdcDecimal,
} from "@/lib/money/decimal";

export type { PaymentInstructions, DepositProgressionStatus };

export interface ConfirmedPaymentState extends ConfirmedAirtimePayment {
  confirmedForPayment: true;
  confirmedAt: string;
  preview: AirtimePreview;
  paymentInstructions?: PaymentInstructions | null;
}

/**
 * Checks whether an AirtimePreview is fresh according to its 5-minute TTL.
 * Quote is valid strictly while Date.now() < expiresAtMs.
 */
export function isPreviewFresh(
  preview: AirtimePreview | null,
  nowMs: number = Date.now(),
): boolean {
  if (!preview?.expiresAt) {
    return false;
  }
  const expiresAtMs = Date.parse(preview.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }
  return nowMs < expiresAtMs;
}

/**
 * Checks whether an AirtimePreview matches the current active intent.
 * Asset-aware with USDC defaulting: absent preview/intent asset is USDC.
 */
export function doesPreviewMatchIntent(
  preview: AirtimePreview | null,
  intent: PaymentIntent | null,
  asset?: unknown,
): boolean {
  if (
    !preview ||
    !intent ||
    intent.type !== "airtime" ||
    !intent.readyForConfirmation
  ) {
    return false;
  }
  const expectedAsset: PaymentAssetSymbol =
    normalizePaymentAssetSymbol(asset) ?? "USDC";
  const previewAsset: PaymentAssetSymbol =
    normalizePaymentAssetSymbol(preview.asset) ?? "USDC";
  if (previewAsset !== expectedAsset) return false;
  return (
    preview.amountNgn === intent.amountNgn &&
    preview.phone === intent.phone &&
    preview.network === intent.network
  );
}

/**
 * Computes deterministic SHA-256 intent fingerprint client-side.
 * Canonical string: `${amountNgn}:${phone}:${network}`
 */
export async function computeIntentFingerprintClient(intent: {
  amountNgn?: string | null;
  phone?: string | null;
  network?: string | null;
}): Promise<string> {
  const canonical = `${intent.amountNgn ?? ""}:${intent.phone ?? ""}:${intent.network ?? ""}`;
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(canonical);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return "";
}
/**
 * Wire shape of GET /api/transactions/[id]?paymentInstructions=true.
 * The server always reports the field explicitly on an opted-in read:
 * an object when payable, null when not, plus an optional machine-readable
 * expiry reason. A read that never opted in omits both keys (legacy body).
 */
export interface RehydratedTransactionResponse {
  ok: boolean;
  transaction?: unknown;
  paymentInstructions?: PaymentInstructions | null;
  paymentInstructionsError?: string;
  error?: { code?: string; message?: string } | string;
}

/** Machine-readable expiry reason emitted only for a proven, elapsed order. */
export const PAYMENT_ORDER_EXPIRED_CODE = "PAYMENT_ORDER_EXPIRED";

/**
 * Fail-closed client-side guard for server-reported deposit instructions.
 * Mirrors the server derivation without trusting it: object shape, exact
 * required fields, non-zero USDC total, finite future validUntil, stable
 * transaction binding. Returns the frozen, trimmed instruction or null.
 * Never synthesizes values, never signs, never sends.
 */
export function coerceRehydratedInstructions(
  value: unknown,
  expectedTransactionId?: string,
  nowMs: number = Date.now(),
): PaymentInstructions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const transactionId = candidate.transactionId;
  const receiveAddress = candidate.receiveAddress;
  const totalUsdcToSend = candidate.totalUsdcToSend;
  const validUntil = candidate.validUntil;
  if (
    typeof transactionId !== "string" ||
    transactionId.trim() === "" ||
    typeof receiveAddress !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(receiveAddress.trim()) ||
    typeof totalUsdcToSend !== "string" ||
    typeof validUntil !== "string"
  ) {
    return null;
  }
  const trimmedTotal = totalUsdcToSend.trim();
  if (!isNonNegativeUsdcDecimal(trimmedTotal)) return null;
  if (decimalStringsEqual(trimmedTotal, "0")) return null;
  const expiry = Date.parse(validUntil);
  if (!Number.isFinite(expiry) || expiry <= nowMs) return null;
  if (
    expectedTransactionId !== undefined &&
    transactionId !== expectedTransactionId
  ) {
    return null;
  }
  const rawAsset = candidate.asset;
  const assetIsAbsent =
    rawAsset === undefined ||
    rawAsset === null ||
    (typeof rawAsset === "string" && rawAsset.trim() === "");
  if (!assetIsAbsent && normalizePaymentAssetSymbol(rawAsset) === null) return null;
  const frozen: PaymentInstructions = Object.freeze({
    transactionId,
    receiveAddress,
    totalUsdcToSend: trimmedTotal,
    validUntil,
    ...(typeof candidate.baseUsdc === "string" ? { baseUsdc: candidate.baseUsdc } : {}),
    ...(typeof candidate.senderFeeUsdc === "string" ? { senderFeeUsdc: candidate.senderFeeUsdc } : {}),
    ...(typeof candidate.transactionFeeUsdc === "string" ? { transactionFeeUsdc: candidate.transactionFeeUsdc } : {}),
    ...(assetIsAbsent ? {} : { asset: normalizePaymentAssetSymbol(rawAsset) as PaymentAssetSymbol }),
  });
  return frozen;
}

/**
 * Deterministic rehydration state transition used by loadTransaction and the
 * isolated self-check. Pure: no fetch, no wallet, no signing.
 */
export interface RehydrationStateInput {
  requestedTransactionId: string;
  response: RehydratedTransactionResponse | null;
  nowMs?: number;
}

export interface RehydrationStateOutput {
  ok: boolean;
  paymentInstructions: PaymentInstructions | null;
  rehydratedTransactionId: string | null;
  depositStatus: DepositProgressionStatus;
  rehydrationError: string | null;
}

export function resolveRehydrationState(input: RehydrationStateInput): RehydrationStateOutput {
  const nowMs = input.nowMs ?? Date.now();
  if (!input.response || input.response.ok !== true) {
    return {
      ok: false,
      paymentInstructions: null,
      rehydratedTransactionId: null,
      depositStatus: "pending",
      rehydrationError: "Transaction lookup failed. Verify the transaction ID and try again.",
    };
  }
  const coerced = coerceRehydratedInstructions(
    input.response.paymentInstructions,
    input.requestedTransactionId,
    nowMs,
  );
  if (!coerced) {
    const expired =
      input.response.paymentInstructionsError === PAYMENT_ORDER_EXPIRED_CODE;
    return {
      ok: false,
      paymentInstructions: null,
      rehydratedTransactionId: null,
      depositStatus: "pending",
      rehydrationError: expired
        ? "This payment window has expired. Request a fresh quote to pay."
        : "No payable instructions are available for this transaction.",
    };
  }
  return {
    ok: true,
    paymentInstructions: coerced,
    rehydratedTransactionId: coerced.transactionId,
    depositStatus: "awaiting_deposit",
    rehydrationError: null,
  };
}

export interface UseAssistantState {
  messages: ConversationMessage[];
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  activeConversationTitle: string | null;
  conversationOwner: string | null;
  conversationsLoading: boolean;
  conversationLoading: boolean;
  conversationCreating: boolean;
  conversationError: string | null;
  conversationCursor: string | null;
  olderBeforeSequence: number | null;
  olderMessagesLoading: boolean;
  retryableMessage: { turnId: string; content: string } | null;
  conversationAddress: string | null;
  walletAction: import("@/lib/assistant/types").WalletTransferAction | null;
  activeIntent: PaymentIntent | null;
  pending: boolean;
  error: string | null;
  preview: AirtimePreview | null;
  previewId: string | null;
  previewLoading: boolean;
  previewError: string | null;
  asset: PaymentAssetSymbol;
  confirmedPayment: ConfirmedPaymentState | null;
  paymentInstructions: PaymentInstructions | null;
  paymentOwner: string | null;
  preparingPayment: boolean;
  preparationError: string | null;
  depositStatus: DepositProgressionStatus;
  depositHash: string | null;
  depositError: string | null;
  rehydratedTransactionId: string | null;
  rehydrating: boolean;
  rehydrationError: string | null;
}

export interface UseAssistantOptions {
  walletTransferOwner?: string | null;
  walletAddress?: string;
  onDepositConfirmed?: (transactionId: string, celoTxHash: string) => void;
}

export interface UseAssistantResult extends UseAssistantState {
  send(message: string): Promise<void>;
  createConversation(): Promise<boolean>;
  openConversation(sessionId: string): Promise<boolean>;
  renameConversation(sessionId: string, title: string): Promise<boolean>;
  deleteConversation(sessionId: string): Promise<boolean>;
  loadMoreConversations(): Promise<void>;
  loadOlderMessages(): Promise<void>;
  retryLastMessage(): Promise<void>;
  reset(): void;
  selectAsset(asset: PaymentAssetSymbol): void;
  confirmPayment(walletOverride?: string): Promise<void>;
  refreshPreview(): Promise<void>;
  editIntent(): void;
  executeDeposit(
    depositFn?: (instructions: PaymentInstructions) => Promise<string>,
  ): Promise<{ ok: boolean; celoTxHash?: string; error?: string }>;
  confirmDeposit(celoTxHash: string): Promise<{ ok: boolean; error?: string }>;
  loadTransaction(transactionId: string, walletOverride?: string): Promise<{ ok: boolean; error?: string }>;
}

function createClientUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const value = Math.floor(Math.random() * 16);
    return (character === "x" ? value : (value & 3) | 8).toString(16);
  });
}

function updateConversationUrl(sessionId: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (sessionId) url.searchParams.set("conversation", sessionId);
  else url.searchParams.delete("conversation");
  window.history.replaceState(window.history.state, "", url);
}

function toConversationMessage(row: ConversationMessageView): ConversationMessage {
  if (row.role === "user") {
    return {
      role: "user",
      content: row.content,
      timestamp: row.timestamp,
      id: row.id,
      sessionId: row.sessionId,
      turnId: row.turnId,
      sequence: row.sequence,
      turnStatus: row.turnStatus,
      failureCode: row.failureCode ?? null,
    };
  }
  return {
    role: "assistant",
    content: row.content,
    timestamp: row.timestamp,
    id: row.id,
    sessionId: row.sessionId,
    turnId: row.turnId,
    sequence: row.sequence,
  };
}

/**
 * Safely resolves connected wallet address without throwing outside WagmiProvider.
 */
function useSafeConnectedAddress(): string | undefined {
  const config = useContext(WagmiContext);
  const [address, setAddress] = useState<string | undefined>(() => {
    if (!config) return undefined;
    try {
      const current = config.state?.current;
      return current ? config.state?.connections?.get(current)?.accounts?.[0] : undefined;
    } catch {
      return undefined;
    }
  });

  useEffect(() => {
    if (!config) return;
    try {
      return config.subscribe(
        (state) => {
          const current = state.current;
          return current ? state.connections?.get(current)?.accounts?.[0] : undefined;
        },
        (newAddress) => setAddress(newAddress),
      );
    } catch {
      return;
    }
  }, [config]);

  return address;
}

export function useAssistant(options?: UseAssistantOptions): UseAssistantResult {
  const walletTransferOwnerRef = useRef(options?.walletTransferOwner);
  useEffect(() => { walletTransferOwnerRef.current = options?.walletTransferOwner; }, [options?.walletTransferOwner]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversationTitle, setActiveConversationTitle] = useState<string | null>(null);
  const [conversationOwner, setConversationOwner] = useState<string | null>(null);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationCreating, setConversationCreating] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [conversationCursor, setConversationCursor] = useState<string | null>(null);
  const [olderBeforeSequence, setOlderBeforeSequence] = useState<number | null>(null);
  const [olderMessagesLoading, setOlderMessagesLoading] = useState(false);
  const [retryableMessage, setRetryableMessage] = useState<{ turnId: string; content: string } | null>(null);
  const [activeIntent, setActiveIntent] = useState<PaymentIntent | null>(null);
  const [walletAction, setWalletAction] = useState<import("@/lib/assistant/types").WalletTransferAction | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [preview, setPreview] = useState<AirtimePreview | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [asset, setAsset] = useState<PaymentAssetSymbol>("USDC");
  const [confirmedPayment, setConfirmedPayment] =
    useState<ConfirmedPaymentState | null>(null);
  const [paymentOwner, setPaymentOwner] = useState<string | null>(null);

  // Payment Instructions & Deposit State (P5)
  const [paymentInstructions, setPaymentInstructions] =
    useState<PaymentInstructions | null>(null);
  const [preparingPayment, setPreparingPayment] = useState(false);
  const [preparationError, setPreparationError] = useState<string | null>(null);
  const [depositStatus, setDepositStatus] =
    useState<DepositProgressionStatus>("pending");
  const [depositHash, setDepositHash] = useState<string | null>(null);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [rehydratedTransactionId, setRehydratedTransactionId] = useState<string | null>(null);
  const [rehydrating, setRehydrating] = useState(false);
  const [rehydrationError, setRehydrationError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const conversationsAbortRef = useRef<AbortController | null>(null);
  const conversationAbortRef = useRef<AbortController | null>(null);
  const olderMessagesAbortRef = useRef<AbortController | null>(null);
  const previewAbortControllerRef = useRef<AbortController | null>(null);
  const activeIntentRef = useRef<PaymentIntent | null>(activeIntent);
  const previewRef = useRef<AirtimePreview | null>(preview);
  const previewIdRef = useRef<string | null>(previewId);
  const paymentInstructionsRef = useRef<PaymentInstructions | null>(
    paymentInstructions,
  );
  const messagesRef = useRef<ConversationMessage[]>(messages);
  const assetRef = useRef<PaymentAssetSymbol>(asset);
  const prevIntentTupleRef = useRef<string | null>(null);
  const walletContextRevisionRef = useRef(0);
  const conversationContextRevisionRef = useRef(0);
  const conversationLoadRevisionRef = useRef(0);
  const effectiveConversationOwnerRef = useRef<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const pendingRef = useRef(false);
  const sendInFlightRef = useRef(false);
  const walletAddressForConversationRef = useRef<string | null>(null);
  const createRequestIdRef = useRef<string | null>(null);
  const conversationContextRef = useRef<{ owner: string | null; address: string | null } | null>(null);

  // Wallet address resolution
  const connectedAddress = useSafeConnectedAddress();
  const currentWalletAddress = normalizeWalletAddress(options?.walletAddress ?? connectedAddress) ?? null;
  const normalizedOwner = normalizeWalletAddress(options?.walletTransferOwner);
  const effectiveConversationOwner =
    normalizedOwner &&
    (!currentWalletAddress || isSameWalletAddress(normalizedOwner, currentWalletAddress))
      ? normalizedOwner
      : null;
  const [conversationAddress, setConversationAddress] = useState(() => normalizeWalletAddress(connectedAddress));
  const previousConnectedAddress = useRef(normalizeWalletAddress(connectedAddress));
  const previousTransferOwner = useRef(normalizeWalletAddress(options?.walletTransferOwner));
  useEffect(() => {
    effectiveConversationOwnerRef.current = effectiveConversationOwner;
    walletAddressForConversationRef.current = currentWalletAddress;
  }, [effectiveConversationOwner, currentWalletAddress]);
  useEffect(() => {
    const currentAddress = normalizeWalletAddress(connectedAddress);
    const currentOwner = normalizeWalletAddress(options?.walletTransferOwner);
    const accountChanged = previousConnectedAddress.current !== currentAddress;
    const ownerChanged = previousTransferOwner.current !== currentOwner;
    previousConnectedAddress.current = currentAddress;
    previousTransferOwner.current = currentOwner;
    if (!accountChanged && !ownerChanged) return;
    walletContextRevisionRef.current += 1;
    setConversationAddress(currentAddress);
    if (!accountChanged && activeIntentRef.current?.type !== "wallet_transfer") return;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    previewAbortControllerRef.current?.abort();
    previewAbortControllerRef.current = null;
    activeIntentRef.current = null;
    previewRef.current = null;
    previewIdRef.current = null;
    messagesRef.current = [];
    setActiveIntent(null);
    setWalletAction(null);
    setMessages([]);
    pendingRef.current = false;
    setPending(false);
    setError(null);
    setPreview(null);
    setPreviewId(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setPreparingPayment(false);
    setRehydrating(false);
  }, [connectedAddress, options?.walletTransferOwner, activeIntent]);
  const targetWalletAddress = options?.walletAddress ?? connectedAddress;
  const targetWalletRef = useRef<string | undefined>(targetWalletAddress);

  useEffect(() => {
    targetWalletRef.current = targetWalletAddress;
  }, [targetWalletAddress]);

  useEffect(() => {
    activeIntentRef.current = activeIntent;
  }, [activeIntent]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);

  useEffect(() => {
    previewIdRef.current = previewId;
  }, [previewId]);

  useEffect(() => {
    paymentInstructionsRef.current = paymentInstructions;
  }, [paymentInstructions]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    assetRef.current = asset;
  }, [asset]);

  // Clean up any pending request on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      previewAbortControllerRef.current?.abort();
      conversationsAbortRef.current?.abort();
      conversationAbortRef.current?.abort();
      olderMessagesAbortRef.current?.abort();
    };
  }, []);

  const reset = useCallback(() => {
    walletContextRevisionRef.current += 1;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (previewAbortControllerRef.current) {
      previewAbortControllerRef.current.abort();
      previewAbortControllerRef.current = null;
    }
    conversationsAbortRef.current?.abort();
    conversationAbortRef.current?.abort();
    olderMessagesAbortRef.current?.abort();
    conversationLoadRevisionRef.current += 1;
    prevIntentTupleRef.current = null;
    assetRef.current = "USDC";
    setAsset("USDC");
    messagesRef.current = [];
    setMessages([]);
    activeConversationIdRef.current = null;
    setActiveConversationId(null);
    setActiveConversationTitle(null);
    setOlderBeforeSequence(null);
    setRetryableMessage(null);
    setConversationLoading(false);
    setConversationError(null);
    updateConversationUrl(null);
    setActiveIntent(null);
    setWalletAction(null);
    setError(null);
    setPending(false);
    pendingRef.current = false;
    setPreview(null);
    setPreviewId(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setConfirmedPayment(null);
    setPaymentInstructions(null);
    setPaymentOwner(null);
    setPreparingPayment(false);
    setPreparationError(null);
    setDepositStatus("pending");
    setDepositHash(null);
    setDepositError(null);
    setRehydratedTransactionId(null);
    setRehydrating(false);
    setRehydrationError(null);
  }, []);

  const refreshConversations = useCallback(async (cursor?: string, append = false) => {
    const owner = effectiveConversationOwnerRef.current;
    if (!owner) return;
    conversationsAbortRef.current?.abort();
    const controller = new AbortController();
    conversationsAbortRef.current = controller;
    const revision = conversationContextRevisionRef.current;
    setConversationsLoading(true);
    setConversationError(null);
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch("/api/conversations?" + params.toString(), {
        headers: {
          Accept: "application/json",
          "x-providus-wallet": walletAddressForConversationRef.current ?? owner,
        },
        signal: controller.signal,
        cache: "no-store",
      });
      const json = (await response.json()) as {
        ok?: boolean;
        sessions?: ConversationSummary[];
        nextCursor?: string | null;
        error?: { message?: string };
      };
      if (revision !== conversationContextRevisionRef.current) return;
      if (!response.ok || !json.ok || !Array.isArray(json.sessions)) {
        setConversationError(json.error?.message ?? "Conversation history could not be loaded.");
        return;
      }
      setConversations((current) => {
        const merged = append ? [...current, ...json.sessions!] : json.sessions!;
        return [...new Map(merged.map((session) => [session.id, session])).values()];
      });
      if (!append && activeConversationIdRef.current) {
        const active = json.sessions.find((session) => session.id === activeConversationIdRef.current);
        if (active) setActiveConversationTitle(active.title);
      }
      setConversationCursor(json.nextCursor ?? null);
    } catch (requestError) {
      if (controller.signal.aborted || revision !== conversationContextRevisionRef.current) return;
      setConversationError(
        requestError instanceof Error
          ? requestError.message
          : "Conversation history could not be loaded.",
      );
    } finally {
      if (conversationsAbortRef.current === controller) {
        conversationsAbortRef.current = null;
        setConversationsLoading(false);
      }
    }
  }, []);

  const openConversation = useCallback(async (sessionId: string): Promise<boolean> => {
    const owner = effectiveConversationOwnerRef.current;
    if (!owner) {
      setConversationError("Sign in with your connected wallet to open saved conversations.");
      return false;
    }
    conversationAbortRef.current?.abort();
    olderMessagesAbortRef.current?.abort();
    const ownerRevision = conversationContextRevisionRef.current;
    reset();
    const controller = new AbortController();
    conversationAbortRef.current = controller;
    const loadRevision = ++conversationLoadRevisionRef.current;
    setConversationOwner(owner);
    activeConversationIdRef.current = sessionId;
    setActiveConversationId(sessionId);
    setActiveConversationTitle(
      conversations.find((session) => session.id === sessionId)?.title ?? "Conversation",
    );
    messagesRef.current = [];
    setMessages([]);
    setRetryableMessage(null);
    setOlderBeforeSequence(null);
    setConversationLoading(true);
    setConversationError(null);
    updateConversationUrl(sessionId);

    try {
      const response = await fetch("/api/conversations/" + encodeURIComponent(sessionId), {
        headers: {
          Accept: "application/json",
          "x-providus-wallet": walletAddressForConversationRef.current ?? owner,
        },
        signal: controller.signal,
        cache: "no-store",
      });
      const json = (await response.json()) as {
        ok?: boolean;
        session?: ConversationSummary;
        messages?: ConversationMessageView[];
        olderBeforeSequence?: number | null;
        error?: { message?: string };
      };
      if (
        ownerRevision !== conversationContextRevisionRef.current ||
        loadRevision !== conversationLoadRevisionRef.current
      ) {
        return false;
      }
      if (!response.ok || !json.ok || !json.session || !Array.isArray(json.messages)) {
        setConversationError(json.error?.message ?? "This conversation could not be opened.");
        if (response.status === 404) {
          activeConversationIdRef.current = null;
          setActiveConversationId(null);
          setActiveConversationTitle(null);
          updateConversationUrl(null);
        }
        return false;
      }
      const restored = json.messages.map(toConversationMessage);
      messagesRef.current = restored;
      setMessages(restored);
      setActiveConversationTitle(json.session.title);
      setConversations((current) => [
        json.session!,
        ...current.filter((session) => session.id !== json.session!.id),
      ]);
      setOlderBeforeSequence(json.olderBeforeSequence ?? null);
      const lastRetryable = [...json.messages]
        .reverse()
        .find((item) => item.role === "user" && item.turnStatus === "failed");
      setRetryableMessage(
        lastRetryable?.turnId && lastRetryable.role === "user"
          ? { turnId: lastRetryable.turnId, content: lastRetryable.content }
          : null,
      );
      return true;
    } catch (requestError) {
      if (controller.signal.aborted || ownerRevision !== conversationContextRevisionRef.current) return false;
      setConversationError(
        requestError instanceof Error
          ? requestError.message
          : "This conversation could not be opened.",
      );
      return false;
    } finally {
      if (conversationAbortRef.current === controller) {
        conversationAbortRef.current = null;
        if (loadRevision === conversationLoadRevisionRef.current) setConversationLoading(false);
      }
    }
  }, [conversations, reset]);

  const createConversation = useCallback(async (): Promise<boolean> => {
    const owner = effectiveConversationOwnerRef.current;
    if (!owner) {
      reset();
      setConversationOwner(null);
      return true;
    }
    const requestId = createRequestIdRef.current ?? createClientUuid();
    createRequestIdRef.current = requestId;
    const ownerRevision = conversationContextRevisionRef.current;
    setConversationCreating(true);
    setConversationError(null);
    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-providus-wallet": walletAddressForConversationRef.current ?? owner,
        },
        body: JSON.stringify({ requestId }),
        cache: "no-store",
      });
      const json = (await response.json()) as {
        ok?: boolean;
        session?: ConversationSummary;
        error?: { message?: string };
      };
      if (ownerRevision !== conversationContextRevisionRef.current) return false;
      if (!response.ok || !json.ok || !json.session) {
        setConversationError(json.error?.message ?? "A new conversation could not be created.");
        return false;
      }
      createRequestIdRef.current = null;
      reset();
      setConversationOwner(owner);
      activeConversationIdRef.current = json.session.id;
      setActiveConversationId(json.session.id);
      setActiveConversationTitle(json.session.title);
      setConversations((current) => [
        json.session!,
        ...current.filter((session) => session.id !== json.session!.id),
      ]);
      updateConversationUrl(json.session.id);
      return true;
    } catch (requestError) {
      if (ownerRevision !== conversationContextRevisionRef.current) return false;
      setConversationError(
        requestError instanceof Error
          ? requestError.message
          : "A new conversation could not be created.",
      );
      return false;
    } finally {
      if (ownerRevision === conversationContextRevisionRef.current) {
        setConversationCreating(false);
      }
    }
  }, [reset]);

  const renameConversation = useCallback(async (sessionId: string, title: string): Promise<boolean> => {
    const owner = effectiveConversationOwnerRef.current;
    if (!owner) return false;
    const revision = conversationContextRevisionRef.current;
    try {
      const response = await fetch("/api/conversations/" + encodeURIComponent(sessionId), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-providus-wallet": walletAddressForConversationRef.current ?? owner,
        },
        body: JSON.stringify({ title }),
        cache: "no-store",
      });
      const json = (await response.json()) as {
        ok?: boolean;
        session?: ConversationSummary;
        error?: { message?: string };
      };
      if (revision !== conversationContextRevisionRef.current) return false;
      if (!response.ok || !json.ok || !json.session) {
        setConversationError(json.error?.message ?? "Conversation title could not be saved.");
        return false;
      }
      setConversations((current) => current.map((session) => session.id === sessionId ? json.session! : session));
      if (activeConversationIdRef.current === sessionId) {
        setActiveConversationTitle(json.session.title);
      }
      return true;
    } catch {
      if (revision === conversationContextRevisionRef.current) {
        setConversationError("Conversation title could not be saved.");
      }
      return false;
    }
  }, []);

  const deleteConversation = useCallback(async (sessionId: string): Promise<boolean> => {
    const owner = effectiveConversationOwnerRef.current;
    if (!owner) return false;
    const revision = conversationContextRevisionRef.current;
    try {
      const response = await fetch("/api/conversations/" + encodeURIComponent(sessionId), {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-providus-wallet": walletAddressForConversationRef.current ?? owner,
        },
        body: JSON.stringify({ confirm: true }),
        cache: "no-store",
      });
      const json = (await response.json()) as { ok?: boolean; error?: { message?: string } };
      if (revision !== conversationContextRevisionRef.current) return false;
      if (!response.ok || !json.ok) {
        setConversationError(json.error?.message ?? "Conversation could not be deleted.");
        return false;
      }
      setConversations((current) => current.filter((session) => session.id !== sessionId));
      if (activeConversationIdRef.current === sessionId) reset();
      return true;
    } catch {
      if (revision === conversationContextRevisionRef.current) {
        setConversationError("Conversation could not be deleted.");
      }
      return false;
    }
  }, [reset]);

  const loadMoreConversations = useCallback(async () => {
    if (conversationCursor) await refreshConversations(conversationCursor, true);
  }, [conversationCursor, refreshConversations]);

  const loadOlderMessages = useCallback(async () => {
    const owner = effectiveConversationOwnerRef.current;
    const sessionId = activeConversationIdRef.current;
    const beforeSequence = olderBeforeSequence;
    if (!owner || !sessionId || !beforeSequence || olderMessagesLoading) return;
    olderMessagesAbortRef.current?.abort();
    const controller = new AbortController();
    olderMessagesAbortRef.current = controller;
    const ownerRevision = conversationContextRevisionRef.current;
    const loadRevision = conversationLoadRevisionRef.current;
    setOlderMessagesLoading(true);
    try {
      const url =
        "/api/conversations/" +
        encodeURIComponent(sessionId) +
        "/messages?beforeSequence=" +
        String(beforeSequence);
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "x-providus-wallet": walletAddressForConversationRef.current ?? owner,
        },
        signal: controller.signal,
        cache: "no-store",
      });
      const json = (await response.json()) as {
        ok?: boolean;
        messages?: ConversationMessageView[];
        olderBeforeSequence?: number | null;
        error?: { message?: string };
      };
      if (
        controller.signal.aborted ||
        ownerRevision !== conversationContextRevisionRef.current ||
        loadRevision !== conversationLoadRevisionRef.current ||
        activeConversationIdRef.current !== sessionId
      ) return;
      if (!response.ok || !json.ok || !Array.isArray(json.messages)) {
        setConversationError(json.error?.message ?? "Earlier messages could not be loaded.");
        return;
      }
      setMessages((current) => {
        if (
          controller.signal.aborted ||
          ownerRevision !== conversationContextRevisionRef.current ||
          loadRevision !== conversationLoadRevisionRef.current ||
          activeConversationIdRef.current !== sessionId
        ) return current;
        const combined = [...json.messages!.map(toConversationMessage), ...current];
        const unique = new Map(
          combined.map((entry, index) => [entry.id ?? entry.turnId ?? String(index), entry]),
        );
        const ordered = [...unique.values()].sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
        messagesRef.current = ordered;
        return ordered;
      });
      setOlderBeforeSequence(json.olderBeforeSequence ?? null);
    } catch {
      if (
        !controller.signal.aborted &&
        ownerRevision === conversationContextRevisionRef.current &&
        loadRevision === conversationLoadRevisionRef.current &&
        activeConversationIdRef.current === sessionId
      ) {
        setConversationError("Earlier messages could not be loaded.");
      }
    } finally {
      if (olderMessagesAbortRef.current === controller) {
        olderMessagesAbortRef.current = null;
        setOlderMessagesLoading(false);
      }
    }
  }, [olderBeforeSequence, olderMessagesLoading]);

  useEffect(() => {
    const address = currentWalletAddress;
    const owner = effectiveConversationOwner;
    const previous = conversationContextRef.current;
    const sameContext =
      previous?.owner === owner &&
      (previous?.address === address ||
        (!previous?.address && !address) ||
        Boolean(previous?.address && address && isSameWalletAddress(previous.address, address)));
    if (sameContext) return;
    conversationContextRef.current = { owner, address };
    effectiveConversationOwnerRef.current = owner;
    conversationContextRevisionRef.current += 1;
    conversationLoadRevisionRef.current += 1;
    conversationsAbortRef.current?.abort();
    conversationAbortRef.current?.abort();
    olderMessagesAbortRef.current?.abort();
    abortControllerRef.current?.abort();
    pendingRef.current = false;
    setPending(false);
    setConversationOwner(owner);
    setConversations([]);
    setConversationCursor(null);
    setConversationError(null);
    activeConversationIdRef.current = null;
    setActiveConversationId(null);
    setActiveConversationTitle(null);
    messagesRef.current = [];
    setMessages([]);
    setRetryableMessage(null);
    setOlderBeforeSequence(null);
    setConversationLoading(false);
    const clearUrl = Boolean(
      previous &&
        ((previous.owner && previous.owner !== owner) ||
          (previous.address && address && !isSameWalletAddress(previous.address, address))),
    );
    if (clearUrl) updateConversationUrl(null);
    if (!owner) return;
    void (async () => {
      await refreshConversations();
      if (!clearUrl && typeof window !== "undefined") {
        const sessionId = new URL(window.location.href).searchParams.get("conversation");
        if (sessionId) await openConversation(sessionId);
      }
    })();
  }, [currentWalletAddress, effectiveConversationOwner, openConversation, refreshConversations]);

  const selectAsset = useCallback((next: PaymentAssetSymbol) => {
    const normalized = normalizePaymentAssetSymbol(next) ?? "USDC";
    if (assetRef.current === normalized) return;
    setAsset(normalized);
    assetRef.current = normalized;
    prevIntentTupleRef.current = null;
    setPreview(null);
    setPreviewId(null);
    setConfirmedPayment(null);
    setPaymentInstructions(null);
    setPreviewError(null);
    setPreparingPayment(false);
    setPreparationError(null);
    setDepositStatus("pending");
    setDepositHash(null);
    setDepositError(null);
  }, []);

  const sendTurn = useCallback(async (content: string, retryTurnId?: string) => {
    const trimmed = content.trim();
    if (!trimmed) {
      return;
    }
    if (sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    pendingRef.current = true;
    setPending(true);

    // Authenticated chat is always attached to a server-created session.
    // An unauthenticated visitor keeps the existing ephemeral experience.
    let sessionId = activeConversationIdRef.current;
    const owner = effectiveConversationOwnerRef.current;
    if (owner && !sessionId) {
      const created = await createConversation();
      if (!created) {
        sendInFlightRef.current = false;
        pendingRef.current = false;
        setPending(false);
        return;
      }
      sessionId = activeConversationIdRef.current;
    }

    // Abort superseded in-flight request if present
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const walletContextRevision = walletContextRevisionRef.current;

    const turnId = retryTurnId ?? createClientUuid();
    const userMessage: UserConversationMessage = {
      role: "user",
      content: trimmed,
      timestamp: new Date().toISOString(),
      id: `local-${turnId}`,
      turnId,
      ...(sessionId ? { sessionId, turnStatus: "pending" as const } : {}),
    };

    // Prior messages before adding current turn
    const priorHistory = messagesRef.current;
    const currentIntent = activeIntentRef.current;

    // Immediately append user message locally and enter pending state
    if (retryTurnId) {
      setMessages((previous) => previous.map((entry) =>
        entry.role === "user" && entry.turnId === retryTurnId
          ? { ...entry, turnStatus: "pending", failureCode: null }
          : entry,
      ));
    } else {
      setMessages((prev) => [...prev, userMessage]);
      messagesRef.current = [...priorHistory, userMessage];
    }
    setPending(true);
    setError(null);

    const payload: AssistantChatRequest = {
      message: trimmed,
      walletTransferOwner: walletTransferOwnerRef.current,
      history: owner && sessionId ? [] : priorHistory,
      activeIntent: currentIntent,
      ...(owner && sessionId ? { sessionId, turnId } : {}),
    };

    try {
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
        cache: "no-store",
      });

      let json: AssistantChatResponse | null = null;
      try {
        json = (await response.json()) as AssistantChatResponse;
      } catch {
        // Fall through to HTTP error status handling below
      }

      if (walletContextRevision !== walletContextRevisionRef.current) return;

      if (!response.ok || !json?.ok) {
        const errorCode = json && !json.ok ? json.error?.code : undefined;
        if (owner && sessionId && (errorCode === "TURN_IN_PROGRESS" || errorCode === "TURN_STALE")) {
          const ownerRevision = conversationContextRevisionRef.current;
          const restored = await openConversation(sessionId);
          if (restored && ownerRevision === conversationContextRevisionRef.current) {
            setError(errorCode === "TURN_IN_PROGRESS"
              ? "This reply is still in progress. Refresh the conversation to check its status."
              : "This reply was superseded. Send a new message to continue.");
          }
          return;
        }
        const errorMessage =
          json && !json.ok && json.error?.message
            ? json.error.message
            : `Request failed with status ${response.status}`;

        setError(errorMessage);
        if (owner && sessionId) {
          setMessages((previous) => previous.map((entry) =>
            entry.role === "user" && entry.turnId === turnId
              ? { ...entry, turnStatus: "failed" }
              : entry,
          ));
          setRetryableMessage({ turnId, content: trimmed });
        }
        return;
      }

      // Success path
      const { turn, activeIntent: newActiveIntent } = json;
      if (owner && sessionId && json.persisted) {
        const persistedAssistant = toConversationMessage(json.persisted.assistantMessage);
        const liveAssistant = turn.message.intent && persistedAssistant.role === "assistant"
          ? { ...persistedAssistant, intent: turn.message.intent }
          : persistedAssistant;
        const persistedMessages = [
          toConversationMessage(json.persisted.userMessage),
          liveAssistant,
        ];
        setMessages((previous) => {
          const next = previous.filter((entry) => entry.turnId !== turnId);
          const combined = [...next, ...persistedMessages];
          const unique = [...new Map(combined.map((entry, index) => [entry.id ?? entry.turnId ?? String(index), entry])).values()];
          const ordered = unique.sort((left, right) => (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER));
          messagesRef.current = ordered;
          return ordered;
        });
        setRetryableMessage(null);
        void refreshConversations();
      } else {
        const assistantMessage = turn.message;
        setMessages((prev) => {
          const updated = prev.map((entry) => entry.role === "user" && entry.turnId === turnId
            ? { ...entry, turnStatus: "complete" as const }
            : entry);
          const next = [...updated, assistantMessage];
          messagesRef.current = next;
          return next;
        });
      }
      setActiveIntent(newActiveIntent);
      setWalletAction(turn.action ?? null);
      setError(null);
    } catch (err: unknown) {
      if (walletContextRevision !== walletContextRevisionRef.current) return;
      // Ignore AbortError when superseded
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }

      const message =
        err instanceof Error ? err.message : "Failed to communicate with assistant.";
      setError(message);
      if (owner && sessionId) {
        setMessages((previous) => previous.map((entry) =>
          entry.role === "user" && entry.turnId === turnId
            ? { ...entry, turnStatus: "failed" }
            : entry,
        ));
        setRetryableMessage({ turnId, content: trimmed });
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        sendInFlightRef.current = false;
        pendingRef.current = false;
        setPending(false);
      }
    }
  }, [createConversation, openConversation, refreshConversations]);

  const send = useCallback((content: string) => sendTurn(content), [sendTurn]);

  const retryLastMessage = useCallback(async () => {
    const retry = retryableMessage;
    if (!retry || pendingRef.current) return;
    setError(null);
    await sendTurn(retry.content, retry.turnId);
  }, [retryableMessage, sendTurn]);

  const fetchPreview = useCallback(async (intent: AirtimeIntent, assetOverride?: PaymentAssetSymbol) => {
    if (
      !intent.amountNgn ||
      !intent.phone ||
      !intent.network ||
      !intent.readyForConfirmation
    ) {
      return;
    }

    if (previewAbortControllerRef.current) {
      previewAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    previewAbortControllerRef.current = controller;
    const walletContextRevision = walletContextRevisionRef.current;

    setPreviewLoading(true);
    setPreviewError(null);

    try {
      const requestedAsset = assetOverride ?? assetRef.current;
      const params = new URLSearchParams({
        amountNgn: intent.amountNgn,
        phone: intent.phone,
        network: intent.network,
      });
      if (requestedAsset !== "USDC") {
        params.set("asset", requestedAsset);
      }

      const currentWallet = targetWalletRef.current;
      if (currentWallet) {
        params.set("walletAddress", currentWallet);
      }

      const response = await fetch(`/api/assistant/preview?${params.toString()}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
        cache: "no-store",
      });

      let json: {
        ok: boolean;
        previewId?: string;
        preview?: AirtimePreview & { id?: string; previewId?: string };
        error?: { code?: string; message?: string };
      } | null = null;

      try {
        json = await response.json();
      } catch {
        // Fall through to error handler
      }

      if (walletContextRevision !== walletContextRevisionRef.current) return;

      if (!response.ok || !json?.ok || !json.preview) {
        const errorCode = json?.error?.code;
        const errorMessage =
          errorCode === "WALLET_CONTEXT_INVALID"
            ? "Please connect your wallet to view quote and payment instructions."
            : json && !json.ok && json.error?.message
              ? json.error.message
              : `Quote request failed with status ${response.status}`;

        setPreviewError(errorMessage);
        setPreview(null);
        setPreviewId(null);
        setConfirmedPayment(null);
        setPaymentInstructions(null);
        return;
      }

      // Guard fetchPreview against late responses: verify the fetched preview's
      // intentFingerprint matches the current active intent before setting state.
      const currentActive = activeIntentRef.current;
      if (
        !currentActive ||
        currentActive.type !== "airtime" ||
        !currentActive.readyForConfirmation
      ) {
        return;
      }

      const currentAsset = assetRef.current;
      const expectedFingerprint = await computeIntentFingerprintClient(currentActive);
      if (walletContextRevision !== walletContextRevisionRef.current) return;
      if (
        json.preview.intentFingerprint !== expectedFingerprint ||
        !doesPreviewMatchIntent(json.preview, currentActive, currentAsset)
      ) {
        // Discard stale or mismatched preview from out-of-order response
        return;
      }

      const extractedId =
        json.previewId ??
        json.preview.id ??
        json.preview.previewId ??
        null;

      setPreview(json.preview);
      setPreviewId(extractedId);
      setConfirmedPayment(null);
      setPaymentInstructions(null);
      setPreviewError(null);
    } catch (err: unknown) {
      if (walletContextRevision !== walletContextRevisionRef.current) return;
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      const message =
        err instanceof Error ? err.message : "Failed to load quote preview.";
      setPreviewError(message);
      setPreview(null);
      setPreviewId(null);
      setConfirmedPayment(null);
      setPaymentInstructions(null);
    } finally {
      if (previewAbortControllerRef.current === controller) {
        previewAbortControllerRef.current = null;
        setPreviewLoading(false);
      }
    }
  }, []);

  // Synchronize preview lifecycle with activeIntent
  useEffect(() => {
    if (
      !activeIntent ||
      activeIntent.type !== "airtime" ||
      !activeIntent.readyForConfirmation
    ) {
      if (prevIntentTupleRef.current !== null) {
        prevIntentTupleRef.current = null;
        setPreview(null);
        setPreviewId(null);
        setConfirmedPayment(null);
        setPaymentInstructions(null);
        setPreviewError(null);
        setPreviewLoading(false);
        if (previewAbortControllerRef.current) {
          previewAbortControllerRef.current.abort();
          previewAbortControllerRef.current = null;
        }
      }
      return;
    }

    const currentTuple = `${activeIntent.amountNgn ?? ""}:${activeIntent.phone ?? ""}:${activeIntent.network ?? ""}:${asset}`;

    if (currentTuple !== prevIntentTupleRef.current) {
      prevIntentTupleRef.current = currentTuple;
      setPreview(null);
      setPreviewId(null);
      setConfirmedPayment(null);
      setPaymentInstructions(null);
      setPreviewError(null);
      fetchPreview(activeIntent, asset);
    }
  }, [activeIntent, asset, fetchPreview]);

  // Auto-invalidate confirmedPayment as soon as quote expiresAt is reached,
  // unless paymentInstructions have already been generated (in which case validUntil governs).
  useEffect(() => {
    if (!confirmedPayment || paymentInstructions) {
      return;
    }
    const expiresAtStr =
      confirmedPayment.preview?.expiresAt ?? confirmedPayment.expiresAt;
    const expiresAtMs = Date.parse(expiresAtStr);

    const checkExpiry = () => {
      if (!Number.isFinite(expiresAtMs) || Date.now() >= expiresAtMs) {
        setConfirmedPayment(null);
      }
    };

    const delay = Math.max(0, expiresAtMs - Date.now());
    const timer = setTimeout(checkExpiry, delay);
    const interval = setInterval(checkExpiry, 500);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [confirmedPayment, paymentInstructions]);

  /**
   * Confirms the payment preview by calling POST /api/assistant/orders
   * with server-authoritative previewId and wallet context.
   * On success, stores paymentInstructions and marks confirmed payment.
   */
  const confirmPayment = useCallback(
    async (walletOverride?: string): Promise<void> => {
      const walletContextRevision = walletContextRevisionRef.current;
      const currentIntent = activeIntentRef.current;
      const currentPreview = previewRef.current;
      const currentPreviewId = previewIdRef.current;
      const currentAsset = assetRef.current;
      const targetWallet =
        walletOverride ??
        targetWalletRef.current ??
        (typeof window !== "undefined"
          ? (window as unknown as { ethereum?: { selectedAddress?: string } })
              .ethereum?.selectedAddress
          : undefined);

      if (
        !currentIntent ||
        currentIntent.type !== "airtime" ||
        !currentIntent.readyForConfirmation ||
        !currentPreview
      ) {
        return;
      }

      // Freshness check: must be strictly before expiresAt
      if (!isPreviewFresh(currentPreview)) {
        setPreparationError("Quote has expired. Please refresh the quote to confirm.");
        return;
      }

      // Matching check: intent fields and selected asset must match preview
      if (!doesPreviewMatchIntent(currentPreview, currentIntent, currentAsset)) {
        setPreparationError("Quote does not match the active intent. Please refresh.");
        return;
      }

      if (!targetWallet) {
        setPreparationError("Please connect your wallet before confirming payment.");
        return;
      }

      if (!currentPreviewId) {
        setPreparationError("Quote preview identifier is missing. Please refresh the quote.");
        return;
      }

      setPreparingPayment(true);
      setPreparationError(null);

      try {
        const response = await fetch("/api/assistant/orders", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            previewId: currentPreviewId,
            walletAddress: targetWallet,
          }),
          cache: "no-store",
        });

        let json: {
          ok: boolean;
          transactionId?: string;
          receiveAddress?: string;
          totalUsdcToSend?: string;
          validUntil?: string;
          baseUsdc?: string;
          senderFeeUsdc?: string;
          transactionFeeUsdc?: string;
          asset?: PaymentAssetSymbol;
          error?: { code?: string; message?: string };
        } | null = null;

        try {
          json = await response.json();
        } catch {
          // Fall through
        }

        if (walletContextRevision !== walletContextRevisionRef.current ||
          (targetWalletRef.current && !isSameWalletAddress(targetWallet, targetWalletRef.current))) return;

        if (
          !response.ok ||
          !json?.ok ||
          !json.transactionId ||
          !json.receiveAddress ||
          !json.totalUsdcToSend ||
          !json.validUntil
        ) {
          const errorCode = json?.error?.code;
          const errorMsg =
            errorCode === "PREVIEW_NOT_USABLE"
              ? "Quote preview is no longer available or already consumed. Please request a fresh quote."
              : errorCode === "WALLET_CONTEXT_INVALID"
                ? "Wallet address mismatch. Please verify your connected wallet."
                : json?.error?.message ??
                  (response.status === 400
                    ? "Invalid order request or quote no longer available."
                    : response.status === 503
                      ? "Payment service is temporarily unavailable. Please try again."
                      : `Order preparation failed with status ${response.status}`);

          setPreparationError(errorMsg);
          return;
        }

        const rawResponseAsset: unknown = json.asset;
        const responseAssetAbsent =
          rawResponseAsset === undefined ||
          rawResponseAsset === null ||
          (typeof rawResponseAsset === "string" && rawResponseAsset.trim() === "");
        const responseAsset = responseAssetAbsent
          ? undefined
          : normalizePaymentAssetSymbol(rawResponseAsset);
        const resolvedAsset = responseAsset ?? "USDC";
        if (responseAsset === null || resolvedAsset !== currentAsset) {
          setPreparationError("Quote does not match the active intent. Please refresh.");
          return;
        }

        const instructions: PaymentInstructions = Object.freeze({
          transactionId: json.transactionId,
          receiveAddress: json.receiveAddress,
          totalUsdcToSend: json.totalUsdcToSend,
          validUntil: json.validUntil,
          ...(typeof json.baseUsdc === "string" ? { baseUsdc: json.baseUsdc } : {}),
          ...(typeof json.senderFeeUsdc === "string" ? { senderFeeUsdc: json.senderFeeUsdc } : {}),
          ...(typeof json.transactionFeeUsdc === "string" ? { transactionFeeUsdc: json.transactionFeeUsdc } : {}),
          ...(resolvedAsset === "USDC" ? {} : { asset: resolvedAsset }),
        });

        const snapshotAsset = normalizePaymentAssetSymbol(currentPreview.asset) ?? "USDC";
        const snapshot: ConfirmedPaymentState = Object.freeze({
          amountNgn: currentPreview.amountNgn,
          phone: currentPreview.phone,
          network: currentPreview.network,
          ...(snapshotAsset === "USDC" ? {} : { asset: snapshotAsset }),
          amountUsdc: currentPreview.amountUsdc,
          feeUsdc: currentPreview.feeUsdc,
          totalUsdc: currentPreview.totalUsdc,
          rate: currentPreview.rate,
          quotedAt: currentPreview.quotedAt,
          expiresAt: currentPreview.expiresAt,
          intentFingerprint: currentPreview.intentFingerprint,
          confirmedForPayment: true,
          confirmedAt: new Date().toISOString(),
          preview: Object.freeze({ ...currentPreview }),
          paymentInstructions: instructions,
        });

        setPaymentInstructions(instructions);
        setPaymentOwner(normalizeWalletAddress(targetWallet));
        setConfirmedPayment(snapshot);
        setDepositStatus("awaiting_deposit");
        setPreparationError(null);
      } catch (err: unknown) {
        if (walletContextRevision !== walletContextRevisionRef.current) return;
        const message =
          err instanceof Error
            ? err.message
            : "Failed to communicate with payment preparation service.";
        setPreparationError(message);
      } finally {
        if (walletContextRevision === walletContextRevisionRef.current) setPreparingPayment(false);
      }
    },
    [],
  );

  /**
   * Confirms on-chain Celo USDC deposit with server-side receipt verification.
   * Calls POST /api/transactions/[id]/confirm-deposit with { celoTxHash }.
   */
  const confirmDeposit = useCallback(
    async (celoTxHash: string): Promise<{ ok: boolean; error?: string }> => {
      const instructions = paymentInstructionsRef.current;
      if (!instructions) {
        const errorMsg = "No active payment instructions to confirm deposit.";
        setDepositError(errorMsg);
        return { ok: false, error: errorMsg };
      }

      if (!/^0x[a-fA-F0-9]{64}$/.test(celoTxHash)) {
        const errorMsg =
          "Invalid transaction hash format. Must be a 32-byte 0x-prefixed hex string.";
        setDepositError(errorMsg);
        return { ok: false, error: errorMsg };
      }

      setDepositHash(celoTxHash);
      setDepositStatus("verifying");
      setDepositError(null);

      const MAX_POLL_ATTEMPTS = 6;
      const POLL_INTERVAL_MS = 2000;
      const delayMs = (ms: number): Promise<void> => {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, ms);
        return promise;
      };

      for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
        try {
          const response = await fetch(
            `/api/transactions/${encodeURIComponent(instructions.transactionId)}/confirm-deposit`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({ celoTxHash }),
              cache: "no-store",
            },
          );

          let json: {
            ok: boolean;
            transaction?: unknown;
            code?: string;
            error?: { code?: string; message?: string } | string;
          } | null = null;

          try {
            json = await response.json();
          } catch {
            // Fall through
          }

          if (response.ok && json?.ok) {
            setDepositStatus("settling");
            setDepositError(null);
            if (options?.onDepositConfirmed) {
              options.onDepositConfirmed(instructions.transactionId, celoTxHash);
            }
            return { ok: true };
          }

          // Check for receipt not found on Celo mainnet yet
          const errorCode =
            (typeof json?.error === "object" ? json?.error?.code : undefined) ??
            json?.code;
          const isReceiptNotFound =
            response.status === 404 || errorCode === "RECEIPT_NOT_FOUND";

          if (isReceiptNotFound) {
            if (attempt < MAX_POLL_ATTEMPTS) {
              await delayMs(POLL_INTERVAL_MS);
              continue;
            }

            // All polling attempts elapsed without finding the receipt
            setDepositStatus("verifying");
            setDepositHash(celoTxHash);
            const timeoutMessage =
              "Transaction broadcast to Celo network. Awaiting block inclusion...";
            setDepositError(timeoutMessage);
            return { ok: false, error: timeoutMessage };
          }

          const message =
            (typeof json?.error === "object"
              ? json?.error?.message
              : typeof json?.error === "string"
                ? json.error
                : undefined) ??
            `Deposit verification failed with status ${response.status}`;
          setDepositStatus("error");
          setDepositError(message);
          return { ok: false, error: message };
        } catch (err: unknown) {
          if (attempt < MAX_POLL_ATTEMPTS) {
            await delayMs(POLL_INTERVAL_MS);
            continue;
          }

          const message =
            err instanceof Error
              ? err.message
              : "Failed to verify deposit with server.";
          setDepositStatus("error");
          setDepositError(message);
          return { ok: false, error: message };
        }
      }

      const fallbackMsg =
        "Transaction broadcast to Celo network. Awaiting block inclusion...";
      setDepositStatus("verifying");
      setDepositHash(celoTxHash);
      setDepositError(fallbackMsg);
      return { ok: false, error: fallbackMsg };
    },
    [options],
  );

  /**
   * Executes Celo USDC deposit handoff via provided deposit function,
   * then verifies on-chain receipt with the server.
   */
  const executeDeposit = useCallback(
    async (
      depositFn?: (instructions: PaymentInstructions) => Promise<string>,
    ): Promise<{ ok: boolean; celoTxHash?: string; error?: string }> => {
      const instructions = paymentInstructionsRef.current;
      if (!instructions) {
        const errorMsg = "No active payment instructions.";
        setDepositError(errorMsg);
        return { ok: false, error: errorMsg };
      }

      const validUntilMs = Date.parse(instructions.validUntil);
      if (Number.isFinite(validUntilMs) && Date.now() >= validUntilMs) {
        const errorMsg =
          "Payment window has expired. Please refresh the quote.";
        setDepositStatus("error");
        setDepositError(errorMsg);
        return { ok: false, error: errorMsg };
      }

      setDepositStatus("submitting");
      setDepositError(null);

      try {
        let celoTxHash: string;
        if (depositFn) {
          celoTxHash = await depositFn(instructions);
        } else {
          throw new Error(
            "No deposit execution function provided. Pass a deposit function or use confirmDeposit directly.",
          );
        }

        const confirmRes = await confirmDeposit(celoTxHash);
        if (!confirmRes.ok) {
          return { ok: false, celoTxHash, error: confirmRes.error };
        }

        return { ok: true, celoTxHash };
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Deposit execution failed.";
        setDepositStatus("error");
        setDepositError(message);
        return { ok: false, error: message };
      }
    },
    [confirmDeposit],
  );

  const refreshPreview = useCallback(async () => {
    const currentIntent = activeIntentRef.current;
    if (
      !currentIntent ||
      currentIntent.type !== "airtime" ||
      !currentIntent.readyForConfirmation
    ) {
      return;
    }
    await fetchPreview(currentIntent, assetRef.current);
  }, [fetchPreview]);

  const editIntent = useCallback(() => {
    setPreview(null);
    setPreviewId(null);
    setConfirmedPayment(null);
    setPaymentInstructions(null);
    setPreviewError(null);
    setPreparingPayment(false);
    setPreparationError(null);
    setDepositStatus("pending");
    setDepositHash(null);
    setDepositError(null);
    setRehydratedTransactionId(null);
    setRehydrationError(null);

    if (typeof document !== "undefined") {
      const input =
        document.getElementById("assistant-input") ??
        document.querySelector<HTMLTextAreaElement>(
          "textarea#assistant-input, textarea",
        );
      input?.focus();
    }
  }, []);
  /**
   * Rehydrates payable deposit instructions for an explicit transaction ID.
   * Read-only: fetches GET /api/transactions/[id]?paymentInstructions=true,
   * stores only server-returned instructions that pass the fail-closed guard,
   * surfaces expiry/ineligible states truthfully, and never signs or sends.
   */
  const loadTransaction = useCallback(
    async (
      transactionId: string,
      walletOverride?: string,
    ): Promise<{ ok: boolean; error?: string }> => {
      const walletContextRevision = walletContextRevisionRef.current;
      const trimmedId = transactionId.trim();
      if (trimmedId === "") {
        const errorMsg = "A transaction ID is required to look up payment instructions.";
        setRehydrationError(errorMsg);
        return { ok: false, error: errorMsg };
      }
      const targetWallet = walletOverride ?? targetWalletRef.current;
      if (!targetWallet || targetWallet.trim() === "") {
        const errorMsg = "Please connect your wallet before looking up payment instructions.";
        setRehydratedTransactionId(null);
        setPaymentInstructions(null);
        setDepositStatus("pending");
        setDepositHash(null);
        setDepositError(null);
        setRehydrationError(errorMsg);
        return { ok: false, error: errorMsg };
      }
      setRehydrating(true);
      setRehydrationError(null);
      try {
        const url =
          `/api/transactions/${encodeURIComponent(trimmedId)}` +
          `?paymentInstructions=true&walletAddress=${encodeURIComponent(targetWallet.trim())}`;
        const response = await fetch(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        let json: RehydratedTransactionResponse | null = null;
        try {
          json = (await response.json()) as RehydratedTransactionResponse;
        } catch {
          json = null;
        }
        if (walletContextRevision !== walletContextRevisionRef.current ||
          (targetWalletRef.current && !isSameWalletAddress(targetWallet, targetWalletRef.current))) {
          return { ok: false, error: "Wallet changed. Check the connected account and try again." };
        }
        if (!response.ok || !json || json.ok !== true) {
          const errorMsg =
            response.status === 404
              ? "Transaction not found. Verify the transaction ID and try again."
              : "Transaction lookup failed. Verify the transaction ID and try again.";
          setPaymentInstructions(null);
          setRehydratedTransactionId(null);
          setDepositStatus("pending");
          setDepositHash(null);
          setDepositError(null);
          setRehydrationError(errorMsg);
          return { ok: false, error: errorMsg };
        }
        const resolved = resolveRehydrationState({
          requestedTransactionId: trimmedId,
          response: json,
        });
        if (!resolved.ok || !resolved.paymentInstructions) {
          setPaymentInstructions(null);
          setRehydratedTransactionId(null);
          setDepositStatus("pending");
          setDepositHash(null);
          setDepositError(null);
          setRehydrationError(resolved.rehydrationError);
          return { ok: false, error: resolved.rehydrationError ?? "No payable instructions are available for this transaction." };
        }
        setPaymentInstructions(resolved.paymentInstructions);
        setPaymentOwner(normalizeWalletAddress(targetWallet));
        setRehydratedTransactionId(resolved.rehydratedTransactionId);
        setDepositStatus("awaiting_deposit");
        setDepositHash(null);
        setDepositError(null);
        setPreparationError(null);
        setRehydrationError(null);
        return { ok: true };
      } catch (err: unknown) {
        if (walletContextRevision !== walletContextRevisionRef.current) {
          return { ok: false, error: "Wallet changed. Check the connected account and try again." };
        }
        const message = err instanceof Error ? err.message : "Transaction lookup failed. Verify the transaction ID and try again.";
        setPaymentInstructions(null);
        setRehydratedTransactionId(null);
        setDepositStatus("pending");
        setDepositHash(null);
        setDepositError(null);
        setRehydrationError(message);
        return { ok: false, error: message };
      } finally {
        if (walletContextRevision === walletContextRevisionRef.current) setRehydrating(false);
      }
    },
    [],
  );


  const currentConversationMatches =
    currentWalletAddress === conversationAddress &&
    conversationOwner === effectiveConversationOwner;
  const currentPaymentOwnerMatches = paymentOwner === null || isSameWalletAddress(paymentOwner, connectedAddress);

  return {
    messages: currentConversationMatches ? messages : [],
    conversations: currentConversationMatches ? conversations : [],
    activeConversationId: currentConversationMatches ? activeConversationId : null,
    activeConversationTitle: currentConversationMatches ? activeConversationTitle : null,
    conversationOwner: currentConversationMatches ? conversationOwner : null,
    conversationsLoading: currentConversationMatches && conversationsLoading,
    conversationLoading: currentConversationMatches && conversationLoading,
    conversationCreating: currentConversationMatches && conversationCreating,
    conversationError: currentConversationMatches ? conversationError : null,
    conversationCursor: currentConversationMatches ? conversationCursor : null,
    olderBeforeSequence: currentConversationMatches ? olderBeforeSequence : null,
    olderMessagesLoading: currentConversationMatches && olderMessagesLoading,
    retryableMessage: currentConversationMatches ? retryableMessage : null,
    conversationAddress,
    walletAction: currentConversationMatches ? walletAction : null,
    activeIntent: currentConversationMatches ? activeIntent : null,
    pending: currentConversationMatches && pending,
    error: currentConversationMatches ? error : null,
    preview: currentConversationMatches ? preview : null,
    previewId: currentConversationMatches ? previewId : null,
    previewLoading: currentConversationMatches && previewLoading,
    previewError: currentConversationMatches ? previewError : null,
    asset,
    confirmedPayment: currentPaymentOwnerMatches ? confirmedPayment : null,
    paymentInstructions: currentPaymentOwnerMatches ? paymentInstructions : null,
    paymentOwner,
    preparingPayment: currentPaymentOwnerMatches && preparingPayment,
    preparationError: currentPaymentOwnerMatches ? preparationError : null,
    depositStatus: currentPaymentOwnerMatches ? depositStatus : "pending",
    depositHash: currentPaymentOwnerMatches ? depositHash : null,
    depositError: currentPaymentOwnerMatches ? depositError : null,
    rehydratedTransactionId: currentPaymentOwnerMatches ? rehydratedTransactionId : null,
    rehydrating: currentPaymentOwnerMatches && rehydrating,
    rehydrationError: currentPaymentOwnerMatches ? rehydrationError : null,
    send,
    createConversation,
    openConversation,
    renameConversation,
    deleteConversation,
    loadMoreConversations,
    loadOlderMessages,
    retryLastMessage,
    reset,
    selectAsset,
    confirmPayment,
    refreshPreview,
    editIntent,
    executeDeposit,
    confirmDeposit,
    loadTransaction,
  };
}
