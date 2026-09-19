/**
 * Conversational assistant endpoint.
 *
 * Server-only. The route is stateless (no conversation state is kept here),
 * never streams, never caches, and has no mutation surface: it answers from
 * recorded status or from the model's candidate intent, which is then
 * re-validated deterministically. No Paycrest, ClubKonnect, wallet, or
 * blockchain call can originate from this handler.
 */

import { NextResponse } from "next/server";
import type {
  AssistantApiErrorCode,
  AssistantChatRequest,
  ConversationMessage,
} from "@/lib/assistant/types";
import { resolveAssistantTurn } from "@/lib/assistant/resolve";
import { sanitizeIncomingIntent } from "@/lib/assistant/validation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Hard request bounds. */
const MAX_BODY_BYTES = 32 * 1024;
const MAX_MESSAGE_CHARS = 2_000;
const MAX_HISTORY_MESSAGES = 24;
const MAX_HISTORY_CONTENT_CHARS = 2_000;

/** Process-local rate limit window. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const RATE_LIMIT_MAX_KEYS = 512;

const HTTP_STATUS_BY_CODE: Record<AssistantApiErrorCode, number> = {
  INVALID_REQUEST: 400,
  BODY_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  ASSISTANT_NOT_CONFIGURED: 503,
  MODEL_UNAVAILABLE: 502,
  MODEL_INVALID_OUTPUT: 502,
  STATUS_UNAVAILABLE: 503,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorResponse(
  code: AssistantApiErrorCode,
  message: string,
  retryable?: boolean,
  extraHeaders?: Record<string, string>,
) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
        ...(retryable === undefined ? {} : { retryable }),
      },
    },
    {
      status: HTTP_STATUS_BY_CODE[code],
      headers: extraHeaders ? { ...NO_STORE, ...extraHeaders } : NO_STORE,
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                              */
/* -------------------------------------------------------------------------- */

/** key -> request timestamps inside the current window. */
const rateLimitWindows = new Map<string, number[]>();

function checkRateLimit(
  key: string,
  nowMs: number,
): { allowed: boolean; retryAfterSeconds: number } {
  if (rateLimitWindows.size > RATE_LIMIT_MAX_KEYS) {
    for (const [existingKey, timestamps] of rateLimitWindows) {
      const fresh = timestamps.filter((t) => nowMs - t < RATE_LIMIT_WINDOW_MS);
      if (fresh.length === 0) rateLimitWindows.delete(existingKey);
      else rateLimitWindows.set(existingKey, fresh);
    }
  }

  const recent = (rateLimitWindows.get(key) ?? []).filter(
    (t) => nowMs - t < RATE_LIMIT_WINDOW_MS,
  );

  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    rateLimitWindows.set(key, recent);
    const oldest = recent[0];
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((RATE_LIMIT_WINDOW_MS - (nowMs - oldest)) / 1000),
      ),
    };
  }

  recent.push(nowMs);
  rateLimitWindows.set(key, recent);
  return { allowed: true, retryAfterSeconds: 0 };
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || "local";
}

/* -------------------------------------------------------------------------- */
/* Request parsing                                                            */
/* -------------------------------------------------------------------------- */

type HistoryParseResult =
  | { ok: true; history: ConversationMessage[] }
  | { ok: false; message: string };

/**
 * Validates the client-held history and caps it. Client-supplied intents are
 * deliberately dropped: history text may be used as conversation context, but
 * every payment value in this system is recomputed server-side.
 */
function parseHistory(raw: unknown): HistoryParseResult {
  if (raw === undefined || raw === null) return { ok: true, history: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, message: "history must be an array." };
  }

  const history: ConversationMessage[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) {
      return { ok: false, message: "history entries must be objects." };
    }
    const role = entry.role;
    const content = entry.content;
    const timestamp = entry.timestamp;

    if (role !== "user" && role !== "assistant") {
      return {
        ok: false,
        message: "history entry role must be 'user' or 'assistant'.",
      };
    }
    if (typeof content !== "string" || !content.trim()) {
      return {
        ok: false,
        message: "history entry content must be a non-empty string.",
      };
    }
    if (typeof timestamp !== "string" || !timestamp.trim()) {
      return {
        ok: false,
        message: "history entry timestamp must be a non-empty string.",
      };
    }

    history.push({
      role,
      content: content.slice(0, MAX_HISTORY_CONTENT_CHARS),
      timestamp,
    });
  }

  return { ok: true, history: history.slice(-MAX_HISTORY_MESSAGES) };
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                    */
/* -------------------------------------------------------------------------- */

export async function POST(request: Request) {
  const limit = checkRateLimit(clientKey(request), Date.now());
  if (!limit.allowed) {
    return errorResponse(
      "RATE_LIMITED",
      "Too many assistant requests. Please wait a moment and try again.",
      true,
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return errorResponse("BODY_TOO_LARGE", "Request body is too large.");
  }

  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch {
    return errorResponse("INVALID_REQUEST", "Request body could not be read.");
  }

  if (new TextEncoder().encode(bodyText).length > MAX_BODY_BYTES) {
    return errorResponse("BODY_TOO_LARGE", "Request body is too large.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return errorResponse(
      "INVALID_REQUEST",
      "Request body must be a JSON object.",
    );
  }

  if (!isPlainObject(payload)) {
    return errorResponse(
      "INVALID_REQUEST",
      "Request body must be a JSON object.",
    );
  }

  const rawMessage = payload.message;
  if (typeof rawMessage !== "string" || !rawMessage.trim()) {
    return errorResponse("INVALID_REQUEST", "message is required.");
  }
  const message = rawMessage.trim();
  if (message.length > MAX_MESSAGE_CHARS) {
    return errorResponse(
      "INVALID_REQUEST",
      `message must be ${MAX_MESSAGE_CHARS} characters or fewer.`,
    );
  }

  const historyResult = parseHistory(payload.history);
  if (!historyResult.ok) {
    return errorResponse("INVALID_REQUEST", historyResult.message);
  }

  const intentResult = sanitizeIncomingIntent(
    payload.activeIntent ?? null,
    historyResult.history,
  );
  if (!intentResult.ok) {
    return errorResponse("INVALID_REQUEST", intentResult.message);
  }

  const chatRequest: AssistantChatRequest = {
    message,
    history: historyResult.history,
    activeIntent: intentResult.intent,
  };

  const response = await resolveAssistantTurn({
    ...chatRequest,
    signal: request.signal,
  });

  return NextResponse.json(response, {
    status: response.ok ? 200 : HTTP_STATUS_BY_CODE[response.error.code],
    headers: NO_STORE,
  });
}
