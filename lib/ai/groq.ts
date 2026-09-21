import "server-only";

import {
  LlmProviderError,
  type LlmCompletionRequest,
  type LlmFinishReason,
  type LlmMessage,
  type LlmProvider,
  type LlmResponse,
  type LlmUsage,
} from "@/lib/ai/types";

export const GROQ_PROVIDER_ID = "groq";
export const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_GROQ_TIMEOUT_MS = 12_000;

const CHAT_COMPLETIONS_PATH = "/chat/completions";
/**
 * Bounded model identifier accepted from configuration. Groq model ids are
 * namespaced (`vendor/model`), so `/` is allowed alongside the DeepSeek set.
 */
const MODEL_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;

/**
 * Transport function shape used by the adapter.
 */
export type GroqFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface GroqConfig {
  /** Server credential. Never log, serialize, or return this to a client. */
  apiKey: string;
  /** Absolute https base URL without trailing slash. */
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

/** Non-secret configuration values that may be supplied by a caller/test. */
export interface GroqConfigOverrides {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export interface GroqProviderOptions extends GroqConfigOverrides {
  /** Test seam for the HTTP call. Production uses the global fetch. */
  fetch?: GroqFetch;
}

export type GroqConfigResult =
  | { ok: true; config: GroqConfig }
  | { ok: false; error: LlmProviderError };


function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function configError(message: string): LlmProviderError {
  return new LlmProviderError(GROQ_PROVIDER_ID, "CONFIGURATION", message, false);
}

function invalidRequest(message: string): LlmProviderError {
  return new LlmProviderError(GROQ_PROVIDER_ID, "INVALID_REQUEST", message, false);
}

function malformedResponse(message: string): LlmProviderError {
  return new LlmProviderError(GROQ_PROVIDER_ID, "MALFORMED_RESPONSE", message, false);
}

/**
 * Builds the chat-completions endpoint.
 * Trims trailing slashes and appends `/chat/completions` exactly once, so a
 * base URL that already names the endpoint is not doubled.
 */
export function buildGroqChatCompletionsUrl(baseUrl: string): string {
  const withoutTrailingSlashes = baseUrl.trim().replace(/\/+$/, "");
  return withoutTrailingSlashes.endsWith(CHAT_COMPLETIONS_PATH)
    ? withoutTrailingSlashes
    : `${withoutTrailingSlashes}${CHAT_COMPLETIONS_PATH}`;
}

/**
 * Accepts only an absolute https base URL without embedded credentials,
 * query string, or fragment. Returns the normalized value or null.
 */
function normalizeGroqBaseUrl(rawBaseUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") {
    return null;
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return null;
  }
  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    return null;
  }
  return rawBaseUrl.replace(/\/+$/, "");
}

/**
 * Reads and validates Groq configuration at call time.
 *
 * Fails closed when GROQ_API_KEY is absent. The returned error never
 * includes the key (or any part of it), and no value from the environment is
 * echoed back into messages.
 */
export function getGroqConfig(overrides?: GroqConfigOverrides): GroqConfigResult {
  const apiKey =
    normalizeOptional(overrides?.apiKey) ?? normalizeOptional(process.env.GROQ_API_KEY);
  if (!apiKey) {
    return {
      ok: false,
      error: configError("GROQ_API_KEY is not configured on the server."),
    };
  }

  const rawBaseUrl =
    normalizeOptional(overrides?.baseUrl) ??
    normalizeOptional(process.env.GROQ_BASE_URL) ??
    DEFAULT_GROQ_BASE_URL;
  const baseUrl = normalizeGroqBaseUrl(rawBaseUrl);
  if (!baseUrl) {
    return {
      ok: false,
      error: configError(
        "GROQ_BASE_URL must be an absolute https URL without credentials, query, or fragment.",
      ),
    };
  }

  const model =
    normalizeOptional(overrides?.model) ??
    normalizeOptional(process.env.GROQ_MODEL) ??
    DEFAULT_GROQ_MODEL;
  if (!MODEL_PATTERN.test(model)) {
    return {
      ok: false,
      error: configError("GROQ_MODEL must be a valid model identifier."),
    };
  }

  const timeoutMs = overrides?.timeoutMs ?? DEFAULT_GROQ_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    return {
      ok: false,
      error: configError("Groq timeout must be a positive integer number of milliseconds."),
    };
  }

  return { ok: true, config: { apiKey, baseUrl, model, timeoutMs } };
}

interface GroqChatRequestBody {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream: false;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
}

function isLlmRole(value: unknown): value is LlmMessage["role"] {
  return value === "system" || value === "user" || value === "assistant";
}

/**
 * Maps an LlmCompletionRequest onto the OpenAI-compatible Groq body.
 * Optional fields are sent only when the caller supplied them.
 */
