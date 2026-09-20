"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicTransactionDto } from "@/lib/transactions/types";
import type { TransactionStage, CashOutStage } from "@/lib/transactions/status";

export type { TransactionStage, CashOutStage };

export interface TransactionStatusState {
  loading: boolean;
  transaction: PublicTransactionDto | null;
  stage: TransactionStage;
  stageLabel: string;
  stageDescription: string;
  isFiatFinal: boolean;
  isFiatDelivered?: boolean;
  isDepositConfirmed: boolean;
  isAirtimeDelivered?: boolean;
  isReconciliationRequired?: boolean;
  error: string | null;
}

const POLL_INTERVAL_MS = 5000;

export function useTransactionStatus(
  transactionId: string | null | undefined,
  options?: {
    enabled?: boolean;
    onFiatSettled?: () => void;
    onAirtimeDelivered?: () => void;
  },
) {
  const [state, setState] = useState<TransactionStatusState>({
    loading: Boolean(transactionId && options?.enabled !== false),
    transaction: null,
    stage: "awaiting_payment",
    stageLabel: "Awaiting payment",
    stageDescription: "Waiting for USDC deposit on Celo.",
    isFiatFinal: false,
    isFiatDelivered: false,
    isDepositConfirmed: false,
    isAirtimeDelivered: false,
    isReconciliationRequired: false,
    error: null,
  });

  const settledCalledRef = useRef(false);
  const airtimeDeliveredCalledRef = useRef(false);
  const fulfilTriggeredRef = useRef<Record<string, boolean>>({});

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
            isFiatDelivered: Boolean(data.isFiatDelivered),
            isDepositConfirmed: Boolean(data.isDepositConfirmed),
            isAirtimeDelivered: Boolean(data.isAirtimeDelivered),
            isReconciliationRequired: Boolean(data.isReconciliationRequired),
            error: null,
          });

          if (data.isFiatFinal && !settledCalledRef.current) {
            settledCalledRef.current = true;
            options?.onFiatSettled?.();
          }

          if (data.isAirtimeDelivered && !airtimeDeliveredCalledRef.current) {
            airtimeDeliveredCalledRef.current = true;
            options?.onAirtimeDelivered?.();
          }

          // When an airtime transaction reaches a settled state with Paycrest
          // fiat delivery confirmed, auto-trigger POST
          // /api/transactions/[id]/fulfil once. A settled row without a
          // confirmed fiat milestone is not a green light: no purchase may be
          // triggered from it.
          if (
            data.transaction.type === "airtime" &&
            (data.stage === "settled" ||
              data.transaction.status === "settled") &&
            data.isFiatDelivered === true &&
            !fulfilTriggeredRef.current[data.transaction.id]
          ) {
            const transactionIdToFulfil = data.transaction.id;
            fulfilTriggeredRef.current[transactionIdToFulfil] = true;
            void (async () => {
              try {
                const fulfilRes = await fetch(
                  `/api/transactions/${encodeURIComponent(transactionIdToFulfil)}/fulfil`,
                  {
                    method: "POST",
                    cache: "no-store",
                    headers: { Accept: "application/json" },
                  },
                );
                // A 5xx (notably 503 FLOAT_CHECK_UNAVAILABLE) is not a verdict
                // on the transaction: nothing was purchased, so the flag is
                // cleared and the next poll may retry. A 4xx verdict is final
                // and keeps the flag, so the client never loops on it.
                if (!fulfilRes.ok && fulfilRes.status >= 500) {
                  delete fulfilTriggeredRef.current[transactionIdToFulfil];
                }
              } catch {
                // Network error; the next poll retries the trigger.
                delete fulfilTriggeredRef.current[transactionIdToFulfil];
              }
            })();
          }

          return data;
        }
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

    const isAirtime = state.transaction?.type === "airtime";
    const shouldPoll = isAirtime
      ? state.stage === "settling" ||
        state.stage === "deposit_confirmed" ||
        state.stage === "settled" ||
        state.stage === "airtime_submitting" ||
        state.stage === "airtime_processing" ||
        state.stage === "airtime_reconciliation_required"
      : state.stage === "settling" ||
        state.stage === "deposit_confirmed" ||
        state.stage === "airtime_submitting" ||
        state.stage === "airtime_processing" ||
        state.stage === "airtime_reconciliation_required";

    if (!shouldPoll) {
      return;
    }

    let active = true;
    let timerId: number | null = null;

    const poll = async () => {
      const result = await fetchStatus(transactionId, true);
      if (!active) return;
      const currentStage = result?.stage;
      const isResultAirtime = result?.transaction?.type === "airtime";
      const continuePolling = isResultAirtime
        ? currentStage === "settling" ||
          currentStage === "deposit_confirmed" ||
          currentStage === "settled" ||
          currentStage === "airtime_submitting" ||
          currentStage === "airtime_processing" ||
          currentStage === "airtime_reconciliation_required"
        : currentStage === "settling" ||
          currentStage === "deposit_confirmed" ||
          currentStage === "airtime_submitting" ||
          currentStage === "airtime_processing" ||
          currentStage === "airtime_reconciliation_required";

      if (continuePolling) {
        timerId = window.setTimeout(poll, POLL_INTERVAL_MS);
      }
    };
    timerId = window.setTimeout(poll, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearTimeout(timerId as number);
    };
  }, [
    transactionId,
    state.stage,
    state.transaction?.type,
    options?.enabled,
    fetchStatus,
  ]);

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
