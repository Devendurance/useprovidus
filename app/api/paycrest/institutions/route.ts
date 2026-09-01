import { listNgnBankInstitutions } from "@/lib/paycrest/server";
import type { PaycrestErrorCode } from "@/lib/paycrest/types";
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

/** Live NGN bank institutions for cash-out recipient selection. */
export async function GET() {
  const result = await listNgnBankInstitutions();

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
      institutions: result.data,
      live: true,
      checkedAt: new Date().toISOString(),
    },
    { status: 200, headers: NO_STORE },
  );
}