function buildGroqRequestBody(
  request: LlmCompletionRequest,
  model: string,
): GroqChatRequestBody {
  const rawMessages = request?.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    throw invalidRequest("Groq completion requires at least one message.");
  }

  const messages: Array<{ role: string; content: string }> = [];
  for (const message of rawMessages) {
    if (!message || !isLlmRole(message.role) || typeof message.content !== "string") {
      throw invalidRequest("Groq completion received a malformed message.");
    }
    messages.push({ role: message.role, content: message.content });
  }

  const body: GroqChatRequestBody = { model, messages, stream: false };

  if (request.temperature !== undefined) {
    if (typeof request.temperature !== "number" || !Number.isFinite(request.temperature)) {
      throw invalidRequest("Groq temperature must be a finite number when supplied.");
    }
    body.temperature = request.temperature;
  }

  if (request.maxTokens !== undefined) {
    if (!Number.isInteger(request.maxTokens) || request.maxTokens <= 0) {
      throw invalidRequest("Groq maxTokens must be a positive integer when supplied.");
    }
    body.max_tokens = request.maxTokens;
  }

  if (request.responseFormat !== undefined) {
    if (request.responseFormat !== "text" && request.responseFormat !== "json_object") {
      throw invalidRequest('Groq responseFormat must be "text" or "json_object".');
    }
    if (request.responseFormat === "json_object") {
      body.response_format = { type: "json_object" };
    }
  }

  return body;
}

/**
 * Reads the JSON envelope. A body that is not valid JSON is classified as a
 * malformed response; the raw body is never retained or echoed.
 */
async function readJsonEnvelope(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw malformedResponse("Groq returned a response that was not valid JSON.");
  }
}

/** Releases an unconsumed response body without reading it into memory. */
async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body may already be consumed or locked; nothing safe remains to release.
  }
}

function normalizeFinishReason(value: unknown): LlmFinishReason {
  switch (value) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "content_filter":
      return "content_filter";
    case "tool_calls":
      return "tool_calls";
    default:
      return "unknown";
  }
}

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Keeps usage only when the envelope reported a complete, usable triple. */
function normalizeUsage(value: unknown): LlmUsage | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const promptTokens = "prompt_tokens" in value ? value.prompt_tokens : undefined;
  const completionTokens = "completion_tokens" in value ? value.completion_tokens : undefined;
  const totalTokens = "total_tokens" in value ? value.total_tokens : undefined;
  if (!isTokenCount(promptTokens) || !isTokenCount(completionTokens) || !isTokenCount(totalTokens)) {
    return undefined;
  }
  return { promptTokens, completionTokens, totalTokens };
}

/**
 * Validates the Groq envelope and normalizes it into LlmResponse.
 * Missing or unusable `choices[0].message.content` is MALFORMED_RESPONSE.
 */
function normalizeGroqResponse(payload: unknown, fallbackModel: string): LlmResponse {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw malformedResponse("Groq returned a response envelope that was not an object.");
  }

  const choices = "choices" in payload ? payload.choices : undefined;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw malformedResponse("Groq response did not include any completion choices.");
  }

  const choice: unknown = choices[0];
  if (typeof choice !== "object" || choice === null) {
    throw malformedResponse("Groq returned a malformed completion choice.");
  }

  const message = "message" in choice ? choice.message : undefined;
  if (typeof message !== "object" || message === null || !("content" in message)) {
    throw malformedResponse("Groq response did not include usable message content.");
  }

  const content = message.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw malformedResponse("Groq response did not include usable message content.");
  }

  const requestId =
    "id" in payload && typeof payload.id === "string" && payload.id.trim().length > 0
      ? payload.id
      : null;
  const model =
    "model" in payload && typeof payload.model === "string" && payload.model.trim().length > 0
      ? payload.model
      : fallbackModel;
  const finishReason = "finish_reason" in choice ? choice.finish_reason : undefined;
  const usage = "usage" in payload ? payload.usage : undefined;

  return {
    provider: GROQ_PROVIDER_ID,
    model,
    requestId,
    content,
    finishReason: normalizeFinishReason(finishReason),
    usage: normalizeUsage(usage),
  };
}

/** Maps a non-OK HTTP status onto the frozen LlmErrorCode contract. */
function mapHttpStatusError(status: number): LlmProviderError {
  if (status === 401 || status === 403) {
    return new LlmProviderError(
      GROQ_PROVIDER_ID,
      "AUTHENTICATION",
      `Groq rejected the server credentials (HTTP ${status}).`,
      false,
      status,
    );
  }
  if (status === 429) {
    return new LlmProviderError(
      GROQ_PROVIDER_ID,
      "RATE_LIMITED",
      "Groq rate limit reached (HTTP 429).",
      true,
      status,
    );
  }
  if (status === 408) {
    return new LlmProviderError(
      GROQ_PROVIDER_ID,
      "TIMEOUT",
      "Groq reported a request timeout (HTTP 408).",
      true,
      status,
    );
  }
  if (status === 402) {
    // Provider-side unavailability (for example insufficient provider
    // balance): never the user's fault, and eligible for the caller to treat
    // as an upstream outage. Billing detail is deliberately not exposed.
    return new LlmProviderError(
      GROQ_PROVIDER_ID,
      "UPSTREAM_UNAVAILABLE",
      "Groq is unavailable (HTTP 402).",
      true,
      status,
    );
  }
  if (status >= 500) {
    return new LlmProviderError(
      GROQ_PROVIDER_ID,
      "UPSTREAM_UNAVAILABLE",
      `Groq is unavailable (HTTP ${status}).`,
      true,
      status,
    );
  }
  if (status >= 400) {
    return new LlmProviderError(
      GROQ_PROVIDER_ID,
      "INVALID_REQUEST",
      `Groq rejected the request (HTTP ${status}).`,
      false,
      status,
    );
  }
  return new LlmProviderError(
    GROQ_PROVIDER_ID,
    "UPSTREAM_ERROR",
    `Groq returned an unexpected HTTP status (${status}).`,
    false,
    status,
  );
}

