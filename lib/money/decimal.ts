/**
 * Exact decimal-string arithmetic for display estimates.
 * No JavaScript Number / parseFloat for money.
 */

/**
 * Add two non-negative decimal strings: a + b.
 */
export function addDecimalStrings(a: string, b: string): string {
  const na = normalizeDecimal(a);
  const nb = normalizeDecimal(b);
  if (na === null || nb === null) {
    throw new Error("Invalid decimal string for addition");
  }
  const [ai, af] = splitParts(na);
  const [bi, bf] = splitParts(nb);
  const scale = Math.max(af.length, bf.length);
  const aScaled = BigInt(ai + af.padEnd(scale, "0"));
  const bScaled = BigInt(bi + bf.padEnd(scale, "0"));
  return formatScaledBigInt(aScaled + bScaled, scale);
}

/** Sum three non-negative decimal strings. */
export function sumDecimalStrings(a: string, b: string, c: string): string {
  return addDecimalStrings(addDecimalStrings(a, b), c);
}

/**
 * True if a and b represent the same decimal value (exact after normalize).
 */
export function decimalStringsEqual(a: string, b: string): boolean {
  try {
    // a - b == 0 via scaled comparison
    const na = normalizeDecimal(a);
    const nb = normalizeDecimal(b);
    if (na === null || nb === null) return false;
    const [ai, af] = splitParts(na);
    const [bi, bf] = splitParts(nb);
    const scale = Math.max(af.length, bf.length);
    const aScaled = BigInt(ai + af.padEnd(scale, "0"));
    const bScaled = BigInt(bi + bf.padEnd(scale, "0"));
    return aScaled === bScaled;
  } catch {
    return false;
  }
}

/**
 * Validate non-negative decimal with at most maxFractional digits (for fees).
 */
export function isNonNegativeUsdcDecimal(
  value: string,
  maxFractional = 6,
): boolean {
  const n = normalizeDecimal(value);
  if (n === null) return false;
  const [, f] = splitParts(n);
  return f.length <= maxFractional;
}

/**
 * Multiply two non-negative decimal strings: a * b.
 * Returns a decimal string without scientific notation.
 */
export function multiplyDecimalStrings(a: string, b: string): string {
  const na = normalizeDecimal(a);
  const nb = normalizeDecimal(b);
  if (na === null || nb === null) {
    throw new Error("Invalid decimal string for multiplication");
  }

  const [ai, af] = splitParts(na);
  const [bi, bf] = splitParts(nb);
  const scale = af.length + bf.length;
  const digitsA = BigInt(ai + af || "0");
  const digitsB = BigInt(bi + bf || "0");
  const product = digitsA * digitsB;
  return formatScaledBigInt(product, scale);
}

/**
 * Exact inverse-quote division of two non-negative decimal strings.
 *
 * `numerator / denominator`, computed with BigInt scaling only — never
 * floating point. The exact quotient is cut (or rounded) at `maxDecimals`
 * fractional digits:
 *
 * - `"ceil"` (default) — any non-zero remainder increments the last digit, so
 *   `result * denominator >= numerator` (never under-funds a payment).
 * - `"floor"` — the remainder is discarded.
 * - `"half_up"` — remainder at or above half of the divisor increments.
 *
 * Throws on invalid decimal inputs, a negative/non-integer `maxDecimals`, or a
 * zero denominator.
 */
export function divideDecimalStrings(
  numerator: string,
  denominator: string,
  maxDecimals = 6,
  rounding: "ceil" | "floor" | "half_up" = "ceil",
): string {
  if (!Number.isInteger(maxDecimals) || maxDecimals < 0) {
    throw new Error("Invalid maxDecimals for division");
  }
  const nn = normalizeDecimal(numerator);
  const nd = normalizeDecimal(denominator);
  if (nn === null || nd === null) {
    throw new Error("Invalid decimal string for division");
  }

  const [ni, nf] = splitParts(nn);
  const [di, df] = splitParts(nd);
  const numeratorDigits = BigInt(ni + nf || "0");
  const denominatorDigits = BigInt(di + df || "0");
  if (denominatorDigits === BigInt(0)) {
    throw new Error("Division by zero");
  }

  // numerator / denominator * 10^maxDecimals, expressed over integers:
  // (N * 10^(df.length + maxDecimals)) / (D * 10^(nf.length))
  const scaledNumerator =
    numeratorDigits *
    BigInt(10) ** BigInt(df.length + maxDecimals);
  const scaledDenominator = denominatorDigits * BigInt(10) ** BigInt(nf.length);

  let quotient = scaledNumerator / scaledDenominator;
  const remainder = scaledNumerator % scaledDenominator;
  if (remainder > BigInt(0)) {
    if (rounding === "ceil") {
      quotient += BigInt(1);
    } else if (
      rounding === "half_up" &&
      remainder * BigInt(2) >= scaledDenominator
    ) {
      quotient += BigInt(1);
    }
  }
  return formatScaledBigInt(quotient, maxDecimals);
}

/**
 * Convert a USDC decimal string to base units (6 decimals) as bigint.
 */
export function usdcToBaseUnits(amount: string, decimals = 6): bigint {
  const n = normalizeDecimal(amount);
  if (n === null) throw new Error("Invalid USDC amount");
  const [intPart, fracPart] = splitParts(n);
  if (fracPart.length > decimals) {
    throw new Error("Too many fractional digits");
  }
  const padded = fracPart.padEnd(decimals, "0");
  return BigInt(intPart + padded || "0");
}

/**
 * Compare amount (decimal USDC string) to raw balance (bigint base units).
 */
export function hasSufficientUsdcBalance(
  amount: string,
  balanceRaw: bigint | null,
  decimals = 6,
): { comparable: boolean; sufficient: boolean } {
  if (balanceRaw === null) {
    return { comparable: false, sufficient: false };
  }
  try {
    const needed = usdcToBaseUnits(amount, decimals);
    return { comparable: true, sufficient: balanceRaw >= needed };
  } catch {
    return { comparable: false, sufficient: false };
  }
}

/**
 * Format a decimal string for display (group thousands on integer part).
 * Does not change the underlying exact value string for math.
 */
export function formatDecimalForDisplay(
  value: string,
  opts?: { maxFractional?: number },
): string {
  const n = normalizeDecimal(value);
  if (n === null) return value;
  const [intPart, fracPart] = splitParts(n);
  const intGrouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (!fracPart) return intGrouped;
  const frac =
    opts?.maxFractional !== undefined
      ? fracPart.slice(0, opts.maxFractional).replace(/0+$/, "")
      : fracPart;
  return frac.length > 0 ? `${intGrouped}.${frac}` : intGrouped;
}

function normalizeDecimal(input: string): string | null {
  const s = input.trim();
  if (!s || /[eE]/.test(s) || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s)) {
    return null;
  }
  // Strip trailing zeros in fraction for intermediate work? Keep full for multiply.
  return s;
}

function splitParts(normalized: string): [string, string] {
  const [i, f = ""] = normalized.split(".");
  return [i.replace(/^0+(?=\d)/, "") || "0", f];
}

function formatScaledBigInt(value: bigint, scale: number): string {
  if (scale === 0) return value.toString();
  const negative = value < BigInt(0);
  const abs = negative ? -value : value;
  const str = abs.toString().padStart(scale + 1, "0");
  const cut = str.length - scale;
  const intPart = str.slice(0, cut).replace(/^0+(?=\d)/, "") || "0";
  const frac = str.slice(cut).replace(/0+$/, "");
  const body = frac.length > 0 ? `${intPart}.${frac}` : intPart;
  return negative ? `-${body}` : body;
}
