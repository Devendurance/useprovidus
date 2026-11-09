/**
 * B2.1 — Shared server helpers for recipient routes (framework-free logic).
 * Ownership always comes from the verified session cookie, never the body.
 * Persistence and rate limiting are shared across instances when DATABASE_URL
 * is set; production without a database fails closed.
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { AuthPersistence } from "@/lib/auth/persistence";
import { createDrizzleRecipientStore } from "@/lib/recipients/repository";
import { RecipientError } from "@/lib/recipients/service";
import {
  authConfigFromEnv,
  authenticateRequest,
  clientKey,
  getRateLimiter,
  getRequestPersistence,
  isSameOriginRequest,
  readJsonBody,
} from "@/lib/auth/server";

export const NO_STORE = { "Cache-Control": "no-store" } as const;
export const MAX_BODY_BYTES = 4 * 1024;

const STATUS_BY_CODE: Record<string, number> = {
  NOT_AUTHENTICATED: 401,
  NOT_FOUND: 404,
  INVALID_LABEL: 400,
  INVALID_ADDRESS: 400,
  UNSUPPORTED_CHAIN: 400,
  DUPLICATE_LABEL: 409,
  STALE_VERSION: 409,
};

export function errorResponse(code: string, message: string, status: number, retryAfter?: number) {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    {
      status,
      headers: retryAfter ? { ...NO_STORE, "Retry-After": String(retryAfter) } : NO_STORE,
    },
  );
}

export function recipientErrorResponse(err: unknown) {
  if (err instanceof RecipientError) {
    // NOT_FOUND covers missing and foreign IDs alike: no owner leakage.
    return errorResponse(err.code, err.message, STATUS_BY_CODE[err.code] ?? 400);
  }
  return errorResponse("RECIPIENT_UNAVAILABLE", "Recipient request failed.", 500);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type AuthContext = { owner: string };

/** Rate limit + session auth. Returns owner or an error response. */
export async function requireOwner(
  request: Request,
): Promise<AuthContext | { response: NextResponse }> {
  const limit = await getRateLimiter("session").check(clientKey(request), Date.now());
  if (limit.allowed === false) {
    return {
      response: errorResponse("RATE_LIMITED", "Too many requests. Try again shortly.", 429, limit.retryAfterSeconds),
    };
  }
  const config = authConfigFromEnv();
  const persistence = getRequestPersistence();
  if (!config || !persistence) {
    return { response: errorResponse("AUTH_NOT_CONFIGURED", "Wallet authentication is not configured.", 503) };
  }
  const claims = await authenticateRequest(request, config, persistence);
  if (!claims) {
    return { response: errorResponse("NOT_AUTHENTICATED", "A verified wallet session is required.", 401) };
  }
  const expectedOwner = request.headers.get("x-providus-wallet");
  if (expectedOwner && expectedOwner.toLowerCase() !== claims.ownerAddress.toLowerCase()) {
    return { response: errorResponse("WALLET_SESSION_MISMATCH", "Session wallet changed. Sign in with the connected wallet again.", 401) };
  }
  return { owner: claims.ownerAddress };
}

/** Same-origin guard for mutations, then session auth. */
export async function requireOwnerForMutation(
  request: Request,
): Promise<AuthContext | { response: NextResponse }> {
  if (!isSameOriginRequest(request)) {
    return { response: errorResponse("FORBIDDEN", "Cross-origin requests are not allowed.", 403) };
  }
  return requireOwner(request);
}

/** Drizzle store, or a 503 when no database is configured. */
export function getStore() {
  const db = getDb();
  if (!db) return null;
  return createDrizzleRecipientStore(db);
}

/** Shared auth persistence for routes that need it directly. */
export function getAuthPersistence(): AuthPersistence | null {
  return getRequestPersistence();
}

export async function readBody(request: Request) {
  return readJsonBody(request, MAX_BODY_BYTES);
}
