import assert from "node:assert/strict";
import { botReceiptStatus, celoReceiptStatus, compareReceiptsNewest, receiptNetwork } from "@/lib/receipts/domain";
import type { ReceiptPreview } from "@/lib/receipts/types";

let assertions = 0;
function check<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}

check(botReceiptStatus("confirmed", "2026-11-10T10:00:00.000Z"), "verified", "confirmed B5 evidence with verifiedAt is verified");
check(botReceiptStatus("confirmed", null), "pending", "confirmed status without verification time is not success");
check(botReceiptStatus("submitted", null), "pending", "submitted hash stays pending");
check(botReceiptStatus("unknown", null), "unknown", "unknown recovery state stays visible");
check(botReceiptStatus("failed", null), "failed", "failed submission remains failed");
check(celoReceiptStatus("completed"), "completed", "Celo status is preserved without B5 verified label");
check(receiptNetwork(677), { key: "bot-mainnet", label: "BOT Chain Mainnet" }, "chain 677 uses Mainnet label");
check(receiptNetwork(968), { key: "bot-testnet", label: "BOT Chain Testnet" }, "historical chain 968 is labeled Testnet");
check(receiptNetwork(42220), { key: "celo", label: "Celo Mainnet" }, "Celo history remains distinguishable");

const row = (id: string): ReceiptPreview => ({
  id,
  source: id.startsWith("bot:") ? "bot" : "celo",
  createdAt: "2026-11-10T10:00:00.000Z",
  network: id.startsWith("bot:") ? "BOT Chain Mainnet" : "Celo Mainnet",
  networkKey: id.startsWith("bot:") ? "bot-mainnet" : "celo",
  chainId: id.startsWith("bot:") ? 677 : 42220,
  token: "BOT",
  amount: "1",
  recipientName: "Recipient",
  recipientAddress: null,
  status: "pending",
  txHash: null,
  explorerUrl: null,
  verifiedAt: null,
});
check([row("celo:z"), row("bot:a")].sort(compareReceiptsNewest).map((receipt) => receipt.id), ["celo:z", "bot:a"], "equal timestamps sort deterministically by stable id");

console.log(`P0.2 receipt domain checks passed (${assertions} assertions)`);