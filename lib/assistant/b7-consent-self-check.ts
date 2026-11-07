import assert from "node:assert/strict";
import { advanceWalletTransfer } from "./wallet-transfer";
import { createMemoryIntentStore } from "@/lib/transfers/repository";
import { createMemoryRecipientStore } from "@/lib/recipients/repository";
import { prepareTransferIntent } from "@/lib/transfers/service";

async function main() {
  for (const userMessage of ["do not save", "don't save", "no, do not save", "don't save this address", "please do not save", "no"]) {
    const recipientStore = createMemoryRecipientStore();
    const ownerAddress = "0x1111111111111111111111111111111111111111";
    await advanceWalletTransfer({
      intentStore: createMemoryIntentStore(), recipientStore, ownerAddress, userMessage,
      draft: { type: "wallet_transfer", ownerAddress, recipientLabel: "Douglas", recipientAddress: "0x2222222222222222222222222222222222222222", addressSource: "stated", recipientConfirmed: true, amount: "0.01", asset: "BOT", chainId: 968, phase: "awaiting_save_decision", missingFields: [], readyForConfirmation: true },
    });
    assert.deepEqual(await recipientStore.listActiveByOwner(ownerAddress), [], `Refusal must never save: ${userMessage}`);
  }
  const intentStore = createMemoryIntentStore();
  const recipientStore = createMemoryRecipientStore();
  const ownerAddress = "0x1111111111111111111111111111111111111111";
  const recipientAddress = "0x2222222222222222222222222222222222222222";
  const prepared = await prepareTransferIntent(intentStore, recipientStore, { ownerAddress, recipient: { type: "unsaved", address: recipientAddress }, chainId: 968, asset: "BOT", amount: "0.01" });
  const cancelled = await advanceWalletTransfer({ intentStore, recipientStore, ownerAddress, userMessage: "cancel", draft: { type: "wallet_transfer", ownerAddress, recipientLabel: "Douglas", recipientAddress, addressSource: "stated", recipientConfirmed: true, amount: "0.01", asset: "BOT", chainId: 968, phase: "awaiting_payment_review", preparedIntentId: prepared.intent.id, missingFields: [], readyForConfirmation: true } });
  assert.equal((await intentStore.findIntentById(prepared.intent.id))?.status, "cancelled");
  assert.equal(cancelled.action?.type, "cancelled");
  assert.match(cancelled.reply, /already approved.*can still settle/);
  console.log("B7 explicit save-consent checks passed.");
}
void main();
