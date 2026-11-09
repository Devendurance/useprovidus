/**
 * POST /api/auth/verify — verify the signed challenge, set the session cookie.
 * Body: { message, signature }. Ownership always comes from the verified
 * signature, never from client claims.
 */

import { NextResponse } from "next/server";
import {
  buildSessionCookie,
  verifyChallengeResponse,
  WalletAuthError,
} from "@/lib/auth/wallet-auth";
import {
  authConfigFromEnv,
  clientKey,
  getRateLimiter,
  getRequestPersistence,
  isSameOriginRequest,
  readJsonBody,
} from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store" } as const;
const MAX_BODY_BYTES = 8 * 1024;

function fail(status: number, code: string, message: string, retryAfter?: number) {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    {
      status,
      headers: retryAfter ? { ...NO_STORE, "Retry-After": String(retryAfter) } : NO_STORE,
    },
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  const limit = await getRateLimiter("verify").check(clientKey(request), Date.now());
  if (!limit.allowed) {
    return fail(429, "RATE_LIMITED", "Too many sign-in attempts. Try again shortly.", limit.retryAfterSeconds);
  }

  const config = authConfigFromEnv();
  if (!config) {
    return fail(503, "AUTH_NOT_CONFIGURED", "Wallet authentication is not configured.");
  }
  const persistence = getRequestPersistence();
  if (!persistence) {
    return fail(503, "AUTH_NOT_CONFIGURED", "Wallet authentication is not configured.");
  }
  if (!isSameOriginRequest(request)) {
    return fail(403, "FORBIDDEN", "Cross-origin sign-in is not allowed.");
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return fail(body.reason === "TOO_LARGE" ? 413 : 400, "INVALID_REQUEST", "Request body must be a small JSON object.");
  }
  if (!isPlainObject(body.value)) {
    return fail(400, "INVALID_REQUEST", "Request body must be a JSON object.");
  }

  const { message, signature } = body.value;
  if (typeof message !== "string" || typeof signature !== "string") {
    return fail(400, "INVALID_REQUEST", "message and signature are required.");
  }

  try {
    const session = await verifyChallengeResponse(config, persistence, {
      message,
      signature,
    });
    const isProduction = process.env.NODE_ENV === "production";
    const maxAgeSeconds = Math.max(
      0,
      Math.floor((session.expiresAtMs - Date.now()) / 1000),
    );
    const response = NextResponse.json(
      {
        ok: true,
        address: session.ownerAddress,
        chainId: session.chainId,
        expiresAt: new Date(session.expiresAtMs).toISOString(),
      },
      { headers: NO_STORE },
    );
    response.headers.append(
      "Set-Cookie",
      buildSessionCookie(session.token, maxAgeSeconds, isProduction),
    );
    return response;
  } catch (err) {
    if (err instanceof WalletAuthError && err.code === "NONCE_STORE_UNAVAILABLE") {
      return fail(503, "AUTH_NOT_CONFIGURED", "Wallet authentication is not configured.");
    }
    // Deliberately generic: no oracle for which check failed.
    return fail(401, "AUTH_FAILED", "Sign-in verification failed.");
  }
}
