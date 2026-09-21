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

export function isTerminalTransactionState(
  stage: string | undefined,
  status: string | undefined,
): boolean {
  return (
    stage === "airtime_delivered" ||
    stage === "failed" ||
    stage === "recovery_required" ||
    status === "completed" ||
    status === "failed" ||
    status === "refunded"
  );
}

export function shouldPollTransactionStatus(
  stage: string | undefined,
  type: string | undefined,
  status: string | undefined,
): boolean {
  if (isTerminalTransactionState(stage, status)) {
    return false;
  }

  if (type === "airtime") {
    return (
      stage === "settling" ||
      stage === "deposit_confirmed" ||
      stage === "settled" ||
      stage === "airtime_submitting" ||
      stage === "airtime_processing" ||
      stage === "airtime_reconciliation_required"
    );
  }

  return stage === "settling" || stage === "deposit_confirmed";
}

interface PollableTransactionResult {
  stage?: string;
  transaction?: {
    type?: string;
    status?: string;
  };
}

export function createTransactionPollingController(
  request: () => Promise<PollableTransactionResult | null>,
  setTimer: (callback: () => void, delayMs: number) => number,
  clearTimer: (timerId: number) => void,
) {
  let active = true;
  let timerId: number | null = null;

  const poll = async () => {
    const result = await request();
    if (!active || !result) return;
    if (
      shouldPollTransactionStatus(
        result.stage,
        result.transaction?.type,
        result.transaction?.status,
      )
    ) {
      timerId = setTimer(() => void poll(), POLL_INTERVAL_MS);
    }
  };

  return {
    start(stage: string | undefined, type: string | undefined, status: string | undefined) {
      if (shouldPollTransactionStatus(stage, type, status)) {
        timerId = setTimer(() => void poll(), POLL_INTERVAL_MS);
      }
    },
    stop() {
      active = false;
      if (timerId !== null) {
        clearTimer(timerId);
      }
    },
  };
}

export function useTransactionStatus(
  transactionId: string | null | undefined,
  options?: {
    enabled?: boolean;
    onFiatSettled?: () => void;
    onAirtimeDelivered?: () => void;
  },
) {
  const enabled = options?.enabled !== false;
  const onFiatSettled = options?.onFiatSettled;
  const onAirtimeDelivered = options?.onAirtimeDelivered;
  const [state, setState] = useState<TransactionStatusState>({
    loading: Boolean(transactionId && enabled),
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
  const onFiatSettledRef = useRef(onFiatSettled);
  const onAirtimeDeliveredRef = useRef(onAirtimeDelivered);
  useEffect(() => {
    onFiatSettledRef.current = onFiatSettled;
    onAirtimeDeliveredRef.current = onAirtimeDelivered;
  }, [onFiatSettled, onAirtimeDelivered]);
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
            onFiatSettledRef.current?.();
          }

          if (data.isAirtimeDelivered && !airtimeDeliveredCalledRef.current) {
            airtimeDeliveredCalledRef.current = true;
            onAirtimeDeliveredRef.current?.();
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
    [],
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
  useEffect(() => {
    if (!transactionId || !enabled) {
      return;
    }

    const controller = createTransactionPollingController(
      () => fetchStatus(transactionId, true),
      (callback, delayMs) => window.setTimeout(callback, delayMs),
      (timerId) => window.clearTimeout(timerId),
    );
    controller.start(
      state.stage,
      state.transaction?.type,
      state.transaction?.status,
    );

    return () => {
      controller.stop();
    };
  }, [
    transactionId,
    state.stage,
    state.transaction?.type,
    state.transaction?.status,
    enabled,
    fetchStatus,
  ]);

  // On initial mount, fetch current transaction state
  useEffect(() => {
    if (!transactionId || !enabled) return;
    const timer = setTimeout(() => {
      fetchStatus(transactionId, false);
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [transactionId, enabled, fetchStatus]);

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
