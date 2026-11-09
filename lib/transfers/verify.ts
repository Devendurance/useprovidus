/**
 * B5 — Read-only deterministic on-chain verifier for transfer submissions.
 *
 * Every check is a read: transaction, receipt, receipt logs, block hash,
 * replay flag. Nothing here broadcasts, retries, or mutates. Bounded by the
 * caller's timeouts; RPC errors yield `unknown`, never a guess.
 *
 * Outcomes:
 * - confirmed: real chain evidence matches every intent term + finality met.
 * - failed: chain evidence definitively contradicts the intent (reverted,
 *   wrong parties/amounts/contract, unexpected events).
 * - pending: no receipt yet, or confirmations below threshold.
 * - unknown: RPC outage, malformed data, contradictory chain state, reorg
 *   suspicion. Safe to recheck later; never auto-resolves to confirmed.
 */

import { decodeFunctionData, keccak256, stringToBytes } from "viem";
import { PAYMENT_ABI } from "@/lib/transfers/contract";
import type { WalletTransferIntent } from "@/lib/transfers/repository";

export type ChainTx = {
  /** May be absent on some RPC responses; authority is getChainId(). */
  chainId: number | null;
  from: string;
  to: string | null;
  value: bigint;
  input: `0x${string}`;
  blockNumber: bigint | null;
  blockHash: string | null;
};

export type ChainLog = {
  address: string;
  topics: [`0x${string}`, ...`0x${string}`[]];
  data: `0x${string}`;
};

export type ChainReceipt = {
  status: "success" | "reverted";
  from: string;
  to: string | null;
  logs: ChainLog[];
  blockNumber: bigint;
  blockHash: string;
};

export type ChainReader = {
  getChainId(): Promise<number>;
  getTransaction(hash: string): Promise<ChainTx | null>;
  getTransactionReceipt(hash: string): Promise<ChainReceipt | null>;
  getBlockNumber(): Promise<bigint>;
  getBlockHash?(blockNumber: bigint): Promise<string | null>;
  readUsedIntent?(contract: string, payer: string, intentId: string): Promise<boolean>;
};

export type VerifierConfig = {
  /** Chain-scoped ProvidusPay addresses. Null = unconfigured (fail closed). */
  contracts: Record<number, string | null>;
  /** Required confirmations per chain before `confirmed`. */
  requiredConfirmations: Record<number, number>;
};

export type VerifyOutcome = "confirmed" | "failed" | "pending" | "unknown";

export type VerifiedEvidence = {
  txHash: string;
  chainId: number;
  from: string;
  to: string;
  value: string;
  blockNumber: string;
  blockHash: string;
  confirmations: number;
  receiptStatus: "success" | "reverted";
  intentId: string;
  payer: string;
  recipient: string;
  token: string | null;
  amountBaseUnits: string;
  deadline: number;
  replayFlag: boolean | null;
};

export type VerifyResult = {
  outcome: VerifyOutcome;
  reason: string;
  evidence: VerifiedEvidence | null;
};

export const TRANSFER_EVENT_TOPIC = keccak256(stringToBytes("Transfer(address,address,uint256)"));
export const PAYMENT_EVENT_TOPIC = keccak256(
  stringToBytes("PaymentExecuted(bytes32,address,address,address,uint256)"),
);

