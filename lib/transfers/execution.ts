/**
 * B4A — Server-side execution-preparation for B3 wallet_transfer intents.
 *
 * Builds an unsigned transaction plan from the STORED intent only. Caller
 * supplied recipient / amount / chain / asset values are never trusted here —
 * every payment-critical field comes from the intent row plus the B1/B3
 * registries. This module never mutates intent status and never signs or
 * broadcasts: it returns calldata + value + routing for a later signing slice.
 */

import {
  encodeFunctionData,
  getAddress,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import {
  checkIntentFreshness,
  resolveTransferAsset,
  TransferError,
} from "@/lib/transfers/service";
import type { IntentStore } from "@/lib/transfers/repository";
import type { RecipientStore } from "@/lib/recipients/repository";
import {
  PROVIDUS_PAY_ABI,
  intentIdBytes,
} from "@/lib/transfers/contract";

export type ExecutionErrorCode =
  | "NOT_AUTHENTICATED"
  | "NOT_FOUND"
  | "INTENT_NOT_EXECUTABLE"
  | "INTENT_EXPIRED"
  | "STALE_RECIPIENT_REMOVED"
  | "STALE_RECIPIENT_VERSION_CHANGED"
  | "STALE_RECIPIENT_ADDRESS_CHANGED"
  | "UNSUPPORTED_CHAIN"
  | "CELO_WALLET_TRANSFER_UNSUPPORTED"
  | "UNSUPPORTED_ASSET"
  | "ASSET_MISMATCH"
  | "CONTRACT_NOT_CONFIGURED";

export class ExecutionError extends Error {
  readonly code: ExecutionErrorCode;
  constructor(code: ExecutionErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type ExecutionConfig = {
  /** Test-injectable. Production env wiring lands in a later slice, NOT here. */
  contractAddresses: Record<number, string | null | undefined>;
};

export type PrepareExecutionPlanArgs = {
  ownerAddress: string;
  intentId?: string;
  /** Alias for intentId (matches B3 getTransferIntent conventions). */
  id?: string;
  nowMs?: number;
};

export type ExecutionPlan = {
  /** Checksummed ProvidusPay contract address. */
  to: Address;
  /** Decimal bigint string: native amount, or "0" for ERC-20. */
  value: string;
  /** Encoded payNative / payToken calldata. */
  data: Hex;
  /** 0x-prefixed 32-byte intent id (terms fingerprint). */
  intentId: Hex;
  /** intent.expiresAt as unix seconds. */
  deadline: number;
  payer: Address;
  recipient: Address;
  /** Checksummed ERC-20, or null for native BOT. */
  token: Address | null;
  amountBaseUnits: string;
  chainId: number;
  environment: string;
  termsFingerprint: string;
};

function requireOwner(ownerAddress: string): Address {
  if (!ownerAddress || !isAddress(ownerAddress)) {
    throw new ExecutionError(
      "NOT_AUTHENTICATED",
      "A verified wallet session is required.",
    );
  }
  return getAddress(ownerAddress);
}

function asExecutionError(err: unknown): ExecutionError | null {
  if (err instanceof ExecutionError) return err;
  if (err instanceof TransferError) {
    const code = err.code as ExecutionErrorCode;
    if (
      code === "NOT_AUTHENTICATED" ||
      code === "NOT_FOUND" ||
      code === "UNSUPPORTED_CHAIN" ||
      code === "UNSUPPORTED_ASSET" ||
      code === "CELO_WALLET_TRANSFER_UNSUPPORTED"
    ) {
      return new ExecutionError(code, err.message);
    }
  }
  return null;
}

/**
 * Build an unsigned execution plan for a pending, fresh, unexpired intent.
 * Read-only: intent status is never mutated here.
 */
export async function prepareExecutionPlan(
  intentStore: IntentStore,
  recipientStore: RecipientStore,
  config: ExecutionConfig,
  args: PrepareExecutionPlanArgs,
): Promise<ExecutionPlan> {
  const owner = requireOwner(args.ownerAddress);
  const nowMs = args.nowMs ?? Date.now();
  const id = args.intentId ?? args.id;
  if (!id) {
    throw new ExecutionError("NOT_FOUND", "Payment intent not found.");
  }

  const intent = await intentStore.findIntentById(id);
  if (!intent || intent.ownerAddress !== owner) {
    throw new ExecutionError("NOT_FOUND", "Payment intent not found.");
  }
  if (intent.status !== "pending") {
    throw new ExecutionError(
      "INTENT_NOT_EXECUTABLE",
      "Only pending intents can be executed.",
    );
  }
  const expiresMs = Date.parse(intent.expiresAt);
  if (Number.isNaN(expiresMs) || expiresMs <= nowMs) {
    throw new ExecutionError("INTENT_EXPIRED", "Payment intent has expired.");
  }

  let freshness: Awaited<ReturnType<typeof checkIntentFreshness>>;
  try {
    freshness = await checkIntentFreshness(intentStore, recipientStore, {
      ownerAddress: owner,
      id: intent.id,
      nowMs,
    });
  } catch (err) {
    const mapped = asExecutionError(err);
    if (mapped) throw mapped;
    throw err;
  }
  if (!freshness.freshness.fresh) {
    const reason = freshness.freshness.staleReason;
    if (reason === "EXPIRED") {
      throw new ExecutionError("INTENT_EXPIRED", "Payment intent has expired.");
    }
    if (reason === "RECIPIENT_REMOVED") {
      throw new ExecutionError(
        "STALE_RECIPIENT_REMOVED",
        "Saved recipient was removed after preparation.",
      );
    }
    if (reason === "RECIPIENT_ADDRESS_CHANGED") {
      throw new ExecutionError(
        "STALE_RECIPIENT_ADDRESS_CHANGED",
        "Saved recipient address changed after preparation.",
      );
    }
    throw new ExecutionError(
      "STALE_RECIPIENT_VERSION_CHANGED",
      "Saved recipient changed after preparation.",
    );
  }

  if (intent.chainId === 42220) {
    throw new ExecutionError(
      "CELO_WALLET_TRANSFER_UNSUPPORTED",
      "Celo uses its existing cash-out and airtime flows; wallet transfers are not prepared on Celo.",
    );
  }
  if (intent.chainId !== 677 && intent.chainId !== 968) {
    throw new ExecutionError("UNSUPPORTED_CHAIN", "Chain ID is not supported.");
  }

  let asset: Awaited<ReturnType<typeof resolveTransferAsset>>;
  try {
    asset = resolveTransferAsset(intent.chainId, intent.assetSymbol);
  } catch (err) {
    const mapped = asExecutionError(err);
    if (mapped) throw mapped;
    throw err;
  }

  if (
    typeof intent.assetSymbol !== "string" ||
    intent.assetSymbol.trim().toUpperCase() !== asset.symbol
  ) {
    throw new ExecutionError("ASSET_MISMATCH", "Stored asset does not match chain registry.");
  }
  if (intent.assetDecimals !== asset.decimals) {
    throw new ExecutionError("ASSET_MISMATCH", "Stored asset decimals do not match chain registry.");
  }
  if (intent.environment !== asset.environment) {
    throw new ExecutionError("ASSET_MISMATCH", "Stored environment does not match chain registry.");
  }
  if (asset.tokenAddress === null) {
    if (intent.tokenAddress !== null) {
      throw new ExecutionError("ASSET_MISMATCH", "Native asset must not carry a token address.");
    }
  } else {
    if (
      typeof intent.tokenAddress !== "string" ||
      !isAddress(intent.tokenAddress) ||
      getAddress(intent.tokenAddress) !== asset.tokenAddress
    ) {
      throw new ExecutionError("ASSET_MISMATCH", "Stored token address does not match chain registry.");
    }
  }
  let amount: bigint;
  try {
    amount = BigInt(intent.amountBaseUnits);
  } catch {
    throw new ExecutionError("ASSET_MISMATCH", "Stored amount is not a valid integer.");
  }
  if (amount <= BigInt(0)) {
    throw new ExecutionError("ASSET_MISMATCH", "Stored amount must be greater than zero.");
  }

  const rawContract = config?.contractAddresses?.[intent.chainId];
  if (typeof rawContract !== "string" || !isAddress(rawContract)) {
    throw new ExecutionError(
      "CONTRACT_NOT_CONFIGURED",
      "No payment contract is configured for this chain.",
    );
  }
  const to = getAddress(rawContract);

  let intentId: Hex;
  try {
    intentId = intentIdBytes(intent);
  } catch {
    throw new ExecutionError("ASSET_MISMATCH", "Stored terms fingerprint is invalid.");
  }
  const deadline = Math.floor(expiresMs / 1000);
  if (!isAddress(intent.recipientAddress) || !isAddress(intent.ownerAddress)) {
    throw new ExecutionError("ASSET_MISMATCH", "Stored addresses are invalid.");
  }
  const recipient = getAddress(intent.recipientAddress);
  const payer = getAddress(intent.ownerAddress);

  let data: Hex;
  let value: string;
  let token: Address | null;
  if (asset.kind === "native") {
    data = encodeFunctionData({
      abi: PROVIDUS_PAY_ABI,
      functionName: "payNative",
      args: [intentId, recipient, BigInt(deadline)],
    });
    value = amount.toString();
    token = null;
  } else {
    if (asset.tokenAddress === null) {
      throw new ExecutionError("ASSET_MISMATCH", "Stored token address is missing.");
    }
    data = encodeFunctionData({
      abi: PROVIDUS_PAY_ABI,
      functionName: "payToken",
      args: [intentId, asset.tokenAddress, recipient, amount, BigInt(deadline)],
    });
    value = "0";
    token = getAddress(asset.tokenAddress);
  }

  return {
    to,
    value,
    data,
    intentId,
    deadline,
    payer,
    recipient,
    token,
    amountBaseUnits: amount.toString(),
    chainId: intent.chainId,
    environment: intent.environment,
    termsFingerprint: intent.termsFingerprint,
  };
}
