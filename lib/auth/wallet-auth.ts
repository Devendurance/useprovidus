/**
 * B2.1 — Wallet-signature authentication (SIWE-compatible, EIP-4361).
 *
 * Hardened for multi-instance deployment:
 * - Challenge nonces and logout revocations live in shared AuthPersistence
 *   (Neon PostgreSQL in production, memory only for tests/local dev).
 *   Consumption is atomic single-use across instances; storage outage fails
 *   closed — never falls back to process-local state in production.
 * - SIWE authority comes ONLY from the configured trusted origin allowlist
 *   (env). Request Host / forwarded-host headers are never trusted.
 * - SESSION_SECRET must be >= 32 bytes of high-entropy material.
 *
 * Preserved from B2: EIP-4361 message shape, explicit issued-at/expiry,
 * chain-aware context (B1 registry), HttpOnly cookie sessions, wallet-switch
 * semantics (ownership always derives from the verified token's subject).
 * EOA ONLY: ECDSA recovery via viem. EIP-1271 contract wallets fail closed.
 */

import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  getAddress,
  isAddress,
  verifyMessage,
  type Address,
} from "viem";
import { getChainById } from "@/lib/chains/registry";
import type { AuthPersistence } from "@/lib/auth/persistence";

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

export type WalletAuthConfig = {
  /**
   * Trusted application origins, canonical first, e.g.
   * ["https://providus.app"]. Challenges are issued for the canonical origin;
   * verification accepts any listed origin. Never derived from request headers.
   */
  origins: string[];
  /** HMAC key: >= 32 bytes of high-entropy material (SESSION_SECRET). */
  sessionSecret: string;
  /** Challenge validity. Default 5 minutes. */
  challengeTtlMs?: number;
  /** Session validity. Default 12 hours. */
  sessionTtlMs?: number;
};

const DEFAULT_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** Acceptable future skew for issued-at timestamps. */
const ISSUED_AT_SKEW_MS = 60 * 1000;
const MIN_SECRET_BYTES = 32;

export type WalletAuthErrorCode =
  | "INVALID_ADDRESS"
  | "UNSUPPORTED_CHAIN"
  | "CHALLENGE_EXPIRED"
  | "NONCE_UNKNOWN"
  | "NONCE_CONSUMED"
  | "NONCE_MISMATCH"
  | "WRONG_DOMAIN"
  | "MESSAGE_MALFORMED"
  | "MESSAGE_EXPIRED"
  | "MESSAGE_NOT_YET_VALID"
  | "SIGNATURE_INVALID"
  | "SESSION_EXPIRED"
  | "SESSION_REVOKED"
  | "SESSION_MALFORMED"
  | "SESSION_SECRET_MISSING"
  | "AUTH_NOT_CONFIGURED"
  | "NONCE_STORE_UNAVAILABLE";

