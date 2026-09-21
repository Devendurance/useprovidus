/**
 * Self-check for the DeepSeek → Groq assistant provider chain (P7A.1).
 *
 * Proves, with stubs/fakes only and no live provider traffic:
 *  1. DeepSeek success → Groq created 0 times, called 0 times
 *  2. DeepSeek 402 (UPSTREAM_UNAVAILABLE) → Groq called once
 *  3. DeepSeek 429 (RATE_LIMITED) → Groq called once
 *  4. DeepSeek timeout → Groq called once
 *  5. DeepSeek 5xx (UPSTREAM_UNAVAILABLE) → Groq called once
 *  6. DeepSeek transport failure → Groq called once
 *  7. DeepSeek malformed response → fallback only when the policy says eligible
 *  8. Groq success returns the same assistant contract (chat + PaymentIntent)
 *  9. DeepSeek failure + Groq failure → MODEL_UNAVAILABLE
 * 10. No fallback for INVALID_REQUEST caused by our own request validation
 * 11. Deterministic confirmation → zero DeepSeek/Groq calls
 * 12. Deterministic status query → zero DeepSeek/Groq calls
 * 13. Diagnostics contain no secrets/PII
 * 14. Payment behavior untouched (no payment modules imported here; static check)
 *
 * Run: npx tsx --conditions=react-server lib/assistant/provider-chain-self-check.ts
 */

import "server-only";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LlmProviderError,
  createAssistantProviderChain,
  isEligibleForGroqFallback,
  type LlmCompletionRequest,
  type LlmProvider,
  type LlmResponse,
} from "@/lib/ai";
import {
  resolveAssistantTurn,
  setAssistantProviderChainForTesting,
  setAssistantProviderForTesting,
} from "@/lib/assistant/resolve";
import type { AirtimeIntent, ConversationMessage } from "@/lib/assistant/types";
import {
  InMemoryTransactionRepository,
  setTransactionRepositoryForTesting,
} from "@/lib/transactions";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const PHONE = "08031234567";
const TIMESTAMP = "2026-09-19T00:00:00.000Z";
const SECRET_MARKER = "sk-test-chain-secret-must-never-leak";
const CHAT_CONTENT = '{"mode":"chat","reply":"Hi there!","intent":null}';

function llmResponse(content: string, provider = "deepseek"): LlmResponse {
  return {
    provider,
    model: provider === "groq" ? "openai/gpt-oss-120b" : "deepseek-chat",
    requestId: null,
    content,
    finishReason: "stop",
  };
}

function deepseekError(code: string): LlmProviderError {
  const retryable = code !== "INVALID_REQUEST" && code !== "CONFIGURATION" && code !== "AUTHENTICATION";
  return new LlmProviderError("deepseek", code as LlmProviderError["code"], `deepseek ${code}`, retryable);
}

class CountingProvider implements LlmProvider {
  readonly requests: LlmCompletionRequest[] = [];
  constructor(
    readonly id: string,
    private readonly behavior: (request: LlmCompletionRequest) => LlmResponse | Promise<LlmResponse>,
  ) {}
  async complete(request: LlmCompletionRequest): Promise<LlmResponse> {
    this.requests.push(request);
    return this.behavior(request);
  }
}

function failingProvider(id: string, error: unknown): CountingProvider {
  return new CountingProvider(id, () => {
    throw error;
  });
}

function history(): ConversationMessage[] {
  return [{ role: "user", content: "hi", timestamp: TIMESTAMP }];
}

