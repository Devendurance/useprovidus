import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const edits = [
  ["AGENTS.md", [[
    "- B7 overrides automatic push. Keep B7 local, with no deploy or production database writes. Migrations through 0006 already exist and must not be rerun.\n- BOT payments require explicit review-card wallet authorization and B5 verification before success. Mainnet execution stays disabled until B9, regardless of environment configuration.\n", "",
  ]]],
  ["lib/assistant/types.ts", [["  walletTransferOwner?: string | null;\n", ""]]],
  ["lib/recipients/routes.ts", [[
    '  const expectedOwner = request.headers.get("x-providus-wallet");\n  if (expectedOwner && expectedOwner.toLowerCase() !== claims.ownerAddress.toLowerCase()) {\n    return { response: errorResponse("WALLET_SESSION_MISMATCH", "Session wallet changed. Sign in with the connected wallet again.", 401) };\n  }\n', "",
  ]]],
  ["app/api/assistant/chat/route.ts", [[
    '    ownerAddress: await (async () => {\n      const owner = await resolveSessionOwner(request);\n      if ("walletTransferOwner" in payload && (typeof payload.walletTransferOwner !== "string" || payload.walletTransferOwner.toLowerCase() !== owner?.toLowerCase())) return null;\n      return owner;\n    })(),',
    '    ownerAddress: await resolveSessionOwner(request),',
  ]]],
  ["app/api/transfers/[id]/submission/route.ts", [
    ['  const c968 = process.env.PROVIDUS_PAY_CONTRACT_968;\n', '  const c968 = process.env.PROVIDUS_PAY_CONTRACT_968;\n  const c677 = process.env.PROVIDUS_PAY_CONTRACT_677;\n'],
    ['      677: null,', '      677: c677 && isAddress(c677) ? c677 : null,'],
  ]],
  ["lib/assistant/wallet-transfer.ts", [
    ['  cancelTransferIntent,\n', ''],
    ['    if (ownerAddress && working.preparedIntentId) {\n      try {\n        await cancelTransferIntent(intentStore, { ownerAddress, id: working.preparedIntentId, nowMs: now });\n      } catch (error) {\n        if (!(error instanceof TransferError) || (error.code !== "NOT_FOUND" && error.code !== "INTENT_ALREADY_CANCELLED")) throw error;\n      }\n    }\n', ''],
    ['      reply: "Payment draft cancelled. A transaction already approved in your wallet can still settle. Recheck its recorded status.",', '      reply: "Cancelled. Nothing was prepared or sent.",'],
    [String.raw`    if (isAffirmativeConfirmation(userMessage) || /^(?:yes[, ]+)?(?:please )?save(?: (?:it|this address|for future payments|for next time))?[.!]?$/i.test(userMessage.trim())) {`, String.raw`    if (isAffirmativeConfirmation(userMessage) || /\bsave\b/i.test(userMessage)) {`],
  ]],
];

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "providus-b7-patch-"));
const beforePath = path.join(temporary, "before");
const afterPath = path.join(temporary, "after");
try {
  const patches = [];
  for (const [file, replacements] of edits) {
    const after = fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
    let before = after;
    for (const [current, previous] of replacements) {
      if (!before.includes(current)) throw new Error(`Cannot isolate B7 edit in ${file}`);
      before = before.replace(current, previous);
    }
    fs.writeFileSync(beforePath, before);
    fs.writeFileSync(afterPath, after);
    const diff = spawnSync("git", ["-c", "core.autocrlf=false", "diff", "--no-index", "--no-ext-diff", "--", beforePath, afterPath], { encoding: "utf8" });
    if (diff.status !== 1) throw new Error(`Expected a B7 diff in ${file}`);
    patches.push(diff.stdout.split("\n").map(line => line.startsWith("diff --git ") ? `diff --git a/${file} b/${file}` : line.startsWith("--- ") ? `--- a/${file}` : line.startsWith("+++ ") ? `+++ b/${file}` : line).join("\n"));
  }
  const patch = patches.join("");
  fs.writeFileSync(".audit/b7-existing-backend-edits.patch", patch);
  fs.writeFileSync(".audit/b7-existing-backend-edits.patch.b64", `${Buffer.from(patch).toString("base64")}\n`);
  console.log("Captured only B7 edits inside the existing dirty backend and instructions. Existing B1-B6 baseline stays unstaged.");
} finally {
  for (const file of [beforePath, afterPath]) if (fs.existsSync(file)) fs.unlinkSync(file);
  fs.rmdirSync(temporary);
}
