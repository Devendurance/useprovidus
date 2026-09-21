/**
 * Assistant turn resolver.
 *
 * Order of authority:
 * 1. deterministic status answers (no model call at all);
 * 2. the deterministic confirmation fast-path: an already-ready draft plus an
 *    exact affirmative answer (no model call at all);
 * 3. the configured model, which may only produce a candidate intent;
 * 4. `parseAssistantModelOutput` + `resolveIntent`, which own every accepted
 *    value and recompute all derived fields.
 *
 * Nothing here authorizes, executes, or reconciles a payment: no provider
 * mutation, no wallet call, no transaction write.
 */

import "server-only";

import {
  LlmProviderError,
  buildAssistantPrompt,
  createAssistantProviderChain,
  createDeepSeekProvider,
  createGroqProvider,
  type LlmProvider,
  type ProviderChain,
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

/**
 * The only user messages that can confirm an already-ready draft without the
 * model: exact matches, after normalization, against a closed vocabulary.
 * Anything else falls through to the model, which owns every softer reading.
 *
 * Apostrophes are punctuation and are stripped by normalization, so
 * "yes that's correct" and "yes thats correct" collapse onto one entry.
 */
const AFFIRMATIVE_CONFIRMATIONS: Record<string, true> = {
  yes: true,
  "yes it is": true,
  "yes thats correct": true,
  correct: true,
  confirm: true,
  confirmed: true,
  proceed: true,
  continue: true,
  ok: true,
  okay: true,
};

/**
 * Deterministic fast-path gate: true only when the whole message is a bare
 * affirmative from the closed vocabulary above. Normalization lowercases,
 * removes punctuation and symbols, collapses whitespace, and trims.
 */
export function isAffirmativeConfirmation(message: string): boolean {
  if (typeof message !== "string") return false;
  const normalized = message
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return AFFIRMATIVE_CONFIRMATIONS[normalized] === true;
}

let providerOverride: LlmProvider | null = null;
let chainOverride: ProviderChain | null = null;

/**
 * Test seam: replaces the production provider for scoped self-checks. The
 * production path always constructs the env-driven adapter. When set, the
 * override is the entire chain: no Groq fallback is attempted, so legacy
 * single-provider self-checks keep their exact error mapping.
 */
export function setAssistantProviderForTesting(
  provider: LlmProvider | null,
): void {
  providerOverride = provider;
}

/**
 * Test seam: replaces the full DeepSeek → Groq chain for provider-fallback
 * self-checks. Takes precedence over setAssistantProviderForTesting.
 */
export function setAssistantProviderChainForTesting(
  chain: ProviderChain | null,
): void {
  chainOverride = chain;
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

  // 2. A complete draft answered with an exact affirmative is already decided:
  //    no model call, no reinterpretation, the draft passes through untouched.
  if (
    activeIntent !== null &&
    activeIntent.readyForConfirmation === true &&
    isAffirmativeConfirmation(message)
  ) {
    const timestamp = new Date().toISOString();
    const turn: AssistantTurn = {
      kind: "payment_intent",
      message: {
        role: "assistant",
        content: "Payment details confirmed. You can review the quote and proceed to payment below.",
        timestamp,
        intent: activeIntent,
      },
      intent: activeIntent,
    };
    return { ok: true, turn, activeIntent };
  }

  // 3. Conversational / intent candidate path. DeepSeek is primary; Groq
  // receives at most one attempt and only for eligible provider failures.
  // A legacy single-provider test override bypasses the chain entirely.
  const completionRequest = {
    messages: buildAssistantPrompt({ history, activeIntent, userMessage: message }),
    temperature: MODEL_TEMPERATURE,
    maxTokens: MODEL_MAX_TOKENS,
    responseFormat: "json_object" as const,
    ...(signal ? { signal } : {}),
  };

  let content: string;
  try {
    if (chainOverride) {
      content = (await chainOverride.complete(completionRequest)).response.content;
    } else if (providerOverride) {
      content = (await providerOverride.complete(completionRequest)).content;
    } else {
      content = (
        await createAssistantProviderChain({
          createPrimary: () => createDeepSeekProvider(),
          createFallback: () => createGroqProvider(),
        }).complete(completionRequest)
      ).response.content;
    }
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

  // 4. Deterministic re-validation owns the result.
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
