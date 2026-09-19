"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  ConversationMessage,
  PaymentIntent,
  AssistantChatRequest,
  AssistantChatResponse,
  UserConversationMessage,
} from "@/lib/assistant/types";

export interface UseAssistantState {
  messages: ConversationMessage[];
  activeIntent: PaymentIntent | null;
  pending: boolean;
  error: string | null;
}

export interface UseAssistantResult extends UseAssistantState {
  send(message: string): Promise<void>;
  reset(): void;
}

export function useAssistant(): UseAssistantResult {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [activeIntent, setActiveIntent] = useState<PaymentIntent | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const activeIntentRef = useRef<PaymentIntent | null>(activeIntent);
  const messagesRef = useRef<ConversationMessage[]>(messages);

  useEffect(() => {
    activeIntentRef.current = activeIntent;
  }, [activeIntent]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Clean up any pending request on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setMessages([]);
    setActiveIntent(null);
    setError(null);
    setPending(false);
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

  return {
    messages,
    activeIntent,
    pending,
    error,
    send,
    reset,
  };
}
