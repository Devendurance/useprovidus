/**
 * iMessage / Photon channel adapter (P7A channel proof).
 *
 * Boundary: this module owns incoming message normalization, conversation
 * mapping, and outgoing message formatting ONLY. It never validates intents,
 * creates previews, binds Paycrest orders, submits ClubKonnect purchases, or
 * decides provider success. All financial authority stays in Providus core
 * (`lib/assistant/*`, `lib/transactions/*`).
 *
 * Photon contract (official source: photon-hq/vercel-chat-adapter-imessage,
 * MIT; Spectrum Cloud webhooks POST signed JSON, HMAC-SHA256 over
 * `v0:{timestamp}:{rawBody}`, headers `x-spectrum-signature` /
 * `x-spectrum-timestamp` / `x-spectrum-event`, at-least-once delivery):
 * - verify signature when IMESSAGE_WEBHOOK_SECRET is configured (fail closed);
 * - dedupe on webhook delivery id + message id (at-least-once retries);
 * - reply by rebuilding thread context; without live credentials outbound
 *   delivery is simulated (returned in the webhook response, never faked as
 *   payment success).
 *
 * Transport in this proof is SIMULATED unless Photon credentials are
 * configured: no live iMessage is sent from this module.
 */

export const CHANNEL_IMESSAGE = "imessage" as const;

export type ChannelId = typeof CHANNEL_IMESSAGE;

/** Narrow adapter boundary: the only shape Providus core ever sees. */
export interface ChannelMessage {
  channel: ChannelId;
  externalConversationId: string;
  externalSenderId: string;
  text: string;
}

/** Result of normalizing one inbound webhook payload. */
export type NormalizeResult =
  | { ok: true; message: ChannelMessage; eventId: string | null }
  | { ok: false; error: string };

const MAX_TEXT_CHARS = 2_000;
const MAX_ID_CHARS = 200;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_ID_CHARS) return null;
  return trimmed;
}

/**
 * Extracts sendable text from a Spectrum-style content union. Mirrors the
 * official adapter's extractor (text / richlink url / poll title / reply /
 * group join); anything else (attachments, voice) yields "" so the caller can
 * answer with a truthful "text only" clarification instead of guessing.
 */
export function extractSpectrumText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!isPlainObject(content)) return "";
  const type = content.type;
  if (type === "text" && typeof content.text === "string") return content.text;
  if (type === "richlink" && typeof content.url === "string")
    return String(content.url);
  if (type === "poll" && typeof content.title === "string")
    return content.title;
  if (type === "reply" && "content" in content)
    return extractSpectrumText(content.content);
  if (type === "group" && Array.isArray(content.items)) {
    return content.items
      .map((item) =>
        isPlainObject(item) && "content" in item
          ? extractSpectrumText(item.content)
          : "",
      )
      .filter((t) => t.length > 0)
      .join("\n");
  }
  return "";
}

interface SpectrumLikeFields {
  conversationId: string | null;
  senderId: string | null;
  text: string;
  messageId: string | null;
  direction: string | null;
}

/** Reads the official Spectrum Cloud delivery shape. */
function readSpectrumShape(payload: Record<string, unknown>): SpectrumLikeFields | null {
  const message = payload.message;
  const space = payload.space;
  if (!isPlainObject(message) || !isPlainObject(space)) return null;
  const innerSpace = isPlainObject(message.space) ? message.space : null;
  const sender = isPlainObject(message.sender) ? message.sender : null;
  const spaceId =
    cleanId(space.id) ?? (innerSpace ? cleanId(innerSpace.id) : null);
  if (!spaceId) return null;
  const senderId =
    (sender ? cleanId(sender.id) : null) ??
    (typeof message.senderId === "string" ? cleanId(message.senderId) : null);
  if (!senderId) return null;
  const text = extractSpectrumText(message.content);
  const messageId =
    cleanId(message.id) ?? cleanId(payload.messageId) ?? null;
  const direction =
    typeof message.direction === "string" ? message.direction : null;
  return {
    conversationId: spaceId,
    senderId,
    text,
    messageId,
    direction,
  };
}

/** Reads the minimal demo/forward-compatible shape used by the demo script. */
function readDemoShape(payload: Record<string, unknown>): SpectrumLikeFields | null {
  const conversationId =
    cleanId(payload.conversationId) ?? cleanId(payload.externalConversationId);
  const senderId =
    cleanId(payload.senderId) ?? cleanId(payload.externalSenderId);
  const rawText = payload.text;
  const text = typeof rawText === "string" ? rawText : null;
  if (!conversationId || !senderId || text === null) return null;
  return {
    conversationId,
    senderId,
    text,
    messageId: cleanId(payload.eventId) ?? cleanId(payload.messageId),
    direction: typeof payload.direction === "string" ? payload.direction : null,
  };
}

/**
 * Normalizes an inbound webhook body into a ChannelMessage. Pure: no I/O, no
 * mutation, no logging (callers must never log sender ids or text).
 */
