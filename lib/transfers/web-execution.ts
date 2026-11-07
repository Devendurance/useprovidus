import { prepareExecutionPlan, ExecutionError } from "@/lib/transfers/execution";
import type { IntentStore } from "@/lib/transfers/repository";
import type { RecipientStore } from "@/lib/recipients/repository";
import type { SubmissionStore } from "@/lib/transfers/submissions";

export const B7_CONTRACT = "0xbc6298701490ba211733F2Dc28deB7Df9835B7a4";

export async function prepareWebExecution(
  intents: IntentStore, recipients: RecipientStore, submissions: SubmissionStore,
  owner: string, id: string, configuredContract: string | undefined,
) {
  const intent = await intents.findIntentById(id);
  if (!intent || intent.ownerAddress !== owner) throw new ExecutionError("NOT_FOUND", "Payment intent not found.");
  if (intent.chainId !== 968) throw new ExecutionError("UNSUPPORTED_CHAIN", "Mainnet payments are disabled until B9. Use native BOT on BOT Testnet (968).");
  if (configuredContract?.toLowerCase() !== B7_CONTRACT.toLowerCase()) throw new ExecutionError("CONTRACT_NOT_CONFIGURED", "Canonical BOT Testnet payment contract is not configured.");
  if (await submissions.findByIntent(id)) throw new ExecutionError("INTENT_NOT_EXECUTABLE", "A submission already exists. Recheck its status without resending.");
  const plan = await prepareExecutionPlan(intents, recipients, { contractAddresses: { 968: configuredContract } }, { ownerAddress: owner, intentId: id });
  return { intent, plan };
}
