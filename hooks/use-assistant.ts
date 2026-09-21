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
import { normalizePaymentAssetSymbol, type PaymentAssetSymbol } from "@/lib/celo/assets";
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
  walletAddress?: string;
  onDepositConfirmed?: (transactionId: string, celoTxHash: string) => void;
}

export interface UseAssistantResult extends UseAssistantState {
  send(message: string): Promise<void>;
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
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [activeIntent, setActiveIntent] = useState<PaymentIntent | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [preview, setPreview] = useState<AirtimePreview | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [asset, setAsset] = useState<PaymentAssetSymbol>("USDC");
  const [confirmedPayment, setConfirmedPayment] =
    useState<ConfirmedPaymentState | null>(null);

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

  // Wallet address resolution
  const connectedAddress = useSafeConnectedAddress();
  const targetWalletAddress = options?.walletAddress ?? connectedAddress;
  const targetWalletRef = useRef<string | undefined>(targetWalletAddress);

  useEffect(() => {
    targetWalletRef.current = targetWalletAddress;
  }, [targetWalletAddress]);

  useEffect(() => {
    activeIntentRef.current = activeIntent;
  }, [activeIntent]);

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
    };
  }, []);

  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (previewAbortControllerRef.current) {
      previewAbortControllerRef.current.abort();
      previewAbortControllerRef.current = null;
    }
    prevIntentTupleRef.current = null;
    assetRef.current = "USDC";
    setAsset("USDC");
    setMessages([]);
    setActiveIntent(null);
    setError(null);
    setPending(false);
    setPreview(null);
    setPreviewId(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setConfirmedPayment(null);
    setPaymentInstructions(null);
    setPreparingPayment(false);
    setPreparationError(null);
    setDepositStatus("pending");
    setDepositHash(null);
    setDepositError(null);
    setRehydratedTransactionId(null);
    setRehydrating(false);
    setRehydrationError(null);
  }, []);

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

  const send = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) {
      return;
    }

    // Abort superseded in-flight request if present
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const userMessage: UserConversationMessage = {
      role: "user",
      content: trimmed,
      timestamp: new Date().toISOString(),
    };

    // Prior messages before adding current turn
    const priorHistory = messagesRef.current;
    const currentIntent = activeIntentRef.current;

    // Immediately append user message locally and enter pending state
    setMessages((prev) => [...prev, userMessage]);
    setPending(true);
    setError(null);

    const payload: AssistantChatRequest = {
      message: trimmed,
      history: priorHistory,
      activeIntent: currentIntent,
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

      if (!response.ok || !json?.ok) {
        const errorMessage =
          json && !json.ok && json.error?.message
            ? json.error.message
            : `Request failed with status ${response.status}`;

        setError(errorMessage);
        return;
      }

      // Success path
      const { turn, activeIntent: newActiveIntent } = json;
      setMessages((prev) => [...prev, turn.message]);
      setActiveIntent(newActiveIntent);
      setError(null);
    } catch (err: unknown) {
      // Ignore AbortError when superseded
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }

      const message =
        err instanceof Error ? err.message : "Failed to communicate with assistant.";
      setError(message);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        setPending(false);
      }
    }
  }, []);

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
        setConfirmedPayment(snapshot);
        setDepositStatus("awaiting_deposit");
        setPreparationError(null);
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to communicate with payment preparation service.";
        setPreparationError(message);
      } finally {
        setPreparingPayment(false);
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
        setRehydratedTransactionId(resolved.rehydratedTransactionId);
        setDepositStatus("awaiting_deposit");
        setDepositHash(null);
        setDepositError(null);
        setPreparationError(null);
        setRehydrationError(null);
        return { ok: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Transaction lookup failed. Verify the transaction ID and try again.";
        setPaymentInstructions(null);
        setRehydratedTransactionId(null);
        setDepositStatus("pending");
        setDepositHash(null);
        setDepositError(null);
        setRehydrationError(message);
        return { ok: false, error: message };
      } finally {
        setRehydrating(false);
      }
    },
    [],
  );


  return {
    messages,
    activeIntent,
    pending,
    error,
    preview,
    previewId,
    previewLoading,
    previewError,
    asset,
    confirmedPayment,
    paymentInstructions,
    preparingPayment,
    preparationError,
    depositStatus,
    depositHash,
    depositError,
    rehydratedTransactionId,
    rehydrating,
    rehydrationError,
    send,
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
