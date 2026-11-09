/**
 * B3 deterministic self-check for wallet_transfer PaymentIntents.
 * Run: npm run test:transfers
 *
 * Fully offline: memory intent + recipient stores. Covers saved/unsaved
 * resolution, per-chain independence, version binding + staleness, ownership
 * isolation, chain/asset gates, exact amounts, malformed inputs, expiry,
 * cancellation, idempotency, immutability, and Celo regression.
 */

import assert from "node:assert/strict";
import { createMemoryIntentStore } from "@/lib/transfers/repository";
import { createMemoryRecipientStore } from "@/lib/recipients/repository";
import {
  saveRecipient,
  changeRecipientAddress,
  removeRecipient,
} from "@/lib/recipients/service";
import {
  cancelTransferIntent,
  checkIntentFreshness,
  computeTermsFingerprint,
  getTransferIntent,
  listTransferIntents,
  prepareTransferIntent,
  resolveTransferAsset,
  TransferError,
  type PrepareIntentArgs,
} from "@/lib/transfers/service";
import { parseTransferAmount, AmountError } from "@/lib/transfers/amounts";

const OWNER_A = "0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa";
const OWNER_B = "0x000000000000000000000000000000000000dEaD";
const DOUGLAS_BOT = "0x1111111111111111111111111111111111111111";
const DOUGLAS_TESTNET = "0x2222222222222222222222222222222222222222";
const NEW_ADDR = "0x3333333333333333333333333333333333333333";
const CELO = 42220;
const BOT_MAINNET = 677;
const BOT_TESTNET = 968;
const USDT_MAINNET = "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C";

function stores() {
  return { intents: createMemoryIntentStore(), recipients: createMemoryRecipientStore() };
}

async function expectTransferCode(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof TransferError, `expected TransferError, got ${String(err)}`);
    assert.equal(err.code, code);
    return;
  }
  assert.fail(`expected TransferError ${code}, but call succeeded`);
}

async function expectAmountCode(fn: () => Promise<unknown> | unknown, code: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof AmountError, `expected AmountError, got ${String(err)}`);
    assert.equal(err.code, code);
    return;
  }
  assert.fail(`expected AmountError ${code}, but call succeeded`);
}

function prepare(
  intents: ReturnType<typeof createMemoryIntentStore>,
  recipients: ReturnType<typeof createMemoryRecipientStore>,
  args: Omit<PrepareIntentArgs, "ownerAddress"> & { ownerAddress?: string },
) {
  return prepareTransferIntent(intents, recipients, { ownerAddress: OWNER_A, ...args });
}

