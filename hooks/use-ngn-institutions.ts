"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InstitutionSummary } from "@/lib/paycrest/types";

export type InstitutionsState =
  | { kind: "loading" }
  | { kind: "ready"; institutions: InstitutionSummary[]; checkedAt: string }
  | { kind: "empty"; checkedAt: string }
  | { kind: "error"; code: string; message: string };

export function useNgnInstitutions(enabled: boolean) {
  const [state, setState] = useState<InstitutionsState>({ kind: "loading" });
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!enabled) return;
    const id = ++seq.current;
    const t = window.setTimeout(() => {
      if (id === seq.current) setState({ kind: "loading" });
    }, 0);
    try {
      const res = await fetch("/api/paycrest/institutions", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const body = await res.json();
      if (id !== seq.current) return;
      if (!res.ok) {
        setState({
          kind: "error",
          code: body?.error?.code ?? "UPSTREAM_ERROR",
          message: body?.error?.message ?? "Could not load banks",
        });
        return;
      }
      const list = Array.isArray(body.institutions)
        ? (body.institutions as InstitutionSummary[])
        : [];
      const checkedAt =
        typeof body.checkedAt === "string"
          ? body.checkedAt
          : new Date().toISOString();
      if (list.length === 0) {
        setState({ kind: "empty", checkedAt });
        return;
      }
      setState({ kind: "ready", institutions: list, checkedAt });
    } catch {
      if (id !== seq.current) return;
      setState({
        kind: "error",
        code: "UPSTREAM_UNAVAILABLE",
        message: "Could not load NGN banks",
      });
    } finally {
      window.clearTimeout(t);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const t = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(t);
  }, [enabled, load]);

  return { state, refresh: load };
}
