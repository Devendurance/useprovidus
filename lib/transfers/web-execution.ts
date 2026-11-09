import { getAddress } from "viem";
import { prepareExecutionPlan, ExecutionError } from "@/lib/transfers/execution";
import type { IntentStore } from "@/lib/transfers/repository";
import type { RecipientStore } from "@/lib/recipients/repository";
import type { SubmissionStore } from "@/lib/transfers/submissions";
import {
  MAINNET_CONTRACT_ADDRESS,
  MAINNET_TEST_TERMS_NATIVE,
  MAINNET_TEST_TERMS_USDT,
  getMainnetTestConfig,
} from "@/lib/transfers/test-mode";

export const B7_CONTRACT = "0xbc6298701490ba211733F2Dc28deB7Df9835B7a4";

export async function prepareWebExecution(
  intents: IntentStore, recipients: RecipientStore, submissions: SubmissionStore,
  owner: string, id: string, configuredContract: string | undefined,
) {
  const intent = await intents.findIntentById(id);
  if (!intent || intent.ownerAddress !== owner) throw new ExecutionError("NOT_FOUND", "Payment intent not found.");
  if (intent.chainId !== 968) {
    // B9C.0 local-only mainnet browser test: exact payer/recipient/amount.
    // Production (and any non-matching intent) keeps failing closed here.
    if (intent.chainId === 677) {
      const test = getMainnetTestConfig();
      if (test === null) {
        throw new ExecutionError("UNSUPPORTED_CHAIN", "Mainnet payments are disabled until B9. Use native BOT on BOT Testnet (968).");
      }
      if (intent.ownerAddress.toLowerCase() !== test.payer.toLowerCase()) {
        throw new ExecutionError("NOT_FOUND", "Payment intent not found.");
      }
      if (intent.ownerAddress.toLowerCase() !== test.payer.toLowerCase()) {
        throw new ExecutionError("NOT_FOUND", "Payment intent not found.");
      }
      if (intent.ownerAddress.toLowerCase() !== test.payer.toLowerCase()) {
        throw new ExecutionError("NOT_FOUND", "Payment intent not found.");
      }
      if (intent.recipientAddress.toLowerCase() !== test.recipient.toLowerCase()) {
        throw new ExecutionError("INTENT_NOT_EXECUTABLE", "Recipient is not the designated mainnet test recipient.");
      }
      const isNativeTest = intent.tokenAddress === null;
      const terms = isNativeTest ? MAINNET_TEST_TERMS_NATIVE : MAINNET_TEST_TERMS_USDT;
      const termsToken = terms.tokenAddress === null ? null : getAddress(terms.tokenAddress).toLowerCase();
      if (
        intent.assetSymbol !== terms.assetSymbol ||
        intent.amountBaseUnits !== terms.amountBaseUnits ||
        (intent.tokenAddress === null ? null : getAddress(intent.tokenAddress).toLowerCase()) !== termsToken
      ) {
        throw new ExecutionError("INTENT_NOT_EXECUTABLE", "Only the approved 0.01 native BOT or 1 USDT mainnet test payments are allowed.");
      }
      // The test contract is the audited constant — never env-derived.
      if (await submissions.findByIntent(id)) throw new ExecutionError("INTENT_NOT_EXECUTABLE", "A submission already exists. Recheck its status without resending.");
      const plan = await prepareExecutionPlan(intents, recipients, { contractAddresses: { 677: MAINNET_CONTRACT_ADDRESS } }, { ownerAddress: owner, intentId: id });
      return { intent, plan };
    }
    throw new ExecutionError("UNSUPPORTED_CHAIN", "Mainnet payments are disabled until B9. Use native BOT on BOT Testnet (968).");
  }
  if (configuredContract?.toLowerCase() !== B7_CONTRACT.toLowerCase()) throw new ExecutionError("CONTRACT_NOT_CONFIGURED", "Canonical BOT Testnet payment contract is not configured.");
  if (await submissions.findByIntent(id)) throw new ExecutionError("INTENT_NOT_EXECUTABLE", "A submission already exists. Recheck its status without resending.");
  const plan = await prepareExecutionPlan(intents, recipients, { contractAddresses: { 968: configuredContract } }, { ownerAddress: owner, intentId: id });
  return { intent, plan };
}
