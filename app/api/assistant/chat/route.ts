/**
 * Conversational assistant endpoint.
 *
 * Server-only. Anonymous chat remains ephemeral. Authenticated conversation
 * turns use owner-scoped persistence for plain text, while each fresh intent
 * continues through the existing deterministic validation path. This handler
 * never calls wallet signing or blockchain services.
 */

import { NextResponse } from "next/server";
import type {
  AssistantApiErrorCode,
  AssistantChatRequest,
  ConversationMessage,
} from "@/lib/assistant/types";
import { getDb } from "@/lib/db";
import {
  beginConversationTurn,
  completeConversationTurn,
  failConversationTurn,
  isConversationId,
  isConversationTurnId,
} from "@/lib/conversations/service";
import type { ConversationFailureCode } from "@/lib/conversations/types";
import {
  errorResponse as ownerErrorResponse,
  requireOwnerForMutation,
} from "@/lib/recipients/routes";
import { resolveAssistantTurn } from "@/lib/assistant/resolve";
import { createDrizzleSharedMemoryStore } from "@/lib/shared-memory/repository";
import { readPromptMemories } from "@/lib/shared-memory/service";
import { sanitizeIncomingIntent } from "@/lib/assistant/validation";
import {
  authConfigFromEnv,
  authenticateRequest,
  getRequestPersistence,
} from "@/lib/auth/server";

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
  NOT_AUTHENTICATED: 401,
  NOT_FOUND: 404,
  STORAGE_UNAVAILABLE: 503,
  TURN_IN_PROGRESS: 409,
  TURN_STALE: 409,
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
/* Wallet session owner (B6) — verified server-side, never client-supplied    */
/* -------------------------------------------------------------------------- */

/**
 * Returns the authenticated SIWE wallet owner, or null when logged out or
 * auth is unconfigured. Wallet-transfer handoff treats null as logged-out:
 * drafts accumulate but nothing owner-scoped is read or prepared.
 */
async function resolveSessionOwner(request: Request): Promise<string | null> {
  try {
    const config = authConfigFromEnv();
    const persistence = getRequestPersistence();
    if (!config || !persistence) return null;
    const claims = await authenticateRequest(request, config, persistence);
    return claims?.ownerAddress ?? null;
  } catch {
    return null;
  }
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

  const hasSessionId = payload.sessionId !== undefined;
  const hasTurnId = payload.turnId !== undefined;
  if (hasSessionId !== hasTurnId) {
    return errorResponse("INVALID_REQUEST", "A session and turn ID are both required.");
  }
  if (hasSessionId) {
    if (
      typeof payload.sessionId !== "string" ||
      !isConversationId(payload.sessionId) ||
      typeof payload.turnId !== "string" ||
      !isConversationTurnId(payload.turnId)
    ) {
      return errorResponse("INVALID_REQUEST", "The conversation session or turn ID is invalid.");
    }
    return persistentTurn(request, payload, message, payload.sessionId, payload.turnId);
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
    ownerAddress: await (async () => {
      const owner = await resolveSessionOwner(request);
      if ("walletTransferOwner" in payload && (typeof payload.walletTransferOwner !== "string" || payload.walletTransferOwner.toLowerCase() !== owner?.toLowerCase())) return null;
      return owner;
    })(),
    signal: request.signal,
  });

  return NextResponse.json(response, {
    status: response.ok ? 200 : HTTP_STATUS_BY_CODE[response.error.code],
    headers: NO_STORE,
  });
}

