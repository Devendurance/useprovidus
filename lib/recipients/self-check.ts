/**
 * B2 deterministic self-check for trusted recipient operations.
 * Run: npm run test:recipients
 *
 * Fully offline: memory store, no database. Covers ownership isolation,
 * chain isolation, versioned edits, deletion, and Celo backward compatibility.
 */

import assert from "node:assert/strict";
import { createMemoryRecipientStore } from "@/lib/recipients/repository";
import {
  changeRecipientAddress,
  getRecipient,
  getRecipientHistory,
  listRecipients,
  normalizeRecipientLabel,
  removeRecipient,
  renameRecipient,
  resolveRecipient,
  saveRecipient,
  toRecipientSummary,
  RecipientError,
} from "@/lib/recipients/service";

const OWNER_A = "0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa";
const OWNER_B = "0x000000000000000000000000000000000000dEaD";
const ADDR_1 = "0x1111111111111111111111111111111111111111";
const ADDR_2 = "0x2222222222222222222222222222222222222222";
const ADDR_3 = "0x3333333333333333333333333333333333333333";
const CELO = 42220;
const BOT_MAINNET = 677;
const BOT_TESTNET = 968;

async function expectCode(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof RecipientError, `expected RecipientError, got ${String(err)}`);
    assert.equal(err.code, code);
    return;
  }
  assert.fail(`expected error ${code}, but call succeeded`);
}

