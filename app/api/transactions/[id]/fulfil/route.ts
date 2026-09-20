/**
 * Airtime fulfilment trigger.
 *
 * `POST /api/transactions/[id]/fulfil` asks the server to fulfil one settled
 * airtime transaction through ClubKonnect. The request body is deliberately
 * ignored: the phone number, network, and amount are read from the stored
 * transaction, so a client can never change what is bought. Repeated calls are
 * safe — an in-flight transaction is reconciled, not purchased again.
 */

import { NextResponse } from "next/server";
import { fulfilAirtimeOrder } from "@/lib/clubkonnect/server/orchestration";
import { toPublicTransactionDto } from "@/lib/transactions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store" } as const;

const HTTP_STATUS_BY_CODE: Record<string, number> = {
  TRANSACTION_NOT_FOUND: 404,
  NOT_ELIGIBLE: 409,
  FULFILMENT_INVALID_TYPE: 409,
  FULFILMENT_NOT_ELIGIBLE: 409,
  FULFILMENT_REQUEST_ID_MISMATCH: 409,
  FULFILMENT_METADATA_INVALID: 409,
  PROVIDER_FLOAT_EXHAUSTED: 409,
  FULFILMENT_RESERVATION_FAILED: 503,
  FULFILMENT_CLAIM_FAILED: 503,
  // Neither is a verdict on the transaction: the row stands and a retry can
  // still succeed, so the caller is told to come back rather than to give up.
  FLOAT_CHECK_UNAVAILABLE: 503,
  PERSISTENCE_FAILED: 503,
};

export async function POST(
  _request: Request,
  props: { params: Promise<{ id: string }> },
) {
  // The body is intentionally not read: fulfilment input is server-authoritative.
  const { id } = await props.params;
  if (!id || typeof id !== "string") {
    return NextResponse.json(
      { success: false, code: "INVALID_REQUEST", error: "Transaction ID is required" },
      { status: 400, headers: NO_STORE },
    );
  }

  const result = await fulfilAirtimeOrder(id);

  if (!result.ok) {
    return NextResponse.json(
      {
        success: false,
        code: result.code,
        error: result.message,
        ...(result.transaction
          ? { transaction: toPublicTransactionDto(result.transaction) }
          : {}),
      },
      {
        status: HTTP_STATUS_BY_CODE[result.code] ?? 500,
        headers: NO_STORE,
      },
    );
  }

  // `processing` means the provider has not finished: the client should poll
  // the transaction rather than assume success.
  return NextResponse.json(
    {
      success: true,
      status: result.status,
      transaction: toPublicTransactionDto(result.transaction),
    },
    { status: result.status === "processing" ? 202 : 200, headers: NO_STORE },
  );
}