export class WalletAuthError extends Error {
  readonly code: WalletAuthErrorCode;
  constructor(code: WalletAuthErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function isSufficientSecret(secret: unknown): secret is string {
  return (
    typeof secret === "string" && Buffer.byteLength(secret, "utf8") >= MIN_SECRET_BYTES
  );
}

/** Canonical origin used when issuing challenges. */
export function canonicalOrigin(config: WalletAuthConfig): string {
  const first = config.origins[0];
  if (!first) {
    throw new WalletAuthError("AUTH_NOT_CONFIGURED", "No trusted application origin is configured.");
  }
  return first;
}

function originHost(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      return null;
    }
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* SIWE-compatible message                                                    */
/* -------------------------------------------------------------------------- */

export type Challenge = {
  message: string;
  nonce: string;
  address: Address;
  chainId: number;
  issuedAt: string;
  expirationTime: string;
};

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * EIP-4361-shaped sign-in message. Verifiable by any SIWE-compatible wallet or
 * validator; parsed strictly by `parseSignInMessage` below.
 */
export function buildSignInMessage(args: {
  domain: string;
  uri: string;
  address: Address;
  chainId: number;
  nonce: string;
  issuedAtMs: number;
  expirationMs: number;
}): string {
  const lines = [
    `${args.domain} wants you to sign in with your Ethereum account:`,
    args.address,
    ``,
    `Sign in to Providus. This signature proves you own this wallet. It does not move funds.`,
    ``,
    `URI: ${args.uri}`,
    `Version: 1`,
    `Chain ID: ${args.chainId}`,
    `Nonce: ${args.nonce}`,
    `Issued At: ${toIso(args.issuedAtMs)}`,
    `Expiration Time: ${toIso(args.expirationMs)}`,
  ];
  return lines.join("\n");
}

export type ParsedSignInMessage = {
  domain: string;
  address: Address;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAtMs: number;
  expirationMs: number;
};

function firstGroup(pattern: RegExp, message: string): string | null {
  const match = pattern.exec(message);
  return match?.[1] ?? null;
}

/** Strict parser: every field must be present and well-formed. */
export function parseSignInMessage(message: unknown): ParsedSignInMessage {
  if (typeof message !== "string" || message.length > 4_096) {
    throw new WalletAuthError("MESSAGE_MALFORMED", "Sign-in message is malformed.");
  }
  const header = firstGroup(
    /^([A-Za-z0-9][A-Za-z0-9.:\-]*[A-Za-z0-9:\]]?) wants you to sign in with your Ethereum account:\n(0x[0-9a-fA-F]{40})/,
    message,
  );
  const addressRaw = firstGroup(
    /wants you to sign in with your Ethereum account:\n(0x[0-9a-fA-F]{40})/,
    message,
  );
  const uri = firstGroup(/^URI: (\S+)$/m, message);
  const version = firstGroup(/^Version: (\S+)$/m, message);
  const chainIdRaw = firstGroup(/^Chain ID: (\d+)$/m, message);
  const nonce = firstGroup(/^Nonce: ([A-Za-z0-9]+)$/m, message);
  const issuedAtRaw = firstGroup(/^Issued At: (\S+)$/m, message);
  const expirationRaw = firstGroup(/^Expiration Time: (\S+)$/m, message);

  if (
    !header || !addressRaw || !uri || version !== "1" ||
    !chainIdRaw || !nonce || !issuedAtRaw || !expirationRaw
  ) {
    throw new WalletAuthError("MESSAGE_MALFORMED", "Sign-in message is malformed.");
  }
  if (!isAddress(addressRaw)) {
    throw new WalletAuthError("MESSAGE_MALFORMED", "Sign-in message address is invalid.");
  }
  const issuedAtMs = Date.parse(issuedAtRaw);
  const expirationMs = Date.parse(expirationRaw);
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expirationMs)) {
    throw new WalletAuthError("MESSAGE_MALFORMED", "Sign-in message time range is invalid.");
  }
  return {
    domain: header,
    address: getAddress(addressRaw),
    uri,
    chainId: Number(chainIdRaw),
    nonce,
    issuedAtMs,
    expirationMs,
  };
}

/* -------------------------------------------------------------------------- */
/* Challenge issuance (shared persistence)                                     */
/* -------------------------------------------------------------------------- */

