"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SharedMemoryDraft, SharedMemoryView, SharedMemoryUpdate } from "@/lib/shared-memory/service";

type State = {
  ownerKey: string | null;
  memories: SharedMemoryView[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  notice: string | null;
};

export type SharedMemoryResult =
  | { ok: true; memory?: SharedMemoryView }
  | { ok: false; code: string; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMemoryView(value: unknown): value is SharedMemoryView {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    (value.kind === "fact" || value.kind === "preference") &&
    typeof value.label === "string" &&
    typeof value.value === "string" &&
    typeof value.version === "number" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function readError(payload: unknown, fallback: string): { code: string; message: string } {
  if (!isRecord(payload) || !isRecord(payload.error)) return { code: "REQUEST_FAILED", message: fallback };
  return {
    code: typeof payload.error.code === "string" ? payload.error.code : "REQUEST_FAILED",
    message: typeof payload.error.message === "string" ? payload.error.message : fallback,
  };
}

function emptyState(ownerKey: string | null, loading = false): State {
  return { ownerKey, memories: [], loading, saving: false, error: null, notice: null };
}

export function useSharedMemory(input: {
  ownerAddress: string | null;
  walletAddress: string | null;
  enabled: boolean;
}) {
  const connectedOwner =
    input.ownerAddress &&
    input.walletAddress &&
    input.ownerAddress.toLowerCase() === input.walletAddress.toLowerCase()
      ? input.ownerAddress
      : null;
  const ownerKey = connectedOwner?.toLowerCase() ?? null;
  const [state, setState] = useState<State>(() => emptyState(ownerKey));
  const revisionRef = useRef(0);
  const controllersRef = useRef(new Set<AbortController>());

  const cancelRequests = useCallback(() => {
    for (const controller of controllersRef.current) controller.abort();
    controllersRef.current.clear();
  }, []);

  const load = useCallback(async (replace = true) => {
    if (!ownerKey || !connectedOwner) return;
    const revision = revisionRef.current;
    const controller = new AbortController();
    controllersRef.current.add(controller);
    if (replace) {
      setState((previous) => ({
        ...emptyState(ownerKey, true),
        memories: previous.ownerKey === ownerKey ? previous.memories : [],
      }));
    }
    try {
      const response = await fetch("/api/memories", {
        method: "GET",
        headers: { "X-Providus-Wallet": connectedOwner, Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (revision !== revisionRef.current || controller.signal.aborted) return;
      if (!response.ok || !isRecord(payload) || payload.ok !== true || !Array.isArray(payload.memories)) {
        const error = readError(payload, "Could not load saved memories.");
        setState((previous) => ({ ...previous, ownerKey, loading: false, error: error.message }));
        return;
      }
      const memories = payload.memories.filter(isMemoryView);
      if (memories.length !== payload.memories.length) {
        setState((previous) => ({ ...previous, ownerKey, loading: false, error: "Saved memories could not be read. Reload to try again." }));
        return;
      }
      setState({ ownerKey, memories, loading: false, saving: false, error: null, notice: null });
    } catch {
      if (controller.signal.aborted || revision !== revisionRef.current) return;
      setState((previous) => ({ ...previous, ownerKey, loading: false, error: "Could not load saved memories. Check your connection and retry." }));
    } finally {
      controllersRef.current.delete(controller);
    }
  }, [connectedOwner, ownerKey]);

  useEffect(() => {
    const revision = ++revisionRef.current;
    cancelRequests();
    if (!input.enabled || !ownerKey || !connectedOwner) return () => {
      if (revisionRef.current === revision) revisionRef.current += 1;
    };
    void Promise.resolve().then(() => {
      if (revisionRef.current === revision) void load();
    });
    return () => {
      if (revisionRef.current === revision) revisionRef.current += 1;
      cancelRequests();
    };
  }, [cancelRequests, connectedOwner, input.enabled, load, ownerKey]);

  const mutate = useCallback(async (
    method: "POST" | "PATCH" | "DELETE",
    url: string,
    body: unknown,
    successMessage: string,
    deletedId?: string,
  ): Promise<SharedMemoryResult> => {
    if (!ownerKey || !connectedOwner) {
      return { ok: false, code: "UNAUTHENTICATED", message: "Sign in with the wallet that owns these memories." };
    }
    const revision = revisionRef.current;
    const controller = new AbortController();
    controllersRef.current.add(controller);
    setState((previous) => ({ ...previous, error: null, notice: null, saving: true }));
    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Providus-Wallet": connectedOwner,
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (revision !== revisionRef.current || controller.signal.aborted) {
        return { ok: false, code: "OWNER_CHANGED", message: "Wallet changed. Reopen memory for the current wallet." };
      }
      if (!response.ok || !isRecord(payload) || payload.ok !== true) {
        const error = readError(payload, "Could not save this memory.");
        setState((previous) => ({ ...previous, ownerKey, saving: false, error: error.message }));
        return { ok: false, ...error };
      }
      const memory = isMemoryView(payload.memory) ? payload.memory : undefined;
      if (method !== "DELETE" && !memory) {
        const error = { code: "INVALID_RESPONSE", message: "The saved memory response could not be read." };
        setState((previous) => ({ ...previous, ownerKey, saving: false, error: error.message }));
        return { ok: false, ...error };
      }
      setState((previous) => {
        if (previous.ownerKey !== ownerKey) return previous;
        const memories = deletedId
          ? previous.memories.filter((item) => item.id !== deletedId)
          : method === "POST"
            ? [...previous.memories.filter((item) => item.id !== memory!.id), memory!]
            : previous.memories.map((item) => item.id === memory!.id ? memory! : item);
        return { ...previous, ownerKey, memories, saving: false, error: null, notice: successMessage };
      });
      return { ok: true, ...(memory ? { memory } : {}) };
    } catch {
      if (controller.signal.aborted || revision !== revisionRef.current) {
        return { ok: false, code: "OWNER_CHANGED", message: "Wallet changed. Reopen memory for the current wallet." };
      }
      const message = "Could not save this memory. Check your connection and retry.";
      setState((previous) => ({ ...previous, ownerKey, saving: false, error: message }));
      return { ok: false, code: "NETWORK_ERROR", message };
    } finally {
      controllersRef.current.delete(controller);
      if (revision === revisionRef.current) {
        setState((previous) => previous.ownerKey === ownerKey ? { ...previous, saving: false } : previous);
      }
    }
  }, [connectedOwner, ownerKey]);

  return {
    memories: state.ownerKey === ownerKey ? state.memories : [],
    loading: state.ownerKey === ownerKey && state.loading,
    saving: state.ownerKey === ownerKey && state.saving,
    error: state.ownerKey === ownerKey ? state.error : null,
    notice: state.ownerKey === ownerKey ? state.notice : null,
    reload: () => load(),
    create: (draft: SharedMemoryDraft) => mutate("POST", "/api/memories", draft, "Saved for future conversations."),
    update: (id: string, update: SharedMemoryUpdate) => mutate("PATCH", `/api/memories/${encodeURIComponent(id)}`, update, "Memory updated."),
    remove: (id: string, expectedVersion: number) => mutate(
      "DELETE",
      `/api/memories/${encodeURIComponent(id)}`,
      { expectedVersion },
      "Memory removed from future conversations.",
      id,
    ),
  };
}
