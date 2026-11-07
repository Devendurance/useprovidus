import assert from "node:assert/strict";
import { createMemoryIntentStore } from "./repository";
import { createMemoryRecipientStore } from "@/lib/recipients/repository";
import { createMemorySubmissionStore, registerSubmissionTx } from "./submissions";
import { prepareTransferIntent, cancelTransferIntent } from "./service";
import { changeRecipientAddress, saveRecipient } from "@/lib/recipients/service";
import { B7_CONTRACT, prepareWebExecution } from "./web-execution";
import { createTokenApprovalControls, prepareTokenAllowance, type ApprovalState } from "@/lib/wallet/transfer-execution";
import type { PublicClient, WalletClient } from "viem";
import type { ExecutionPlan } from "./execution";

const owner = "0x1111111111111111111111111111111111111111";
const address = "0x2222222222222222222222222222222222222222";
const intents = createMemoryIntentStore();
const recipients = createMemoryRecipientStore();
const submissions = createMemorySubmissionStore();
const prep = async (chainId = 968, asset = "BOT") => (await prepareTransferIntent(intents, recipients, { ownerAddress: owner, recipient: { type: "unsaved", label: "Douglas", address }, chainId, asset, amount: "0.01" })).intent;
const web = (id: string, contract: string | undefined = B7_CONTRACT, wallet = owner) => prepareWebExecution(intents, recipients, submissions, wallet, id, contract);

async function main() {
  const intent = await prep();
  const { plan } = await web(intent.id);
  assert.equal(plan.value, "10000000000000000");
  assert.equal(plan.recipient, address);
  assert.equal(plan.payer, owner);
  assert.equal(plan.chainId, 968);
  await assert.rejects(web(intent.id, B7_CONTRACT, address), /not found/);
  await assert.rejects(web("forged"), /not found/);
  await assert.rejects(web(intent.id, ""), /configured/);
  await assert.rejects(web(intent.id, address), /configured/);
  const mainnet = await prep(677, "USDT");
  await assert.rejects(web(mainnet.id), /disabled until B9/);
  await assert.rejects(prep(968, "USDT"), /Only native/);
  await cancelTransferIntent(intents, { ownerAddress: owner, id: intent.id });
  await assert.rejects(web(intent.id), /pending/);
  const expired = (await prepareTransferIntent(intents, recipients, { ownerAddress: owner, recipient: { type: "unsaved", address }, chainId: 968, asset: "BOT", amount: "0.01", nowMs: 0 })).intent;
  await assert.rejects(web(expired.id), /expired/);
  const saved = await saveRecipient(recipients, { ownerAddress: owner, label: "Douglas", chainId: 968, address });
  const savedIntent = (await prepareTransferIntent(intents, recipients, { ownerAddress: owner, recipient: { type: "saved", label: "Douglas" }, chainId: 968, asset: "BOT", amount: "0.01" })).intent;
  await changeRecipientAddress(recipients, { ownerAddress: owner, id: saved.id, expectedVersion: saved.version, newAddress: owner });
  await assert.rejects(web(savedIntent.id), /changed/);
  const submitted = await prep();
  const args = { intent: submitted, ownerAddress: owner, txHash: `0x${"ab".repeat(32)}`, contractAddress: B7_CONTRACT };
  await registerSubmissionTx(submissions, args);
  assert.equal((await registerSubmissionTx(submissions, args)).deduplicated, true);
  await assert.rejects(web(submitted.id), /submission already exists/);

  const tokenPlan: ExecutionPlan = { ...plan, chainId: 677, token: address, amountBaseUnits: "12345", value: "0" };
  let approvals = 0;
  const states: ApprovalState[] = [];
  const controls = {
    plan: tokenPlan, readAllowance: async (chainId: number) => { assert.equal(chainId, 677); return BigInt(0); },
    approveExact: async (chainId: number, token: string, spender: string, amount: bigint) => { approvals++; assert.equal(chainId, 677); assert.equal(token, address); assert.equal(spender, plan.to); assert.equal(amount, BigInt(12345)); return `0x${"cd".repeat(32)}` as `0x${string}`; },
    wait: async () => ({ status: "success" }), revalidate: async () => {}, onState: (state: ApprovalState) => states.push(state),
  };
  await prepareTokenAllowance({ ...controls, approveExact: undefined });
  assert.equal(approvals, 0);
  assert.equal(states.at(-1), "approval_required");
  await prepareTokenAllowance(controls);
  assert.equal(approvals, 1);
  assert.deepEqual(states.slice(-5), ["checking_allowance", "approval_required", "awaiting_token_approval", "approval_confirming", "payment_ready"]);
  await assert.rejects(prepareTokenAllowance({ ...controls, revalidate: async () => { throw new Error("Intent expired while approval confirmed"); } }), /expired/);
  await assert.rejects(prepareTokenAllowance({ ...controls, wait: async () => ({ status: "reverted" }) }), /approval failed/);
  const before = approvals;
  await prepareTokenAllowance({ ...controls, readAllowance: async () => BigInt(12345) });
  assert.equal(approvals, before);
  let tokenWrites = 0;
  const tokenClient = {
    getChainId: async () => 677,
    readContract: async (request: { address: string; functionName: string; args: unknown[] }) => {
      assert.equal(request.address, address); assert.equal(request.functionName, "allowance"); assert.deepEqual(request.args, [owner, plan.to]); return BigInt(0);
    },
    waitForTransactionReceipt: async () => ({ status: "success" }),
  } as unknown as PublicClient;
  const tokenWallet = {
    getChainId: async () => 677, getAddresses: async () => [owner],
    writeContract: async (request: { address: string; functionName: string; args: unknown[]; chain: { id: number } }) => {
      assert.equal(request.chain.id, 677); assert.equal(request.address, address); assert.equal(request.functionName, "approve"); assert.deepEqual(request.args, [plan.to, BigInt(12345)]); tokenWrites++; return `0x${"ef".repeat(32)}`;
    },
  } as unknown as WalletClient;
  const wired = createTokenApprovalControls(tokenPlan, tokenClient, tokenWallet, async () => {});
  await prepareTokenAllowance({ ...wired, onState: () => {} });
  assert.equal(tokenWrites, 1);
  await assert.rejects(wired.readAllowance(968, address, owner, plan.to), /network or owner changed/);
  console.log("B7 execution security, durable submission, and exact ERC-20 approval checks passed.");
}
void main();
