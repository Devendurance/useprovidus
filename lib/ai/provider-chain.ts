/**
 * Server-only DeepSeek → Groq provider chain for the Providus assistant.
 *
 * DeepSeek remains PRIMARY. Groq receives exactly one attempt, and only when
 * the DeepSeek failure is an eligible provider failure (outage-like, never a
 * request/validation or business-rule failure).
 *
 * Eligible DeepSeek failure codes (all LlmProviderError codes):
 * - UPSTREAM_UNAVAILABLE (covers HTTP 402 provider unavailability, transport
 *   failures, and HTTP 5xx)
 * - RATE_LIMITED (HTTP 429)
 * - TIMEOUT (HTTP 408, adapter timeouts, caller aborts of the model call)
 * - MALFORMED_RESPONSE (provider returned an unusable envelope)
 *
 * Never eligible:
 * - CONFIGURATION (our own missing/bad server config)
 * - AUTHENTICATION (our own bad credentials)
 * - INVALID_REQUEST (our own malformed request or a provider-side request
 *   rejection; falling back cannot fix it)
 * - UPSTREAM_ERROR (unexpected upstream status; not in the §2 eligible set)
 * - non-LlmProviderError throws (programming errors, validation bugs; these
 *   must surface, not trigger a second provider)
 *
 * Attempt budget: maximum 1 DeepSeek attempt + maximum 1 Groq attempt, zero
 * retry loops. The chain performs no parsing and no payment validation; the
 * caller still owns parseAssistantModelOutput + resolveIntent for whichever
 * completion wins.
 *
 * Diagnostics are closed, secret-free records only: the fallback transition
 * (from/to/reasonCode) plus whatever each adapter already emits for its own
 * attempt. No prompts, user text, phone numbers, wallet addresses, keys, or
 * provider bodies are ever logged here.
 */

import "server-only";

import { LlmProviderError, type LlmCompletionRequest, type LlmProvider, type LlmResponse } from "@/lib/ai/types";

export const PRIMARY_PROVIDER_ID = "deepseek";
export const FALLBACK_PROVIDER_ID = "groq";

/** DeepSeek LlmError codes that may trigger the single Groq attempt. */
const ELIGIBLE_FALLBACK_CODES: Record<string, true> = {
  UPSTREAM_UNAVAILABLE: true,
  RATE_LIMITED: true,
  TIMEOUT: true,
  MALFORMED_RESPONSE: true,
};

/**
 * Returns true only for provider-side failures where a different provider
 * could plausibly succeed. Request/validation failures (INVALID_REQUEST),
 * server misconfiguration (CONFIGURATION, AUTHENTICATION), and unknown
 * non-provider throws never qualify.
 */
export function isEligibleForGroqFallback(error: unknown): boolean {
  if (!(error instanceof LlmProviderError)) {
    return false;
  }
  if (error.provider !== PRIMARY_PROVIDER_ID) {
    return false;
  }
  return ELIGIBLE_FALLBACK_CODES[error.code] === true;
}

export interface ProviderChainResult {
  /** The winning completion (primary or fallback). */
  response: LlmResponse;
  /** True when the completion came from the Groq fallback attempt. */
  usedFallback: boolean;
  /** The DeepSeek failure that triggered the fallback, when usedFallback. */
  primaryError?: LlmProviderError;
}

function emitFallbackDiagnostic(reasonCode: string): void {
  console.error(
    JSON.stringify({
      tag: "assistant_provider_fallback",
      from: PRIMARY_PROVIDER_ID,
      to: FALLBACK_PROVIDER_ID,
      reasonCode,
    }),
  );
}

export interface ProviderChain {
  /** Single attempt against DeepSeek, then at most one Groq attempt. */
  complete(request: LlmCompletionRequest): Promise<ProviderChainResult>;
}

/**
 * Creates the frozen two-step chain: DeepSeek first, Groq at most once and
 * only for eligible provider failures. `createFallback` is invoked lazily so
 * Groq is never constructed (and never emits config diagnostics) unless the
 * DeepSeek failure qualifies.
 */
export function createAssistantProviderChain(options: {
  createPrimary: () => LlmProvider;
  createFallback: () => LlmProvider;
}): ProviderChain {
  return {
    async complete(request: LlmCompletionRequest): Promise<ProviderChainResult> {
      const primary = options.createPrimary();
      try {
        const response = await primary.complete(request);
        return { response, usedFallback: false };
      } catch (error) {
        if (!isEligibleForGroqFallback(error)) {
          throw error;
        }
        const primaryError = error as LlmProviderError;
        emitFallbackDiagnostic(primaryError.code);
        const fallback = options.createFallback();
        const response = await fallback.complete(request);
        return { response, usedFallback: true, primaryError };
      }
    },
  };
}
