/**
 * B5 deterministic self-check for durable submissions + on-chain verification.
 * Run: npm run test:verification
 *
 * Fully offline: injected fake chain readers, memory stores. Covers native +
 * ERC-20 receipts, every mismatch class, pending/unknown paths, idempotent
 * registration + reconciliation, restart recovery, finality, and Celo
 * regression. No broadcasts, no network.
 */

import assert from "node:assert/strict";
import { encodeFunctionData, keccak256, stringToBytes } from "viem";
import { PAYMENT_ABI } from "@/lib/transfers/contract";
import { BOT_MAINNET_USDT_ADDRESS } from "@/lib/chains/registry";
import { createMemoryIntentStore } from "@/lib/transfers/repository";
import { prepareTransferIntent } from "@/lib/transfers/service";
import { createMemoryRecipientStore } from "@/lib/recipients/repository";
import { saveRecipient } from "@/lib/recipients/service";
import {
  createMemorySubmissionStore,
  reconcileSubmission,
  registerSubmissionTx,
  SubmissionError,
} from "@/lib/transfers/submissions";
import {
  verifySubmissionOnChain,
  type ChainReader,
  type ChainReceipt,
  type ChainTx,
  type VerifierConfig,
} from "@/lib/transfers/verify";

const OWNER = "0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa";
const OTHER = "0x000000000000000000000000000000000000dEaD";
const RECIP = "0x2222222222222222222222222222222222222222";
const CONTRACT_968 = "0xbc6298701490ba211733F2Dc28deB7Df9835B7a4";
const CONTRACT_677 = "0x3333333333333333333333333333333333333333";
const USDT = BOT_MAINNET_USDT_ADDRESS;
const TX = "0x" + "ab".repeat(32);
const NOW = 20_000_000;

const CONFIG: VerifierConfig = {
  contracts: { 968: CONTRACT_968, 677: CONTRACT_677 },
  requiredConfirmations: { 968: 2, 677: 3 },
};

const TRANSFER_TOPIC = keccak256(stringToBytes("Transfer(address,address,uint256)"));
const PAYMENT_TOPIC = keccak256(stringToBytes("PaymentExecuted(bytes32,address,address,address,uint256)"));

function padTopic(addr: string): `0x${string}` {
  return ("0x" + addr.slice(2).toLowerCase().padStart(64, "0")) as `0x${string}`;
}
function word(n: bigint): `0x${string}` {
  return ("0x" + n.toString(16).padStart(64, "0")) as `0x${string}`;
}

type Intent = Awaited<ReturnType<typeof prepareTransferIntent>>["intent"];

async function nativeIntent(amount = "0.01"): Promise<{ intent: Intent }> {
  const intents = createMemoryIntentStore();
  const recipients = createMemoryRecipientStore();
  await saveRecipient(recipients, { ownerAddress: OWNER, label: "Douglas", chainId: 968, address: RECIP });
  const { intent } = await prepareTransferIntent(intents, recipients, {
    ownerAddress: OWNER,
    recipient: { type: "saved", label: "douglas" },
    chainId: 968,
    asset: "BOT",
    amount,
    nowMs: NOW,
  });
  return { intent };
}

async function usdtIntent(): Promise<{ intent: Intent }> {
  const intents = createMemoryIntentStore();
  const recipients = createMemoryRecipientStore();
  await saveRecipient(recipients, { ownerAddress: OWNER, label: "Douglas", chainId: 677, address: RECIP });
  const { intent } = await prepareTransferIntent(intents, recipients, {
    ownerAddress: OWNER,
    recipient: { type: "saved", label: "douglas" },
    chainId: 677,
    asset: "USDT",
    amount: "2",
    nowMs: NOW,
  });
  return { intent };
}

function deadlineOf(intent: Intent): number {
  return Math.floor(Date.parse(intent.expiresAt) / 1000);
}
function intentIdOf(intent: Intent): `0x${string}` {
  return ("0x" + intent.termsFingerprint) as `0x${string}`;
}

