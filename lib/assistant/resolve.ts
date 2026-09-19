/**
 * Assistant turn resolver.
 *
 * Order of authority:
 * 1. deterministic status answers (no model call at all);
 * 2. the configured model, which may only produce a candidate intent;
 * 3. `parseAssistantModelOutput` + `resolveIntent`, which own every accepted
 *    value and recompute all derived fields.
 *
 * Nothing here authorizes, executes, or reconciles a payment: no provider
 * mutation, no wallet call, no transaction write.
 */

import "server-only";

import {
  LlmProviderError,
  buildAssistantPrompt,
  createDeepSeekProvider,
  type LlmProvider,
} from "@/lib/ai";
import type {
  AssistantChatResponse,
  AssistantTurn,
  ConversationMessage,
  PaymentIntent,
} from "@/lib/assistant/types";
import {
  parseAssistantModelOutput,
  resolveIntent,
  sanitizeIncomingIntent,
} from "@/lib/assistant/validation";
import {
  STATUS_REFERENCE_REQUEST,
  detectStatusQuery,
  formatStatusAnswer,
  readTransactionStatus,
} from "@/lib/assistant/status";

export interface ResolveAssistantTurnInput {
  message: string;
  history: readonly ConversationMessage[];
  activeIntent: PaymentIntent | null;
  signal?: AbortSignal;
}

/** Intent extraction is deterministic work: no sampling. */
const MODEL_TEMPERATURE = 0;
/** Bounded: one short reply plus one small intent object. */
const MODEL_MAX_TOKENS = 600;

let providerOverride: LlmProvider | null = null;

/**
 * Test seam: replaces the production provider for scoped self-checks. The
 * production path always constructs the env-driven adapter.
 */
export function setAssistantProviderForTesting(
  provider: LlmProvider | null,
): void {
  providerOverride = provider;
}

function chatTurn(
  reply: string,
  activeIntent: PaymentIntent | null,
): AssistantChatResponse {
  const turn: AssistantTurn = {
    kind: "chat",
    message: {
      role: "assistant",
      content: reply,
      timestamp: new Date().toISOString(),
    },
  };
  return { ok: true, turn, activeIntent };
}

/** Maps a provider failure onto the frozen assistant error contract. */
function modelErrorResponse(error: unknown): AssistantChatResponse {
  const code = error instanceof LlmProviderError ? error.code : null;

  if (code === "CONFIGURATION") {
    return {
      ok: false,
      error: {
        code: "ASSISTANT_NOT_CONFIGURED",
        message: "The assistant is not configured on this server.",
        retryable: false,
      },
    };
  }

  if (code === "INVALID_REQUEST") {
    return {
      ok: false,
      error: {
        code: "MODEL_INVALID_OUTPUT",
        message: "The assistant could not accept that request.",
        retryable: false,
      },
    };
  }

  if (code === "AUTHENTICATION") {
    return {
      ok: false,
      error: {
        code: "MODEL_UNAVAILABLE",
        message: "The assistant model is temporarily unavailable.",
        retryable: false,
      },
    };
  }

  // MALFORMED_RESPONSE, RATE_LIMITED, TIMEOUT, UPSTREAM_*, and anything
  // unexpected are transient as far as the caller is concerned.
  return {
    ok: false,
    error: {
      code: "MODEL_UNAVAILABLE",
      message: "The assistant model is temporarily unavailable.",
      retryable: true,
    },
  };
}

export async function resolveAssistantTurn(
  input: ResolveAssistantTurnInput,
): Promise<AssistantChatResponse> {
  const { message, history, signal } = input;

  // The caller-supplied draft is never echoed back or trusted: it is
  // canonicalized and re-derived here (idempotent for an already-sanitized
  // draft), so no client-computed networkConfirmed / missingFields /
  // readyForConfirmation value can cross this boundary.
  const draftResult = sanitizeIncomingIntent(input.activeIntent, history);
  const activeIntent = draftResult.ok ? draftResult.intent : null;

  // 1. Status questions are answered from recorded state alone.
  const statusQuery = detectStatusQuery(message, history);
  if (statusQuery) {
    if (statusQuery.kind === "ask_for_reference") {
      return chatTurn(STATUS_REFERENCE_REQUEST, activeIntent);
    }

    const lookup = await readTransactionStatus(statusQuery.reference);
    if (lookup.ok) {
      return chatTurn(formatStatusAnswer(lookup.data), activeIntent);
    }
    if (lookup.code === "STATUS_UNAVAILABLE") {
      return {
        ok: false,
        error: {
          code: "STATUS_UNAVAILABLE",
          message: lookup.message,
          retryable: true,
        },
      };
    }
    // NOT_FOUND / INVALID_REFERENCE: truthful deterministic answer.
    return chatTurn(lookup.message, activeIntent);
  }

  // 2. Conversational / intent candidate path.
  const provider = providerOverride ?? createDeepSeekProvider();

  let content: string;
  try {
    const completion = await provider.complete({
      messages: buildAssistantPrompt({ history, activeIntent, userMessage: message }),
      temperature: MODEL_TEMPERATURE,
      maxTokens: MODEL_MAX_TOKENS,
      responseFormat: "json_object",
      ...(signal ? { signal } : {}),
    });
    content = completion.content;
  } catch (error) {
    return modelErrorResponse(error);
  }

  const parsed = parseAssistantModelOutput(content);
  if (!parsed.ok) {
    return {
      ok: false,
      error: {
        code: "MODEL_INVALID_OUTPUT",
        message: "The assistant returned a response that failed validation.",
        retryable: true,
      },
    };
  }

  // 3. Deterministic re-validation owns the result.
  const resolved = resolveIntent({
    candidate: parsed.data.intent,
    userMessage: message,
    history,
    activeIntent,
  });

  if (!resolved) {
    return chatTurn(parsed.data.reply, activeIntent);
  }

  const turn: AssistantTurn = {
    kind: "payment_intent",
    message: {
      role: "assistant",
      content: parsed.data.reply,
      timestamp: new Date().toISOString(),
      intent: resolved,
    },
    intent: resolved,
  };

  return { ok: true, turn, activeIntent: resolved };
}
