import { matchesCanonicalCeloUsdc, CANONICAL_CELO_USDC } from "@/lib/celo/usdc";
import { getCorridorSupport } from "@/lib/paycrest/server";
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

export async function GET() {
  const result = await getCorridorSupport();

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

  const { token, buy, sell } = result.data;
  const checkedAt = new Date().toISOString();
  const match = matchesCanonicalCeloUsdc(
    token.contractAddress,
    token.decimals,
  );

  return NextResponse.json(
    {
      network: "celo",
      token: "USDC",
      fiat: "NGN",
      tokenSupported: true,
      contractAddress: token.contractAddress,
      decimals: token.decimals,
      canonical: {
        address: CANONICAL_CELO_USDC.address,
        decimals: CANONICAL_CELO_USDC.decimals,
        source: CANONICAL_CELO_USDC.source,
      },
      contractMatchesCanonical: match.contractMatchesCanonical,
      decimalsMatchCanonical: match.decimalsMatchCanonical,
      tokenCompatible: match.tokenCompatible,
      /** @deprecated use contractMatchesCanonical */
      contractMatchesEnv: match.contractMatchesCanonical,
      quoteReadiness: match.tokenCompatible,
      buy,
      sell,
      live: true,
      checkedAt,
    },
    { status: 200, headers: NO_STORE },
  );
}