function eqAddr(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function topicAddress(topic: string): string {
  return ("0x" + topic.slice(-40)).toLowerCase();
}

export function intentDeadlineSeconds(intent: WalletTransferIntent): number {
  return Math.floor(Date.parse(intent.expiresAt) / 1000);
}

export async function verifySubmissionOnChain(
  reader: ChainReader,
  config: VerifierConfig,
  intent: WalletTransferIntent,
  txHash: string,
): Promise<VerifyResult> {
  const fail = (reason: string): VerifyResult => ({ outcome: "failed", reason, evidence: null });
  const unknown = (reason: string): VerifyResult => ({ outcome: "unknown", reason, evidence: null });

  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return fail("MALFORMED_TX_HASH");
  }
  const expectedContract = config.contracts[intent.chainId] ?? null;
  if (!expectedContract) return unknown("CONTRACT_NOT_CONFIGURED");

  let rpcChainId: number;
  let tx: ChainTx | null;
  try {
    rpcChainId = await reader.getChainId();
    tx = await reader.getTransaction(txHash);
  } catch {
    return unknown("RPC_UNAVAILABLE");
  }
  if (rpcChainId !== intent.chainId) return fail("WRONG_CHAIN");
  if (!tx) return { outcome: "pending", reason: "RECEIPT_NOT_FOUND", evidence: null };
  if (!tx.to || !eqAddr(tx.to, expectedContract)) return fail("WRONG_CONTRACT");
  if (!eqAddr(tx.from, intent.ownerAddress)) return fail("WRONG_PAYER");

  // Exact calldata: function + every parameter must match the stored intent.
  let decoded: { functionName: string; args: unknown[] };
  try {
    const d = decodeFunctionData({ abi: PAYMENT_ABI, data: tx.input });
    decoded = { functionName: d.functionName, args: [...(d.args as readonly unknown[])] };
  } catch {
    return fail("UNEXPECTED_CALLDATA");
  }
  const isNative = intent.tokenAddress === null;
  const expectedFn = isNative ? "payNative" : "payToken";
  if (decoded.functionName !== expectedFn) return fail("WRONG_ASSET_FUNCTION");
  const [dIntentId, dSecond, dThird, dAmount, dDeadline] = decoded.args;
  const expectedIntentId = ("0x" + intent.termsFingerprint.replace(/^0x/, "")).toLowerCase();
  const norm = (v: unknown) => String(v).toLowerCase();
  if (norm(dIntentId) !== expectedIntentId) return fail("WRONG_INTENT_ID");
  const expectedDeadline = intentDeadlineSeconds(intent);
  if (isNative) {
    // payNative(intentId, recipient, deadline)
    if (norm(dSecond) !== intent.recipientAddress.toLowerCase()) return fail("WRONG_RECIPIENT");
    if (Number(dThird) !== expectedDeadline) return fail("WRONG_DEADLINE");
    if (tx.value.toString() !== intent.amountBaseUnits) return fail("WRONG_AMOUNT");  } else {
    // payToken(intentId, token, recipient, amount, deadline)
    if (!intent.tokenAddress || norm(dSecond) !== intent.tokenAddress.toLowerCase()) return fail("WRONG_TOKEN");
    if (norm(dThird) !== intent.recipientAddress.toLowerCase()) return fail("WRONG_RECIPIENT");
    if (String(dAmount) !== intent.amountBaseUnits) return fail("WRONG_AMOUNT");
    if (Number(dDeadline) !== expectedDeadline) return fail("WRONG_DEADLINE");
    if (tx.value !== BigInt(0)) return fail("UNEXPECTED_NATIVE_VALUE");
  }

  let receipt: ChainReceipt | null;
  let head: bigint;
  try {
    receipt = await reader.getTransactionReceipt(txHash);
    head = await reader.getBlockNumber();
  } catch {
    return unknown("RPC_UNAVAILABLE");
  }
  if (!receipt) return { outcome: "pending", reason: "RECEIPT_NOT_FOUND", evidence: null };
  if (receipt.status === "reverted") {
    return {
      outcome: "failed",
      reason: "TRANSACTION_REVERTED",
      evidence: null,
    };
  }

  // Exactly one PaymentExecuted from our contract, matching every term.
  const paymentEvents = receipt.logs.filter(
    (l) => eqAddr(l.address, expectedContract) && l.topics[0]?.toLowerCase() === PAYMENT_EVENT_TOPIC.toLowerCase(),
  );
  if (paymentEvents.length !== 1) return fail("UNEXPECTED_PAYMENT_EVENTS");
  const evt = paymentEvents[0];
  if (evt.topics.length < 4) return fail("MALFORMED_PAYMENT_EVENT");
  if (("0x" + evt.topics[1].slice(-64)).toLowerCase() !== expectedIntentId) return fail("WRONG_INTENT_ID");
  if (topicAddress(evt.topics[2]) !== intent.ownerAddress.toLowerCase()) return fail("WRONG_PAYER");
  if (topicAddress(evt.topics[3]) !== intent.recipientAddress.toLowerCase()) return fail("WRONG_RECIPIENT");
  const tokenWord = ("0x" + evt.data.slice(2, 66)).toLowerCase();
  const eventAmount = BigInt("0x" + evt.data.slice(66));
  const expectedToken = (isNative ? "0x" + "00".repeat(32) : (intent.tokenAddress as string).slice(2).toLowerCase().padStart(64, "0"));
  const expectedTokenWord = (expectedToken.startsWith("0x") ? expectedToken : "0x" + expectedToken).toLowerCase();
  if (tokenWord !== expectedTokenWord) return fail("WRONG_TOKEN");
  if (eventAmount.toString() !== intent.amountBaseUnits) return fail("WRONG_AMOUNT");

  // ERC-20 path: the real Transfer must move exact units payer → recipient.
  if (!isNative && intent.tokenAddress) {
    const transfers = receipt.logs.filter(
      (l) => eqAddr(l.address, intent.tokenAddress as string) && l.topics[0]?.toLowerCase() === TRANSFER_EVENT_TOPIC.toLowerCase(),
    );
    const exact = transfers.find(
      (l) =>
        l.topics.length >= 3 &&
        topicAddress(l.topics[1]) === intent.ownerAddress.toLowerCase() &&
        topicAddress(l.topics[2]) === intent.recipientAddress.toLowerCase() &&
        BigInt(l.data).toString() === intent.amountBaseUnits,
    );
    if (!exact) return fail("TOKEN_TRANSFER_MISMATCH");
  }

  // Block finality + reorg guard.
  const confirmations = Number(head - receipt.blockNumber + BigInt(1));
  const required = config.requiredConfirmations[intent.chainId] ?? 1;
  if (confirmations < required) {
    return { outcome: "pending", reason: "AWAITING_CONFIRMATIONS", evidence: null };
  }
  if (reader.getBlockHash) {
    try {
      const canonical = await reader.getBlockHash(receipt.blockNumber);
      if (canonical && canonical.toLowerCase() !== receipt.blockHash.toLowerCase()) {
        return unknown("REORG_SUSPECTED");
      }
    } catch {
      return unknown("RPC_UNAVAILABLE");
    }
  }

  // Replay flag: must be set after a successful payment.
  let replayFlag: boolean | null = null;
  if (reader.readUsedIntent) {
    try {
      replayFlag = await reader.readUsedIntent(expectedContract, intent.ownerAddress, expectedIntentId);
      if (!replayFlag) return unknown("REPLAY_FLAG_MISSING");
    } catch {
      return unknown("RPC_UNAVAILABLE");
    }
  }

  return {
    outcome: "confirmed",
    reason: "VERIFIED_ONCHAIN",
    evidence: {
      txHash,
      chainId: intent.chainId,
      from: tx.from,
      to: tx.to,
      value: tx.value.toString(),
      blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash,
      confirmations,
      receiptStatus: "success",
      intentId: expectedIntentId,
      payer: intent.ownerAddress,
      recipient: intent.recipientAddress,
      token: intent.tokenAddress,
      amountBaseUnits: intent.amountBaseUnits,
      deadline: expectedDeadline,
      replayFlag,
    },
  };
}
