import {
  getCorridorQuote,
  validateCryptoAmount,
} from "@/lib/paycrest/server";
import type { PaycrestErrorCode, PaycrestSide } from "@/lib/paycrest/types";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = {
  "Cache-Control": "no-store",
} as const;

function httpStatusForCode(code: PaycrestErrorCode): number {
  switch (code) {
    case "MISSING_CONFIG":
      return 500;
    case "INVALID_INPUT":
      return 400;
    case "UPSTREAM_TIMEOUT":
      return 504;
    case "AUTH_FAILED":
    case "UPSTREAM_ERROR":
    case "UPSTREAM_UNAVAILABLE":
    case "PARSE_ERROR":
    case "TOKEN_NOT_FOUND":
      return 502;
    default:
      return 502;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sideRaw = searchParams.get("side");
  const amountRaw = searchParams.get("amount");

  if (sideRaw !== "buy" && sideRaw !== "sell") {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "Query param side must be buy or sell",
        },
      },
      { status: 400, headers: NO_STORE },
    );
  }

  if (amountRaw === null || amountRaw === "") {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "Query param amount is required",
        },
      },
      { status: 400, headers: NO_STORE },
    );
  }

  const amountCheck = validateCryptoAmount(amountRaw);
  if (!amountCheck.ok) {
    return NextResponse.json(
      {
        error: {
          code: amountCheck.code,
          message: amountCheck.message,
        },
      },
      { status: 400, headers: NO_STORE },
    );
  }

  const side = sideRaw as PaycrestSide;
  const result = await getCorridorQuote(side, amountCheck.data);

  if (!result.ok) {
    return NextResponse.json(
      {
        error: {
          code: result.code,
          message: result.message,
        },
      },
      { status: httpStatusForCode(result.code), headers: NO_STORE },
    );
  }

  return NextResponse.json(
    {
      corridor: {
        network: "celo",
        token: "USDC",
        fiat: "NGN",
      },
      quote: result.data,
      live: true,
      timeSensitive: true,
    },
    { status: 200, headers: NO_STORE },
  );
}
