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
  PaymentInstructions,
  DepositProgressionStatus,
} from "@/components/assistant/payment-instructions-card";

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
 */
export function doesPreviewMatchIntent(
  preview: AirtimePreview | null,
  intent: PaymentIntent | null,
): boolean {
  if (
    !preview ||
    !intent ||
    intent.type !== "airtime" ||
    !intent.readyForConfirmation
  ) {
    return false;
  }
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

export interface UseAssistantState {
  messages: ConversationMessage[];
  activeIntent: PaymentIntent | null;
  pending: boolean;
  error: string | null;
  preview: AirtimePreview | null;
  previewId: string | null;
  previewLoading: boolean;
  previewError: string | null;
  confirmedPayment: ConfirmedPaymentState | null;
  paymentInstructions: PaymentInstructions | null;
  preparingPayment: boolean;
  preparationError: string | null;
  depositStatus: DepositProgressionStatus;
  depositHash: string | null;
  depositError: string | null;
}

export interface UseAssistantOptions {
  walletAddress?: string;
  onDepositConfirmed?: (transactionId: string, celoTxHash: string) => void;
}

export interface UseAssistantResult extends UseAssistantState {
  send(message: string): Promise<void>;
  reset(): void;
  confirmPayment(walletOverride?: string): Promise<void>;
  refreshPreview(): Promise<void>;
  editIntent(): void;
  executeDeposit(
    depositFn?: (instructions: PaymentInstructions) => Promise<string>,
  ): Promise<{ ok: boolean; celoTxHash?: string; error?: string }>;
  confirmDeposit(celoTxHash: string): Promise<{ ok: boolean; error?: string }>;
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

  const abortControllerRef = useRef<AbortController | null>(null);
  const previewAbortControllerRef = useRef<AbortController | null>(null);
  const activeIntentRef = useRef<PaymentIntent | null>(activeIntent);
  const previewRef = useRef<AirtimePreview | null>(preview);
  const previewIdRef = useRef<string | null>(previewId);
  const paymentInstructionsRef = useRef<PaymentInstructions | null>(
    paymentInstructions,
  );
  const messagesRef = useRef<ConversationMessage[]>(messages);
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

  const fetchPreview = useCallback(async (intent: AirtimeIntent) => {
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
      const params = new URLSearchParams({
        amountNgn: intent.amountNgn,
        phone: intent.phone,
        network: intent.network,
      });

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

      const expectedFingerprint = await computeIntentFingerprintClient(currentActive);
      if (
        json.preview.intentFingerprint !== expectedFingerprint ||
        !doesPreviewMatchIntent(json.preview, currentActive)
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

    const currentTuple = `${activeIntent.amountNgn ?? ""}:${activeIntent.phone ?? ""}:${activeIntent.network ?? ""}`;

    if (currentTuple !== prevIntentTupleRef.current) {
      prevIntentTupleRef.current = currentTuple;
      setPreview(null);
      setPreviewId(null);
      setConfirmedPayment(null);
      setPaymentInstructions(null);
      setPreviewError(null);
      fetchPreview(activeIntent);
    }
  }, [activeIntent, fetchPreview]);

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

      // Matching check: intent fields must match preview
      if (!doesPreviewMatchIntent(currentPreview, currentIntent)) {
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

        const instructions: PaymentInstructions = Object.freeze({
          transactionId: json.transactionId,
          receiveAddress: json.receiveAddress,
          totalUsdcToSend: json.totalUsdcToSend,
          validUntil: json.validUntil,
          ...(typeof json.baseUsdc === "string" ? { baseUsdc: json.baseUsdc } : {}),
          ...(typeof json.senderFeeUsdc === "string" ? { senderFeeUsdc: json.senderFeeUsdc } : {}),
          ...(typeof json.transactionFeeUsdc === "string" ? { transactionFeeUsdc: json.transactionFeeUsdc } : {}),
        });

        const snapshot: ConfirmedPaymentState = Object.freeze({
          amountNgn: currentPreview.amountNgn,
          phone: currentPreview.phone,
          network: currentPreview.network,
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
    await fetchPreview(currentIntent);
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

    if (typeof document !== "undefined") {
      const input =
        document.getElementById("assistant-input") ??
        document.querySelector<HTMLTextAreaElement>(
          "textarea#assistant-input, textarea",
        );
      input?.focus();
    }
  }, []);

  return {
    messages,
    activeIntent,
    pending,
    error,
    preview,
    previewId,
    previewLoading,
    previewError,
    confirmedPayment,
    paymentInstructions,
    preparingPayment,
    preparationError,
    depositStatus,
    depositHash,
    depositError,
    send,
    reset,
    confirmPayment,
    refreshPreview,
    editIntent,
    executeDeposit,
    confirmDeposit,
  };
}