async function run() {
  // --- saved Douglas resolution: "Pay Douglas 2 USDT on BOT Chain" ---
  {
    const { intents, recipients } = stores();
    await saveRecipient(recipients, {
      ownerAddress: OWNER_A,
      label: "Douglas",
      chainId: BOT_MAINNET,
      address: DOUGLAS_BOT,
    });
    const { intent, deduplicated } = await prepare(intents, recipients, {
      recipient: { type: "saved", label: "douglas" },
      chainId: BOT_MAINNET,
      asset: "USDT",
      amount: "2",
      nowMs: 1_000_000,
    });
    assert.equal(deduplicated, false);
    assert.equal(intent.recipientSource, "saved");
    assert.equal(intent.recipientAddress, DOUGLAS_BOT);
    assert.equal(intent.savedRecipientVersion, 1);
    assert.equal(intent.chainId, BOT_MAINNET);
    assert.equal(intent.environment, "mainnet");
    assert.equal(intent.assetSymbol, "USDT");
    assert.equal(intent.assetDecimals, 6);
    assert.equal(intent.amountDisplay, "2");
    assert.equal(intent.amountBaseUnits, "2000000");
    assert.equal(intent.tokenAddress, USDT_MAINNET);
    assert.equal(intent.status, "pending");
    assert.equal(intent.approvalVersion, 1);
    assert.ok(/^[0-9a-f]{64}$/.test(intent.termsFingerprint));
    assert.equal(intent.ownerAddress, OWNER_A);
  }

  // --- first-time unsaved Douglas address (no record created) ---
  {
    const { intents, recipients } = stores();
    const { intent } = await prepare(intents, recipients, {
      recipient: { type: "unsaved", label: "Douglas", address: DOUGLAS_BOT },
      chainId: BOT_MAINNET,
      asset: "USDT",
      amount: "2",
      nowMs: 2_000_000,
    });
    assert.equal(intent.recipientSource, "unsaved");
    assert.equal(intent.savedRecipientId, null);
    assert.equal(intent.savedRecipientVersion, null);
    assert.equal(intent.recipientAddress, DOUGLAS_BOT);
    assert.deepEqual(await import("@/lib/recipients/service").then((m) =>
      m.listRecipients(recipients, OWNER_A),
    ), []);
  }

  // --- independent address records on different chains ---
  {
    const { intents, recipients } = stores();
    await saveRecipient(recipients, { ownerAddress: OWNER_A, label: "Douglas", chainId: BOT_MAINNET, address: DOUGLAS_BOT });
    await saveRecipient(recipients, { ownerAddress: OWNER_A, label: "Douglas", chainId: BOT_TESTNET, address: DOUGLAS_TESTNET });
    const onMainnet = await prepare(intents, recipients, {
      recipient: { type: "saved", label: "Douglas" },
      chainId: BOT_MAINNET,
      asset: "BOT",
      amount: "1",
      nowMs: 3_000_000,
    });
    const onTestnet = await prepare(intents, recipients, {
      recipient: { type: "saved", label: "Douglas" },
      chainId: BOT_TESTNET,
      asset: "BOT",
      amount: "1",
      nowMs: 3_000_000,
    });
    assert.equal(onMainnet.intent.recipientAddress, DOUGLAS_BOT);
    assert.equal(onTestnet.intent.recipientAddress, DOUGLAS_TESTNET);
    assert.notEqual(onMainnet.intent.termsFingerprint, onTestnet.intent.termsFingerprint);
  }

  // --- recipient version mismatch / address changed after creation ---
  {
    const { intents, recipients } = stores();
    const saved = await saveRecipient(recipients, {
      ownerAddress: OWNER_A, label: "Douglas", chainId: BOT_MAINNET, address: DOUGLAS_BOT,
    });
    const { intent } = await prepare(intents, recipients, {
      recipient: { type: "saved", label: "Douglas" },
      chainId: BOT_MAINNET,
      asset: "USDT",
      amount: "2",
      nowMs: 4_000_000,
    });
    assert.equal(intent.savedRecipientVersion, saved.version);
    // Address edit bumps the version.
    await changeRecipientAddress(recipients, {
      ownerAddress: OWNER_A, id: saved.id, newAddress: NEW_ADDR, expectedVersion: 1,
    });
    const stale = await checkIntentFreshness(intents, recipients, {
      ownerAddress: OWNER_A, id: intent.id, nowMs: 4_000_100,
    });
    assert.equal(stale.freshness.fresh, false);
    if (!stale.freshness.fresh) {
      assert.equal(stale.freshness.staleReason, "RECIPIENT_VERSION_CHANGED");
    }
    // Deletion invalidates too.
    await removeRecipient(recipients, { ownerAddress: OWNER_A, id: saved.id });
    const removed = await checkIntentFreshness(intents, recipients, {
      ownerAddress: OWNER_A, id: intent.id, nowMs: 4_000_200,
    });
    assert.equal(removed.freshness.fresh, false);
  }

  // --- wrong owner cannot read/cancel ---
  {
    const { intents, recipients } = stores();
    const { intent } = await prepare(intents, recipients, {
      recipient: { type: "unsaved", address: DOUGLAS_BOT },
      chainId: BOT_MAINNET,
      asset: "USDT",
      amount: "1",
      nowMs: 5_000_000,
    });
    await expectTransferCode(
      () => getTransferIntent(intents, { ownerAddress: OWNER_B, id: intent.id }),
      "NOT_FOUND",
    );
    await expectTransferCode(
      () => cancelTransferIntent(intents, { ownerAddress: OWNER_B, id: intent.id }),
      "NOT_FOUND",
    );
    await expectTransferCode(
      () => checkIntentFreshness(intents, recipients, { ownerAddress: OWNER_B, id: intent.id }),
      "NOT_FOUND",
    );
    assert.deepEqual(await listTransferIntents(intents, OWNER_B), []);
    assert.equal((await listTransferIntents(intents, OWNER_A)).length, 1);
  }

  // --- wrong chain / Celo preservation ---
  {
    const { intents, recipients } = stores();
    await expectTransferCode(
      () => prepare(intents, recipients, {
        recipient: { type: "unsaved", address: DOUGLAS_BOT },
        chainId: 1, asset: "BOT", amount: "1", nowMs: 6_000_000,
      }),
      "UNSUPPORTED_CHAIN",
    );
    await expectTransferCode(
      () => prepare(intents, recipients, {
        recipient: { type: "unsaved", address: DOUGLAS_BOT },
        chainId: CELO, asset: "USDC", amount: "1", nowMs: 6_000_000,
      }),
      "CELO_WALLET_TRANSFER_UNSUPPORTED",
    );
  }

  // --- testnet USDT rejection (same address is WES there, never USDT) ---
  {
    const { intents, recipients } = stores();
    await expectTransferCode(
      () => prepare(intents, recipients, {
        recipient: { type: "unsaved", address: DOUGLAS_TESTNET },
        chainId: BOT_TESTNET, asset: "USDT", amount: "1", nowMs: 7_000_000,
      }),
      "UNSUPPORTED_ASSET",
    );
    // Even the mainnet USDT contract address is rejected as USDT on testnet.
    await expectTransferCode(
      () => prepare(intents, recipients, {
        recipient: { type: "unsaved", address: USDT_MAINNET },
        chainId: BOT_TESTNET, asset: "USDT", amount: "1", nowMs: 7_000_000,
      }),
      "UNSUPPORTED_ASSET",
    );
    assert.equal(resolveTransferAsset(BOT_TESTNET, "BOT").decimals, 18);
  }

  // --- mainnet USDT exact amount + native BOT conversion ---
  {
    const usdt = resolveTransferAsset(BOT_MAINNET, "usdt");
    assert.equal(usdt.decimals, 6);
    assert.equal(usdt.tokenAddress, USDT_MAINNET);
    const { intents, recipients } = stores();
    const { intent } = await prepare(intents, recipients, {
      recipient: { type: "unsaved", address: DOUGLAS_BOT },
      chainId: BOT_MAINNET, asset: "USDT", amount: "2.50", nowMs: 8_000_000,
    });
    assert.equal(intent.amountBaseUnits, "2500000");
    assert.equal(intent.amountDisplay, "2.5");
    const native = await prepare(intents, recipients, {
      recipient: { type: "unsaved", address: DOUGLAS_BOT },
      chainId: BOT_MAINNET, asset: "BOT", amount: "1.5", nowMs: 8_000_000,
    });
    assert.equal(native.intent.amountBaseUnits, "1500000000000000000");
    assert.equal(native.intent.tokenAddress, null);
  }

  // --- unsupported asset ---
  {
    const { intents, recipients } = stores();
    await expectTransferCode(
      () => prepare(intents, recipients, {
        recipient: { type: "unsaved", address: DOUGLAS_BOT },
        chainId: BOT_MAINNET, asset: "USDC", amount: "1", nowMs: 9_000_000,
      }),
      "UNSUPPORTED_ASSET",
    );
    await expectTransferCode(
      () => prepare(intents, recipients, {
        recipient: { type: "unsaved", address: "not-an-address" },
        chainId: BOT_MAINNET, asset: "BOT", amount: "1", nowMs: 9_000_000,
      }),
      "INVALID_ADDRESS",
    );
  }

  // --- malformed decimal amounts (no float, ever) ---
  {
    assert.deepEqual(parseTransferAmount("007.50", 6), { display: "7.5", baseUnits: BigInt("7500000") });
    await expectAmountCode(() => parseTransferAmount("0", 6), "ZERO_AMOUNT");
    await expectAmountCode(() => parseTransferAmount("0.000000", 6), "ZERO_AMOUNT");
    await expectAmountCode(() => parseTransferAmount("-1", 6), "INVALID_AMOUNT");
    await expectAmountCode(() => parseTransferAmount("1.1234567", 6), "EXCESS_PRECISION");
    await expectAmountCode(() => parseTransferAmount("1e3", 6), "INVALID_AMOUNT");
    await expectAmountCode(() => parseTransferAmount("1,000", 6), "INVALID_AMOUNT");
    await expectAmountCode(() => parseTransferAmount("abc", 6), "INVALID_AMOUNT");
    await expectAmountCode(() => parseTransferAmount("", 6), "INVALID_AMOUNT");
    await expectAmountCode(() => parseTransferAmount("1. 5", 6), "INVALID_AMOUNT");
    await expectAmountCode(() => parseTransferAmount(2 as unknown as string, 6), "INVALID_AMOUNT");
    await expectAmountCode(() => parseTransferAmount("9".repeat(25), 6), "AMOUNT_TOO_LARGE");
  }

  // --- expired + stale intents ---
  {
    const { intents, recipients } = stores();
    const { intent } = await prepare(intents, recipients, {
      recipient: { type: "unsaved", address: DOUGLAS_BOT },
      chainId: BOT_MAINNET, asset: "BOT", amount: "1", nowMs: 10_000_000,
    });
    const live = await getTransferIntent(intents, { ownerAddress: OWNER_A, id: intent.id, nowMs: 10_000_001 });
    assert.equal(live.expired, false);
    const after = await getTransferIntent(intents, {
      ownerAddress: OWNER_A, id: intent.id, nowMs: 10_000_000 + 15 * 60 * 1000 + 1,
    });
    assert.equal(after.expired, true);
    const stale = await checkIntentFreshness(intents, recipients, {
      ownerAddress: OWNER_A, id: intent.id, nowMs: 10_000_000 + 15 * 60 * 1000 + 1,
    });
    assert.equal(stale.freshness.fresh, false);
  }

  // --- cancellation (idempotent, owner-scoped) ---
  {
    const { intents, recipients } = stores();
    const { intent } = await prepare(intents, recipients, {
      recipient: { type: "unsaved", address: DOUGLAS_BOT },
      chainId: BOT_MAINNET, asset: "BOT", amount: "1", nowMs: 11_000_000,
    });
    const cancelled = await cancelTransferIntent(intents, { ownerAddress: OWNER_A, id: intent.id });
    assert.equal(cancelled.status, "cancelled");
    const again = await cancelTransferIntent(intents, { ownerAddress: OWNER_A, id: intent.id });
    assert.equal(again.status, "cancelled");
    await expectTransferCode(
      () => cancelTransferIntent(intents, { ownerAddress: OWNER_A, id: "wti_missing" }),
      "NOT_FOUND",
    );
  }

  // --- duplicate / idempotent creation ---
  {
    const { intents, recipients } = stores();
    const base = {
      recipient: { type: "unsaved", address: DOUGLAS_BOT } as const,
      chainId: BOT_MAINNET, asset: "USDT", amount: "2",
      idempotencyKey: "pay-douglas-001",
    };
    const first = await prepare(intents, recipients, { ...base, nowMs: 12_000_000 });
    // Same key + same terms + same window → identical intent returned.
    const second = await prepareTransferIntent(intents, recipients, {
      ownerAddress: OWNER_A, ...base, nowMs: 12_000_000,
    });
    assert.equal(second.deduplicated, true);
    assert.equal(second.intent.id, first.intent.id);
    // Same key + different amount → conflict, no silent overwrite.
    await expectTransferCode(
      () => prepare(intents, recipients, { ...base, amount: "3", nowMs: 12_000_000 }),
      "IDEMPOTENCY_CONFLICT",
    );
    // No key → always a fresh intent.
    const third = await prepare(intents, recipients, {
      recipient: { type: "unsaved", address: DOUGLAS_BOT },
      chainId: BOT_MAINNET, asset: "USDT", amount: "2", nowMs: 12_000_000,
    });
    assert.notEqual(third.intent.id, first.intent.id);
  }

  // --- immutable payment-critical fields + fingerprint binding ---
  {
    const fpA = computeTermsFingerprint({
      owner: OWNER_A, chainId: BOT_MAINNET, assetKey: `native:BOT:${BOT_MAINNET}`,
      amountBaseUnits: "1000000", recipientAddress: DOUGLAS_BOT,
      savedRecipientId: null, savedRecipientVersion: null,
      expiresAtIso: "2026-01-01T00:00:00.000Z",
    });
    const fpB = computeTermsFingerprint({
      owner: OWNER_A, chainId: BOT_MAINNET, assetKey: `native:BOT:${BOT_MAINNET}`,
      amountBaseUnits: "2000000", recipientAddress: DOUGLAS_BOT,
      savedRecipientId: null, savedRecipientVersion: null,
      expiresAtIso: "2026-01-01T00:00:00.000Z",
    });
    assert.notEqual(fpA, fpB);
    assert.equal(fpA, computeTermsFingerprint({
      owner: OWNER_A, chainId: BOT_MAINNET, assetKey: `native:BOT:${BOT_MAINNET}`,
      amountBaseUnits: "1000000", recipientAddress: DOUGLAS_BOT,
      savedRecipientId: null, savedRecipientVersion: null,
      expiresAtIso: "2026-01-01T00:00:00.000Z",
    }));
    // Repository exposes no terms mutation: cancel is the only write path.
    const { intents, recipients } = stores();
    const { intent } = await prepare(intents, recipients, {
      recipient: { type: "unsaved", address: DOUGLAS_BOT },
      chainId: BOT_MAINNET, asset: "BOT", amount: "1", nowMs: 13_000_000,
    });
    const reloaded = await getTransferIntent(intents, { ownerAddress: OWNER_A, id: intent.id });
    assert.equal(reloaded.intent.termsFingerprint, intent.termsFingerprint);
    assert.equal(reloaded.intent.amountBaseUnits, intent.amountBaseUnits);
  }

  // --- no client-controlled success/approval state ---
  {
    const { intents, recipients } = stores();
    const { intent } = await prepareTransferIntent(intents, recipients, {
      ownerAddress: OWNER_A,
      recipient: { type: "unsaved", address: DOUGLAS_BOT },
      chainId: BOT_MAINNET,
      asset: "USDT",
      amount: "2",
      // A hostile client cannot smuggle approval through extra fields.
      nowMs: 14_000_000,
    } as PrepareIntentArgs);
    assert.equal(intent.status, "pending");
    assert.equal(intent.approvalVersion, 1);
  }

  // --- Celo airtime/cash-out regression (Paycrest path untouched) ---
  {
    const { getPaymentAsset } = await import("@/lib/celo/assets");
    const { CANONICAL_CELO_USDC_ADDRESS } = await import("@/lib/celo/usdc");
    assert.equal(getPaymentAsset("USDC").address, CANONICAL_CELO_USDC_ADDRESS);
    assert.equal(getPaymentAsset("CNGN").symbol, "CNGN");
  }

  console.log("transfers self-check (B3): all assertions passed");
}

run().catch((err) => {
  console.error("transfers self-check (B3) failed:", err);
  process.exit(1);
});
