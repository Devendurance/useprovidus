/**
 * POST /api/auth/challenge — issue a one-time SIWE-compatible sign-in challenge.
 * Body: { address, chainId }. Rate limited. No session required.
 * Authority: env-configured trusted origins only; Host headers are ignored.
 */

import { NextResponse } from "next/server";
import { createChallenge, WalletAuthError } from "@/lib/auth/wallet-auth";
import {
  authConfigFromEnv,
  clientKey,
  getRateLimiter,
  getRequestPersistence,
  readJsonBody,
} from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store" } as const;
const MAX_BODY_BYTES = 4 * 1024;

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
  const limit = await getRateLimiter("challenge").check(clientKey(request), Date.now());
  if (!limit.allowed) {
    return fail(429, "RATE_LIMITED", "Too many challenge requests. Try again shortly.", limit.retryAfterSeconds);
  }

  const config = authConfigFromEnv();
  if (!config) {
    return fail(503, "AUTH_NOT_CONFIGURED", "Wallet authentication is not configured.");
  }
  const persistence = getRequestPersistence();
  if (!persistence) {
    return fail(503, "AUTH_NOT_CONFIGURED", "Wallet authentication is not configured.");
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return fail(body.reason === "TOO_LARGE" ? 413 : 400, "INVALID_REQUEST", "Request body must be a small JSON object.");
  }
  if (!isPlainObject(body.value)) {
    return fail(400, "INVALID_REQUEST", "Request body must be a JSON object.");
  }

  const { address, chainId } = body.value;
  if (typeof address !== "string" || typeof chainId !== "number") {
    return fail(400, "INVALID_REQUEST", "address (string) and chainId (number) are required.");
  }

  try {
    const challenge = await createChallenge(config, persistence, { address, chainId });
    return NextResponse.json(
      {
        ok: true,
        message: challenge.message,
        nonce: challenge.nonce,
        address: challenge.address,
        chainId: challenge.chainId,
        issuedAt: challenge.issuedAt,
        expirationTime: challenge.expirationTime,
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    if (err instanceof WalletAuthError && err.code === "NONCE_STORE_UNAVAILABLE") {
      return fail(503, "AUTH_NOT_CONFIGURED", "Wallet authentication is not configured.");
    }
    // Invalid addresses / unsupported chains only — no detail oracle.
    return fail(400, "INVALID_REQUEST", "Address must be a valid wallet address on a supported chain.");
  }
}
