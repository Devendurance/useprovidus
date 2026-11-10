import { CHAIN_REGISTRY } from "@/lib/chains/registry";
import { CELO_CHAIN_ID } from "@/lib/wallet/celo";
import type { ReceiptNetworkKey, ReceiptPreview } from "@/lib/receipts/types";

export function receiptNetwork(chainId: number): { key: ReceiptNetworkKey; label: string } {
  if (chainId === CELO_CHAIN_ID) return { key: "celo", label: "Celo Mainnet" };
  if (chainId === CHAIN_REGISTRY.botMainnet.chainId) return { key: "bot-mainnet", label: "BOT Chain Mainnet" };
  if (chainId === CHAIN_REGISTRY.botTestnet.chainId) return { key: "bot-testnet", label: "BOT Chain Testnet" };
  return { key: "bot-mainnet", label: `Chain ${chainId}` };
}

export function botReceiptStatus(status: string, verifiedAt: string | null): string {
  if (status === "confirmed" && verifiedAt) return "verified";
  if (status === "confirmed" || status === "submitted") return "pending";
  if (status === "unknown" || status === "failed") return status;
  return "pending";
}

export function celoReceiptStatus(status: string): string {
  return status.toLowerCase();
}

export function compareReceiptsNewest(a: ReceiptPreview, b: ReceiptPreview): number {
  const byDate = Date.parse(b.createdAt) - Date.parse(a.createdAt);
  if (byDate !== 0) return byDate;
  if (a.id === b.id) return 0;
  return b.id < a.id ? -1 : 1;
}