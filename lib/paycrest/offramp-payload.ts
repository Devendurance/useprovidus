/**
 * Canonical Paycrest v2 offramp create-order payload builder.
 * Pure — used by production client and tests (exact same builder).
 *
 * Contract: POST https://api.paycrest.io/v2/sender/orders
 * OpenAPI: V2PaymentOrderPayload + V2CryptoSource + V2FiatDestination + V2FiatRecipient
 * Docs: https://docs.paycrest.io/api-reference/sender/initiate-payment-order-v2
 */

export type OfframpOrderPayloadInput = {
  amount: string;
  reference: string;
  refundAddress: string;
  institution: string;
  accountIdentifier: string;
  accountName: string;
  /** Payment narration; required by V2FiatRecipient. */
  memo?: string;
};

/**
 * Exact JSON body sent to Paycrest for USDC/celo → NGN bank offramp.
 * - amount: decimal string (not number)
 * - amountIn omitted (defaults to crypto per OpenAPI)
 * - memo always set (required by schema)
 * - no rate/senderFee unless caller adds later via a different builder
 */
export function buildOfframpOrderPayload(input: OfframpOrderPayloadInput): {
  amount: string;
  source: {
    type: "crypto";
    currency: "USDC";
    network: "celo";
    refundAddress: string;
  };
  destination: {
    type: "fiat";
    currency: "NGN";
    recipient: {
      institution: string;
      accountIdentifier: string;
      accountName: string;
      memo: string;
    };
  };
  reference: string;
} {
  const memo =
    typeof input.memo === "string" && input.memo.trim() !== ""
      ? input.memo.trim().slice(0, 120)
      : "Providus cash-out";

  return {
    amount: input.amount,
    source: {
      type: "crypto",
      currency: "USDC",
      network: "celo",
      refundAddress: input.refundAddress,
    },
    destination: {
      type: "fiat",
      currency: "NGN",
      recipient: {
        institution: input.institution,
        accountIdentifier: input.accountIdentifier,
        accountName: input.accountName,
        memo,
      },
    },
    reference: input.reference,
  };
}

/**
 * Redacted view of the exact object passed to JSON.stringify for POST /sender/orders.
 * Derived from the same payload reference — not a separately reconstructed example.
 * Sensitive values replaced; optional top-level keys reported by presence only.
 */
export function redactOfframpOutgoingBody(
  body: ReturnType<typeof buildOfframpOrderPayload>,
): {
  amount: string;
  source: {
    type: string;
    currency: string;
    network: string;
    refundAddress: "<redacted-wallet>";
  };
  destination: {
    type: string;
    currency: string;
    recipient: {
      institution: string;
      accountIdentifier: "<redacted-account>";
      accountName: "<redacted-name>";
      memo: string;
    };
  };
  reference: string;
  amountInPresent: boolean;
  ratePresent: boolean;
  senderFeePresent: boolean;
  senderFeePercentPresent: boolean;
} {
  const record = body as Record<string, unknown>;
  return {
    amount: body.amount,
    source: {
      type: body.source.type,
      currency: body.source.currency,
      network: body.source.network,
      refundAddress: "<redacted-wallet>",
    },
    destination: {
      type: body.destination.type,
      currency: body.destination.currency,
      recipient: {
        institution: body.destination.recipient.institution,
        accountIdentifier: "<redacted-account>",
        accountName: "<redacted-name>",
        memo: body.destination.recipient.memo,
      },
    },
    reference: body.reference,
    amountInPresent: "amountIn" in record && record.amountIn !== undefined,
    ratePresent: "rate" in record && record.rate !== undefined,
    senderFeePresent: "senderFee" in record && record.senderFee !== undefined,
    senderFeePercentPresent:
      "senderFeePercent" in record && record.senderFeePercent !== undefined,
  };
}

export type PayloadFieldTypeSummary = {
  path: string;
  present: boolean;
  jsonType: string;
};

/** Non-sensitive field presence + JSON types for diagnostics/tests. */
export function summarizeOfframpPayloadFields(
  payload: ReturnType<typeof buildOfframpOrderPayload>,
): PayloadFieldTypeSummary[] {
  const typeOf = (v: unknown): string => {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    return typeof v;
  };

  return [
    { path: "amount", present: true, jsonType: typeOf(payload.amount) },
    { path: "amountIn", present: false, jsonType: "absent" },
    { path: "rate", present: false, jsonType: "absent" },
    { path: "senderFee", present: false, jsonType: "absent" },
    { path: "reference", present: true, jsonType: typeOf(payload.reference) },
    { path: "source.type", present: true, jsonType: typeOf(payload.source.type) },
    {
      path: "source.currency",
      present: true,
      jsonType: typeOf(payload.source.currency),
    },
    {
      path: "source.network",
      present: true,
      jsonType: typeOf(payload.source.network),
    },
    {
      path: "source.refundAddress",
      present: true,
      jsonType: typeOf(payload.source.refundAddress),
    },
    {
      path: "destination.type",
      present: true,
      jsonType: typeOf(payload.destination.type),
    },
    {
      path: "destination.currency",
      present: true,
      jsonType: typeOf(payload.destination.currency),
    },
    {
      path: "destination.recipient.institution",
      present: true,
      jsonType: typeOf(payload.destination.recipient.institution),
    },
    {
      path: "destination.recipient.accountIdentifier",
      present: true,
      jsonType: typeOf(payload.destination.recipient.accountIdentifier),
    },
    {
      path: "destination.recipient.accountName",
      present: true,
      jsonType: typeOf(payload.destination.recipient.accountName),
    },
    {
      path: "destination.recipient.memo",
      present: true,
      jsonType: typeOf(payload.destination.recipient.memo),
    },
  ];
}
