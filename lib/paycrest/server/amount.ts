/**
 * Server-only crypto amount validation — delegates to shared USDC amount rules.
 */

import { validateUsdcAmount } from "@/lib/money/usdc-amount";
import type { PaycrestResult } from "@/lib/paycrest/types";

/**
 * Validates a positive decimal string suitable for Paycrest crypto notional.
 */
export function validateCryptoAmount(
  amount: string,
): PaycrestResult<string> {
  const result = validateUsdcAmount(amount);
  if (!result.ok) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: result.message,
    };
  }
  return { ok: true, data: result.data };
}
