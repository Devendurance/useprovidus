import { prepareExecutionPlan, ExecutionError } from "@/lib/transfers/execution";
import type { IntentStore } from "@/lib/transfers/repository";
import type { RecipientStore } from "@/lib/recipients/repository";
import type { SubmissionStore } from "@/lib/transfers/submissions";
import { MAINNET_CONTRACT_ADDRESS, isPublicMainnetIntent } from "@/lib/transfers/mainnet";

export const B7_CONTRACT = "0xbc6298701490ba211733F2Dc28deB7Df9835B7a4";

export async function prepareWebExecution(
  intents: IntentStore, recipients: RecipientStore, submissions: SubmissionStore,
  owner: string, id: string, configuredContract: string | undefined,
) {
  const intent = await intents.findIntentById(id);
  if (!intent || intent.ownerAddress !== owner) throw new ExecutionError("NOT_FOUND", "Payment intent not found.");
  if (intent.chainId === 677) {
    // Public BOT Mainnet path: any authenticated wallet, exact audited terms.
    // Test-mode gating was removed at public activation; B9C.0's designated
    // payer/recipient/amount restrictions no longer apply.
    if (!isPublicMainnetIntent(intent)) {
      throw new ExecutionError("INTENT_NOT_EXECUTABLE", "Only native BOT and official USDT payments are supported on BOT Chain Mainnet.");
    }
    if (await submissions.findByIntent(id)) throw new ExecutionError("INTENT_NOT_EXECUTABLE", "A submission already exists. Recheck its status without resending.");
    const plan = await prepareExecutionPlan(intents, recipients, { contractAddresses: { 677: MAINNET_CONTRACT_ADDRESS } }, { ownerAddress: owner, intentId: id });
    return { intent, plan };
  }
  if (intent.chainId === 968 && process.env.VERCEL_ENV === "production") {
    // Testnet is hidden from the public product: no new mainnet-adjacent
    // testnet executions in production. Local/dev chains keep working and
    // historical testnet receipts remain verifiable.
    throw new ExecutionError("UNSUPPORTED_CHAIN", "BOT Testnet payments are disabled in production. Use Celo or BOT Chain Mainnet.");
  }
  if (intent.chainId !== 968) throw new ExecutionError("UNSUPPORTED_CHAIN", "Unsupported network for wallet transfers.");
  if (configuredContract?.toLowerCase() !== B7_CONTRACT.toLowerCase()) throw new ExecutionError("CONTRACT_NOT_CONFIGURED", "Canonical BOT Testnet payment contract is not configured.");
  if (await submissions.findByIntent(id)) throw new ExecutionError("INTENT_NOT_EXECUTABLE", "A submission already exists. Recheck its status without resending.");
  const plan = await prepareExecutionPlan(intents, recipients, { contractAddresses: { 968: configuredContract } }, { ownerAddress: owner, intentId: id });
  return { intent, plan };
}
