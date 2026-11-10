/**
 * B9C public mainnet policy self-check.
 * Run: npx --yes tsx lib/transfers/mainnet-policy-self-check.ts
 *
 * Fully offline, memory stores. Covers: native + USDT happy paths for
 * arbitrary authenticated wallets, unsupported tokens, zero/malformed amounts
 * (predicate level), owner binding, duplicate submission, 968 blocked in
 * production (VERCEL_ENV=production) but working locally, Celo untouched.
 */

import assert from "node:assert/strict";
import { createMemoryIntentStore } from "@/lib/transfers/repository";
import { createMemoryRecipientStore } from "@/lib/recipients/repository";
import { saveRecipient } from "@/lib/recipients/service";
import { prepareTransferIntent } from "@/lib/transfers/service";
import { createMemorySubmissionStore } from "@/lib/transfers/submissions";
import { prepareWebExecution } from "@/lib/transfers/web-execution";
import { ExecutionError } from "@/lib/transfers/execution";
import {
  isPublicMainnetIntent,
  MAINNET_CONTRACT_ADDRESS,
} from "@/lib/transfers/mainnet";

const OWNER_A = "0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa";
const OWNER_B = "0x000000000000000000000000000000000000dEaD";
const RECIP = "0x2222222222222222222222222222222222222222";
const USDT = "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C";

async function expectCode(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof ExecutionError, `expected ExecutionError, got ${String(err)}`);
    assert.equal(err.code, code);
    return;
  }
  assert.fail(`expected ExecutionError ${code}, but call succeeded`);
}

async function nativeIntent(owner: string, amount: string) {
  const intents = createMemoryIntentStore();
  const recipients = createMemoryRecipientStore();
  await saveRecipient(recipients, { ownerAddress: owner, label: "Douglas", chainId: 677, address: RECIP });
  const { intent } = await prepareTransferIntent(intents, recipients, {
    ownerAddress: owner, recipient: { type: "saved", label: "douglas" }, chainId: 677, asset: "BOT", amount,
  });
  return { intents, recipients, intent };
}

async function usdtIntent(owner: string, amount: string) {
  const intents = createMemoryIntentStore();
  const recipients = createMemoryRecipientStore();
  await saveRecipient(recipients, { ownerAddress: owner, label: "Douglas", chainId: 677, address: RECIP });
  const { intent } = await prepareTransferIntent(intents, recipients, {
    ownerAddress: owner, recipient: { type: "saved", label: "douglas" }, chainId: 677, asset: "USDT", amount,
  });
  return { intents, recipients, intent };
}