async function run() {
  // --- save + resolve (returning-user flow) ---
  {
    const store = createMemoryRecipientStore();
    const saved = await saveRecipient(store, {
      ownerAddress: OWNER_A,
      label: "Douglas",
      chainId: BOT_MAINNET,
      address: ADDR_1,
    });
    assert.equal(saved.label, "Douglas");
    assert.equal(saved.version, 1);
    assert.ok(saved.address.startsWith("0x"));
    // Resolution shows the FULL address for user verification.
    const resolved = await resolveRecipient(store, {
      ownerAddress: OWNER_A,
      label: "douglas",
      chainId: BOT_MAINNET,
    });
    assert.equal(resolved.address, saved.address);
    assert.equal(resolved.id, saved.id);
    const fetched = await getRecipient(store, { ownerAddress: OWNER_A, id: saved.id });
    assert.equal(fetched.address, saved.address);
  }

  // --- label normalization ---
  {
    assert.equal(normalizeRecipientLabel("  DOUGLAS  "), "douglas");
    assert.equal(normalizeRecipientLabel("Mary   Jane"), "mary jane");
    const store = createMemoryRecipientStore();
    const saved = await saveRecipient(store, {
      ownerAddress: OWNER_A,
      label: "  DOUGLAS ",
      chainId: BOT_MAINNET,
      address: ADDR_1,
    });
    assert.equal(saved.label, "DOUGLAS"); // display trimmed, not lowercased
    await expectCode(
      () => saveRecipient(store, { ownerAddress: OWNER_A, label: "douglas", chainId: BOT_MAINNET, address: ADDR_2 }),
      "DUPLICATE_LABEL",
    );
    await expectCode(() => normalizeRecipientLabel("   ") as unknown as Promise<unknown>, "INVALID_LABEL");
  }

  // --- separate addresses per chain, duplicates scoped to owner + chain ---
  {
    const store = createMemoryRecipientStore();
    const onBot = await saveRecipient(store, {
      ownerAddress: OWNER_A,
      label: "Douglas",
      chainId: BOT_MAINNET,
      address: ADDR_1,
    });
    const onTestnet = await saveRecipient(store, {
      ownerAddress: OWNER_A,
      label: "Douglas",
      chainId: BOT_TESTNET,
      address: ADDR_2,
    });
    const onCelo = await saveRecipient(store, {
      ownerAddress: OWNER_A,
      label: "Douglas",
      chainId: CELO,
      address: ADDR_3,
    });
    assert.notEqual(onBot.id, onTestnet.id);
    assert.notEqual(onBot.id, onCelo.id);
    // Cross-chain resolution never mixes addresses.
    assert.equal((await resolveRecipient(store, { ownerAddress: OWNER_A, label: "douglas", chainId: CELO })).address, onCelo.address);
    assert.equal((await resolveRecipient(store, { ownerAddress: OWNER_A, label: "douglas", chainId: BOT_TESTNET })).address, onTestnet.address);
    // Wrong chain has no match.
    await expectCode(
      () => resolveRecipient(store, { ownerAddress: OWNER_A, label: "douglas", chainId: 1 }),
      "UNSUPPORTED_CHAIN",
    );
  }

  // --- owner isolation: no leak, no cross-owner access ---
  {
    const store = createMemoryRecipientStore();
    const saved = await saveRecipient(store, {
      ownerAddress: OWNER_A,
      label: "Douglas",
      chainId: BOT_MAINNET,
      address: ADDR_1,
    });
    assert.deepEqual(await listRecipients(store, OWNER_B), []);
    await expectCode(() => getRecipient(store, { ownerAddress: OWNER_B, id: saved.id }), "NOT_FOUND");
    await expectCode(
      () => resolveRecipient(store, { ownerAddress: OWNER_B, label: "douglas", chainId: BOT_MAINNET }),
      "NOT_FOUND",
    );
    await expectCode(
      () => changeRecipientAddress(store, { ownerAddress: OWNER_B, id: saved.id, newAddress: ADDR_2, expectedVersion: 1 }),
      "NOT_FOUND",
    );
    await expectCode(
      () => removeRecipient(store, { ownerAddress: OWNER_B, id: saved.id }),
      "NOT_FOUND",
    );
    // Same label under a different owner is independent.
    const bOwn = await saveRecipient(store, {
      ownerAddress: OWNER_B,
      label: "Douglas",
      chainId: BOT_MAINNET,
      address: ADDR_2,
    });
    assert.notEqual(bOwn.id, saved.id);
  }

  // --- unauthenticated access ---
  {
    const store = createMemoryRecipientStore();
    await expectCode(() => listRecipients(store, ""), "NOT_AUTHENTICATED");
    await expectCode(() => listRecipients(store, "not-an-address"), "NOT_AUTHENTICATED");
    await expectCode(
      () => saveRecipient(store, { ownerAddress: "", label: "X", chainId: BOT_MAINNET, address: ADDR_1 }),
      "NOT_AUTHENTICATED",
    );
  }

  // --- invalid addresses ---
  {
    const store = createMemoryRecipientStore();
    await expectCode(
      () => saveRecipient(store, { ownerAddress: OWNER_A, label: "X", chainId: BOT_MAINNET, address: "0x123" }),
      "INVALID_ADDRESS",
    );
    await expectCode(
      () => saveRecipient(store, { ownerAddress: OWNER_A, label: "X", chainId: BOT_MAINNET, address: null }),
      "INVALID_ADDRESS",
    );
  }

  // --- rename + stale version ---
  {
    const store = createMemoryRecipientStore();
    const saved = await saveRecipient(store, {
      ownerAddress: OWNER_A,
      label: "Doug",
      chainId: BOT_MAINNET,
      address: ADDR_1,
    });
    const renamed = await renameRecipient(store, {
      ownerAddress: OWNER_A,
      id: saved.id,
      newLabel: "Douglas",
      expectedVersion: 1,
    });
    assert.equal(renamed.label, "Douglas");
    assert.equal(renamed.version, 2);
    await expectCode(
      () => renameRecipient(store, { ownerAddress: OWNER_A, id: saved.id, newLabel: "D", expectedVersion: 1 }),
      "STALE_VERSION",
    );
  }

  // --- address edit: version bump, stale write rejected, history kept ---
  {
    const store = createMemoryRecipientStore();
    const saved = await saveRecipient(store, {
      ownerAddress: OWNER_A,
      label: "Douglas",
      chainId: BOT_MAINNET,
      address: ADDR_1,
    });
    const updated = await changeRecipientAddress(store, {
      ownerAddress: OWNER_A,
      id: saved.id,
      newAddress: ADDR_2,
      expectedVersion: 1,
    });
    assert.equal(updated.version, 2);
    assert.notEqual(updated.address, saved.address);
    // Old version snapshot is stale: a concurrent writer holding v1 fails.
    await expectCode(
      () => changeRecipientAddress(store, {
        ownerAddress: OWNER_A,
        id: saved.id,
        newAddress: ADDR_3,
        expectedVersion: 1,
      }),
      "STALE_VERSION",
    );
    // History invalidates the old version: audit shows v1 -> v2 address move.
    const history = await getRecipientHistory(store, { ownerAddress: OWNER_A, id: saved.id });
    const change = history.find((h) => h.reason === "address_change");
    assert.ok(change);
    assert.equal(change.oldVersion, 1);
    assert.equal(change.newVersion, 2);
    assert.equal(change.oldAddress, saved.address);
    assert.equal(change.newAddress, updated.address);
    await expectCode(
      () => getRecipientHistory(store, { ownerAddress: OWNER_B, id: saved.id }),
      "NOT_FOUND",
    );
  }

  // --- deletion behavior ---
  {
    const store = createMemoryRecipientStore();
    const saved = await saveRecipient(store, {
      ownerAddress: OWNER_A,
      label: "Douglas",
      chainId: BOT_MAINNET,
      address: ADDR_1,
    });
    const result = await removeRecipient(store, { ownerAddress: OWNER_A, id: saved.id });
    assert.deepEqual(result, { id: saved.id, deleted: true });
    await expectCode(() => getRecipient(store, { ownerAddress: OWNER_A, id: saved.id }), "NOT_FOUND");
    await expectCode(
      () => resolveRecipient(store, { ownerAddress: OWNER_A, label: "douglas", chainId: BOT_MAINNET }),
      "NOT_FOUND",
    );
    assert.deepEqual(await listRecipients(store, OWNER_A), []);
    // Label is reusable after deletion (partial unique index semantics).
    const again = await saveRecipient(store, {
      ownerAddress: OWNER_A,
      label: "Douglas",
      chainId: BOT_MAINNET,
      address: ADDR_2,
    });
    assert.notEqual(again.id, saved.id);
    assert.equal(again.version, 1);
  }

  // --- compact summaries mask addresses ---
  {
    const store = createMemoryRecipientStore();
    const saved = await saveRecipient(store, {
      ownerAddress: OWNER_A,
      label: "Douglas",
      chainId: BOT_MAINNET,
      address: ADDR_1,
    });
    const summary = toRecipientSummary(saved);
    assert.ok(!summary.maskedAddress.includes(ADDR_1.slice(10, 30)));
    assert.ok(summary.maskedAddress.includes("…") || summary.maskedAddress.length < saved.address.length);
  }

  // --- Celo backward compatibility: existing asset path untouched ---
  {
    const { getPaymentAsset } = await import("@/lib/celo/assets");
    const { CANONICAL_CELO_USDC_ADDRESS } = await import("@/lib/celo/usdc");
    assert.equal(getPaymentAsset("USDC").address, CANONICAL_CELO_USDC_ADDRESS);
    const store = createMemoryRecipientStore();
    // Celo recipients coexist with BOT ones via the B1 registry chain IDs.
    const celo = await saveRecipient(store, {
      ownerAddress: OWNER_A,
      label: "Douglas",
      chainId: CELO,
      address: CANONICAL_CELO_USDC_ADDRESS,
    });
    assert.equal(celo.chainId, 42220);
    assert.equal(
      (await resolveRecipient(store, { ownerAddress: OWNER_A, label: "douglas", chainId: BOT_MAINNET }).catch(() => null)),
      null,
    );
  }

  console.log("recipients self-check (B2): all assertions passed");
}

run().catch((err) => {
  console.error("recipients self-check (B2) failed:", err);
  process.exit(1);
});
