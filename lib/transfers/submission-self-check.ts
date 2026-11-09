/**
 * B4B deterministic self-check for idempotent submission/confirmation.
 * Run: npm run test:submission
 *
 * Fully offline: injected fake transports, in-memory record store.
 * Covers: success, revert, receipt-timeout → unknown with no resend,
 * idempotent repeat, broadcast-failure retry safety, invalid hashes/plans.
 */

import assert from "node:assert/strict";
import {
  submitPreparedPlan,
  type ExecutionPlanLike,
  type SubmissionRecord,
  type SubmissionTransport,
} from "@/lib/transfers/submission";

const PLAN: ExecutionPlanLike = {
  to: "0x2222222222222222222222222222222222222222",
  value: "1000000000000000",
  data: "0x1a56282b",
  intentId: "0x" + "ab".repeat(32),
  deadline: 9_999_999_999,
  payer: "0x1111111111111111111111111111111111111111",
  recipient: "0x3333333333333333333333333333333333333333",
  token: null,
  amountBaseUnits: "1000000000000000",
  chainId: 968,
  environment: "testnet",
  termsFingerprint: "cd".repeat(32),
};

function transportFor(
  send: (plan: ExecutionPlanLike) => Promise<{ txHash: string }>,
  wait: (txHash: string) => Promise<{ outcome: "success" | "reverted" | "unknown"; blockNumber: number | null }>,
): SubmissionTransport & { sends: number } {
  const t = {
    sends: 0,
    sendPlan: async (plan: ExecutionPlanLike) => {
      t.sends += 1;
      return send(plan);
    },
    waitReceipt: wait,
  };
  return t;
}

const TX = "0x" + "12".repeat(32);

async function run() {
  // --- success path ---
  {
    const store = new Map<string, SubmissionRecord>();
    const t = transportFor(
      async () => ({ txHash: TX }),
      async () => ({ outcome: "success", blockNumber: 100 }),
    );
    const res = await submitPreparedPlan(store, t, PLAN, { intentDbId: "wti_1", nowMs: 1_000 });
    assert.equal(res.fresh, true);
    assert.equal(res.record.status, "confirmed");
    assert.equal(res.record.txHash, TX);
    assert.equal(res.record.blockNumber, 100);
    assert.equal(t.sends, 1);
  }

  // --- revert → failed, hash preserved ---
  {
    const store = new Map<string, SubmissionRecord>();
    const t = transportFor(
      async () => ({ txHash: TX }),
      async () => ({ outcome: "reverted", blockNumber: 101 }),
    );
    const res = await submitPreparedPlan(store, t, PLAN, { intentDbId: "wti_1", nowMs: 2_000 });
    assert.equal(res.record.status, "failed");
    assert.equal(res.record.txHash, TX);
  }

  // --- receipt timeout → unknown, NO resend on retry ---
  {
    const store = new Map<string, SubmissionRecord>();
    const t = transportFor(
      async () => ({ txHash: TX }),
      async () => {
        throw new Error("receipt timeout");
      },
    );
    const first = await submitPreparedPlan(store, t, PLAN, { intentDbId: "wti_1", nowMs: 3_000 });
    assert.equal(first.record.status, "unknown");
    assert.equal(first.record.txHash, TX);
    const second = await submitPreparedPlan(store, t, PLAN, { intentDbId: "wti_1", nowMs: 4_000 });
    assert.equal(second.fresh, false);
    assert.equal((second as { note: string }).note, "already-submitted");
    assert.equal(second.record.txHash, TX);
    assert.equal(t.sends, 1);
  }

  // --- idempotent repeat after confirm: no second broadcast ---
  {
    const store = new Map<string, SubmissionRecord>();
    const t = transportFor(
      async () => ({ txHash: TX }),
      async () => ({ outcome: "success", blockNumber: 102 }),
    );
    await submitPreparedPlan(store, t, PLAN, { intentDbId: "wti_1", nowMs: 5_000 });
    const again = await submitPreparedPlan(store, t, PLAN, { intentDbId: "wti_1", nowMs: 6_000 });
    assert.equal(again.fresh, false);
    assert.equal(t.sends, 1);
  }

  // --- broadcast failure: no hash recorded, error surfaces ---
  {
    const store = new Map<string, SubmissionRecord>();
    const t = transportFor(
      async () => {
        throw new Error("insufficient funds");
      },
      async () => ({ outcome: "success", blockNumber: 103 }),
    );
    let threw = false;
    try {
      await submitPreparedPlan(store, t, PLAN, { intentDbId: "wti_1", nowMs: 7_000 });
    } catch {
      threw = true;
    }
    assert.equal(threw, true);
    const rec = store.get(PLAN.termsFingerprint);
    assert.ok(rec);
    assert.equal(rec.txHash, null);
  }

  // --- invalid transport hash / invalid plan fail closed ---
  {
    const store = new Map<string, SubmissionRecord>();
    const badHash = transportFor(
      async () => ({ txHash: "0x123" }),
      async () => ({ outcome: "success", blockNumber: 1 }),
    );
    let threw = false;
    try {
      await submitPreparedPlan(store, badHash, PLAN, { intentDbId: "wti_1" });
    } catch {
      threw = true;
    }
    assert.equal(threw, true);
    threw = false;
    try {
      await submitPreparedPlan(store, badHash, { ...PLAN, to: "nope" }, { intentDbId: "wti_1" });
    } catch {
      threw = true;
    }
    assert.equal(threw, true);
  }

  console.log("submission self-check (B4B): all assertions passed");
}

run().catch((err) => {
  console.error("submission self-check (B4B) failed:", err);
  process.exit(1);
});