async function run() {
  console.log("Starting assistant provider-chain self-check...");

  const repository = new InMemoryTransactionRepository();
  setTransactionRepositoryForTesting(repository);
  const captured: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    captured.push(args.map((arg) => (typeof arg === "string" ? arg : String(arg))).join(" "));
  };

  try {
    /* 1. DeepSeek success → Groq untouched */
    {
      const primary = new CountingProvider("deepseek", () => llmResponse(CHAT_CONTENT));
      let fallbackConstructions = 0;
      const chain = createAssistantProviderChain({
        createPrimary: () => primary,
        createFallback: () => {
          fallbackConstructions += 1;
          return new CountingProvider("groq", () => llmResponse(CHAT_CONTENT, "groq"));
        },
      });
      const result = await chain.complete({ messages: [{ role: "user", content: "hi" }] });
      assert.equal(result.usedFallback, false);
      assert.equal(result.response.provider, "deepseek");
      assert.equal(primary.requests.length, 1);
      assert.equal(fallbackConstructions, 0, "Groq must not be constructed on primary success");
    }

    /* 2-6. Eligible DeepSeek failures → exactly one Groq attempt */
    const eligibleCases: Array<{ label: string; error: LlmProviderError }> = [
      { label: "402 provider unavailability", error: new LlmProviderError("deepseek", "UPSTREAM_UNAVAILABLE", "DeepSeek is unavailable (HTTP 402).", true, 402) },
      { label: "429 rate limited", error: deepseekError("RATE_LIMITED") },
      { label: "timeout", error: deepseekError("TIMEOUT") },
      { label: "5xx upstream", error: deepseekError("UPSTREAM_UNAVAILABLE") },
      { label: "transport upstream", error: deepseekError("UPSTREAM_UNAVAILABLE") },
    ];
    for (const eligible of eligibleCases) {
      assert.equal(isEligibleForGroqFallback(eligible.error), true, eligible.label);
      const primary = failingProvider("deepseek", eligible.error);
      const fallback = new CountingProvider("groq", () => llmResponse(CHAT_CONTENT, "groq"));
      const chain = createAssistantProviderChain({
        createPrimary: () => primary,
        createFallback: () => fallback,
      });
      const baseline = captured.length;
      const result = await chain.complete({ messages: [{ role: "user", content: "hi" }] });
      assert.equal(result.usedFallback, true, eligible.label);
      assert.equal(result.response.provider, "groq");
      assert.equal(primary.requests.length, 1, `${eligible.label}: one DeepSeek attempt`);
      assert.equal(fallback.requests.length, 1, `${eligible.label}: one Groq attempt`);
      const fallbackLines = captured.slice(baseline);
      assert.equal(fallbackLines.length, 1, `${eligible.label}: one fallback diagnostic`);
      const record = JSON.parse(fallbackLines[0]) as Record<string, unknown>;
      assert.deepEqual(Object.keys(record).sort(), ["from", "reasonCode", "tag", "to"]);
      assert.equal(record.tag, "assistant_provider_fallback");
      assert.equal(record.from, "deepseek");
      assert.equal(record.to, "groq");
    }

    /* 7. Malformed provider response is eligible per policy; unknown throws are not */
    {
      assert.equal(isEligibleForGroqFallback(deepseekError("MALFORMED_RESPONSE")), true);
      assert.equal(isEligibleForGroqFallback(deepseekError("UPSTREAM_ERROR")), false);
      assert.equal(isEligibleForGroqFallback(deepseekError("INVALID_REQUEST")), false);
      assert.equal(isEligibleForGroqFallback(deepseekError("CONFIGURATION")), false);
      assert.equal(isEligibleForGroqFallback(deepseekError("AUTHENTICATION")), false);
      assert.equal(isEligibleForGroqFallback(new Error("boom")), false);
      assert.equal(
        isEligibleForGroqFallback(new LlmProviderError("groq", "UPSTREAM_UNAVAILABLE", "x", true)),
        false,
        "Only DeepSeek errors trigger the fallback",
      );
      // A Groq-side INVALID_REQUEST still surfaces through the normal error contract.
      const chain = createAssistantProviderChain({
        createPrimary: () => failingProvider("deepseek", deepseekError("TIMEOUT")),
        createFallback: () =>
          failingProvider("groq", new LlmProviderError("groq", "INVALID_REQUEST", "bad", false)),
      });
      setAssistantProviderChainForTesting(chain);
      const invalidFallback = await resolveAssistantTurn({ message: "hi", history: history(), activeIntent: null });
      assert.equal(invalidFallback.ok, false);
      if (!invalidFallback.ok) {
        assert.equal(invalidFallback.error.code, "MODEL_INVALID_OUTPUT");
      }
      setAssistantProviderChainForTesting(null);
    }

    /* 8. Groq success returns the same assistant contract */
    {
      const airtimeContent = JSON.stringify({
        mode: "payment_intent",
        reply: "Got it — here is what I have.",
        intent: { type: "airtime", amountNgn: "500", phone: PHONE, network: "mtn" },
      });
      for (const content of [CHAT_CONTENT, airtimeContent]) {
        const chain = createAssistantProviderChain({
          createPrimary: () => failingProvider("deepseek", deepseekError("TIMEOUT")),
          createFallback: () => new CountingProvider("groq", () => llmResponse(content, "groq")),
        });
        setAssistantProviderChainForTesting(chain);
        const turn = await resolveAssistantTurn({ message: "hello", history: history(), activeIntent: null });
        assert.equal(turn.ok, true);
        if (turn.ok) {
          if (content === CHAT_CONTENT) {
            assert.equal(turn.turn.kind, "chat");
          } else {
            assert.equal(turn.turn.kind, "payment_intent");
          }
        }
      }
      setAssistantProviderChainForTesting(null);
    }

    /* 9. Both providers fail → MODEL_UNAVAILABLE */
    {
      const chain = createAssistantProviderChain({
        createPrimary: () => failingProvider("deepseek", deepseekError("UPSTREAM_UNAVAILABLE")),
        createFallback: () =>
          failingProvider("groq", new LlmProviderError("groq", "UPSTREAM_UNAVAILABLE", "down", true)),
      });
      setAssistantProviderChainForTesting(chain);
      const bothDown = await resolveAssistantTurn({ message: "hi", history: history(), activeIntent: null });
      assert.equal(bothDown.ok, false);
      if (!bothDown.ok) {
        assert.equal(bothDown.error.code, "MODEL_UNAVAILABLE");
        assert.equal(bothDown.error.message, "The assistant model is temporarily unavailable.");
      }
      setAssistantProviderChainForTesting(null);
    }

    /* 10. No fallback for INVALID_REQUEST from our own request validation */
    {
      const primary = failingProvider("deepseek", deepseekError("INVALID_REQUEST"));
      let fallbackConstructions = 0;
      const chain = createAssistantProviderChain({
        createPrimary: () => primary,
        createFallback: () => {
          fallbackConstructions += 1;
          return new CountingProvider("groq", () => llmResponse(CHAT_CONTENT, "groq"));
        },
      });
      let thrown: unknown = null;
      try {
        await chain.complete({ messages: [{ role: "user", content: "hi" }] });
      } catch (error) {
        thrown = error;
      }
      assert.ok(thrown instanceof LlmProviderError);
      assert.equal(primary.requests.length, 1);
      assert.equal(fallbackConstructions, 0, "INVALID_REQUEST must never reach Groq");

      setAssistantProviderChainForTesting(chain);
      const invalid = await resolveAssistantTurn({ message: "hi", history: history(), activeIntent: null });
      assert.equal(invalid.ok, false);
      if (!invalid.ok) {
        assert.equal(invalid.error.code, "MODEL_INVALID_OUTPUT");
        assert.equal(invalid.error.message, "The assistant could not accept that request.");
      }
      setAssistantProviderChainForTesting(null);
    }

    /* 11. Deterministic confirmation → zero model calls */
    {
      const primary = new CountingProvider("deepseek", () => {
        throw new Error("DeepSeek must not be called for a confirmed draft");
      });
      const fallback = new CountingProvider("groq", () => {
        throw new Error("Groq must not be called for a confirmed draft");
      });
      const readyDraft: AirtimeIntent = {
        type: "airtime",
        amountNgn: "500",
        phone: PHONE,
        network: "mtn",
        networkConfirmed: true,
        missingFields: [],
        readyForConfirmation: true,
      };
      setAssistantProviderChainForTesting(
        createAssistantProviderChain({ createPrimary: () => primary, createFallback: () => fallback }),
      );
      const confirmed = await resolveAssistantTurn({
        message: "yes",
        history: [
          { role: "user", content: `send 500 mtn airtime to ${PHONE}`, timestamp: TIMESTAMP },
          { role: "assistant", content: "That looks like MTN. Is MTN correct?", timestamp: TIMESTAMP },
        ],
        activeIntent: readyDraft,
      });
      assert.equal(confirmed.ok, true);
      assert.equal(primary.requests.length, 0);
      assert.equal(fallback.requests.length, 0);
      setAssistantProviderChainForTesting(null);
    }

    /* 12. Deterministic status query → zero model calls */
    {
      const primary = new CountingProvider("deepseek", () => {
        throw new Error("DeepSeek must not be called for a status query");
      });
      const fallback = new CountingProvider("groq", () => {
        throw new Error("Groq must not be called for a status query");
      });
      setAssistantProviderChainForTesting(
        createAssistantProviderChain({ createPrimary: () => primary, createFallback: () => fallback }),
      );
      const status = await resolveAssistantTurn({
        message: "what is the status of my last payment?",
        history: history(),
        activeIntent: null,
      });
      assert.equal(status.ok, true);
      assert.equal(primary.requests.length, 0);
      assert.equal(fallback.requests.length, 0);
      setAssistantProviderChainForTesting(null);
    }

    /* 13. Diagnostics contain no secrets/PII */
    {
      const diagnosticsText = captured.join("\n");
      for (const forbidden of [SECRET_MARKER, "Bearer", "Authorization", PHONE, "0x", "hi there"]) {
        assert.equal(diagnosticsText.includes(forbidden), false, `Diagnostics must not contain ${forbidden}`);
      }
      for (const line of captured) {
        const record = JSON.parse(line) as Record<string, unknown>;
        assert.deepEqual(Object.keys(record).sort(), ["from", "reasonCode", "tag", "to"]);
      }
    }

    /* 14. Payment behavior untouched: this module and the chain import no payment code */
    {
      const chainSource = readFileSync(path.join(REPO_ROOT, "lib", "ai", "provider-chain.ts"), "utf8");
      const groqSource = readFileSync(path.join(REPO_ROOT, "lib", "ai", "groq.ts"), "utf8");
      for (const source of [chainSource, groqSource]) {
        for (const forbidden of ["paycrest", "clubkonnect", "celo", "PaymentIntent", "preview", "order"]) {
          assert.equal(
            source.toLowerCase().includes(forbidden),
            false,
            `Provider layer must not touch payment code (${forbidden})`,
          );
        }
      }
    }

    console.log("Assistant provider-chain self-check: ALL ASSERTIONS PASSED!");
  } finally {
    console.error = originalError;
    setAssistantProviderChainForTesting(null);
    setAssistantProviderForTesting(null);
    setTransactionRepositoryForTesting(null);
  }
}

run().catch((err) => {
  console.error("Assistant provider-chain self-check failed:", err);
  process.exit(1);
});
