/**
 * POST /api/auth/logout — revoke the session server-side and clear the cookie.
 * Always succeeds (idempotent): an absent or invalid session still clears it.
 */

import { NextResponse } from "next/server";
import {
  clearSessionCookie,
  extractSessionToken,
  revokeSession,
  verifySessionToken,
} from "@/lib/auth/wallet-auth";
import {
  authConfigFromEnv,
  getRequestPersistence,
} from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(request: Request) {
  const config = authConfigFromEnv();
  const persistence = getRequestPersistence();
  const isProduction = process.env.NODE_ENV === "production";
  if (config && persistence) {
    const token = extractSessionToken(request.headers.get("cookie"));
    if (token) {
      try {
        const claims = await verifySessionToken(config, persistence, { token });
        await revokeSession(persistence, claims.sessionId, claims.expiresAtMs);
      } catch {
        // Invalid/expired/unavailable: still clear the cookie below.
      }
    }
  }
  const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
  response.headers.append("Set-Cookie", clearSessionCookie(isProduction));
  return response;
}
