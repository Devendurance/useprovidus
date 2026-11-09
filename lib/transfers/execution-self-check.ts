/**
 * B4A deterministic self-check for wallet_transfer execution preparation.
 * Run: npm run test:execution
 *
 * Fully offline: memory intent + recipient stores, viem only. No database,
 * no signing, no broadcast. Verifies the stored-intent-only plan builder:
 * correct calldata/value/deadline routing, every rejection path, and that
 * execution never mutates intent status.
 */

import assert from "node:assert/strict";
import {
  decodeFunctionData,
  getAddress,
  isAddress,
  type Hex,
} from "viem";
import { createMemoryIntentStore } from "@/lib/transfers/repository";
import { createMemoryRecipientStore } from "@/lib/recipients/repository";
import {
  saveRecipient,
  changeRecipientAddress,
} from "@/lib/recipients/service";
import {
  cancelTransferIntent,
  prepareTransferIntent,
  TransferError,
} from "@/lib/transfers/service";
import {
  PAY_NATIVE_SIGNATURE,
  PAY_TOKEN_SIGNATURE,
  PROVIDUS_PAY_ABI,
  getPaymentContractAddress,
  intentIdBytes,
} from "@/lib/transfers/contract";
import {
  ExecutionError,
  prepareExecutionPlan,
  type ExecutionConfig,
} from "@/lib/transfers/execution";

const OWNER_A = "0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa";
const OWNER_B = "0x000000000000000000000000000000000000dEaD";
const DOUGLAS_BOT = "0x1111111111111111111111111111111111111111";
const DOUGLAS_TESTNET = "0x2222222222222222222222222222222222222222";
const NEW_ADDR = "0x3333333333333333333333333333333333333333";
const BOT_MAINNET = 677;
const BOT_TESTNET = 968;
const USDT_MAINNET = "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C";
const CONTRACT_677 = "0x7777777777777777777777777777777777777777";
const CONTRACT_968 = "0x8888888888888888888888888888888888888888";

function stores() {
  return {
    intents: createMemoryIntentStore(),
    recipients: createMemoryRecipientStore(),
  };
}

function fullConfig(): ExecutionConfig {
  return {
    contractAddresses: {
      [BOT_MAINNET]: CONTRACT_677,
      [BOT_TESTNET]: CONTRACT_968,
    },
  };
}

async function expectExecutionCode(
  fn: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    assert.ok(
      err instanceof ExecutionError,
      `expected ExecutionError, got ${String(err)}`,
    );
    assert.equal(err.code, code);
    return;
  }
  assert.fail(`expected ExecutionError ${code}, but call succeeded`);
}

async function expectTransferCode(
  fn: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    assert.ok(
      err instanceof TransferError,
      `expected TransferError, got ${String(err)}`,
    );
    assert.equal(err.code, code);
    return;
  }
  assert.fail(`expected TransferError ${code}, but call succeeded`);
}