async function persistentTurn(
  request: Request,
  payload: Record<string, unknown>,
  message: string,
  sessionId: string,
  turnId: string,
) {
  const auth = await requireOwnerForMutation(request);
  if ("response" in auth) return auth.response;
  if (
    "walletTransferOwner" in payload &&
    (typeof payload.walletTransferOwner !== "string" ||
      payload.walletTransferOwner.toLowerCase() !== auth.owner.toLowerCase())
  ) {
    return ownerErrorResponse(
      "WALLET_SESSION_MISMATCH",
      "Session wallet changed. Sign in with the connected wallet again.",
      401,
    );
  }
  const db = getDb();
  if (!db) {
    return errorResponse("STORAGE_UNAVAILABLE", "Conversation storage is not configured.");
  }

  let claim: Awaited<ReturnType<typeof beginConversationTurn>>;
  try {
    claim = await beginConversationTurn(db, {
      ownerAddress: auth.owner,
      sessionId,
      turnId,
      content: message,
    });
  } catch {
    return errorResponse("STORAGE_UNAVAILABLE", "Your message could not be saved.");
  }
  if (claim.kind === "not_found") return errorResponse("NOT_FOUND", "Conversation not found.");
  if (claim.kind === "in_progress") {
    return errorResponse("TURN_IN_PROGRESS", "This message is still being answered.", true);
  }
  if (claim.kind === "conflict") {
    return errorResponse("TURN_STALE", "This retry key belongs to a different message.");
  }
  if (claim.kind === "stale") {
    return errorResponse("TURN_STALE", "This message can no longer be retried. Send it again to continue.");
  }
  if (claim.kind === "replay") {
    return NextResponse.json(
      {
        ok: true,
        turn: {
          kind: "chat",
          message: {
            role: "assistant",
            content: claim.assistantMessage.content,
            timestamp: claim.assistantMessage.timestamp,
          },
        },
        activeIntent: null,
        persisted: {
          userMessage: {
            role: "user",
            content: claim.userMessage.content,
            timestamp: claim.userMessage.timestamp,
            id: claim.userMessage.id,
            sessionId: claim.userMessage.sessionId,
            turnId: claim.userMessage.turnId,
            sequence: claim.userMessage.sequence,
            turnStatus: claim.userMessage.turnStatus,
            failureCode: null,
          },
          assistantMessage: {
            role: "assistant",
            content: claim.assistantMessage.content,
            timestamp: claim.assistantMessage.timestamp,
            id: claim.assistantMessage.id,
            sessionId: claim.assistantMessage.sessionId,
            turnId: claim.assistantMessage.turnId,
            sequence: claim.assistantMessage.sequence,
          },
          replayed: true,
        },
      },
      { headers: NO_STORE },
    );
  }

  const history: ConversationMessage[] = claim.context.map((entry) => ({
    role: entry.role,
    content: entry.content,
    timestamp: entry.timestamp,
  }));
  const intentResult = sanitizeIncomingIntent(payload.activeIntent ?? null, history);
  if (!intentResult.ok) {
    await failConversationTurn(db, {
      ownerAddress: auth.owner,
      sessionId,
      turnId,
      attemptId: claim.attemptId,
      failureCode: "invalid_output",
    });
    return errorResponse("INVALID_REQUEST", intentResult.message);
  }

  try {
    let memoryContext = [] as Awaited<ReturnType<typeof readPromptMemories>>;
    try {
      memoryContext = await readPromptMemories(
        createDrizzleSharedMemoryStore(db),
        auth.owner,
      );
    } catch {
      console.warn("Saved memory context was unavailable for this assistant turn.");
    }
    const response = await resolveAssistantTurn({
      message,
      history,
      activeIntent: intentResult.intent,
      ownerAddress: auth.owner,
      memoryContext,
      signal: request.signal,
    });
    if (!response.ok) {
      await failConversationTurn(db, {
        ownerAddress: auth.owner,
        sessionId,
        turnId,
        attemptId: claim.attemptId,
        failureCode: safeFailureCode(response.error.code),
      });
      return NextResponse.json(response, {
        status: HTTP_STATUS_BY_CODE[response.error.code],
        headers: NO_STORE,
      });
    }

    const completion = await completeConversationTurn(db, {
      ownerAddress: auth.owner,
      sessionId,
      turnId,
      attemptId: claim.attemptId,
      assistantText: response.turn.message.content,
    });
    if (completion.kind === "not_found") return errorResponse("NOT_FOUND", "Conversation not found.");
    if (completion.kind === "stale") {
      return errorResponse("TURN_STALE", "This reply was superseded. Load the conversation to continue.");
    }
    const replayed = completion.kind === "replay";
    if (replayed) {
      return NextResponse.json(
        {
          ok: true,
          turn: {
            kind: "chat",
            message: {
              role: "assistant",
              content: completion.assistantMessage.content,
              timestamp: completion.assistantMessage.timestamp,
            },
          },
          activeIntent: null,
          persisted: persistedPair(completion.userMessage, completion.assistantMessage, true),
        },
        { headers: NO_STORE },
      );
    }
    return NextResponse.json(
      {
        ...response,
        persisted: persistedPair(completion.userMessage, completion.assistantMessage, false),
      },
      { headers: NO_STORE },
    );
  } catch {
    await failConversationTurn(db, {
      ownerAddress: auth.owner,
      sessionId,
      turnId,
      attemptId: claim.attemptId,
      failureCode: "assistant_unavailable",
    });
    return errorResponse("MODEL_UNAVAILABLE", "Providus could not finish this reply. You can retry it.", true);
  }
}

function safeFailureCode(code: AssistantApiErrorCode): ConversationFailureCode {
  if (code === "RATE_LIMITED") return "rate_limited";
  if (code === "MODEL_INVALID_OUTPUT") return "invalid_output";
  return "assistant_unavailable";
}

function persistedPair(
  userMessage: import("@/lib/conversations/types").ConversationMessageView,
  assistantMessage: import("@/lib/conversations/types").ConversationMessageView,
  replayed: boolean,
) {
  return {
    userMessage: {
      role: "user" as const,
      content: userMessage.content,
      timestamp: userMessage.timestamp,
      id: userMessage.id,
      sessionId: userMessage.sessionId,
      turnId: userMessage.turnId,
      sequence: userMessage.sequence,
      turnStatus: userMessage.turnStatus,
      failureCode: userMessage.failureCode ?? null,
    },
    assistantMessage: {
      role: "assistant" as const,
      content: assistantMessage.content,
      timestamp: assistantMessage.timestamp,
      id: assistantMessage.id,
      sessionId: assistantMessage.sessionId,
      turnId: assistantMessage.turnId,
      sequence: assistantMessage.sequence,
    },
    replayed,
  };
}
