/**
 * Airtime preview endpoint.
 *
 * The sole HTTP boundary for obtaining an `AirtimePreview`: the server fetches
 * the Paycrest sell rate and returns the exact inverse quote plus a 5-minute
 * TTL and the intent fingerprint. The client never sees a provider credential
 * or a raw provider payload.
 */

import { NextResponse } from "next/server";
import {
  buildAirtimePreview,
  type AirtimePreviewErrorCode,
  type AirtimePreviewIntent,
} from "@/lib/assistant/preview";
import type { PaymentNetwork } from "@/lib/assistant/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Small JSON payloads only; the preview intent is three short fields. */
const MAX_BODY_BYTES = 4 * 1024;

type RouteErrorCode = AirtimePreviewErrorCode | "INVALID_REQUEST" | "BODY_TOO_LARGE";

const HTTP_STATUS_BY_CODE: Record<RouteErrorCode, number> = {
  INCOMPLETE_INTENT: 400,
  INVALID_INTENT: 400,
  INVALID_REQUEST: 400,
  WALLET_CONTEXT_INVALID: 400,
  BODY_TOO_LARGE: 413,
  INVALID_RATE: 502,
  QUOTE_UNAVAILABLE: 503,
  RATE_UNAVAILABLE: 503,
  PREVIEW_STORE_UNAVAILABLE: 503,
};

function errorResponse(code: RouteErrorCode, message: string, retryable?: boolean) {
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

async function previewResponse(intent: AirtimePreviewIntent, walletAddress: string) {
  const result = await buildAirtimePreview(intent, { walletAddress });
  if (!result.ok) {
    return errorResponse(
      result.error.code,
      result.error.message,
      result.error.retryable,
    );
  }
  return NextResponse.json(
    { ok: true, previewId: result.previewId, preview: result.data },
    { status: 200, headers: NO_STORE },
  );
}

/** GET /api/assistant/preview?amountNgn=…&phone=…&network=…&walletAddress=… */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  return previewResponse(
    {
      amountNgn: searchParams.get("amountNgn") ?? "",
      phone: searchParams.get("phone") ?? "",
      network: (searchParams.get("network") ?? "") as PaymentNetwork,
    },
    searchParams.get("walletAddress") ?? "",
  );
}

/** POST /api/assistant/preview with a JSON body of the same four fields. */
export async function POST(request: Request) {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return errorResponse("INVALID_REQUEST", "Request body could not be read");
  }
  if (raw.length > MAX_BODY_BYTES) {
    return errorResponse("BODY_TOO_LARGE", "Request body is too large");
  }

  let parsed: unknown;
  try {
    parsed = raw.trim() === "" ? {} : JSON.parse(raw);
  } catch {
    return errorResponse("INVALID_REQUEST", "Request body must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return errorResponse("INVALID_REQUEST", "Request body must be a JSON object");
  }

  const body = parsed as Record<string, unknown>;

  return previewResponse(
    {
      amountNgn: typeof body.amountNgn === "string" ? body.amountNgn : "",
      phone: typeof body.phone === "string" ? body.phone : "",
      network: (typeof body.network === "string"
        ? body.network
        : "") as PaymentNetwork,
    },
    typeof body.walletAddress === "string" ? body.walletAddress : "",
  );
}