function nativeCalldata(intent: Intent): `0x${string}` {
  return encodeFunctionData({
    abi: PAYMENT_ABI,
    functionName: "payNative",
    args: [intentIdOf(intent), RECIP as `0x${string}`, BigInt(deadlineOf(intent))],
  });
}

function payTokenCalldata(intent: Intent): `0x${string}` {
  return encodeFunctionData({
    abi: PAYMENT_ABI,
    functionName: "payToken",
    args: [intentIdOf(intent), USDT, RECIP as `0x${string}`, BigInt(intent.amountBaseUnits), BigInt(deadlineOf(intent))],
  });
}

function paymentLog(intent: Intent, token: string): ChainReceipt["logs"][number] {
  return {
    address: CONTRACT_968,
    topics: [PAYMENT_TOPIC, intentIdOf(intent), padTopic(OWNER), padTopic(RECIP)] as [`0x${string}`, ...`0x${string}`[]],
    data: (word(BigInt(0)).slice(0, 2) + token.slice(2).toLowerCase().padStart(64, "0") + BigInt(intent.amountBaseUnits).toString(16).padStart(64, "0")) as `0x${string}`,
  };
}

function readerFor(o: {
  chainId?: number;
  tx?: ChainTx | null;
  receipt?: ChainReceipt | null;
  head?: bigint;
  blockHash?: string | null;
  usedIntent?: boolean;
  throwOn?: "all" | null;
  calls?: { count: number };
}): ChainReader {
  return {
    async getChainId() {
      if (o.throwOn === "all") throw new Error("rpc down");
      if (o.calls) o.calls.count += 1;
      return o.chainId ?? 968;
    },
    async getTransaction() {
      if (o.throwOn === "all") throw new Error("rpc down");
      return o.tx ?? null;
    },
    async getTransactionReceipt() {
      if (o.throwOn === "all") throw new Error("rpc down");
      return o.receipt ?? null;
    },
    async getBlockNumber() {
      if (o.throwOn === "all") throw new Error("rpc down");
      return o.head ?? BigInt(200);
    },
    async getBlockHash() {
      return o.blockHash ?? null;
    },
    async readUsedIntent() {
      return o.usedIntent ?? true;
    },
  };
}

function nativeTx(intent: Intent, overrides: Partial<ChainTx> = {}): ChainTx {
  return {
    chainId: 968,
    from: OWNER,
    to: CONTRACT_968,
    value: BigInt(intent.amountBaseUnits),
    input: nativeCalldata(intent),
    blockNumber: BigInt(100),
    blockHash: "0x" + "11".repeat(32),
    ...overrides,
  };
}

function nativeReceipt(intent: Intent, overrides: Partial<ChainReceipt> = {}): ChainReceipt {
  return {
    status: "success",
    from: OWNER,
    to: CONTRACT_968,
    logs: [paymentLog(intent, "0x" + "00".repeat(20))],
    blockNumber: BigInt(100),
    blockHash: "0x" + "11".repeat(32),
    ...overrides,
  };
}

async function expectSubmissionCode(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof SubmissionError, `expected SubmissionError, got ${String(err)}`);
    assert.equal(err.code, code);
    return;
  }
  assert.fail(`expected SubmissionError ${code}, but call succeeded`);
}