async function run() {
  // --- canonical selectors stay exact (parallel Solidity track binds to these) ---
  {
    assert.equal(PAY_NATIVE_SIGNATURE, "payNative(bytes32,address,uint256)");
    assert.equal(
      PAY_TOKEN_SIGNATURE,
      "payToken(bytes32,address,address,uint256,uint256)",
    );
    const names = PROVIDUS_PAY_ABI.map((e) => `${e.type}:${e.name}`);
    assert.deepEqual(names, [
      "function:payNative",
      "function:payToken",
      "event:PaymentExecuted",
    ]);
  }

  // --- contract address binding: env override, null when unset, null for unknown chain ---
  {
    assert.equal(
      getPaymentContractAddress(BOT_MAINNET, {
        PROVIDUS_PAY_CONTRACT_677: CONTRACT_677,
      }),
      getAddress(CONTRACT_677),
    );
    assert.equal(
      getPaymentContractAddress(BOT_TESTNET, {
        PROVIDUS_PAY_CONTRACT_968: CONTRACT_968,
      }),
      getAddress(CONTRACT_968),
    );
    assert.equal(getPaymentContractAddress(BOT_MAINNET, {}), null);
    assert.equal(getPaymentContractAddress(1, {}), null);
    assert.equal(
      getPaymentContractAddress(BOT_MAINNET, {
        PROVIDUS_PAY_CONTRACT_677: "not-an-address",
      }),
      null,
    );
  }

  // --- intentIdBytes: 0x + fingerprint, strict 32 bytes ---
  {
    const fp = "ab".repeat(32);
    assert.equal(intentIdBytes({ termsFingerprint: fp }), `0x${fp}` as Hex);
    assert.throws(() => intentIdBytes({ termsFingerprint: "abc" }));
    assert.throws(() => intentIdBytes({ termsFingerprint: "zz".repeat(32) }));
  }

  // --- saved Douglas USDT intent: correct to / data / value / deadline ---
  {
    const { intents, recipients } = stores();
    await saveRecipient(recipients, {
      ownerAddress: OWNER_A,
      label: "Douglas",
      chainId: BOT_MAINNET,
      address: DOUGLAS_BOT,
    });
    const { intent } = await prepareTransferIntent(intents, recipients, {
      ownerAddress: OWNER_A,
      recipient: { type: "saved", label: "douglas" },
      chainId: BOT_MAINNET,
      asset: "USDT",
      amount: "2",
      nowMs: 1_000_000,
    });
    const plan = await prepareExecutionPlan(intents, recipients, fullConfig(), {
      ownerAddress: OWNER_A,
      intentId: intent.id,
      nowMs: 1_000_100,
    });
    assert.equal(plan.to, getAddress(CONTRACT_677));
    assert.equal(plan.value, "0");
    assert.equal(plan.token, getAddress(USDT_MAINNET));
    assert.equal(plan.amountBaseUnits, "2000000");
    assert.equal(plan.payer, getAddress(OWNER_A));
    assert.equal(plan.recipient, getAddress(DOUGLAS_BOT));
    assert.equal(plan.chainId, BOT_MAINNET);
    assert.equal(plan.environment, "mainnet");
    assert.equal(plan.termsFingerprint, intent.termsFingerprint);
    assert.equal(plan.intentId, `0x${intent.termsFingerprint}`);
    assert.equal(plan.deadline, Math.floor(Date.parse(intent.expiresAt) / 1000));
    assert.ok(isAddress(plan.to));
    assert.ok(plan.data.startsWith("0x") && plan.data.length > 10);
    const decoded = decodeFunctionData({ abi: PROVIDUS_PAY_ABI, data: plan.data });
    assert.equal(decoded.functionName, "payToken");
    assert.deepEqual(
      (decoded.args as unknown as unknown[]).map(String),
      [
        plan.intentId,
        getAddress(USDT_MAINNET),
        getAddress(DOUGLAS_BOT),
        "2000000",
        String(plan.deadline),
      ],
    );
    // Execution never mutates status.
    const { intents: check } = { intents };
    const reloaded = await check.findIntentById(intent.id);
    assert.equal(reloaded?.status, "pending");
  }

  // --- unsaved recipient: native BOT plan carries value, null token ---
  {
    const { intents, recipients } = stores();
    const { intent } = await prepareTransferIntent(intents, recipients, {
      ownerAddress: OWNER_A,
      recipient: { type: "unsaved", label: "Douglas", address: DOUGLAS_BOT },
      chainId: BOT_MAINNET,
      asset: "BOT",
      amount: "1.5",
      nowMs: 2_000_000,
    });
    const plan = await prepareExecutionPlan(intents, recipients, fullConfig(), {
      ownerAddress: OWNER_A,
      intentId: intent.id,
      nowMs: 2_000_100,
    });
    assert.equal(plan.token, null);
    assert.equal(plan.value, "1500000000000000000");
    assert.equal(plan.amountBaseUnits, "1500000000000000000");
    assert.equal(plan.to, getAddress(CONTRACT_677));
    const decoded = decodeFunctionData({ abi: PROVIDUS_PAY_ABI, data: plan.data });
    assert.equal(decoded.functionName, "payNative");
    assert.deepEqual(
      (decoded.args as unknown as unknown[]).map(String),
      [plan.intentId, getAddress(DOUGLAS_BOT), String(plan.deadline)],
    );
  }

  // --- stale version rejected (edit after prepare) ---
  {
    const { intents, recipients } = stores();
    const saved = await saveRecipient(recipients, {
      ownerAddress: OWNER_A,
      label: "Douglas",
      chainId: BOT_MAINNET,
      address: DOUGLAS_BOT,
    });
    const { intent } = await prepareTransferIntent(intents, recipients, {
      ownerAddress: OWNER_A,
      recipient: { type: "saved", label: "Douglas" },
      chainId: BOT_MAINNET,
      asset: "USDT",
      amount: "2",
      nowMs: 3_000_000,
    });
    await changeRecipientAddress(recipients, {
      ownerAddress: OWNER_A,
      id: saved.id,
      newAddress: NEW_ADDR,
      expectedVersion: 1,
    });
    await expectExecutionCode(
      () =>
        prepareExecutionPlan(intents, recipients, fullConfig(), {
          ownerAddress: OWNER_A,
          intentId: intent.id,
          nowMs: 3_000_100,
        }),
      "STALE_RECIPIENT_VERSION_CHANGED",
    );
  }

  // --- expired rejected ---
  {
    const { intents, recipients } = stores();
    const { intent } = await prepareTransferIntent(intents, recipients, {
      ownerAddress: OWNER_A,
      recipient: { type: "unsaved", address: DOUGLAS_BOT },
      chainId: BOT_MAINNET,
      asset: "BOT",
      amount: "1",
      nowMs: 4_000_000,
    });
    await expectExecutionCode(
      () =>
        prepareExecutionPlan(intents, recipients, fullConfig(), {
          ownerAddress: OWNER_A,
          intentId: intent.id,
          nowMs: 4_000_000 + 15 * 60 * 1000 + 1,
        }),
      "INTENT_EXPIRED",
    );
  }

  // --- non-pending status is not executable and is never mutated here ---
  {
    const { intents, recipients } = stores();
    const { intent } = await prepareTransferIntent(intents, recipients, {
      ownerAddress: OWNER_A,
      recipient: { type: "unsaved", address: DOUGLAS_BOT },
      chainId: BOT_MAINNET,
      asset: "BOT",
      amount: "1",
      nowMs: 4_500_000,
    });
    await cancelTransferIntent(intents, {
      ownerAddress: OWNER_A,
      id: intent.id,
    });
    await expectExecutionCode(
      () =>
        prepareExecutionPlan(intents, recipients, fullConfig(), {
          ownerAddress: OWNER_A,
          intentId: intent.id,
          nowMs: 4_500_100,
        }),
      "INTENT_NOT_EXECUTABLE",
    );
  }

  // --- wrong chain via direct insert (service could never prepare these) ---
  {
    const { intents, recipients } = stores();
    const base = {
      ownerAddress: getAddress(OWNER_A),
      recipientSource: "unsaved",
      savedRecipientId: null,
      savedRecipientVersion: null,
      recipientAddress: getAddress(DOUGLAS_BOT),
      recipientLabel: "Douglas",
      environment: "mainnet",
      assetSymbol: "BOT",
      tokenAddress: null,
      assetDecimals: 18,
      amountDisplay: "1",
      amountBaseUnits: "1000000000000000000",
      status: "pending",
      approvalVersion: 1,
      termsFingerprint: "11".repeat(32),
      idempotencyKey: null,
      createdAt: new Date(5_000_000).toISOString(),
      expiresAt: new Date(5_000_000 + 15 * 60 * 1000).toISOString(),
      updatedAt: new Date(5_000_000).toISOString(),
    } as const;
    await intents.insertIntent({ ...base, id: "wti_wrong_chain_1", chainId: 1 });
    await expectExecutionCode(
      () =>
        prepareExecutionPlan(intents, recipients, fullConfig(), {
          ownerAddress: OWNER_A,
          intentId: "wti_wrong_chain_1",
          nowMs: 5_000_100,
        }),
      "UNSUPPORTED_CHAIN",
    );
    await intents.insertIntent({ ...base, id: "wti_celo", chainId: 42220 });
    await expectExecutionCode(
      () =>
        prepareExecutionPlan(intents, recipients, fullConfig(), {
          ownerAddress: OWNER_A,
          intentId: "wti_celo",
          nowMs: 5_000_100,
        }),
      "CELO_WALLET_TRANSFER_UNSUPPORTED",
    );
  }

  // --- wrong payer sees NOT_FOUND (no owner leakage) ---
  {
    const { intents, recipients } = stores();
    const { intent } = await prepareTransferIntent(intents, recipients, {
      ownerAddress: OWNER_A,
      recipient: { type: "unsaved", address: DOUGLAS_BOT },
      chainId: BOT_MAINNET,
      asset: "USDT",
      amount: "1",
      nowMs: 6_000_000,
    });
    await expectExecutionCode(
      () =>
        prepareExecutionPlan(intents, recipients, fullConfig(), {
          ownerAddress: OWNER_B,
          intentId: intent.id,
          nowMs: 6_000_100,
        }),
      "NOT_FOUND",
    );
    await expectExecutionCode(
      () =>
        prepareExecutionPlan(intents, recipients, fullConfig(), {
          ownerAddress: "not-an-address",
          intentId: intent.id,
          nowMs: 6_000_100,
        }),
      "NOT_AUTHENTICATED",
    );
  }

  // --- tampered stored terms: mismatched tokenAddress ---
  {
    const { intents, recipients } = stores();
    await intents.insertIntent({
      id: "wti_tampered_token",
      ownerAddress: getAddress(OWNER_A),
      recipientSource: "unsaved",
      savedRecipientId: null,
      savedRecipientVersion: null,
      recipientAddress: getAddress(DOUGLAS_BOT),
      recipientLabel: "Douglas",
      chainId: BOT_MAINNET,
      environment: "mainnet",
      assetSymbol: "USDT",
      tokenAddress: getAddress(NEW_ADDR),
      assetDecimals: 6,
      amountDisplay: "2",
      amountBaseUnits: "2000000",
      status: "pending",
      approvalVersion: 1,
      termsFingerprint: "22".repeat(32),
      idempotencyKey: null,
      createdAt: new Date(7_000_000).toISOString(),
      expiresAt: new Date(7_000_000 + 15 * 60 * 1000).toISOString(),
      updatedAt: new Date(7_000_000).toISOString(),
    });
    await expectExecutionCode(
      () =>
        prepareExecutionPlan(intents, recipients, fullConfig(), {
          ownerAddress: OWNER_A,
          intentId: "wti_tampered_token",
          nowMs: 7_000_100,
        }),
      "ASSET_MISMATCH",
    );
  }

  // --- wrong decimals: stored decimals inconsistent with registry ---
  {
    const { intents, recipients } = stores();
    await intents.insertIntent({
      id: "wti_wrong_decimals",
      ownerAddress: getAddress(OWNER_A),
      recipientSource: "unsaved",
      savedRecipientId: null,
      savedRecipientVersion: null,
      recipientAddress: getAddress(DOUGLAS_BOT),
      recipientLabel: "Douglas",
      chainId: BOT_MAINNET,
      environment: "mainnet",
      assetSymbol: "BOT",
      tokenAddress: null,
      assetDecimals: 6,
      amountDisplay: "1",
      amountBaseUnits: "1000000",
      status: "pending",
      approvalVersion: 1,
      termsFingerprint: "33".repeat(32),
      idempotencyKey: null,
      createdAt: new Date(7_100_000).toISOString(),
      expiresAt: new Date(7_100_000 + 15 * 60 * 1000).toISOString(),
      updatedAt: new Date(7_100_000).toISOString(),
    });
    await expectExecutionCode(
      () =>
        prepareExecutionPlan(intents, recipients, fullConfig(), {
          ownerAddress: OWNER_A,
          intentId: "wti_wrong_decimals",
          nowMs: 7_100_100,
        }),
      "ASSET_MISMATCH",
    );
  }

  // --- BOT 18-decimal and USDT 6-decimal conversions via plan ---
  {
    const { intents, recipients } = stores();
    const bot = await prepareTransferIntent(intents, recipients, {
      ownerAddress: OWNER_A,
      recipient: { type: "unsaved", address: DOUGLAS_BOT },
      chainId: BOT_MAINNET,
      asset: "BOT",
      amount: "1.5",
      nowMs: 8_000_000,
    });
    assert.equal(bot.intent.amountBaseUnits, "1500000000000000000");
    const botPlan = await prepareExecutionPlan(intents, recipients, fullConfig(), {
      ownerAddress: OWNER_A,
      intentId: bot.intent.id,
      nowMs: 8_000_100,
    });
    assert.equal(botPlan.amountBaseUnits, "1500000000000000000");
    assert.equal(botPlan.value, "1500000000000000000");

    const usdt = await prepareTransferIntent(intents, recipients, {
      ownerAddress: OWNER_A,
      recipient: { type: "unsaved", address: DOUGLAS_BOT },
      chainId: BOT_MAINNET,
      asset: "USDT",
      amount: "2.50",
      nowMs: 8_000_000,
    });
    assert.equal(usdt.intent.amountBaseUnits, "2500000");
    const usdtPlan = await prepareExecutionPlan(intents, recipients, fullConfig(), {
      ownerAddress: OWNER_A,
      intentId: usdt.intent.id,
      nowMs: 8_000_100,
    });
    assert.equal(usdtPlan.amountBaseUnits, "2500000");
    assert.equal(usdtPlan.value, "0");
  }

  // --- testnet USDT impossible via service; execution rejects tokenAddress on 968 ---
  {
    const { intents, recipients } = stores();
    await expectTransferCode(
      () =>
        prepareTransferIntent(intents, recipients, {
          ownerAddress: OWNER_A,
          recipient: { type: "unsaved", address: DOUGLAS_TESTNET },
          chainId: BOT_TESTNET,
          asset: "USDT",
          amount: "1",
          nowMs: 9_000_000,
        }),
      "UNSUPPORTED_ASSET",
    );
    await intents.insertIntent({
      id: "wti_testnet_token",
      ownerAddress: getAddress(OWNER_A),
      recipientSource: "unsaved",
      savedRecipientId: null,
      savedRecipientVersion: null,
      recipientAddress: getAddress(DOUGLAS_TESTNET),
      recipientLabel: "Douglas",
      chainId: BOT_TESTNET,
      environment: "testnet",
      assetSymbol: "BOT",
      tokenAddress: getAddress(USDT_MAINNET),
      assetDecimals: 18,
      amountDisplay: "1",
      amountBaseUnits: "1000000000000000000",
      status: "pending",
      approvalVersion: 1,
      termsFingerprint: "44".repeat(32),
      idempotencyKey: null,
      createdAt: new Date(9_000_000).toISOString(),
      expiresAt: new Date(9_000_000 + 15 * 60 * 1000).toISOString(),
      updatedAt: new Date(9_000_000).toISOString(),
    });
    await expectExecutionCode(
      () =>
        prepareExecutionPlan(intents, recipients, fullConfig(), {
          ownerAddress: OWNER_A,
          intentId: "wti_testnet_token",
          nowMs: 9_000_100,
        }),
      "ASSET_MISMATCH",
    );
    // Valid testnet native plan routes to the 968 contract.
    const native = await prepareTransferIntent(intents, recipients, {
      ownerAddress: OWNER_A,
      recipient: { type: "unsaved", address: DOUGLAS_TESTNET },
      chainId: BOT_TESTNET,
      asset: "BOT",
      amount: "1",
      nowMs: 9_100_000,
    });
    const testnetPlan = await prepareExecutionPlan(intents, recipients, fullConfig(), {
      ownerAddress: OWNER_A,
      intentId: native.intent.id,
      nowMs: 9_100_100,
    });
    assert.equal(testnetPlan.to, getAddress(CONTRACT_968));
    assert.equal(testnetPlan.token, null);
  }

  // --- missing contract config ---
  {
    const { intents, recipients } = stores();
    const { intent } = await prepareTransferIntent(intents, recipients, {
      ownerAddress: OWNER_A,
      recipient: { type: "unsaved", address: DOUGLAS_BOT },
      chainId: BOT_MAINNET,
      asset: "USDT",
      amount: "1",
      nowMs: 10_000_000,
    });
    await expectExecutionCode(
      () =>
        prepareExecutionPlan(
          intents,
          recipients,
          { contractAddresses: {} },
          { ownerAddress: OWNER_A, intentId: intent.id, nowMs: 10_000_100 },
        ),
      "CONTRACT_NOT_CONFIGURED",
    );
    await expectExecutionCode(
      () =>
        prepareExecutionPlan(
          intents,
          recipients,
          { contractAddresses: { [BOT_MAINNET]: null } },
          { ownerAddress: OWNER_A, intentId: intent.id, nowMs: 10_000_100 },
        ),
      "CONTRACT_NOT_CONFIGURED",
    );
  }

  // --- Celo regression (Paycrest path untouched) ---
  {
    const { getPaymentAsset } = await import("@/lib/celo/assets");
    const { CANONICAL_CELO_USDC_ADDRESS } = await import("@/lib/celo/usdc");
    assert.equal(getPaymentAsset("USDC").address, CANONICAL_CELO_USDC_ADDRESS);
    assert.equal(getPaymentAsset("CNGN").symbol, "CNGN");
  }

  console.log("execution self-check (B4A): all assertions passed");
}

run().catch((err) => {
  console.error("execution self-check (B4A) failed:", err);
  process.exit(1);
});
