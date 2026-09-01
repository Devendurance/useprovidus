"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  usePublicClient,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import type { Address, Hash } from "viem";
import { CANONICAL_CELO_USDC } from "@/lib/celo/usdc";
import { usdcToBaseUnits } from "@/lib/money/decimal";
import {
  calculateMaxCeloGasFee,
  isPaymentWindowOpen,
  PAYMENT_EXPIRY_SAFETY_MS,
  type NormalizedCashOutOrder,
} from "@/lib/paycrest/order";
import { CELO_CHAIN_ID } from "@/lib/wallet/celo";
import { erc20BalanceOfAbi, erc20TransferAbi } from "@/lib/wallet/erc20";

export type DepositUiState =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "submitting" }
  | { kind: "submitted"; hash: Hash }
  | { kind: "confirmed"; hash: Hash }
  | { kind: "reverted"; message: string; hash?: Hash }
  | { kind: "error"; message: string; hash?: Hash };

export function useUsdcDeposit(onConfirmed?: () => void) {
  const [uiPhase, setUiPhase] = useState<
    "idle" | "confirming" | "submitting" | "locked"
  >("idle");
  const [localError, setLocalError] = useState<string | null>(null);

  const publicClient = usePublicClient({ chainId: CELO_CHAIN_ID });
  const { writeContract, data: hash, error, reset: resetWrite, isPending } =
    useWriteContract();

  const receipt = useWaitForTransactionReceipt({
    hash,
    chainId: CELO_CHAIN_ID,
    query: {
      enabled: Boolean(hash),
    },
  });

  const state: DepositUiState = useMemo(() => {
    if (localError) {
      return {
        kind: "error",
        message: localError,
        hash: hash ?? undefined,
      };
    }
    if (receipt.isSuccess && receipt.data) {
      if (receipt.data.status === "success") {
        return { kind: "confirmed", hash: receipt.data.transactionHash ?? hash };
      } else if (receipt.data.status === "reverted") {
        return { kind: "reverted", message: "Transaction reverted on Celo mainnet", hash: receipt.data.transactionHash ?? hash };
      }
    }
    if (hash) {
      return { kind: "submitted", hash };
    }
    if (error) {
      const msg =
        error instanceof Error
          ? error.message
          : "Wallet rejected or transfer failed";
      const lower = msg.toLowerCase();
      const friendly =
        lower.includes("user rejected") || lower.includes("user denied")
          ? "Payment rejected in wallet"
          : msg;
      return { kind: "error", message: friendly };
    }
    if (uiPhase === "submitting" || isPending) {
      return { kind: "submitting" };
    }
    if (uiPhase === "confirming") {
      return { kind: "confirming" };
    }
    return { kind: "idle" };
  }, [error, hash, isPending, localError, receipt.isSuccess, receipt.data, uiPhase]);

  // Hook to call onConfirmed exactly once when receipt is successful
  useEffect(() => {
    if (state.kind === "confirmed" && onConfirmed) {
      onConfirmed();
    }
  }, [state.kind, onConfirmed]);

  const reset = useCallback(() => {
    resetWrite();
    setLocalError(null);
    setUiPhase("idle");
  }, [resetWrite]);

  const beginConfirm = useCallback(() => {
    setLocalError(null);
    setUiPhase("confirming");
  }, []);

  const cancelConfirm = useCallback(() => {
    setUiPhase("idle");
  }, []);

  const simulateAndPay = useCallback(
    async (input: { order: NormalizedCashOutOrder; walletAddress: Address }) => {
      if (hash || isPending) return;
      if (!publicClient) {
        setLocalError("Celo public client not available");
        return;
      }

      const { order, walletAddress } = input;
      const receiveAddress = order.providerAccount.receiveAddress;
      const validUntil = order.providerAccount.validUntil;

      // a. Pre-simulation Expiry Check
      const winCheck1 = isPaymentWindowOpen(validUntil, Date.now());
      if (!winCheck1.open || (winCheck1.msRemaining && winCheck1.msRemaining <= PAYMENT_EXPIRY_SAFETY_MS)) {
        setLocalError("Order expired or inside 60s safety margin");
        return;
      }

      // b. Wallet & Network Check
      if (walletAddress !== order.refundAddress) {
        setLocalError("Wallet address does not match refund address");
        return;
      }

      let value: bigint;
      try {
        value = usdcToBaseUnits(order.totalUsdcToSend, CANONICAL_CELO_USDC.decimals);
      } catch {
        setLocalError("Invalid USDC total for transfer");
        return;
      }

      if (value <= BigInt(0)) {
        setLocalError("Transfer amount must be positive");
        return;
      }

      setLocalError(null);
      setUiPhase("submitting");

      try {
        // c. USDC Balance Refetch & Verification
        const balance = await publicClient.readContract({
          address: CANONICAL_CELO_USDC.address,
          abi: erc20BalanceOfAbi,
          functionName: "balanceOf",
          args: [walletAddress],
        });

        if (balance < value) {
          setLocalError("Insufficient USDC balance");
          setUiPhase("idle");
          return;
        }

        // d. CELO Native Gas Check
        const celoBalance = await publicClient.getBalance({ address: walletAddress });
        const gasEstimate = await publicClient.estimateContractGas({
          address: CANONICAL_CELO_USDC.address,
          abi: erc20TransferAbi,
          functionName: "transfer",
          args: [receiveAddress as Address, value],
          account: walletAddress,
        });
        const gasPrice = await publicClient.getGasPrice();
        const maxGasCost = calculateMaxCeloGasFee(gasEstimate, gasPrice);

        if (celoBalance < maxGasCost) {
          setLocalError("Insufficient native CELO balance for transaction gas (estimated fee + 25% safety buffer)");
          setUiPhase("idle");
          return;
        }

        // e. Explicit Simulation
        const { request } = await publicClient.simulateContract({
          address: CANONICAL_CELO_USDC.address,
          abi: erc20TransferAbi,
          functionName: "transfer",
          args: [receiveAddress as Address, value],
          account: walletAddress,
        });

        // f. Post-simulation Expiry Recheck
        const winCheck2 = isPaymentWindowOpen(validUntil, Date.now());
        if (!winCheck2.open || (winCheck2.msRemaining && winCheck2.msRemaining <= PAYMENT_EXPIRY_SAFETY_MS)) {
          setLocalError("Order expired during simulation preparation");
          setUiPhase("idle");
          return;
        }

        // g. Wallet Execution
        writeContract(request);
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : "Simulation failed");
        setUiPhase("idle");
      }
    },
    [hash, isPending, publicClient, writeContract],
  );

  return {
    state,
    reset,
    beginConfirm,
    cancelConfirm,
    simulateAndPay,
    isSubmitting: state.kind === "submitting" || isPending,
    isSubmitted: state.kind === "submitted" || state.kind === "confirmed",
    isConfirmed: state.kind === "confirmed",
    effectiveHash:
      state.kind === "confirmed" || state.kind === "submitted" || state.kind === "reverted"
        ? state.hash
        : hash,
  };
}
