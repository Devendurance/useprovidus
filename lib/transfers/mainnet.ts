/**
 * B9C — Public BOT Mainnet payment policy (no allowlist, no test flags).
 *
 * Any authenticated wallet may prepare a 677 intent through the normal B3
 * flow; EXECUTION additionally requires the exact terms below. Nothing here
 * reads local-only test configuration: production and local behave alike.
 *
 * Supported: native BOT and official USDT, any positive B3-validated amount.
 * Everything else on 677 fails closed at the execution boundary.
 */

import { getAddress } from "viem";
import type { WalletTransferIntent } from "@/lib/transfers/repository";

/** Audited canonical ProvidusPay deployment on BOT Mainnet (B9B.3). */
export const MAINNET_CONTRACT_ADDRESS = getAddress(
  "0xd373b0377F17D38707C610f39820297CF4cfCF60",
);

/** Official BOT Chain USDT (B1-verified, re-verified pre-deploy). */
export const MAINNET_USDT_ADDRESS = getAddress(
  "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C",
);

function isPositiveBaseUnits(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]+$/.test(value) && !/^0+$/.test(value);
}

/**
 * Public execution predicate for chain 677 intents. Pure and total:
 * native BOT (null token) or official USDT with positive base-unit amounts.
 */
export function isPublicMainnetIntent(intent: Pick<WalletTransferIntent, "chainId" | "assetSymbol" | "amountBaseUnits" | "tokenAddress">): boolean {
  if (intent.chainId !== 677) return false;
  if (!isPositiveBaseUnits(intent.amountBaseUnits)) return false;
  if (intent.assetSymbol === "BOT" && intent.tokenAddress === null) return true;
  if (
    intent.assetSymbol === "USDT" &&
    typeof intent.tokenAddress === "string" &&
    intent.tokenAddress.toLowerCase() === MAINNET_USDT_ADDRESS.toLowerCase()
  ) {
    return true;
  }
  return false;
}