export async function createChallenge(
  config: WalletAuthConfig,
  persistence: AuthPersistence,
  args: { address: string; chainId: number; nowMs?: number },
): Promise<Challenge> {
  if (!isSufficientSecret(config.sessionSecret)) {
    throw new WalletAuthError("SESSION_SECRET_MISSING", "Session secret is not configured.");
  }
  if (!isAddress(args.address)) {
    throw new WalletAuthError("INVALID_ADDRESS", "Wallet address is invalid.");
  }
  if (getChainById(args.chainId) === null) {
    throw new WalletAuthError("UNSUPPORTED_CHAIN", "Chain ID is not supported.");
  }
  const origin = canonicalOrigin(config);
  const host = originHost(origin);
  if (!host) {
    throw new WalletAuthError("AUTH_NOT_CONFIGURED", "Trusted application origin is invalid.");
  }
  const nowMs = args.nowMs ?? Date.now();
  const challengeTtlMs = config.challengeTtlMs ?? DEFAULT_CHALLENGE_TTL_MS;
  const address = getAddress(args.address);
  const nonce = randomBytes(16).toString("hex");
  const issuedAtMs = nowMs;
  const expirationMs = nowMs + challengeTtlMs;

  try {
    await persistence.saveNonce({ nonce, address, chainId: args.chainId, issuedAtMs, expiresAtMs: expirationMs });
  } catch (err) {
    throw new WalletAuthError(
      "NONCE_STORE_UNAVAILABLE",
      `Challenge store unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    message: buildSignInMessage({
      domain: host,
      uri: origin,
      address,
      chainId: args.chainId,
      nonce,
      issuedAtMs,
      expirationMs,
    }),
    nonce,
    address,
    chainId: args.chainId,
    issuedAt: toIso(issuedAtMs),
    expirationTime: toIso(expirationMs),
  };
}

/* -------------------------------------------------------------------------- */
/* Challenge verification → session                                           */
/* -------------------------------------------------------------------------- */

export type VerifiedSession = {
  token: string;
  ownerAddress: Address;
  chainId: number;
  sessionId: string;
  issuedAtMs: number;
  expiresAtMs: number;
};

export async function verifyChallengeResponse(
  config: WalletAuthConfig,
  persistence: AuthPersistence,
  args: { message: unknown; signature: unknown; nowMs?: number },
): Promise<VerifiedSession> {
  if (!isSufficientSecret(config.sessionSecret)) {
    throw new WalletAuthError("SESSION_SECRET_MISSING", "Session secret is not configured.");
  }
  const nowMs = args.nowMs ?? Date.now();
  const parsed = parseSignInMessage(args.message);

  // Authority check against the allowlist only. Host headers play no role.
  const matchedOrigin = config.origins.find((o) => {
    try {
      return new URL(o).href === new URL(parsed.uri).href;
    } catch {
      return o === parsed.uri;
    }
  });
  if (!matchedOrigin || originHost(matchedOrigin) === null) {
    throw new WalletAuthError("WRONG_DOMAIN", "Sign-in domain does not match this app.");
  }
  if (originHost(matchedOrigin) !== parsed.domain.toLowerCase()) {
    throw new WalletAuthError("WRONG_DOMAIN", "Sign-in domain does not match this app.");
  }
  if (getChainById(parsed.chainId) === null) {
    throw new WalletAuthError("UNSUPPORTED_CHAIN", "Sign-in chain is not supported.");
  }
  if (parsed.expirationMs <= nowMs) {
    throw new WalletAuthError("MESSAGE_EXPIRED", "Sign-in message has expired.");
  }
  if (parsed.issuedAtMs > nowMs + ISSUED_AT_SKEW_MS) {
    throw new WalletAuthError("MESSAGE_NOT_YET_VALID", "Sign-in message is not yet valid.");
  }

  // Atomic single-use consumption: exactly one instance wins a race; storage
  // outage throws and fails closed below.
  let record;
  try {
    record = await persistence.consumeNonce(parsed.nonce, nowMs);
  } catch (err) {
    throw new WalletAuthError(
      "NONCE_STORE_UNAVAILABLE",
      `Challenge store unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!record) {
    throw new WalletAuthError("NONCE_UNKNOWN", "Challenge nonce is unknown, expired, or already used.");
  }
  if (record.address !== parsed.address || record.chainId !== parsed.chainId) {
    throw new WalletAuthError("NONCE_MISMATCH", "Challenge does not match this wallet and chain.");
  }

  if (typeof args.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(args.signature)) {
    throw new WalletAuthError("SIGNATURE_INVALID", "Signature is invalid.");
  }
  let signatureValid = false;
  try {
    signatureValid = await verifyMessage({
      address: parsed.address,
      message: args.message as string,
      signature: args.signature as `0x${string}`,
    });
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    // Covers wrong-wallet signatures and unsupported contract-wallet
    // (EIP-1271) signatures: both fail closed here.
    throw new WalletAuthError("SIGNATURE_INVALID", "Signature does not prove wallet ownership.");
  }

  return createSession(config, {
    ownerAddress: parsed.address,
    chainId: parsed.chainId,
    nowMs,
  });
}

/* -------------------------------------------------------------------------- */
/* Stateless HMAC session tokens + durable revocation                         */
/* -------------------------------------------------------------------------- */

export type SessionClaims = {
  ownerAddress: Address;
  chainId: number;
  sessionId: string;
  issuedAtMs: number;
  expiresAtMs: number;
};

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signPayload(secret: string, payloadB64: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

export function createSession(
  config: WalletAuthConfig,
  args: { ownerAddress: Address; chainId: number; nowMs?: number },
): VerifiedSession {
  if (!isSufficientSecret(config.sessionSecret)) {
    throw new WalletAuthError("SESSION_SECRET_MISSING", "Session secret is not configured.");
  }
  const nowMs = args.nowMs ?? Date.now();
  const sessionTtlMs = config.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const claims: SessionClaims = {
    ownerAddress: getAddress(args.ownerAddress),
    chainId: args.chainId,
    sessionId: randomBytes(16).toString("hex"),
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + sessionTtlMs,
  };
  const payloadB64 = base64UrlEncode(JSON.stringify(claims));
  const token = `${payloadB64}.${signPayload(config.sessionSecret, payloadB64)}`;
  return {
    token,
    ownerAddress: claims.ownerAddress,
    chainId: claims.chainId,
    sessionId: claims.sessionId,
    issuedAtMs: claims.issuedAtMs,
    expiresAtMs: claims.expiresAtMs,
  };
}

export async function verifySessionToken(
  config: WalletAuthConfig,
  persistence: AuthPersistence,
  args: { token: unknown; nowMs?: number },
): Promise<SessionClaims> {
  if (!isSufficientSecret(config.sessionSecret)) {
    throw new WalletAuthError("SESSION_SECRET_MISSING", "Session secret is not configured.");
  }
  if (typeof args.token !== "string") {
    throw new WalletAuthError("SESSION_MALFORMED", "Session token is malformed.");
  }
  const parts = args.token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new WalletAuthError("SESSION_MALFORMED", "Session token is malformed.");
  }
  const [payloadB64, sigB64] = parts as [string, string];
  const expected = signPayload(config.sessionSecret, payloadB64);
  const a = Buffer.from(sigB64, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new WalletAuthError("SESSION_MALFORMED", "Session token signature is invalid.");
  }
  let claims: SessionClaims;
  try {
    const raw = JSON.parse(base64UrlDecode(payloadB64)) as Record<string, unknown>;
    if (
      typeof raw.ownerAddress !== "string" || !isAddress(raw.ownerAddress) ||
      typeof raw.chainId !== "number" || !Number.isInteger(raw.chainId) ||
      typeof raw.sessionId !== "string" || !raw.sessionId ||
      typeof raw.issuedAtMs !== "number" || typeof raw.expiresAtMs !== "number"
    ) {
      throw new Error("bad claims");
    }
    claims = {
      ownerAddress: getAddress(raw.ownerAddress),
      chainId: raw.chainId,
      sessionId: raw.sessionId,
      issuedAtMs: raw.issuedAtMs,
      expiresAtMs: raw.expiresAtMs,
    };
  } catch {
    throw new WalletAuthError("SESSION_MALFORMED", "Session token is malformed.");
  }

  const nowMs = args.nowMs ?? Date.now();
  let revoked: boolean;
  try {
    revoked = await persistence.isSessionRevoked(claims.sessionId, nowMs);
  } catch (err) {
    throw new WalletAuthError(
      "NONCE_STORE_UNAVAILABLE",
      `Session store unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (revoked) {
    throw new WalletAuthError("SESSION_REVOKED", "Session has been logged out.");
  }
  if (claims.expiresAtMs <= nowMs) {
    throw new WalletAuthError("SESSION_EXPIRED", "Session has expired.");
  }
  return claims;
}

/** Logout: revoke the session id so the token fails closed even before expiry. */
export async function revokeSession(
  persistence: AuthPersistence,
  sessionId: string,
  expiresAtMs: number,
): Promise<void> {
  await persistence.revokeSession(sessionId, expiresAtMs);
}

/* -------------------------------------------------------------------------- */
/* Cookie helpers (routes set these; no framework dependency here)            */
/* -------------------------------------------------------------------------- */

export const SESSION_COOKIE_NAME = "providus_session";

export function buildSessionCookie(token: string, maxAgeSeconds: number, isProduction: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    isProduction ? "Secure" : null,
    "SameSite=Lax",
  ].filter((p): p is string => p !== null);
  return parts.join("; ");
}

export function clearSessionCookie(isProduction: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "Max-Age=0",
    isProduction ? "Secure" : null,
    "SameSite=Lax",
  ].filter((p): p is string => p !== null);
  return parts.join("; ");
}

export function extractSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const piece of cookieHeader.split(";")) {
    const idx = piece.indexOf("=");
    if (idx === -1) continue;
    if (piece.slice(0, idx).trim() === SESSION_COOKIE_NAME) {
      const value = piece.slice(idx + 1).trim();
      return value || null;
    }
  }
  return null;
}
