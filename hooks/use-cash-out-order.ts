"use client";

import { useCallback, useRef, useState } from "react";
import type { Address } from "viem";
import type { NormalizedCashOutOrder } from "@/lib/paycrest/order";
import type { VerifiedRecipientBinding } from "@/lib/paycrest/recipient";

export type CreateOrderUiState =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "creating" }
  | { kind: "created"; order: NormalizedCashOutOrder }
  | {
      kind: "error";
      code: string;
      message: string;
      reference?: string;
      diagnosticId?: string;
      orderCreated?: boolean;
      paymentBlocked?: boolean;
      validationDetails?: Array<{ field: string; message: string }>;
      recipientChanged?: {
        accountName: string;
        institutionName: string;
      };
    }
  | {
      kind: "unknown_outcome";
      code: "ORDER_CREATION_OUTCOME_UNKNOWN";
      message: string;
      reference?: string;
    };

/**
 * Create Paycrest cash-out order via POST /api/paycrest/orders.
 * Never auto-creates. Caller must only invoke after deliberate confirmation.
 */
export function useCashOutOrder() {
  const [state, setState] = useState<CreateOrderUiState>({ kind: "idle" });
  const creatingRef = useRef(false);

  const reset = useCallback(() => {
    creatingRef.current = false;
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
    }) => {
      if (creatingRef.current) return;
      if (state.kind === "created") return;

      creatingRef.current = true;
      setState({ kind: "creating" });

      try {
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
          }),
        });

        const body = await res.json();

        if (body?.error?.code === "ORDER_CREATION_OUTCOME_UNKNOWN") {
          setState({
            kind: "unknown_outcome",
            code: "ORDER_CREATION_OUTCOME_UNKNOWN",
            message: body.error.message,
            reference:
              typeof body.reference === "string" ? body.reference : undefined,
          });
          return;
        }

        if (body?.error?.code === "RECIPIENT_CHANGED") {
          setState({
            kind: "error",
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
            code: body?.error?.code ?? "UPSTREAM_ERROR",
            message: body?.error?.message ?? "Order creation failed",
            reference:
              typeof body?.reference === "string" ? body.reference : undefined,
            diagnosticId:
              typeof body?.diagnosticId === "string"
                ? body.diagnosticId
                : undefined,
            orderCreated: Boolean(body?.orderCreated),
            paymentBlocked: Boolean(body?.paymentBlocked),
            validationDetails: Array.isArray(body?.validationDetails)
              ? body.validationDetails
              : undefined,
          });
          return;
        }

        setState({
          kind: "created",
          order: body.order as NormalizedCashOutOrder,
        });
      } catch {
        setState({
          kind: "error",
          code: "PAYCREST_UNAVAILABLE",
          message: "Network error during order creation",
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
  };
}
