/**
 * Pure P3 money / direction / token helpers.
 * Run: npm run test:money-helpers
 */

import assert from "node:assert/strict";
import {
  CANONICAL_CELO_USDC,
  CANONICAL_CELO_USDC_ADDRESS,
  matchesCanonicalCeloUsdc,
} from "@/lib/celo/usdc";
import {
  addDecimalStrings,
  formatDecimalForDisplay,
  hasSufficientUsdcBalance,
  multiplyDecimalStrings,
  sumDecimalStrings,
  usdcToBaseUnits,
} from "@/lib/money/decimal";
import {
  directionToSide,
  sideToDirection,
  directionLabel,
} from "@/lib/money/direction";
import { validateUsdcAmount } from "@/lib/money/usdc-amount";
import { getAddress } from "viem";

function run() {
  // Direction mapping
  assert.equal(directionToSide("buy-usdc"), "buy");
  assert.equal(directionToSide("cash-out"), "sell");
  assert.equal(sideToDirection("buy"), "buy-usdc");
  assert.equal(sideToDirection("sell"), "cash-out");
  assert.equal(directionLabel("buy-usdc"), "Buy USDC");
  assert.equal(directionLabel("cash-out"), "Cash out");

  // Amount validation
  assert.equal(validateUsdcAmount("100").ok, true);
  assert.equal(validateUsdcAmount("0").ok, false);
  assert.equal(validateUsdcAmount("-1").ok, false);
  assert.equal(validateUsdcAmount("1e6").ok, false);
  assert.equal(validateUsdcAmount("1.1234567").ok, false);
  assert.equal(validateUsdcAmount("1000000").ok, true);
  assert.equal(validateUsdcAmount("1000000.1").ok, false);
  assert.equal(validateUsdcAmount("0.000001").ok, true);

  // Exact multiply / add
  assert.equal(multiplyDecimalStrings("100", "1385.33"), "138533");
  assert.equal(multiplyDecimalStrings("1.5", "2"), "3");
  assert.equal(multiplyDecimalStrings("0.1", "0.1"), "0.01");
  assert.equal(addDecimalStrings("100", "0.5"), "100.5");
  assert.equal(sumDecimalStrings("100", "0.5", "0.25"), "100.75");

  // Base units
  assert.equal(usdcToBaseUnits("1", 6), BigInt(1_000_000));
  assert.equal(usdcToBaseUnits("1.5", 6), BigInt(1_500_000));
  assert.equal(usdcToBaseUnits("0.000001", 6), BigInt(1));

  // Balance compare
  const enough = hasSufficientUsdcBalance("10", BigInt(10_000_000), 6);
  assert.equal(enough.comparable, true);
  assert.equal(enough.sufficient, true);
  const short = hasSufficientUsdcBalance("10", BigInt(9_999_999), 6);
  assert.equal(short.sufficient, false);
  const noBal = hasSufficientUsdcBalance("10", null, 6);
  assert.equal(noBal.comparable, false);

  // Display format (does not change exact multiply output)
  assert.equal(formatDecimalForDisplay("138533"), "138,533");
  assert.equal(formatDecimalForDisplay("138533.45", { maxFractional: 2 }), "138,533.45");

  // Canonical token
  assert.equal(CANONICAL_CELO_USDC.symbol, "USDC");
  assert.equal(CANONICAL_CELO_USDC.decimals, 6);
  assert.equal(CANONICAL_CELO_USDC.chainId, 42220);
  assert.equal(
    CANONICAL_CELO_USDC_ADDRESS,
    getAddress("0xcebA9300f2b948710d2653dD7B07f33A8B32118C"),
  );

  const match = matchesCanonicalCeloUsdc(
    "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    6,
  );
  assert.equal(match.contractMatchesCanonical, true);
  assert.equal(match.decimalsMatchCanonical, true);
  assert.equal(match.tokenCompatible, true);

  const bad = matchesCanonicalCeloUsdc(
    "0x0000000000000000000000000000000000000001",
    6,
  );
  assert.equal(bad.contractMatchesCanonical, false);
  assert.equal(bad.tokenCompatible, false);

  const badDec = matchesCanonicalCeloUsdc(CANONICAL_CELO_USDC_ADDRESS, 18);
  assert.equal(badDec.decimalsMatchCanonical, false);
  assert.equal(badDec.tokenCompatible, false);

  console.log("money self-check (P3): all assertions passed");
}

run();
