"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicTransactionDto } from "@/lib/transactions/types";

export type CashOutStage =
  | "awaiting_payment"
  | "deposit_confirming"
  | "deposit_confirmed"
  | "settling"
  | "settled"
  | "failed"
  | "recovery_required";

export interface TransactionStatusState {
  loading: boolean;
  transaction: PublicTransactionDto | null;
  stage: CashOutStage;
  stageLabel: string;
  stageDescription: string;
  isFiatFinal: boolean;
  isDepositConfirmed: boolean;
  error: string | null;
}

const POLL_INTERVAL_MS = 5000;

export function useTransactionStatus(
  transactionId: string | null | undefined,
  options?: {
    enabled?: boolean;
    onFiatSettled?: () => void;
  },
) {
  const [state, setState] = useState<TransactionStatusState>({
    loading: Boolean(transactionId && options?.enabled !== false),
    transaction: null,
    stage: "awaiting_payment",
    stageLabel: "Awaiting payment",
    stageDescription: "Waiting for USDC deposit on Celo.",
    isFiatFinal: false,
    isDepositConfirmed: false,
    error: null,
  });

  const settledCalledRef = useRef(false);

  const fetchStatus = useCallback(
    async (id: string, reconcile = false) => {
      try {
        const url = `/api/transactions/${encodeURIComponent(id)}${
          reconcile ? "?reconcile=true" : ""
        }`;
        const res = await fetch(url, {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

        if (!res.ok) {
          if (res.status === 404) {
            setState((prev) => ({
              ...prev,
              loading: false,
              error: "Transaction not found",
            }));
            return null;
          }
          setState((prev) => ({
            ...prev,
            loading: false,
            error: "Could not fetch transaction status",
          }));
          return null;
        }

        const data = await res.json();
        if (data.ok && data.transaction) {
          setState({
            loading: false,
            transaction: data.transaction,
            stage: data.stage ?? "awaiting_payment",
            stageLabel: data.stageLabel ?? "Awaiting payment",
            stageDescription: data.stageDescription ?? "",
            isFiatFinal: Boolean(data.isFiatFinal),
            isDepositConfirmed: Boolean(data.isDepositConfirmed),
            error: null,
          });

          if (data.isFiatFinal && !settledCalledRef.current) {
            settledCalledRef.current = true;
            options?.onFiatSettled?.();
          }

          return data;
        }
        return null;
      } catch {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: "Network error fetching status",
        }));
        return null;
      }
    },
    [options],
  );

  const confirmDeposit = useCallback(
    async (celoTxHash: string): Promise<boolean> => {
      if (!transactionId) return false;
      try {
        const res = await fetch(
          `/api/transactions/${encodeURIComponent(transactionId)}/confirm-deposit`,
          {
            method: "POST",
            cache: "no-store",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ celoTxHash }),
          },
        );

        const data = await res.json();
        if (data.ok && data.transaction) {
          setState((prev) => ({
            ...prev,
            transaction: data.transaction,
            stage: "deposit_confirmed",
            stageLabel: "Celo deposit confirmed",
            stageDescription:
              "Celo USDC deposit confirmed on-chain. Waiting for Paycrest NGN bank settlement.",
            isDepositConfirmed: true,
          }));
          // Immediately trigger initial reconciliation and activate polling
          fetchStatus(transactionId, true);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [transactionId, fetchStatus],
  );

  // State-driven polling effect: runs and continues polling whenever stage is settling or deposit_confirmed
  useEffect(() => {
    if (!transactionId || options?.enabled === false) {
      return;
    }

    const shouldPoll =
      state.stage === "settling" || state.stage === "deposit_confirmed";

    if (!shouldPoll) {
      return;
    }

    let active = true;
    let timerId: number | null = null;

    const poll = async () => {
      const result = await fetchStatus(transactionId, true);
      if (!active) return;
      const currentStage = result?.stage;
      if (
        currentStage === "settling" ||
        currentStage === "deposit_confirmed"
      ) {
        timerId = window.setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    timerId = window.setTimeout(poll, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearTimeout(timerId as number);
    };
  }, [transactionId, state.stage, options?.enabled, fetchStatus]);

  // On initial mount, fetch current transaction state
  useEffect(() => {
    if (!transactionId || options?.enabled === false) return;
    const timer = setTimeout(() => {
      fetchStatus(transactionId, true);
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [transactionId, options?.enabled, fetchStatus]);

  const refetch = useCallback(() => {
    if (transactionId) {
      return fetchStatus(transactionId, true);
    }
    return Promise.resolve(null);
  }, [transactionId, fetchStatus]);

  return {
    ...state,
    confirmDeposit,
    refetch,
  };
}
