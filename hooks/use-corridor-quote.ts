"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { validateUsdcAmount } from "@/lib/money/usdc-amount";
import { multiplyDecimalStrings } from "@/lib/money/decimal";
import type { CorridorQuote, PaycrestSide } from "@/lib/paycrest/types";

const DEBOUNCE_MS = 450;

export type CorridorApiSuccess = {
  corridor: { network: "celo"; token: "USDC"; fiat: "NGN" };
  quote: CorridorQuote;
  live: true;
  timeSensitive: true;
};

export type CorridorApiErrorBody = {
  error: { code: string; message: string };
};

export type QuoteUiState =
  | { kind: "idle" }
  | { kind: "invalid_amount"; message: string }
  | { kind: "loading"; side: PaycrestSide; amount: string }
  | {
      kind: "available";
      side: PaycrestSide;
      amount: string;
      quote: Extract<CorridorQuote, { available: true }>;
      estimatedNgn: string;
      live: true;
      timeSensitive: true;
    }
  | {
      kind: "no_provider";
      side: PaycrestSide;
      amount: string;
      quote: Extract<CorridorQuote, { available: false }>;
      live: true;
    }
  | {
      kind: "error";
      side: PaycrestSide | null;
      amount: string | null;
      code: string;
      message: string;
      httpStatus: number | null;
    };

type UseCorridorQuoteArgs = {
  side: PaycrestSide;
  amount: string;
  enabled?: boolean;
};

export function useCorridorQuote({
  side,
  amount,
  enabled = true,
}: UseCorridorQuoteArgs) {
  const [state, setState] = useState<QuoteUiState>({ kind: "idle" });
  const requestSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const fetchQuote = useCallback(
    async (nextSide: PaycrestSide, nextAmount: string) => {
      const validation = validateUsdcAmount(nextAmount);
      if (!validation.ok) {
        setState({
          kind: "invalid_amount",
          message: validation.message,
        });
        return;
      }

      if (!enabled) {
        setState({ kind: "idle" });
        return;
      }

      const seq = ++requestSeq.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({
        kind: "loading",
        side: nextSide,
        amount: validation.data,
      });

      try {
        const url = `/api/paycrest/corridor?side=${encodeURIComponent(nextSide)}&amount=${encodeURIComponent(validation.data)}`;
        const res = await fetch(url, {
          method: "GET",
          signal: controller.signal,
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

        if (seq !== requestSeq.current) return;

        const body = (await res.json()) as
          | CorridorApiSuccess
          | CorridorApiErrorBody;

        if (seq !== requestSeq.current) return;

        if (!res.ok) {
          const err = "error" in body ? body.error : null;
          setState({
            kind: "error",
            side: nextSide,
            amount: validation.data,
            code: err?.code ?? "UPSTREAM_ERROR",
            message: err?.message ?? "Could not fetch quote",
            httpStatus: res.status,
          });
          return;
        }

        if (!("quote" in body) || !body.quote) {
          setState({
            kind: "error",
            side: nextSide,
            amount: validation.data,
            code: "PARSE_ERROR",
            message: "Unexpected quote response",
            httpStatus: res.status,
          });
          return;
        }

        const quote = body.quote;
        if (!quote.available) {
          setState({
            kind: "no_provider",
            side: nextSide,
            amount: validation.data,
            quote,
            live: true,
          });
          return;
        }

        let estimatedNgn: string;
        try {
          estimatedNgn = multiplyDecimalStrings(validation.data, quote.rate);
        } catch {
          setState({
            kind: "error",
            side: nextSide,
            amount: validation.data,
            code: "PARSE_ERROR",
            message: "Could not compute NGN estimate from rate",
            httpStatus: res.status,
          });
          return;
        }

        setState({
          kind: "available",
          side: nextSide,
          amount: validation.data,
          quote,
          estimatedNgn,
          live: true,
          timeSensitive: true,
        });
      } catch (err) {
        if (seq !== requestSeq.current) return;
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setState({
          kind: "error",
          side: nextSide,
          amount: nextAmount,
          code: "UPSTREAM_UNAVAILABLE",
          message: "Network error while fetching quote",
          httpStatus: null,
        });
      }
    },
    [enabled],
  );

  // Debounced amount/side-driven fetch — schedule only (no sync setState in effect body).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!enabled) {
        setState({ kind: "idle" });
        return;
      }

      const trimmed = amount.trim();
      if (trimmed === "") {
        setState({ kind: "idle" });
        return;
      }

      const validation = validateUsdcAmount(trimmed);
      if (!validation.ok) {
        setState({ kind: "invalid_amount", message: validation.message });
        return;
      }

      void fetchQuote(side, validation.data);
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [amount, side, enabled, fetchQuote]);

  const refresh = useCallback(() => {
    const validation = validateUsdcAmount(amount.trim());
    if (!validation.ok) {
      setState({ kind: "invalid_amount", message: validation.message });
      return;
    }
    void fetchQuote(side, validation.data);
  }, [amount, side, fetchQuote]);

  return {
    state,
    refresh,
    isLoading: state.kind === "loading",
  };
}
