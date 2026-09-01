/**
 * Celo USDC token configuration — re-exports the shared canonical Circle contract.
 * Do not reintroduce NEXT_PUBLIC_CELO_USDC_ADDRESS as a source of truth.
 */

import {
  CANONICAL_CELO_USDC,
  getCanonicalCeloUsdc,
  type CanonicalCeloUsdc,
} from "@/lib/celo/usdc";

export type CeloUsdcConfig = CanonicalCeloUsdc;

/** Always returns the canonical Circle USDC on Celo mainnet. */
export function getCeloUsdcConfig(): CeloUsdcConfig {
  return getCanonicalCeloUsdc();
}

/** @deprecated Always true — kept for call-site compatibility. */
export function isCeloUsdcConfigured(): boolean {
  return true;
}

export { CANONICAL_CELO_USDC };
