/**
 * Shared USDC amount validation (crypto notional).
 * Safe for client and server — no floats for money.
 */

export type AmountValidation =
  | { ok: true; data: string }
  | { ok: false; code: "INVALID_INPUT"; message: string };

const MAX_INTEGER_PART = "1000000";
const MAX_FRACTIONAL_DIGITS = 6;
/** Digits only integer + optional fraction — no exponent. */
const AMOUNT_RE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * Validates a positive decimal string suitable as a USDC crypto notional.
 */
export function validateUsdcAmount(amount: string): AmountValidation {
  if (typeof amount !== "string") {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Amount must be a string",
    };
  }

  const trimmed = amount.trim();
  if (trimmed === "" || !AMOUNT_RE.test(trimmed)) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Amount must be a positive decimal string",
    };
  }

  // Reject exponent-like forms already blocked by regex; belt-and-suspenders:
  if (/[eE]/.test(trimmed)) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Amount must not use exponent notation",
    };
  }

  const [integerPart, fractionalPart = ""] = trimmed.split(".");

  if (fractionalPart.length > MAX_FRACTIONAL_DIGITS) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: `Amount may have at most ${MAX_FRACTIONAL_DIGITS} decimal places`,
    };
  }

  const allZero =
    /^0+$/.test(integerPart) &&
    (fractionalPart === "" || /^0+$/.test(fractionalPart));
  if (allZero) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Amount must be greater than zero",
    };
  }

  const intNormalized = integerPart.replace(/^0+(?=\d)/, "") || "0";
  if (
    intNormalized.length > MAX_INTEGER_PART.length ||
    (intNormalized.length === MAX_INTEGER_PART.length &&
      intNormalized > MAX_INTEGER_PART)
  ) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: `Amount must not exceed ${MAX_INTEGER_PART}`,
    };
  }

  if (intNormalized === MAX_INTEGER_PART && /[1-9]/.test(fractionalPart)) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: `Amount must not exceed ${MAX_INTEGER_PART}`,
    };
  }

  return { ok: true, data: trimmed };
}

export const USDC_AMOUNT_MAX = MAX_INTEGER_PART;
export const USDC_DECIMALS = MAX_FRACTIONAL_DIGITS;
