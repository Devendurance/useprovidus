"use client";

import { useState, useCallback, useRef, useEffect } from "react";
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

export interface ConfirmedPaymentState extends ConfirmedAirtimePayment {
  confirmedForPayment: true;
  confirmedAt: string;
  preview: AirtimePreview;
}

/**
 * Checks whether an AirtimePreview is fresh according to its 60s TTL.
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
  previewLoading: boolean;
  previewError: string | null;
  confirmedPayment: ConfirmedPaymentState | null;
}

export interface UseAssistantResult extends UseAssistantState {
  send(message: string): Promise<void>;
  reset(): void;
  confirmPayment(): void;
  refreshPreview(): Promise<void>;
  editIntent(): void;
}
export function useAssistant(): UseAssistantResult {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [activeIntent, setActiveIntent] = useState<PaymentIntent | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [preview, setPreview] = useState<AirtimePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmedPayment, setConfirmedPayment] =
    useState<ConfirmedPaymentState | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const previewAbortControllerRef = useRef<AbortController | null>(null);
  const activeIntentRef = useRef<PaymentIntent | null>(activeIntent);
  const previewRef = useRef<AirtimePreview | null>(preview);
  const messagesRef = useRef<ConversationMessage[]>(messages);
  const prevIntentTupleRef = useRef<string | null>(null);

  useEffect(() => {
    activeIntentRef.current = activeIntent;
  }, [activeIntent]);

  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);

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
    setPreviewLoading(false);
    setPreviewError(null);
    setConfirmedPayment(null);
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

        // Keep existing activeIntent intact on error per architect contract
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
      // Keep existing activeIntent intact on error
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
        preview?: AirtimePreview;
        error?: { message?: string };
      } | null = null;
      try {
        json = await response.json();
      } catch {
        // Fall through to error handler
      }

      if (!response.ok || !json?.ok || !json.preview) {
        const errorMessage =
          json && !json.ok && json.error?.message
            ? json.error.message
            : `Quote request failed with status ${response.status}`;
        setPreviewError(errorMessage);
        setPreview(null);
        setConfirmedPayment(null);
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

      setPreview(json.preview);
      setConfirmedPayment(null);
      setPreviewError(null);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      const message =
        err instanceof Error ? err.message : "Failed to load quote preview.";
      setPreviewError(message);
      setPreview(null);
      setConfirmedPayment(null);
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
        setConfirmedPayment(null);
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
      setConfirmedPayment(null);
      setPreviewError(null);
      fetchPreview(activeIntent);
    }
  }, [activeIntent, fetchPreview]);
  // Auto-invalidate confirmedPayment as soon as quote expiresAt is reached.
  // If confirmedPayment exists and Date.now() >= Date.parse(confirmedPayment.preview.expiresAt),
  // clear confirmedPayment so a stale quote cannot remain confirmed indefinitely.
  useEffect(() => {
    if (!confirmedPayment) {
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
  }, [confirmedPayment]);


  /**
   * Records local explicit user confirmation state.
   * MUST NOT call any payment or wallet endpoint.
   */
  const confirmPayment = useCallback(() => {
    const currentIntent = activeIntentRef.current;
    const currentPreview = previewRef.current;

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
      return;
    }

    // Matching check: intent fields must match preview
    if (!doesPreviewMatchIntent(currentPreview, currentIntent)) {
      return;
    }

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
    });

    setConfirmedPayment(snapshot);
  }, []);

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
    setConfirmedPayment(null);
    setPreviewError(null);
    if (typeof document !== "undefined") {
      const input =
        document.getElementById("assistant-input") ??
        document.querySelector<HTMLTextAreaElement>("textarea#assistant-input, textarea");
      input?.focus();
    }
  }, []);

  return {
    messages,
    activeIntent,
    pending,
    error,
    preview,
    previewLoading,
    previewError,
    confirmedPayment,
    send,
    reset,
    confirmPayment,
    refreshPreview,
    editIntent,
  };
}
