/**
 * B9C.0 deterministic self-check for the local-only mainnet test gate.
 * Run: npx --yes tsx lib/transfers/test-mode-self-check.ts
 *
 * Fully offline. Covers: gate closed without flag / in production / with bad
 * config; exact payer/recipient/amount/contract enforcement; 968 path
 * unchanged; mainnet stays disabled by default.
 */

import assert from "node:assert/strict";
import { createMemoryIntentStore } from "@/lib/transfers/repository";
import { createMemoryRecipientStore } from "@/lib/recipients/repository";
import { createMemorySubmissionStore } from "@/lib/transfers/submissions";
import { saveRecipient } from "@/lib/recipients/service";
import { prepareTransferIntent } from "@/lib/transfers/service";
import { prepareWebExecution } from "@/lib/transfers/web-execution";
import { ExecutionError } from "@/lib/transfers/execution";
import { getMainnetTestConfig, MAINNET_CONTRACT_ADDRESS } from "@/lib/transfers/test-mode";

const PAYER = "0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const OTHER = "0x000000000000000000000000000000000000dEaD";

function setEnv(vars: Record<string, string | undefined>): void {
  const env = process.env as Record<string, string | undefined>;
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
}

function setNodeEnv(value: string | undefined): string | undefined {
  const env = process.env as Record<string, string | undefined>;
  const prev = env.NODE_ENV;
  if (value === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = value;
  return prev;
}

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

async function makeIntent(amount = "0.01") {
  const intents = createMemoryIntentStore();
  const recipients = createMemoryRecipientStore();
  await saveRecipient(recipients, { ownerAddress: PAYER, label: "Douglas", chainId: 677, address: RECIPIENT });
  const { intent } = await prepareTransferIntent(intents, recipients, {
    ownerAddress: PAYER,
    recipient: { type: "saved", label: "douglas" },
    chainId: 677,
    asset: "BOT",
    amount,
  });
  return { intents, recipients, intent };
}

async function run() {
  const prevFlag = process.env.PROVIDUS_MAINNET_TEST_MODE;
  const prevPayer = process.env.PROVIDUS_MAINNET_TEST_PAYER;
  const prevRecipient = process.env.PROVIDUS_MAINNET_TEST_RECIPIENT;
  const prevNodeEnv = (process.env as Record<string, string | undefined>).NODE_ENV;
  try {
    // --- gate closed without flag ---
    setEnv({ PROVIDUS_MAINNET_TEST_MODE: undefined, PROVIDUS_MAINNET_TEST_PAYER: PAYER, PROVIDUS_MAINNET_TEST_RECIPIENT: RECIPIENT });
    assert.equal(getMainnetTestConfig(), null);

    // --- gate closed with invalid addresses ---
    setEnv({ PROVIDUS_MAINNET_TEST_MODE: "1", PROVIDUS_MAINNET_TEST_PAYER: "nope", PROVIDUS_MAINNET_TEST_RECIPIENT: RECIPIENT });
    assert.equal(getMainnetTestConfig(), null);
    setEnv({ PROVIDUS_MAINNET_TEST_MODE: "1", PROVIDUS_MAINNET_TEST_PAYER: PAYER, PROVIDUS_MAINNET_TEST_RECIPIENT: PAYER });
    assert.equal(getMainnetTestConfig(), null);

    // --- gate closed in production even when flagged ---
    setEnv({ PROVIDUS_MAINNET_TEST_MODE: "1", PROVIDUS_MAINNET_TEST_PAYER: PAYER, PROVIDUS_MAINNET_TEST_RECIPIENT: RECIPIENT });
    const savedNodeEnv = setNodeEnv("production");
    assert.equal(getMainnetTestConfig(), null);
    setNodeEnv(savedNodeEnv);

    // --- gate open with valid config ---
    const config = getMainnetTestConfig();
    assert.ok(config);
    assert.equal(config.payer, PAYER);
    assert.equal(config.recipient, RECIPIENT);

    const submissions = () => createMemorySubmissionStore();

    // --- 677 without flag → hard disabled ---
    {
      setEnv({ PROVIDUS_MAINNET_TEST_MODE: undefined });
      const { intents, recipients, intent } = await makeIntent();
      await expectCode(
        () => prepareWebExecution(intents, recipients, submissions(), PAYER, intent.id, undefined),
        "UNSUPPORTED_CHAIN",
      );
    }

    // --- 677 with flag: wrong owner / recipient / amount rejected ---
    setEnv({ PROVIDUS_MAINNET_TEST_MODE: "1", PROVIDUS_MAINNET_TEST_PAYER: PAYER, PROVIDUS_MAINNET_TEST_RECIPIENT: RECIPIENT });
    {
      const { intents, recipients, intent } = await makeIntent();
      await expectCode(
        () => prepareWebExecution(intents, recipients, submissions(), OTHER, intent.id, undefined),
        "NOT_FOUND",
      );
      const wrongRcp = { ...intent, recipientAddress: OTHER };
      const intents2 = createMemoryIntentStore();
      const recipients2 = createMemoryRecipientStore();
      await saveRecipient(recipients2, { ownerAddress: PAYER, label: "Eve", chainId: 677, address: OTHER });
      const made = await prepareTransferIntent(intents2, recipients2, {
        ownerAddress: PAYER, recipient: { type: "saved", label: "eve" }, chainId: 677, asset: "BOT", amount: "0.01",
      });
      assert.notEqual(made.intent.recipientAddress, RECIPIENT);
      await expectCode(
        () => prepareWebExecution(intents2, recipients2, submissions(), PAYER, made.intent.id, undefined),
        "INTENT_NOT_EXECUTABLE",
      );
      void wrongRcp;
    }
    {
      const { intents, recipients } = await makeIntent("0.02");
      const { intent } = await prepareTransferIntent(intents, recipients, {
        ownerAddress: PAYER, recipient: { type: "unsaved", address: RECIPIENT }, chainId: 677, asset: "BOT", amount: "0.02",
      });
      assert.equal(intent.amountBaseUnits, "20000000000000000");
      await expectCode(
        () => prepareWebExecution(intents, recipients, submissions(), PAYER, intent.id, undefined),
        "INTENT_NOT_EXECUTABLE",
      );
    }

    // --- happy path: exact 0.01 native BOT to designated recipient ---
    {
      const { intents, recipients, intent } = await makeIntent();
      const { plan } = await prepareWebExecution(intents, recipients, submissions(), PAYER, intent.id, undefined);
      assert.equal(plan.chainId, 677);
      assert.equal(plan.to.toLowerCase(), MAINNET_CONTRACT_ADDRESS.toLowerCase());
      assert.equal(plan.value, "10000000000000000");
      assert.equal(plan.token, null);
      assert.equal(plan.recipient, RECIPIENT);
    }

    // --- USDT happy path: exact 1 official USDT ---
    {
      const intents = createMemoryIntentStore();
      const recipients = createMemoryRecipientStore();
      await saveRecipient(recipients, { ownerAddress: PAYER, label: "Douglas", chainId: 677, address: RECIPIENT });
      const { intent } = await prepareTransferIntent(intents, recipients, {
        ownerAddress: PAYER, recipient: { type: "saved", label: "douglas" }, chainId: 677, asset: "USDT", amount: "1",
      });
      assert.equal(intent.amountBaseUnits, "1000000");
      const { plan } = await prepareWebExecution(intents, recipients, submissions(), PAYER, intent.id, undefined);
      assert.equal(plan.chainId, 677);
      assert.equal(plan.to.toLowerCase(), MAINNET_CONTRACT_ADDRESS.toLowerCase());
      assert.equal(plan.value, "0");
      assert.equal(plan.token?.toLowerCase(), "0xababc7ddc03e501d190c676bf3d92ef0e6e87a3c");
      assert.equal(plan.amountBaseUnits, "1000000");
    }
    // --- USDT rejections: wrong amount / test mode off ---
    {
      const intents = createMemoryIntentStore();
      const recipients = createMemoryRecipientStore();
      await saveRecipient(recipients, { ownerAddress: PAYER, label: "Douglas", chainId: 677, address: RECIPIENT });
      const { intent } = await prepareTransferIntent(intents, recipients, {
        ownerAddress: PAYER, recipient: { type: "saved", label: "douglas" }, chainId: 677, asset: "USDT", amount: "2",
      });
      await expectCode(
        () => prepareWebExecution(intents, recipients, submissions(), PAYER, intent.id, undefined),
        "INTENT_NOT_EXECUTABLE",
      );
    }
    {
      setEnv({ PROVIDUS_MAINNET_TEST_MODE: undefined });
      const intents = createMemoryIntentStore();
      const recipients = createMemoryRecipientStore();
      await saveRecipient(recipients, { ownerAddress: PAYER, label: "Douglas", chainId: 677, address: RECIPIENT });
      const { intent } = await prepareTransferIntent(intents, recipients, {
        ownerAddress: PAYER, recipient: { type: "saved", label: "douglas" }, chainId: 677, asset: "USDT", amount: "1",
      });
      await expectCode(
        () => prepareWebExecution(intents, recipients, submissions(), PAYER, intent.id, undefined),
        "UNSUPPORTED_CHAIN",
      );
      setEnv({ PROVIDUS_MAINNET_TEST_MODE: "1", PROVIDUS_MAINNET_TEST_PAYER: PAYER, PROVIDUS_MAINNET_TEST_RECIPIENT: RECIPIENT });
    }
    // --- exact-amount approval flow (mocked wallet): never unlimited ---
    {
      const { prepareTokenAllowance } = await import("@/lib/wallet/transfer-execution");
      const fakePlan = {
        chainId: 677,
        token: "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C" as `0x${string}`,
        payer: PAYER as `0x${string}`,
        to: MAINNET_CONTRACT_ADDRESS,
        amountBaseUnits: "1000000",
      };
      const states: string[] = [];
      let approvedAmount: bigint | null = null;
      let approveCalls = 0;
      await prepareTokenAllowance({
        plan: fakePlan as Parameters<typeof prepareTokenAllowance>[0]["plan"],
        readAllowance: async () => BigInt(0),
        approveExact: (async (_c: number, _t: `0x${string}`, _s: `0x${string}`, amount: bigint) => {
          approveCalls += 1;
          approvedAmount = amount;
          return "0x" + "aa".repeat(32) as `0x${string}`;
        }) as NonNullable<Parameters<typeof prepareTokenAllowance>[0]["approveExact"]>,
        wait: async () => ({ status: "success" }),
        revalidate: async () => {},
        onState: (s) => { states.push(s); },
      });
      assert.equal(approveCalls, 1);
      assert.equal(approvedAmount, BigInt(1000000));
      assert.deepEqual(states, ["checking_allowance", "approval_required", "awaiting_token_approval", "approval_confirming", "payment_ready"]);
      // Sufficient allowance: no approval transaction at all.
      let approveCalls2 = 0;
      await prepareTokenAllowance({
        plan: fakePlan as Parameters<typeof prepareTokenAllowance>[0]["plan"],
        readAllowance: async () => BigInt(1000000),
        approveExact: (async () => { approveCalls2 += 1; return ("0x" + "bb".repeat(32)) as `0x${string}`; }) as NonNullable<Parameters<typeof prepareTokenAllowance>[0]["approveExact"]>,
        wait: async () => ({ status: "success" }),
        revalidate: async () => {},
        onState: () => {},
      });
      assert.equal(approveCalls2, 0);
    }
    // --- 968 path unchanged (no flag needed) ---
    {
      setEnv({ PROVIDUS_MAINNET_TEST_MODE: undefined });
      const intents = createMemoryIntentStore();
      const recipients = createMemoryRecipientStore();
      await saveRecipient(recipients, { ownerAddress: PAYER, label: "Douglas", chainId: 968, address: RECIPIENT });
      const { intent } = await prepareTransferIntent(intents, recipients, {
        ownerAddress: PAYER, recipient: { type: "saved", label: "douglas" }, chainId: 968, asset: "BOT", amount: "1",
      });
      const { plan } = await prepareWebExecution(intents, recipients, submissions(), PAYER, intent.id, "0xbc6298701490ba211733F2Dc28deB7Df9835B7a4");
      assert.equal(plan.chainId, 968);
    }
  } finally {
    setEnv({
      PROVIDUS_MAINNET_TEST_MODE: prevFlag,
      PROVIDUS_MAINNET_TEST_PAYER: prevPayer,
      PROVIDUS_MAINNET_TEST_RECIPIENT: prevRecipient,
    });
    setNodeEnv(prevNodeEnv);
  }

  console.log("mainnet test-mode self-check (B9C.0): all assertions passed");
}

run().catch((err) => {
  console.error("mainnet test-mode self-check (B9C.0) failed:", err);
  process.exit(1);
});
