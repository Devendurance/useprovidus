/**
 * Self-check for the read-only assistant status reader.
 *
 * Proves the three hard boundaries of `lib/assistant/status.ts`:
 *   1. no repository method other than the two lookups is ever called;
 *   2. no HTTP call is made;
 *   3. recorded state is never mutated, and the formatter never claims fiat
 *      delivery or success that the stage does not prove.
 *
 * Run: npx tsx --conditions=react-server lib/assistant/status-self-check.ts
 */

import "server-only";

import assert from "node:assert/strict";

import {
  STATUS_REFERENCE_REQUEST,
  detectStatusQuery,
  extractTransactionReference,
  formatStatusAnswer,
  readTransactionStatus,
} from "@/lib/assistant/status";
import {
  InMemoryTransactionRepository,
  setTransactionRepositoryForTesting,
  type TransactionRepository,
} from "@/lib/transactions";
import { computeTransactionStage } from "@/lib/transactions/status";

const ORDER_ID = "3f0b0e5e-1f4a-4c5a-8f8e-1b2c3d4e5f60";

/**
 * Wraps the repository so any method other than the two read lookups fails the
 * check loudly, and records which methods the status path actually used.
 */
function guardRepository(repository: TransactionRepository): {
  repository: TransactionRepository;
  calls: string[];
} {
  const calls: string[] = [];
  const guarded = new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const name = String(property);
        calls.push(name);
        if (name !== "findById" && name !== "findByPaycrestOrderId") {
          throw new Error(`status read must not call repository.${name}()`);
        }
        return (value as (...inner: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as TransactionRepository;

  return { repository: guarded, calls };
}

async function seedRepository(): Promise<InMemoryTransactionRepository> {
  const repository = new InMemoryTransactionRepository();

  await repository.create({
    id: "tx_pending_1",
    idempotencyKey: "idem_pending_1",
    walletAddress: "0x1111111111111111111111111111111111111111",
    amountUsdc: "10.00",
    amountNgn: "1500",
    paycrestReference: "ref_pending_1",
  });

  await repository.create({
    id: "tx_settling_1",
    idempotencyKey: "idem_settling_1",
    walletAddress: "0x1111111111111111111111111111111111111111",
    amountUsdc: "10.00",
    amountNgn: "1500",
    paycrestReference: "ref_settling_1",
    paycrestOrderId: ORDER_ID,
  });
  await repository.updateStatus("tx_settling_1", {
    status: "settling",
    paycrestStatus: "fulfilling",
  });

  await repository.create({
    id: "tx_settled_1",
    idempotencyKey: "idem_settled_1",
    walletAddress: "0x1111111111111111111111111111111111111111",
    amountUsdc: "10.00",
    amountNgn: "1500",
    paycrestReference: "ref_settled_1",
  });
  await repository.updateStatus("tx_settled_1", {
    status: "settling",
    paycrestStatus: "validated",
  });
  await repository.updateStatus("tx_settled_1", { status: "settled" });

  await repository.create({
    id: "tx_refunded_1",
    idempotencyKey: "idem_refunded_1",
    walletAddress: "0x1111111111111111111111111111111111111111",
    amountUsdc: "10.00",
    amountNgn: "1500",
    paycrestReference: "ref_refunded_1",
  });
  await repository.updateStatus("tx_refunded_1", { status: "settling" });
  await repository.updateStatus("tx_refunded_1", { status: "refunded" });

  await repository.create({
    id: "tx_recovery_1",
    idempotencyKey: "idem_recovery_1",
    walletAddress: "0x1111111111111111111111111111111111111111",
    amountUsdc: "10.00",
    amountNgn: "1500",
    paycrestReference: "ref_recovery_1",
  });
  await repository.updateStatus("tx_recovery_1", {
    status: "failed",
    failureCode: "ORDER_CREATION_OUTCOME_UNKNOWN",
  });

  return repository;
}

async function run() {
  console.log("Starting assistant status self-check...");

  const repository = await seedRepository();
  const { repository: guarded, calls } = guardRepository(repository);
  setTransactionRepositoryForTesting(guarded);

  try {
    /* ---------------------------------------------------------------- */
    /* Reference extraction and query detection                          */
    /* ---------------------------------------------------------------- */
    assert.equal(extractTransactionReference("check tx_9f2b1c please"), "tx_9f2b1c");
    assert.equal(extractTransactionReference(`order ${ORDER_ID}`), ORDER_ID);
    assert.equal(
      extractTransactionReference("check order ord_recon_1 please"),
      "ord_recon_1",
    );
    assert.equal(
      extractTransactionReference("check Paycrest pc_ord_123 please"),
      "pc_ord_123",
    );
    assert.equal(extractTransactionReference("no reference here"), null);
    assert.equal(extractTransactionReference("my record_123 is fine"), null);
    assert.equal(extractTransactionReference("ord_"), null);
    assert.equal(extractTransactionReference("ord_a"), null);
    assert.equal(extractTransactionReference("pc_ord_a"), null);

    // Overlong candidates are skipped, never returned truncated or whole, and
    // a real reference after one still resolves - same pattern or another.
    const overlongTx = `tx_${"a".repeat(300)}`;
    assert.equal(extractTransactionReference(overlongTx), null);
    assert.equal(extractTransactionReference(`ord_${"a".repeat(300)}`), null);
    assert.equal(extractTransactionReference(`${overlongTx} tx_9f2b1c`), "tx_9f2b1c");
    assert.equal(extractTransactionReference(`${overlongTx} ord_ok1`), "ord_ok1");
    assert.equal(
      extractTransactionReference(`ord_${"a".repeat(300)} ord_recon_1`),
      "ord_recon_1",
    );

    const direct = detectStatusQuery("what is the status of tx_pending_1?", []);
    assert.deepEqual(direct, { kind: "reference", reference: "tx_pending_1" });
    const directOrder = detectStatusQuery("what is the status of ord_recon_1?", []);
    assert.deepEqual(directOrder, {
      kind: "reference",
      reference: "ord_recon_1",
    });

    const directPaycrestOrder = detectStatusQuery("track pc_ord_123", []);
    assert.deepEqual(directPaycrestOrder, {
      kind: "reference",
      reference: "pc_ord_123",
    });

    const bare = detectStatusQuery("tx_pending_1", []);
    assert.deepEqual(bare, { kind: "reference", reference: "tx_pending_1" });

    const carried = detectStatusQuery("any update?", [
      { role: "user", content: "I sent tx_settled_1 yesterday", timestamp: "t1" },
      { role: "assistant", content: "Thanks, I'll note that.", timestamp: "t2" },
    ]);
    assert.deepEqual(carried, { kind: "reference", reference: "tx_settled_1" });

    assert.deepEqual(detectStatusQuery("any update on my payment?", []), {
      kind: "ask_for_reference",
    });
    assert.equal(detectStatusQuery("hey, how are you?", []), null);
    assert.equal(detectStatusQuery("what can you do?", []), null);
    assert.match(STATUS_REFERENCE_REQUEST, /reference/);

    /* ---------------------------------------------------------------- */
    /* Read-only lookup by id and by Paycrest order id                   */
    /* ---------------------------------------------------------------- */
    const settledBefore = await repository.findById("tx_settled_1");

    const pending = await readTransactionStatus("tx_pending_1");
    assert.equal(pending.ok, true);
    if (pending.ok) {
      assert.equal(pending.data.transaction.id, "tx_pending_1");
      assert.equal(pending.data.transaction.amountNgn, "1500");
      assert.equal(pending.data.stage.stage, "awaiting_payment");
      assert.equal(pending.data.stage.isDepositConfirmed, false);
      assert.equal(pending.data.stage.isFiatDelivered, false);
    }

    const byOrderId = await readTransactionStatus(ORDER_ID);
    assert.equal(byOrderId.ok, true);
    if (byOrderId.ok) {
      assert.equal(byOrderId.data.transaction.id, "tx_settling_1");
      assert.equal(byOrderId.data.stage.stage, "settling");
      assert.equal(byOrderId.data.stage.isDepositConfirmed, true);
      assert.equal(byOrderId.data.stage.isFiatDelivered, false);
    }

    const settled = await readTransactionStatus("tx_settled_1");
    assert.equal(settled.ok, true);
    if (settled.ok) {
      assert.equal(settled.data.stage.stage, "settled");
      assert.equal(settled.data.stage.isFiatDelivered, true);
      assert.equal(settled.data.stage.isProtocolSettled, false);
    }

    const refunded = await readTransactionStatus("tx_refunded_1");
    const recovery = await readTransactionStatus("tx_recovery_1");
    assert.equal(refunded.ok, true);
    assert.equal(recovery.ok, true);
    if (recovery.ok) {
      assert.equal(recovery.data.stage.stage, "recovery_required");
    }

    const missing = await readTransactionStatus("tx_does_not_exist");
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, "NOT_FOUND");

    const blank = await readTransactionStatus("   ");
    assert.equal(blank.ok, false);
    if (!blank.ok) assert.equal(blank.code, "INVALID_REFERENCE");

    const oversized = await readTransactionStatus("x".repeat(201));
    assert.equal(oversized.ok, false);
    if (!oversized.ok) assert.equal(oversized.code, "INVALID_REFERENCE");

    /* ---------------------------------------------------------------- */
    /* Zero writes, zero HTTP                                            */
    /* ---------------------------------------------------------------- */
    assert.equal(
      calls.every(
        (name) => name === "findById" || name === "findByPaycrestOrderId",
      ),
      true,
      `readTransactionStatus must only call the two lookups, saw: ${calls.join(", ")}`,
    );
    assert.equal(calls.length > 0, true);

    const settledAfter = await repository.findById("tx_settled_1");
    assert.deepEqual(settledAfter, settledBefore);

    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("status reads must not perform HTTP");
    }) as typeof fetch;
    try {
      await readTransactionStatus("tx_pending_1");
      await readTransactionStatus(ORDER_ID);
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(fetchCalls, 0, "status reads must not call fetch");

    /* ---------------------------------------------------------------- */
    /* Truthful formatting: no invented finality                         */
    /* ---------------------------------------------------------------- */
    const pendingText =
      pending.ok ? formatStatusAnswer(pending.data) : "";
    assert.match(pendingText, /Awaiting payment/);
    assert.match(pendingText, /tx_pending_1/);
    assert.match(pendingText, /No confirmed Celo deposit/);
    assert.equal(pendingText.includes("confirmed fiat delivery"), false);

    const settlingText =
      byOrderId.ok ? formatStatusAnswer(byOrderId.data) : "";
    assert.match(settlingText, /NGN payout in progress/);
    assert.match(settlingText, /NOT confirmed yet/);

    const settledText = settled.ok ? formatStatusAnswer(settled.data) : "";
    assert.match(settledText, /Fiat delivery confirmed/);
    assert.match(settledText, /confirmed fiat delivery to the recipient/);
    assert.equal(settledText.includes("NOT confirmed yet"), false);

    const refundedText =
      refunded.ok ? formatStatusAnswer(refunded.data) : "";
    assert.match(refundedText, /refunded on Celo/);
    assert.equal(refundedText.includes("confirmed fiat delivery"), false);

    const recoveryText =
      recovery.ok ? formatStatusAnswer(recovery.data) : "";
    assert.match(recoveryText, /Do not send another payment/);

    /* ---------------------------------------------------------------- */
    /* Stage extraction parity (shared pure module)                      */
    /* ---------------------------------------------------------------- */
    if (settledBefore) {
      assert.equal(computeTransactionStage(settledBefore).stage, "settled");
    }
    const settlingRecord = await repository.findById("tx_settling_1");
    assert.equal(
      settlingRecord ? computeTransactionStage(settlingRecord).isDepositConfirmed : null,
      true,
    );

    console.log("Assistant status self-check: ALL ASSERTIONS PASSED!");
  } finally {
    setTransactionRepositoryForTesting(null);
  }
}

run().catch((err) => {
  console.error("Assistant status self-check failed:", err);
  process.exit(1);
});
