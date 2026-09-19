/**
 * LLM provider boundary contracts for the Providus conversational assistant.
 *
 * These types are provider-independent: the DeepSeek adapter, the assistant
 * resolve/route layer, and any future provider share only this module.
 *
 * Server-only by construction. Nothing in lib/ai may be imported from client
 * components, hooks, or any other browser-facing module.
 *
 * Error discipline: `LlmError` never carries raw provider bodies, prompts,
 * headers, API keys, or an unbounded `cause`. Only a bounded classification
 * and safe diagnostic identifiers (provider request id, HTTP status) cross
 * this boundary.
 */

import "server-only";

export type LlmRole = "system" | "user" | "assistant";

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export type LlmResponseFormat = "text" | "json_object";

export interface LlmCompletionRequest {
  messages: readonly LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: LlmResponseFormat;
  signal?: AbortSignal;
}

export type LlmFinishReason =
  | "stop"
  | "length"
  | "content_filter"
  | "tool_calls"
  | "unknown";

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmResponse {
  provider: string;
  model: string;
  requestId: string | null;
  content: string;
  finishReason: LlmFinishReason;
  usage?: LlmUsage;
}

export type LlmErrorCode =
  | "CONFIGURATION"
  | "AUTHENTICATION"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_ERROR"
  | "MALFORMED_RESPONSE"
  | "INVALID_REQUEST";

export interface LlmError {
  name: "LlmError";
  provider: string;
  code: LlmErrorCode;
  message: string;
  retryable: boolean;
  httpStatus?: number;
  requestId?: string;
}

export class LlmProviderError extends Error implements LlmError {
  readonly name = "LlmError" as const;
  constructor(
    readonly provider: string,
    readonly code: LlmErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly httpStatus?: number,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

export interface LlmProvider {
  readonly id: string;
  complete(request: LlmCompletionRequest): Promise<LlmResponse>;
}
