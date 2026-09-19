"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import type { NormalizedCashOutOrder } from "@/lib/paycrest/order";
import type { VerifiedRecipientBinding } from "@/lib/paycrest/recipient";

export type FailureCategory = "DEFINITE_FAILURE" | "OUTCOME_UNKNOWN";

export type CreateOrderUiState =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "creating" }
  | {
      kind: "created";
      order: NormalizedCashOutOrder;
      transactionId?: string;
    }
  | {
      kind: "error";
      category: "DEFINITE_FAILURE";
      code: string;
      message: string;
      reference?: string;
      diagnosticId?: string;
      orderCreated?: false;
      paymentBlocked?: boolean;
      validationDetails?: Array<{ field: string; message: string }>;
      recipientChanged?: {
        accountName: string;
        institutionName: string;
      };
    }
  | {
      kind: "unknown_outcome";
      category: "OUTCOME_UNKNOWN";
      code: "ORDER_CREATION_OUTCOME_UNKNOWN";
      message: string;
      reference?: string;
      diagnosticId?: string;
      orderCreated?: boolean;
    };

export interface CashOutOrderFlow {
  state: CreateOrderUiState;
  reset: () => void;
  beginConfirm: () => void;
  cancelConfirm: () => void;
  createOrder: (input: {
    amount: string;
    recipient: VerifiedRecipientBinding;
    refundAddress: Address;
    idempotencyKey?: string;
  }) => Promise<void>;
  isCreating: boolean;
  order: NormalizedCashOutOrder | null;
  transactionId: string | null;
}

const STORAGE_KEY = "providus_active_cashout";
const IDEMPOTENCY_KEY_STORAGE = "providus_active_idem_key";

function getOrCreateActiveIdempotencyKey(): string {
  try {
    const existing = sessionStorage.getItem(IDEMPOTENCY_KEY_STORAGE);
    if (existing && existing.trim() !== "") {
      return existing.trim();
    }
    const newKey = `idem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(IDEMPOTENCY_KEY_STORAGE, newKey);
    return newKey;
  } catch {
    return `idem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Create Paycrest cash-out order via POST /api/paycrest/orders.
 * Persists active order to sessionStorage so page refresh does not lose state.
 * Never auto-creates. Caller must only invoke after deliberate confirmation.
 */
export function useCashOutOrder(): CashOutOrderFlow {
  const [state, setState] = useState<CreateOrderUiState>({ kind: "idle" });
  const creatingRef = useRef(false);

  // Hydration-safe deferred restoration from sessionStorage
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.order && typeof parsed.order.id === "string") {
          setState({
            kind: "created",
            order: parsed.order as NormalizedCashOutOrder,
            transactionId:
              typeof parsed.transactionId === "string"
                ? parsed.transactionId
                : undefined,
          });
        }
      } catch {
        // Ignore storage read/parse error
      }
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, []);

  const reset = useCallback(() => {
    creatingRef.current = false;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(IDEMPOTENCY_KEY_STORAGE);
    } catch {
      // Ignore storage error
    }
    setState({ kind: "idle" });
  }, []);

  const beginConfirm = useCallback(() => {
    setState({ kind: "confirming" });
  }, []);

  const cancelConfirm = useCallback(() => {
    setState({ kind: "idle" });
  }, []);

  const createOrder = useCallback(
    async (input: {
      amount: string;
      recipient: VerifiedRecipientBinding;
      refundAddress: Address;
      idempotencyKey?: string;
    }) => {
      if (creatingRef.current) return;
      if (state.kind === "created") return;

      creatingRef.current = true;
      setState({ kind: "creating" });

      try {
        const idempotencyKey =
          input.idempotencyKey ?? getOrCreateActiveIdempotencyKey();

        const res = await fetch("/api/paycrest/orders", {
          method: "POST",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amount: input.amount,
            institution: input.recipient.institution,
            accountIdentifier: input.recipient.accountIdentifier,
            refundAddress: input.refundAddress,
            reviewedAccountName: input.recipient.accountName,
            idempotencyKey,
          }),
        });

        const body = await res.json();

        if (
          body?.error?.code === "ORDER_CREATION_OUTCOME_UNKNOWN" ||
          Boolean(body?.orderCreated)
        ) {
          setState({
            kind: "unknown_outcome",
            category: "OUTCOME_UNKNOWN",
            code: "ORDER_CREATION_OUTCOME_UNKNOWN",
            message:
              body?.error?.message ??
              "Order creation outcome unknown. An order may have been created upstream. Do not submit again immediately.",
            reference:
              typeof body?.reference === "string" ? body.reference : undefined,
            diagnosticId:
              typeof body?.diagnosticId === "string"
                ? body.diagnosticId
                : undefined,
            orderCreated: Boolean(body?.orderCreated),
          });
          return;
        }

        if (body?.error?.code === "RECIPIENT_CHANGED") {
          setState({
            kind: "error",
            category: "DEFINITE_FAILURE",
            code: "RECIPIENT_CHANGED",
            message: body.error.message,
            recipientChanged: body.recipient
              ? {
                  accountName: String(body.recipient.accountName),
                  institutionName: String(body.recipient.institutionName),
                }
              : undefined,
          });
          return;
        }

        if (!res.ok || !body?.ok) {
          setState({
            kind: "error",
            category: "DEFINITE_FAILURE",
            code: body?.error?.code ?? "UPSTREAM_ERROR",
            message: body?.error?.message ?? "Order creation failed",
            reference:
              typeof body?.reference === "string" ? body.reference : undefined,
            diagnosticId:
              typeof body?.diagnosticId === "string"
                ? body.diagnosticId
                : undefined,
            orderCreated: false,
            paymentBlocked: Boolean(body?.paymentBlocked),
            validationDetails: Array.isArray(body?.validationDetails)
              ? body.validationDetails
              : undefined,
          });
          return;
        }

        const normalizedOrder = body.order as NormalizedCashOutOrder;
        const transactionId =
          typeof body.transactionId === "string" ? body.transactionId : undefined;

        try {
          sessionStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
              order: normalizedOrder,
              transactionId,
            }),
          );
        } catch {
          // Ignore storage write error
        }

        setState({
          kind: "created",
          order: normalizedOrder,
          transactionId,
        });
      } catch {
        setState({
          kind: "unknown_outcome",
          category: "OUTCOME_UNKNOWN",
          code: "ORDER_CREATION_OUTCOME_UNKNOWN",
          message:
            "Network error during order creation. The request may have reached the server and created an order. Do not submit again immediately.",
        });
      } finally {
        creatingRef.current = false;
      }
    },
    [state.kind],
  );

  return {
    state,
    reset,
    beginConfirm,
    cancelConfirm,
    createOrder,
    isCreating: state.kind === "creating",
    order: state.kind === "created" ? state.order : null,
    transactionId:
      state.kind === "created" && state.transactionId
        ? state.transactionId
        : null,
  };
}