async function run() {
  // --- predicate unit checks ---
  assert.equal(isPublicMainnetIntent({ chainId: 677, assetSymbol: "BOT", amountBaseUnits: "10000000000000000", tokenAddress: null }), true);
  assert.equal(isPublicMainnetIntent({ chainId: 677, assetSymbol: "BOT", amountBaseUnits: "1", tokenAddress: null }), true);
  assert.equal(isPublicMainnetIntent({ chainId: 677, assetSymbol: "USDT", amountBaseUnits: "1000000", tokenAddress: USDT }), true);
  assert.equal(isPublicMainnetIntent({ chainId: 677, assetSymbol: "USDT", amountBaseUnits: "1000000", tokenAddress: "0x1111111111111111111111111111111111111111" }), false);
  assert.equal(isPublicMainnetIntent({ chainId: 677, assetSymbol: "BOT", amountBaseUnits: "0", tokenAddress: null }), false);
  assert.equal(isPublicMainnetIntent({ chainId: 677, assetSymbol: "BOT", amountBaseUnits: "", tokenAddress: null }), false);
  assert.equal(isPublicMainnetIntent({ chainId: 677, assetSymbol: "USDC", amountBaseUnits: "1000000", tokenAddress: USDT }), false);
  assert.equal(isPublicMainnetIntent({ chainId: 968, assetSymbol: "BOT", amountBaseUnits: "10000000000000000", tokenAddress: null }), false);

  // --- native happy path, arbitrary owner, no test flags needed ---
  {
    const { intents, recipients, intent } = await nativeIntent(OWNER_A, "0.01");
    const { plan } = await prepareWebExecution(intents, recipients, createMemorySubmissionStore(), OWNER_A, intent.id, undefined);
    assert.equal(plan.chainId, 677);
    assert.equal(plan.to.toLowerCase(), MAINNET_CONTRACT_ADDRESS.toLowerCase());
    assert.equal(plan.value, "10000000000000000");
    assert.equal(plan.token, null);
  }

  // --- USDT happy path ---
  {
    const { intents, recipients, intent } = await usdtIntent(OWNER_A, "1");
    const { plan } = await prepareWebExecution(intents, recipients, createMemorySubmissionStore(), OWNER_A, intent.id, undefined);
    assert.equal(plan.value, "0");
    assert.equal(plan.token?.toLowerCase(), USDT.toLowerCase());
    assert.equal(plan.amountBaseUnits, "1000000");
  }

  // --- second independent wallet works; owner binding enforced ---
  {
    const { intents, recipients, intent } = await usdtIntent(OWNER_B, "2.5");
    const { plan } = await prepareWebExecution(intents, recipients, createMemorySubmissionStore(), OWNER_B, intent.id, undefined);
    assert.equal(plan.recipient, RECIP);
    await expectCode(
      () => prepareWebExecution(intents, recipients, createMemorySubmissionStore(), OWNER_A, intent.id, undefined),
      "NOT_FOUND",
    );
  }

  // --- duplicate submission blocked ---
  {
    const { intents, recipients, intent } = await nativeIntent(OWNER_A, "0.5");
    const store = createMemorySubmissionStore();
    await prepareWebExecution(intents, recipients, store, OWNER_A, intent.id, undefined);
    const { registerSubmissionTx } = await import("@/lib/transfers/submissions");
    await registerSubmissionTx(store, {
      intent, ownerAddress: OWNER_A, txHash: "0x" + "ab".repeat(32), contractAddress: MAINNET_CONTRACT_ADDRESS,
    });
    await expectCode(
      () => prepareWebExecution(intents, recipients, store, OWNER_A, intent.id, undefined),
      "INTENT_NOT_EXECUTABLE",
    );
  }

  // --- 968 blocked in production, allowed locally ---
  {
    const prev = (process.env as Record<string, string | undefined>).VERCEL_ENV;
    try {
      (process.env as Record<string, string | undefined>).VERCEL_ENV = "production";
      const intents = createMemoryIntentStore();
      const recipients = createMemoryRecipientStore();
      await saveRecipient(recipients, { ownerAddress: OWNER_A, label: "D", chainId: 968, address: RECIP });
      const { intent } = await prepareTransferIntent(intents, recipients, {
        ownerAddress: OWNER_A, recipient: { type: "saved", label: "d" }, chainId: 968, asset: "BOT", amount: "1",
      });
      await expectCode(
        () => prepareWebExecution(intents, recipients, createMemorySubmissionStore(), OWNER_A, intent.id, "0xbc6298701490ba211733F2Dc28deB7Df9835B7a4"),
        "UNSUPPORTED_CHAIN",
      );
    } finally {
      if (prev === undefined) delete (process.env as Record<string, string | undefined>).VERCEL_ENV;
      else (process.env as Record<string, string | undefined>).VERCEL_ENV = prev;
    }
    const intents = createMemoryIntentStore();
    const recipients = createMemoryRecipientStore();
    await saveRecipient(recipients, { ownerAddress: OWNER_A, label: "D", chainId: 968, address: RECIP });
    const { intent } = await prepareTransferIntent(intents, recipients, {
      ownerAddress: OWNER_A, recipient: { type: "saved", label: "d" }, chainId: 968, asset: "BOT", amount: "1",
    });
    const { plan } = await prepareWebExecution(intents, recipients, createMemorySubmissionStore(), OWNER_A, intent.id, "0xbc6298701490ba211733F2Dc28deB7Df9835B7a4");
    assert.equal(plan.chainId, 968);
  }

  // --- Celo untouched ---
  {
    const { getPaymentAsset } = await import("@/lib/celo/assets");
    assert.equal(getPaymentAsset("USDC").symbol, "USDC");
  }

  console.log("mainnet policy self-check (B9C): all assertions passed");
}

run().catch((err) => {
  console.error("mainnet policy self-check (B9C) failed:", err);
  process.exit(1);
});
