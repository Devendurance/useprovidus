/**
 * Airtime order preparation endpoint.
 *
 * The sole HTTP boundary for turning a consumed preview into deposit
 * instructions. The body carries two fields only — the preview identifier and
 * the wallet context — and every price, amount, destination, and reference is
 * resolved server-side by `prepareAirtimePaymentOrder`. Extra client fields are
 * ignored, never read, and never forwarded: a browser cannot inject an amount,
 * an address, or a settlement account.
 *
 * Response contract (frozen): success is flat —
 * `{ ok: true, transactionId, receiveAddress, totalUsdcToSend, validUntil,
 * baseUsdc, senderFeeUsdc, transactionFeeUsdc }` — where `totalUsdcToSend` is
 * the provider-authoritative amount (base plus the Paycrest fees finalized on
 * order creation) and the fee fields are that same bound breakdown, never a
 * client-supplied or preview-derived estimate — and failure is
 * `{ ok: false, error: { code, message, retryable? } }`.
 */

import { NextResponse } from "next/server";

import {
  prepareAirtimePaymentOrder,
  type AirtimePaymentErrorCode,
} from "@/lib/assistant/payment-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Two short string fields; anything larger is not a request this route serves. */
const MAX_BODY_BYTES = 4 * 1024;

const HTTP_STATUS_BY_CODE: Record<AirtimePaymentErrorCode, number> = {
  ORDER_REQUEST_INVALID: 400,
  WALLET_CONTEXT_INVALID: 400,
  PREVIEW_NOT_USABLE: 400,
  PREVIEW_STORE_UNAVAILABLE: 503,
  SETTLEMENT_CONFIG_MISSING: 503,
  TRANSACTION_CREATION_FAILED: 503,
  PAYCREST_ORDER_REJECTED: 502,
  ORDER_CREATION_OUTCOME_UNKNOWN: 504,
  PAYCREST_BIND_FAILED: 502,
};

function errorResponse(
  code: AirtimePaymentErrorCode,
  message: string,
  retryable?: boolean,
) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
        ...(retryable === undefined ? {} : { retryable }),
      },
    },
    { status: HTTP_STATUS_BY_CODE[code], headers: NO_STORE },
  );
}

/** POST /api/assistant/orders with `{ previewId, walletAddress }`. */
export async function POST(request: Request) {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return errorResponse("ORDER_REQUEST_INVALID", "Request body could not be read");
  }
  if (raw.length > MAX_BODY_BYTES) {
    return errorResponse("ORDER_REQUEST_INVALID", "Request body is too large");
  }

  let parsed: unknown;
  try {
    parsed = raw.trim() === "" ? {} : JSON.parse(raw);
  } catch {
    return errorResponse("ORDER_REQUEST_INVALID", "Request body must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return errorResponse("ORDER_REQUEST_INVALID", "Request body must be a JSON object");
  }

  const body = parsed as Record<string, unknown>;
  const result = await prepareAirtimePaymentOrder({
    previewId: typeof body.previewId === "string" ? body.previewId : "",
    walletAddress: typeof body.walletAddress === "string" ? body.walletAddress : "",
  });

  if (!result.ok) {
    return errorResponse(
      result.error.code,
      result.error.message,
      result.error.retryable,
    );
  }

  return NextResponse.json(
    { ok: true, ...result.data },
    { status: 200, headers: NO_STORE },
  );
}