/**
 * Classifies a thrown transport failure. Aborts (our timer or the caller's
 * signal) are TIMEOUT; anything else is a retryable upstream-unavailable
 * failure. The original error is not attached, to avoid leaking internals.
 */
function classifyTransportFailure(
  error: unknown,
  timedOut: boolean,
  timeoutMs: number,
): LlmProviderError {
  const aborted =
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "AbortError" || error.name === "TimeoutError");

  if (aborted) {
    return new LlmProviderError(
      GROQ_PROVIDER_ID,
      "TIMEOUT",
      timedOut
        ? `Groq request exceeded the ${timeoutMs}ms time limit.`
        : "Groq request was aborted before completion.",
      true,
    );
  }
  return new LlmProviderError(
    GROQ_PROVIDER_ID,
    "UPSTREAM_UNAVAILABLE",
    "Could not reach Groq.",
    true,
  );
}

/**
 * Emits the one permitted server diagnostic for an instrumented Groq
 * failure: a non-OK HTTP response or a classified transport failure. Failures
 * outside that scope — configuration, request validation, and malformed
 * response envelopes — stay silent.
 *
 * The payload is a closed, non-sensitive record: the configured (validated)
 * model identifier, the HTTP status or `null` for a transport failure, the
 * elapsed attempt duration, and the frozen LlmErrorCode. The API key,
 * authorization header, prompt messages, phone numbers, and response bodies
 * are never part of it.
 */
function emitGroqFailureDiagnostic(
  model: string,
  status: number | null,
  startedAt: number,
  error: LlmProviderError,
): void {
  console.error(
    JSON.stringify({
      tag: "groq_failure",
      model,
      status,
      durationMs: Math.max(0, Date.now() - startedAt),
      code: error.code,
    }),
  );
}

/**
 * Creates the Groq-backed LlmProvider.
 *
 * Same normalized LlmResponse shape and same request contract as the DeepSeek
 * adapter; Groq carries no new schema fields and no new authority. Everything
 * it returns still passes through parseAssistantModelOutput + resolveIntent.
 *
 * Environment is read inside `complete`, so a provider instance created before
 * configuration changes still fails closed (or succeeds) based on the current
 * process environment. No automatic retry is performed.
 */
export function createGroqProvider(options?: GroqProviderOptions): LlmProvider {
  return {
    id: GROQ_PROVIDER_ID,
    async complete(request: LlmCompletionRequest): Promise<LlmResponse> {
      const configRes = getGroqConfig(options);
      if (!configRes.ok) {
        throw configRes.error;
      }
      const config = configRes.config;

      const body = buildGroqRequestBody(request, config.model);
      const url = buildGroqChatCompletionsUrl(config.baseUrl);
      const fetchImpl = options?.fetch ?? fetch;

      const controller = new AbortController();
      const callerSignal = request.signal;
      const forwardAbort = () => controller.abort();
      let timedOut = false;

      if (callerSignal) {
        if (callerSignal.aborted) {
          controller.abort();
        } else {
          callerSignal.addEventListener("abort", forwardAbort, { once: true });
        }
      }

      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, config.timeoutMs);

      const startedAt = Date.now();

      /**
       * Emits the safe failure diagnostic and rethrows the classified error, so
       * every failing attempt is observable without duplicating the emit call.
       */
      const failRequest = (error: LlmProviderError, status: number | null): never => {
        emitGroqFailureDiagnostic(config.model, status, startedAt, error);
        throw error;
      };

      try {
        let response: Response;
        try {
          response = await fetchImpl(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } catch (error) {
          throw failRequest(
            classifyTransportFailure(error, timedOut, config.timeoutMs),
            null,
          );
        }

        if (!response.ok) {
          const status = response.status;
          await discardResponseBody(response);
          throw failRequest(mapHttpStatusError(status), status);
        }

        let payload: unknown;
        try {
          payload = await readJsonEnvelope(response);
        } catch (error) {
          if (error instanceof LlmProviderError) {
            throw error;
          }
          throw failRequest(
            classifyTransportFailure(error, timedOut, config.timeoutMs),
            null,
          );
        }

        return normalizeGroqResponse(payload, config.model);
      } finally {
        clearTimeout(timeoutId);
        if (callerSignal) {
          callerSignal.removeEventListener("abort", forwardAbort);
        }
      }
    },
  };
}
