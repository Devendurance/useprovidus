/**
 * Photon / iMessage channel webhook (P7A channel proof, server-only).
 *
 * Shape: Spectrum Cloud (photon-hq/vercel-chat-adapter-imessage, MIT)
 * delivers inbound messages as signed JSON:
 * - HMAC-SHA256 over `v0:{timestamp}:{rawBody}`, hex `v0=<...>`;
 * - headers `x-spectrum-signature` / `x-spectrum-timestamp` /
 *   `x-spectrum-event` (only `messages` is delivered);
 * - timestamp drift beyond 5 minutes is rejected (replay guard);
 * - at-least-once delivery: dedupe on delivery id + message id.
 *
 * Fail-closed: when IMESSAGE_WEBHOOK_SECRET is configured, deliveries with
 * missing/stale/bad signatures are rejected. When it is absent (demo mode),
 * unsigned demo payloads are accepted and the transport is labeled simulated.
 *
 * No financial mutation here: the handler only normalizes the message and
 * calls `resolveAssistantTurn` (LLM interpretation + read-only status reads).
 * It never creates previews, binds Paycrest orders, submits ClubKonnect
 * purchases, or moves money. A ready intent produces an approval handoff,
 * never a payment. No secrets/PII are logged.
 */

import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import {
  approvalUrlFor,
  formatApprovalHandoff,
  formatDeliveryRecovery,
  formatDeliverySuccess,
  normalizeChannelPayload,
  receiptUrlFor,
  resolveAppUrl,
  sendChannelReply,
  summarizeReadyIntent,
} from "@/lib/channels/imessage";
import {
  extractTransactionReference,
  readTransactionStatus,
} from "@/lib/assistant/status";
import { sanitizeIncomingIntent } from "@/lib/assistant/validation";
import { resolveAssistantTurn } from "@/lib/assistant/resolve";
import type {
  ConversationMessage,
  PaymentIntent,
} from "@/lib/assistant/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Hard request bounds (channel texts are short). */
const MAX_BODY_BYTES = 8 * 1024;
const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_CONTENT_CHARS = 2_000;

/** Replay guard: reject deliveries whose timestamp drifts more than 5 min. */
const TIMESTAMP_TOLERANCE_SEC = 5 * 60;

/** Process-local at-least-once dedupe + rate-limit windows. */
const SEEN_DELIVERIES = new Map<string, { reply: unknown; seenAt: number }>();
const RATE_WINDOWS = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 20;
const MAX_DEDUPE_KEYS = 1_000;

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status, headers: NO_STORE },
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Verifies the Spectrum HMAC signature over the exact raw bytes. Returns null
 * when no secret is configured (demo mode: caller labels transport simulated).
 */
function verifySignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  secret: string,
): { ok: true } | { ok: false; reason: string; status: number } {
  if (!(signature && timestamp)) {
    return { ok: false, reason: "Missing signature headers.", status: 401 };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const age = Math.abs(nowSec - Number(timestamp));
  if (!Number.isFinite(age) || age > TIMESTAMP_TOLERANCE_SEC) {
    return { ok: false, reason: "Stale or invalid timestamp.", status: 400 };
  }
  const expected = `v0=${createHmac("sha256", secret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "Bad signature.", status: 401 };
  }
  return { ok: true };
}

function checkRateLimit(key: string, nowMs: number): boolean {
  const window = (RATE_WINDOWS.get(key) ?? []).filter(
    (t) => nowMs - t < RATE_WINDOW_MS,
  );
  if (window.length >= RATE_MAX_REQUESTS) {
    RATE_WINDOWS.set(key, window);
    return false;
  }
  window.push(nowMs);
  if (RATE_WINDOWS.size > 512) {
    const oldest = RATE_WINDOWS.keys().next();
    if (!oldest.done) RATE_WINDOWS.delete(oldest.value);
  }
  RATE_WINDOWS.set(key, window);
  return true;
}

function rememberDelivery(key: string, reply: unknown): void {
  if (SEEN_DELIVERIES.size >= MAX_DEDUPE_KEYS) {
    const oldest = SEEN_DELIVERIES.keys().next();
    if (!oldest.done) SEEN_DELIVERIES.delete(oldest.value);
  }
  SEEN_DELIVERIES.set(key, { reply, seenAt: Date.now() });
}

/**
 * Minimal history parse for multi-turn channel demos. Client-supplied intents
 * are dropped (same rule as the web chat route): only role/content text is
 * kept as conversation context, every payment value is recomputed server-side.
 */
function parseChannelHistory(raw: unknown): ConversationMessage[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_HISTORY_MESSAGES) return null;
  const out: ConversationMessage[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) return null;
    if (entry.role !== "user" && entry.role !== "assistant") return null;
    if (typeof entry.content !== "string") return null;
    const content = entry.content.trim();
    if (!content || content.length > MAX_HISTORY_CONTENT_CHARS) return null;
    out.push({
      role: entry.role,
      content,
      timestamp: new Date().toISOString(),
    } as ConversationMessage);
  }
  return out;
}

export async function POST(request: Request) {
  const rawBody = await request.text().catch(() => null);
  if (rawBody === null) {
    return errorResponse("INVALID_REQUEST", "Request body could not be read.", 400);
  }
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return errorResponse("BODY_TOO_LARGE", "Request body is too large.", 413);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return errorResponse("INVALID_REQUEST", "Request body must be a JSON object.", 400);
  }
  if (!isPlainObject(payload)) {
    return errorResponse("INVALID_REQUEST", "Request body must be a JSON object.", 400);
  }

  const secret = process.env.IMESSAGE_WEBHOOK_SECRET;
  let verified = false;
  if (secret) {
    const check = verifySignature(
      rawBody,
      request.headers.get("x-spectrum-signature"),
      request.headers.get("x-spectrum-timestamp"),
      secret,
    );
    if (!check.ok) {
      return errorResponse("UNAUTHORIZED", check.reason, check.status);
    }
    verified = true;
  }

  // Spectrum event validation: only `messages` deliveries are supported.
  // The header/payload event is optional (demo shape omits it), but an
  // explicitly unsupported event is rejected rather than processed as chat.
  const spectrumEvent = request.headers.get("x-spectrum-event");
  if (spectrumEvent && spectrumEvent !== "messages") {
    return errorResponse("INVALID_REQUEST", "Unsupported channel event.", 400);
  }
  if (
    typeof payload.event === "string" &&
    payload.event !== "messages"
  ) {
    return errorResponse("INVALID_REQUEST", "Unsupported channel event.", 400);
  }

  const normalized = normalizeChannelPayload(payload);
  if (!normalized.ok) {
    return errorResponse("INVALID_REQUEST", normalized.error, 400);
  }
  const channelMessage = normalized.message;
  // At-least-once dedupe, tracked INDEPENDENTLY on each id so a retried
  // delivery and a re-sent message are both caught:
  // - Spectrum delivery id (webhook retry of the same POST), when present;
  // - provider message id scoped to the conversation (message re-send).
  // Tuple semantics are deliberately NOT required: either id repeating
  // suppresses re-processing.
  const deliveryId = request.headers.get("x-spectrum-webhook-id");
  const messageKey = normalized.eventId
    ? `msg:${channelMessage.externalConversationId}:${normalized.eventId}`
    : null;
  const deliveryKey = deliveryId ? `wh:${deliveryId}` : null;
  for (const key of [deliveryKey, messageKey]) {
    if (key) {
      const seen = SEEN_DELIVERIES.get(key);
      if (seen) {
        return NextResponse.json(
          { ...(seen.reply as Record<string, unknown>), duplicate: true },
          { status: 200, headers: NO_STORE },
        );
      }
    }
  }

  if (!checkRateLimit(`imessage:${channelMessage.externalSenderId}`, Date.now())) {
    return errorResponse(
      "RATE_LIMITED",
      "Too many channel requests. Please wait a moment and try again.",
      429,
    );
  }

  const history = parseChannelHistory(payload.history);
  if (history === null) {
    return errorResponse("INVALID_REQUEST", "history is invalid.", 400);
  }
  const intentResult = sanitizeIncomingIntent(
    payload.activeIntent ?? null,
    history,
  );
  if (!intentResult.ok) {
    return errorResponse("INVALID_REQUEST", intentResult.message, 400);
  }
  const incomingIntent: PaymentIntent | null = intentResult.intent;

  const turn = await resolveAssistantTurn({
    message: channelMessage.text,
    history,
    activeIntent: incomingIntent,
    signal: request.signal,
  });

  const appUrl = resolveAppUrl();
  let replyText: string;
  let kind: string;
  let approvalUrl: string | null = null;
  let receiptUrl: string | null = null;

  // Reference gate (hoisted above kind dispatch): every reference-bearing
  // turn — chat AND payment_intent — resolves against a fresh read-only
  // lookup. Only the verified terminal branch below may emit
  // delivery-success text; unverified model wording is never echoed.
  const turnContent = turn.ok ? turn.turn.message.content : "";
  const gatedReference = turn.ok
    ? (extractTransactionReference(channelMessage.text) ??
      (turn.turn.kind === "chat" ? extractReferenceHint(turnContent) : null))
    : null;
  const gatedLookup = gatedReference
    ? await readTransactionStatus(gatedReference)
    : null;

  if (!turn.ok) {
    // Assistant error contract mapped to chat-safe text; never a payment.
    replyText =
      "Providus is temporarily unavailable. Please try again in a moment, or continue on the web dashboard.";
    kind = "unavailable";
  } else if (gatedLookup) {
    // Reference gate wins for every turn kind: the reply derives from a fresh
    // read-only lookup, never from model wording. Only the verified terminal
    // branch may emit delivery-success text.
    if (gatedLookup.ok) {
      const stage = gatedLookup.data.stage.stage;
      const url = receiptUrlFor(appUrl, gatedLookup.data.transaction.id);
      if (stage === "airtime_delivered") {
        // Verified terminal delivery only: the single success path.
        replyText = formatDeliverySuccess(url);
        receiptUrl = url;
        kind = "delivered";
      } else if (
        stage === "failed" ||
        stage === "recovery_required" ||
        stage === "airtime_reconciliation_required"
      ) {
        replyText = formatDeliveryRecovery(url);
        receiptUrl = url;
        kind = "recovery";
      } else {
        // Non-terminal stage: gated status line that never claims delivery.
        const stageLabel = gatedLookup.data.stage.label;
        replyText =
          `${stageLabel} — Reference: ${gatedLookup.data.transaction.id}\n\n` +
          `Open the payment status:\n${url}`;
        receiptUrl = url;
        kind = "status";
      }
    } else {
      // Unknown reference: truthful lookup failure, never echoed model text.
      // Classified recovery: nothing verifiable to show, no receipt link.
      replyText = `${gatedLookup.message} Send a valid reference or continue on the web dashboard.`;
      kind = "recovery";
    }
  } else if (turn.turn.kind === "payment_intent") {
    const intent = turn.activeIntent;
    if (intent && intent.type === "airtime" && intent.readyForConfirmation) {
      // Approval handoff: never execute from chat.
      approvalUrl = approvalUrlFor(appUrl);
      replyText = formatApprovalHandoff(
        summarizeReadyIntent({
          amountNgn: intent.amountNgn,
          phone: intent.phone,
          network: intent.network,
        }),
        approvalUrl,
      );
      kind = "approval";
    } else if (intent && intent.type !== "airtime") {
      // Unsupported-category notice: the model reply prefix is sanitized so
      // unverified outcome claims never ride along with the notice.
      replyText =
        `${sanitizeUnverifiedChatText(turn.turn.message.content)}\n\n` +
        `Supported on this channel today: MTN, Airtel, Glo, and 9mobile airtime. ` +
        `Review and approve securely:\n${approvalUrlFor(appUrl)}`;
      kind = "unsupported";
    } else {
      // Clarification: the assistant's own follow-up question, sanitized so
      // unverified outcome claims never leak through model wording.
      replyText = sanitizeUnverifiedChatText(turn.turn.message.content);
      kind = "clarification";
    }
  } else {
    // Unreferenced chat: sanitize unverified delivery-success claims. The
    // model contract does not forbid chat from claiming delivery, so success
    // wording without a verified record is replaced, never echoed.
    replyText = sanitizeUnverifiedChatText(turn.turn.message.content);
    kind = "chat";
  }

  // Outbound: simulated unless Photon credentials are configured; the reply
  // text is returned in the webhook response so judges can verify the proof.

  const outbound = sendChannelReply(
    channelMessage.externalConversationId,
    replyText,
  );
  const body = {
    ok: true as const,
    reply: replyText,
    kind,
    ...(approvalUrl ? { approvalUrl } : {}),
    ...(receiptUrl ? { receiptUrl } : {}),
    simulated: outbound.simulated || !verified,
    transport: verified ? "photon_verified" : "simulated",
    duplicate: false,
  };
  for (const key of [deliveryKey, messageKey]) {
    if (key) rememberDelivery(key, body);
  }
  return NextResponse.json(body, { status: 200, headers: NO_STORE });
}

/**
 * The assistant's own status answers embed `Reference: <id>`; reuse that
 * exact hint so the channel layer never re-parses free text for references.
 */
function extractReferenceHint(content: string): string | null {
  const match = /\bReference:\s*([A-Za-z0-9][A-Za-z0-9_-]{2,})\b/.exec(content);
  return match ? match[1] : null;
}

/**
 * Unverified outcome guard: without a transaction reference there is no
 * verified record behind the turn, so deterministic outcome claims are never
 * echoed. Matches explicit success, delivery, completion, fulfilment, and
 * colloquial gone/went-through claims that name airtime, delivery, payment,
 * receipt, transaction, or order. Plain clarifications pass through.
 */
function sanitizeUnverifiedChatText(content: string): string {
  if (
    /\b(airtime|deliver\w*|payment|receipt|transaction|order)\b/i.test(content) &&
    /\b(deliver\w*|success\w*|succeed\w*|complet\w*|confirm\w*|fulfi\w*|\bdone\b|\bsent\b|\breceived\b|gone\s+through|went\s+through|has\s+gone|have\s+gone|✓)\b/i.test(
      content,
    )
  ) {
    return (
      "Providus could not verify completion yet. " +
      "Send a transaction reference (it starts with tx_) or continue on the web dashboard."
    );
  }
  return content;
}