export function normalizeChannelPayload(payload: unknown): NormalizeResult {
  if (!isPlainObject(payload)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  const fields = readSpectrumShape(payload) ?? readDemoShape(payload);
  if (!fields) {
    return { ok: false, error: "Unsupported or incomplete channel payload." };
  }
  if (fields.direction === "outbound") {
    return { ok: false, error: "Outbound echo ignored." };
  }
  const text = fields.text.trim();
  if (!text) {
    return { ok: false, error: "Message text is required." };
  }
  if (text.length > MAX_TEXT_CHARS) {
    return {
      ok: false,
      error: `Message text must be ${MAX_TEXT_CHARS} characters or fewer.`,
    };
  }
  return {
    ok: true,
    message: {
      channel: CHANNEL_IMESSAGE,
      externalConversationId: fields.conversationId as string,
      externalSenderId: fields.senderId as string,
      text,
    },
    eventId: fields.messageId,
  };
}

/* -------------------------------------------------------------------------- */
/* Outgoing formatting (text only; links are opaque app URLs, no PII in query) */
/* -------------------------------------------------------------------------- */

/** Approval handoff: review-and-approve on web, never execute from chat. */
export function formatApprovalHandoff(
  summaryLines: string[],
  approvalUrl: string,
): string {
  const summary = summaryLines.join("\n");
  return (
    `Ready to review:\n${summary}\n` +
    `Pay with USDC or cNGN on Celo.\n\n` +
    `Review and approve securely:\n${approvalUrl}`
  );
}

export function formatDeliverySuccess(receiptUrl: string): string {
  return `Airtime delivered ✓\nView verified receipt:\n${receiptUrl}`;
}

/** Recovery reply: never claims success; points at the status surface. */
export function formatDeliveryRecovery(statusUrl: string): string {
  return (
    `Providus could not verify completion yet.\n` +
    `Open the payment status:\n${statusUrl}`
  );
}

export function approvalUrlFor(appUrl: string): string {
  return `${appUrl}/dashboard?channel=imessage`;
}

export function receiptUrlFor(appUrl: string, reference: string): string {
  return `${appUrl}/receipt?tx=${encodeURIComponent(reference)}`;
}

/**
 * Summarizes a ready airtime intent for chat without leaking anything the
 * web confirmation card does not already show. Amount/phone/network are the
 * user's own stated values echoed back for review (same as the assistant's
 * own reply semantics); no quote, fee, wallet, or provider detail here — the
 * browser flow owns the exact quote.
 */
export function summarizeReadyIntent(intent: {
  amountNgn?: string;
  phone?: string;
  network?: string;
}): string[] {
  const lines: string[] = [];
  const amount = intent.amountNgn ? `₦${intent.amountNgn}` : null;
  const network = intent.network ? intent.network.toUpperCase() : null;
  if (amount && network) lines.push(`${amount} ${network} airtime`);
  else if (amount) lines.push(`${amount} airtime`);
  else lines.push(`Airtime request`);
  if (intent.phone) lines.push(`Recipient: ${maskPhone(intent.phone)}`);
  return lines;
}

/** Masks all but the last 4 digits; never emits a full recipient number. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `${"*".repeat(Math.min(7, digits.length - 4))}${digits.slice(-4)}`;
}

/* -------------------------------------------------------------------------- */
/* Outbound delivery (simulated unless Photon credentials are configured)      */
/* -------------------------------------------------------------------------- */

export interface OutboundResult {
  delivered: boolean;
  simulated: boolean;
  detail: string;
}

/**
 * Sends one text reply. This proof has no live Spectrum Cloud sender wired:
 * the reply text is always returned inside the webhook response for the
 * caller to verify, and this function reports that honestly. `simulated` is
 * therefore always true here: the iMessage transport is simulated even when
 * the inbound delivery was signature-verified. It never throws for a missing
 * transport and never reports payment success — delivery of a chat message is
 * not delivery of airtime.
 */
export function sendChannelReply(
  conversationId: string,
  text: string,
): OutboundResult {
  void conversationId;
  void text;
  const projectId = process.env.IMESSAGE_PROJECT_ID;
  const projectSecret = process.env.IMESSAGE_PROJECT_SECRET;
  const configured = Boolean(projectId && projectSecret);
  return {
    delivered: false,
    simulated: true,
    detail: configured
      ? "Photon credentials present but live send is not enabled in this proof; reply returned in webhook response (simulated transport)."
      : "Photon credentials not configured; reply returned in webhook response (simulated transport).",
  };
}

/** Resolves the public app base URL without leaking secrets. */
export function resolveAppUrl(): string {
  const raw = (process.env.PROVIDUS_APP_URL ?? "").trim().replace(/\/+$/, "");
  if (raw && /^https?:\/\//.test(raw)) return raw;
  return "https://useprovidus.vercel.app";
}
