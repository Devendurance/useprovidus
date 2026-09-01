"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CorridorQuote } from "@/lib/paycrest/types";

export type SupportApiSuccess = {
  network: "celo";
  token: "USDC";
  fiat: "NGN";
  tokenSupported: boolean;
  contractAddress: string;
  decimals: number;
  canonical: {
    address: string;
    decimals: number;
    source: string;
  };
  contractMatchesCanonical: boolean;
  decimalsMatchCanonical: boolean;
  tokenCompatible: boolean;
  quoteReadiness: boolean;
  buy: CorridorQuote;
  sell: CorridorQuote;
  live: true;
  checkedAt: string;
};

export type SupportState =
  | { kind: "loading" }
  | { kind: "ready"; data: SupportApiSuccess }
  | { kind: "mismatch"; data: SupportApiSuccess }
  | { kind: "error"; code: string; message: string };

export function usePaycrestSupport(enabled = true) {
  const [state, setState] = useState<SupportState>({ kind: "loading" });
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!enabled) return;
    const id = ++seq.current;
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/paycrest/support", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const body = await res.json();
      if (id !== seq.current) return;
      if (!res.ok) {
        setState({
          kind: "error",
          code: body?.error?.code ?? "UPSTREAM_ERROR",
          message: body?.error?.message ?? "Support check failed",
        });
        return;
      }
      const data = body as SupportApiSuccess;
      if (!data.tokenCompatible || !data.quoteReadiness) {
        setState({ kind: "mismatch", data });
        return;
      }
      setState({ kind: "ready", data });
    } catch {
      if (id !== seq.current) return;
      setState({
        kind: "error",
        code: "UPSTREAM_UNAVAILABLE",
        message: "Could not verify Paycrest token support",
      });
    }
  }, [enabled]);

  useEffect(() => {
    // Defer so setState is not synchronous in the effect body (lint rule).
    const t = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  return { state, refresh: load };
}