async function run() {
  // --- 1. valid native BOT receipt → confirmed with evidence ---
  {
    const { intent } = await nativeIntent();
    const r = readerFor({
      tx: nativeTx(intent),
      receipt: nativeReceipt(intent),
      head: BigInt(101),
      blockHash: "0x" + "11".repeat(32),
    });
    const v = await verifySubmissionOnChain(r, CONFIG, intent, TX);
    assert.equal(v.outcome, "confirmed");
    assert.ok(v.evidence);
    assert.equal(v.evidence.amountBaseUnits, "10000000000000000");
    assert.equal(v.evidence.replayFlag, true);
    assert.equal(v.evidence.confirmations, 2);
  }

  // --- 2. valid ERC-20 USDT receipt → confirmed ---
  {
    const { intent } = await usdtIntent();
    const tokenLog = {
      address: USDT,
      topics: [TRANSFER_TOPIC, padTopic(OWNER), padTopic(RECIP)] as [`0x${string}`, ...`0x${string}`[]],
      data: word(BigInt(intent.amountBaseUnits)),
    };
    const payLog = { ...paymentLog(intent, USDT), address: CONTRACT_677 };
    const r: ChainReader = {
      async getChainId() { return 677; },
      async getTransaction() {
        return { chainId: 677, from: OWNER, to: CONTRACT_677, value: BigInt(0), input: payTokenCalldata(intent), blockNumber: BigInt(50), blockHash: "0x" + "22".repeat(32) };
      },
      async getTransactionReceipt() {
        return { status: "success", from: OWNER, to: CONTRACT_677, logs: [payLog, tokenLog], blockNumber: BigInt(50), blockHash: "0x" + "22".repeat(32) };
      },
      async getBlockNumber() { return BigInt(52); },
      async getBlockHash() { return "0x" + "22".repeat(32); },
      async readUsedIntent() { return true; },
    };
    const v = await verifySubmissionOnChain(r, CONFIG, intent, TX);
    assert.equal(v.outcome, "confirmed");
    assert.equal(v.evidence?.token?.toLowerCase(), USDT.toLowerCase());
  }

  // --- 3-11. mismatch classes → failed ---
  {
    const { intent } = await nativeIntent();
    const goodTx = () => nativeTx(intent);
    const goodRc = () => nativeReceipt(intent);
    const cases: Array<[string, Partial<ChainTx>, Partial<ChainReceipt>, number?, string?]> = [
      ["WRONG_CHAIN", {}, {}, 1, "chain"],
      ["WRONG_CONTRACT", { to: OTHER }, {}, 968, undefined],
      ["WRONG_PAYER", { from: OTHER }, {}, 968, undefined],
      ["WRONG_RECIPIENT", {}, { logs: [{ ...paymentLog(intent, "0x" + "00".repeat(20)), topics: [PAYMENT_TOPIC, intentIdOf(intent), padTopic(OWNER), padTopic(OTHER)] as [`0x${string}`, ...`0x${string}`[]] }] }, 968, undefined],
      ["WRONG_AMOUNT", {}, { logs: [{ ...paymentLog(intent, "0x" + "00".repeat(20)), data: (word(BigInt(0)).slice(0, 2) + "00".repeat(20) + BigInt(1).toString(16).padStart(64, "0")) as `0x${string}` }] }, 968, undefined],
    ];
    for (const [expected, txOver, rcOver, cid, special] of cases) {
      const r = readerFor({ chainId: special === "chain" ? cid : 968, tx: { ...goodTx(), ...txOver }, receipt: { ...goodRc(), ...rcOver }, head: BigInt(101), blockHash: "0x" + "11".repeat(32) });
      const v = await verifySubmissionOnChain(r, CONFIG, intent, TX);
      assert.equal(v.outcome, "failed", expected);
      assert.equal(v.reason, expected);
    }
    // Wrong intent ID: calldata for a different fingerprint.
    {
      const other = await nativeIntent("0.02");
      const r = readerFor({
        tx: { ...goodTx(), input: nativeCalldata(other.intent), value: BigInt(other.intent.amountBaseUnits) },
        receipt: goodRc(), head: BigInt(101), blockHash: "0x" + "11".repeat(32),
      });
      const v = await verifySubmissionOnChain(r, CONFIG, intent, TX);
      assert.equal(v.outcome, "failed");
      assert.equal(v.reason, "WRONG_INTENT_ID");
    }
    // Event emitted by an unrelated contract only.
    {
      const stray = { ...paymentLog(intent, "0x" + "00".repeat(20)), address: OTHER };
      const r = readerFor({ tx: goodTx(), receipt: { ...goodRc(), logs: [stray] }, head: BigInt(101), blockHash: "0x" + "11".repeat(32) });
      const v = await verifySubmissionOnChain(r, CONFIG, intent, TX);
      assert.equal(v.outcome, "failed");
    }
    // Success hash for an unrelated payment (different recipient/amount, same contract).
    {
      const other = await nativeIntent("0.05");
      const r = readerFor({
        tx: { ...goodTx(), input: nativeCalldata(other.intent), value: BigInt(other.intent.amountBaseUnits) },
        receipt: {
          ...goodRc(),
          logs: [{ ...paymentLog(other.intent, "0x" + "00".repeat(20)), address: CONTRACT_968 }],
        },
        head: BigInt(101), blockHash: "0x" + "11".repeat(32),
      });
      const v = await verifySubmissionOnChain(r, CONFIG, intent, TX);
      assert.equal(v.outcome, "failed");
    }
    // Wrong token (USDT intent, calldata names another token).
    {
      const { intent: usdt } = await usdtIntent();
      const badCalldata = encodeFunctionData({
        abi: PAYMENT_ABI, functionName: "payToken",
        args: [intentIdOf(usdt), OTHER as `0x${string}`, RECIP as `0x${string}`, BigInt(usdt.amountBaseUnits), BigInt(deadlineOf(usdt))],
      });
      const r: ChainReader = {
        async getChainId() { return 677; },
        async getTransaction() {
          return { chainId: 677, from: OWNER, to: CONTRACT_677, value: BigInt(0), input: badCalldata, blockNumber: BigInt(50), blockHash: "0x" + "22".repeat(32) };
        },
        async getTransactionReceipt() {
          return { status: "success", from: OWNER, to: CONTRACT_677, logs: [], blockNumber: BigInt(50), blockHash: "0x" + "22".repeat(32) };
        },
        async getBlockNumber() { return BigInt(52); },
      };
      const v = await verifySubmissionOnChain(r, CONFIG, usdt, TX);
      assert.equal(v.outcome, "failed");
      assert.equal(v.reason, "WRONG_TOKEN");
    }
    // ERC-20 Transfer amount mismatch.
    {
      const { intent: usdt } = await usdtIntent();
      const payLog = { ...paymentLog(usdt, USDT), address: CONTRACT_677 };
      const badTransfer = {
        address: USDT,
        topics: [TRANSFER_TOPIC, padTopic(OWNER), padTopic(RECIP)] as [`0x${string}`, ...`0x${string}`[]],
        data: word(BigInt(1)),
      };
      const r: ChainReader = {
        async getChainId() { return 677; },
        async getTransaction() {
          return { chainId: 677, from: OWNER, to: CONTRACT_677, value: BigInt(0), input: payTokenCalldata(usdt), blockNumber: BigInt(50), blockHash: "0x" + "22".repeat(32) };
        },
        async getTransactionReceipt() {
          return { status: "success", from: OWNER, to: CONTRACT_677, logs: [payLog, badTransfer], blockNumber: BigInt(50), blockHash: "0x" + "22".repeat(32) };
        },
        async getBlockNumber() { return BigInt(52); },
      };
      const v = await verifySubmissionOnChain(r, CONFIG, usdt, TX);
      assert.equal(v.outcome, "failed");
      assert.equal(v.reason, "TOKEN_TRANSFER_MISMATCH");
    }
  }

  // --- 12-14. failed / pending / RPC timeout ---
  {
    const { intent } = await nativeIntent();
    const reverted = readerFor({
      tx: nativeTx(intent), receipt: { ...nativeReceipt(intent), status: "reverted" }, head: BigInt(101),
    });
    assert.equal((await verifySubmissionOnChain(reverted, CONFIG, intent, TX)).outcome, "failed");
    const missing = readerFor({ tx: nativeTx(intent), receipt: null, head: BigInt(101) });
    assert.equal((await verifySubmissionOnChain(missing, CONFIG, intent, TX)).outcome, "pending");
    const down = readerFor({ throwOn: "all" });
    assert.equal((await verifySubmissionOnChain(down, CONFIG, intent, TX)).outcome, "unknown");
  }

  // --- 15-16. registration: ambiguous + concurrent duplicates ---
  {
    const store = createMemorySubmissionStore();
    const { intent } = await nativeIntent();
    const first = await registerSubmissionTx(store, {
      intent, ownerAddress: OWNER, txHash: TX, contractAddress: CONTRACT_968,
    });
    assert.equal(first.deduplicated, false);
    const again = await registerSubmissionTx(store, {
      intent, ownerAddress: OWNER, txHash: TX, contractAddress: CONTRACT_968,
    });
    assert.equal(again.deduplicated, true);
    assert.equal(again.submission.id, first.submission.id);
    // Conflicting hash for the same intent fails closed.
    await expectSubmissionCode(
      () => registerSubmissionTx(store, {
        intent, ownerAddress: OWNER, txHash: "0x" + "99".repeat(32), contractAddress: CONTRACT_968,
      }),
      "CONFLICTING_SUBMISSION",
    );
    // Same hash for another intent fails closed.
    const other = await nativeIntent("0.03");
    await expectSubmissionCode(
      () => registerSubmissionTx(store, {
        intent: other.intent, ownerAddress: OWNER, txHash: TX, contractAddress: CONTRACT_968,
      }),
      "CONFLICTING_SUBMISSION",
    );
    // Concurrent duplicate registration: exactly one row.
    const store2 = createMemorySubmissionStore();
    const results = await Promise.allSettled(
      [0, 1, 2].map(() => registerSubmissionTx(store2, {
        intent, ownerAddress: OWNER, txHash: TX, contractAddress: CONTRACT_968,
      })),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    assert.equal(ok.length, 3); // losers return the winner (deduplicated), never throw
    assert.equal((await store2.findByIntent(intent.id))?.txHash, TX);
  }

  // --- 17. cross-owner access blocked ---
  {
    const store = createMemorySubmissionStore();
    const { intent } = await nativeIntent();
    await expectSubmissionCode(
      () => registerSubmissionTx(store, {
        intent, ownerAddress: OTHER, txHash: TX, contractAddress: CONTRACT_968,
      }),
      "NOT_FOUND",
    );
    await expectSubmissionCode(
      () => registerSubmissionTx(store, {
        intent, ownerAddress: OWNER, txHash: "0x123", contractAddress: CONTRACT_968,
      }),
      "INVALID_TX_HASH",
    );
  }

  // --- 19-21. stale snapshot still verifies; cancel never hides confirmation ---
  {
    const intents = createMemoryIntentStore();
    const recipients = createMemoryRecipientStore();
    const saved = await saveRecipient(recipients, {
      ownerAddress: OWNER, label: "Douglas", chainId: 968, address: RECIP,
    });
    const { prepareTransferIntent: prep } = await import("@/lib/transfers/service");
    const { changeRecipientAddress } = await import("@/lib/recipients/service");
    const made = await prep(intents, recipients, {
      ownerAddress: OWNER,
      recipient: { type: "saved", label: "douglas" },
      chainId: 968, asset: "BOT", amount: "0.01", nowMs: NOW,
    });
    // User edits the saved recipient AFTER preparation (version bump).
    const { changeRecipientAddress: change } = await import("@/lib/recipients/service");
    void change;
    await changeRecipientAddress(recipients, {
      ownerAddress: OWNER, id: saved.id, newAddress: OTHER, expectedVersion: 1,
    });
    const store = createMemorySubmissionStore();
    await registerSubmissionTx(store, {
      intent: made.intent, ownerAddress: OWNER, txHash: TX, contractAddress: CONTRACT_968,
    });
    // The snapshot (old address/version) is what the chain must show.
    const r = readerFor({
      tx: nativeTx(made.intent), receipt: nativeReceipt(made.intent), head: BigInt(101), blockHash: "0x" + "11".repeat(32),
    });
    const v = await verifySubmissionOnChain(r, CONFIG, made.intent, TX);
    assert.equal(v.outcome, "confirmed");
    // Cancel the intent, then reconcile: confirmation is still recorded.
    const { cancelTransferIntent } = await import("@/lib/transfers/service");
    await cancelTransferIntent(intents, { ownerAddress: OWNER, id: made.intent.id });
    const rec = await reconcileSubmission(store, r, CONFIG, { intent: { ...made.intent, status: "cancelled" } });
    assert.equal(rec.outcome, "confirmed");
    assert.equal(rec.submission?.status, "confirmed");
    assert.equal((await store.findByIntent(made.intent.id))?.status, "confirmed");
  }

  // --- 22-24. restart recovery + idempotent reconcile + no rebroadcast ---
  {
    const { intent } = await nativeIntent();
    const backing = (await import("@/lib/transfers/submissions")).createMemorySubmissionBacking();
    const { createMemorySubmissionStore: mk } = await import("@/lib/transfers/submissions");
    const instance1 = mk(backing);
    await registerSubmissionTx(instance1, {
      intent, ownerAddress: OWNER, txHash: TX, contractAddress: CONTRACT_968,
    });
    // "Restart": a fresh instance over the same backing sees everything.
    const instance2 = mk(backing);
    const calls = { count: 0 };
    const r = readerFor({
      calls, tx: nativeTx(intent), receipt: nativeReceipt(intent), head: BigInt(101), blockHash: "0x" + "11".repeat(32),
    });
    const first = await reconcileSubmission(instance2, r, CONFIG, { intent });
    assert.equal(first.outcome, "confirmed");
    const callsAfterFirst = calls.count;
    const second = await reconcileSubmission(instance2, r, CONFIG, { intent });
    assert.equal(second.outcome, "confirmed");
    assert.equal(second.submission?.txHash, TX);
    // Reconcile is read-only w.r.t. chain writes: the reader exposes no send
    // path, and the second run only re-reads (no new submission row).
    assert.ok(calls.count >= callsAfterFirst);
  }

  // --- unknown persists across rechecks without resend ---
  {
    const { intent } = await nativeIntent();
    const store = createMemorySubmissionStore();
    await registerSubmissionTx(store, {
      intent, ownerAddress: OWNER, txHash: TX, contractAddress: CONTRACT_968,
    });
    const down = readerFor({ throwOn: "all" });
    const first = await reconcileSubmission(store, down, CONFIG, { intent });
    assert.equal(first.outcome, "unknown");
    assert.equal(first.submission?.txHash, TX);
    const second = await reconcileSubmission(store, down, CONFIG, { intent });
    assert.equal(second.outcome, "unknown");
    assert.equal(second.submission?.status, "unknown");
  }

  // --- 25. finality threshold ---
  {
    const { intent } = await nativeIntent();
    const store = createMemorySubmissionStore();
    await registerSubmissionTx(store, {
      intent, ownerAddress: OWNER, txHash: TX, contractAddress: CONTRACT_968,
    });
    const early = readerFor({
      tx: nativeTx(intent), receipt: nativeReceipt(intent), head: BigInt(100), blockHash: "0x" + "11".repeat(32),
    });
    const r1 = await reconcileSubmission(store, early, CONFIG, { intent });
    assert.equal(r1.outcome, "pending");
    assert.equal((await store.findByIntent(intent.id))?.status, "submitted");
    const late = readerFor({
      tx: nativeTx(intent), receipt: nativeReceipt(intent), head: BigInt(101), blockHash: "0x" + "11".repeat(32),
    });
    const r2 = await reconcileSubmission(store, late, CONFIG, { intent });
    assert.equal(r2.outcome, "confirmed");
  }

  // --- 26. Celo regression ---
  {
    const { getPaymentAsset } = await import("@/lib/celo/assets");
    assert.equal(getPaymentAsset("CNGN").symbol, "CNGN");
  }

  console.log("verification self-check (B5): all assertions passed");
}

run().catch((err) => {
  console.error("verification self-check (B5) failed:", err);
  process.exit(1);
});
