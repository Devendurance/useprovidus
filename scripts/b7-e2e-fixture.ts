import { createServer } from "node:http";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hexToString } from "viem";
import { createMemoryIntentStore } from "../lib/transfers/repository";
import { createMemoryRecipientStore } from "../lib/recipients/repository";
import { createMemorySubmissionStore, registerSubmissionTx } from "../lib/transfers/submissions";
import { prepareWebExecution, B7_CONTRACT } from "../lib/transfers/web-execution";
import { checkIntentFreshness, cancelTransferIntent } from "../lib/transfers/service";
import { advanceWalletTransfer } from "../lib/assistant/wallet-transfer";
import { saveRecipient } from "../lib/recipients/service";
import type { WalletTransferIntent } from "../lib/assistant/types";

const account = privateKeyToAccount(generatePrivateKey());
const intents = createMemoryIntentStore();
const recipients = createMemoryRecipientStore();
const submissions = createMemorySubmissionStore();
let verified = false;
let registrationFails = false;

const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString();
    const body = text ? JSON.parse(text) : {};
    const path = req.url ?? "/";
    let result: unknown;
    if (path === "/account") result = { address: account.address };
    else if (path === "/sign") {
      const message = body.message.startsWith("0x") ? hexToString(body.message) : body.message;
      if (!message.startsWith("localhost:3000 wants you to sign in") || !message.includes(account.address)) throw new Error("Only local SIWE messages are signed by this empty test account.");
      result = { signature: await account.signMessage({ message }) };
    } else if (path === "/verify-fixture") { verified = true; result = { ok: true }; }
    else if (path === "/fail-registration") { registrationFails = true; result = { ok: true }; }
    else if (path === "/api/assistant/chat") {
      if (body.message === "Buy airtime") {
        const intent = { type: "airtime", amountNgn: "500", networkConfirmed: false, missingFields: ["phone", "network"], readyForConfirmation: false };
        res.end(JSON.stringify({ ok: true, activeIntent: intent, turn: { kind: "payment_intent", intent, message: { role: "assistant", content: "Celo airtime draft retained across wallet authentication.", timestamp: new Date().toISOString(), intent } } }));
        return;
      }
      const draft: WalletTransferIntent = body.activeIntent?.type === "wallet_transfer" ? body.activeIntent : {
        type: "wallet_transfer", recipientLabel: "Douglas", chainId: 968, amount: "0.01", asset: "BOT", phase: "collecting", missingFields: ["address"], readyForConfirmation: false,
      };
      const turn = await advanceWalletTransfer({ intentStore: intents, recipientStore: recipients, ownerAddress: account.address, draft, userMessage: body.message });
      result = { ok: true, activeIntent: turn.draft, turn: { kind: turn.draft ? "payment_intent" : "chat", message: { role: "assistant", content: turn.reply, timestamp: new Date().toISOString(), ...(turn.draft ? { intent: turn.draft } : {}) }, action: turn.action, ...(turn.draft ? { intent: turn.draft } : {}) } };
    } else if (path === "/api/recipients") {
      result = { ok: true, recipient: await saveRecipient(recipients, { ownerAddress: account.address, ...body }) };
    } else if (path === "/api/transfers") result = { ok: true, intents: (await intents.listByOwner(account.address)).map(intent => ({ intent })) };
    else {
      const match = path.match(/^\/api\/transfers\/([^/]+)(?:\/(execution|status|submission))?$/);
      if (!match) throw new Error("Unknown fixture path");
      const [, id, action] = match;
      const intent = await intents.findIntentById(id);
      if (!intent) throw new Error("Unknown fixture intent");
      if (action === "execution") result = { ok: true, ...await prepareWebExecution(intents, recipients, submissions, account.address, id, B7_CONTRACT) };
      else if (action === "submission") {
        if (registrationFails && body.txHash) { registrationFails = false; res.statusCode = 503; result = { ok: false, error: { message: "Fixture registration timeout. Keep the hash and recheck." } }; }
        else if (body.txHash) result = { ok: true, ...await registerSubmissionTx(submissions, { intent, ownerAddress: account.address, txHash: body.txHash, contractAddress: B7_CONTRACT }) };
        else {
          if (verified) await submissions.transitionStatus(id, ["submitted", "unknown"], { status: "confirmed", confirmations: 5, verifiedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
          result = { ok: true, submission: await submissions.findByIntent(id) };
        }
      } else if (req.method === "DELETE") result = { ok: true, intent: await cancelTransferIntent(intents, { ownerAddress: account.address, id }) };
      else result = { ok: true, ...await checkIntentFreshness(intents, recipients, { ownerAddress: account.address, id }), submission: await submissions.findByIntent(id) };
    }
    res.end(JSON.stringify(result));
  } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: { message: error instanceof Error ? error.message : "Fixture error" } })); }
});
server.listen(3999, "127.0.0.1", () => console.log("B7 fixture ready on 127.0.0.1:3999. Empty ephemeral SIWE account, memory stores, simulated submission confirmation, no broadcast."));
