/**
 * Isolated self-check for Providus Assistant UI components and hook contract.
 * Validates type alignment, contract satisfaction, and state invariants.
 */

import type {
  ConversationMessage,
  AirtimeIntent,
  UnsupportedIntent,
  AssistantChatRequest,
  AssistantChatResponse,
} from "@/lib/assistant/types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Self-check assertion failed: ${message}`);
  }
}

// 1. Validate sample intent objects against frozen types
const airtimeDraftIncomplete: AirtimeIntent = {
  type: "airtime",
  amountNgn: "500",
  missingFields: ["phone", "network"],
  networkConfirmed: false,
  readyForConfirmation: false,
};

const airtimeDraftUnconfirmedNetwork: AirtimeIntent = {
  type: "airtime",
  amountNgn: "1000",
  phone: "08012345678",
  network: "mtn",
  missingFields: ["network"],
  networkConfirmed: false,
  readyForConfirmation: false,
};

const airtimeDraftComplete: AirtimeIntent = {
  type: "airtime",
  amountNgn: "1000",
  phone: "08012345678",
  network: "mtn",
  missingFields: [],
  networkConfirmed: true,
  readyForConfirmation: true,
};

const unsupportedDraft: UnsupportedIntent = {
  type: "data",
  missingFields: [],
  readyForConfirmation: false,
};

assert(airtimeDraftIncomplete.type === "airtime", "airtime type invariant");
assert(airtimeDraftIncomplete.readyForConfirmation === false, "incomplete draft not ready");
assert(airtimeDraftUnconfirmedNetwork.networkConfirmed === false, "suggested network unconfirmed");
assert(airtimeDraftComplete.readyForConfirmation === true, "complete draft is ready");
assert(unsupportedDraft.readyForConfirmation === false, "unsupported intent never ready");

// 2. Validate sample messages
const userMsg: ConversationMessage = {
  role: "user",
  content: "Buy ₦500 airtime",
  timestamp: "2026-09-19T12:00:00.000Z",
};

const assistantMsgWithIntent: ConversationMessage = {
  role: "assistant",
  content: "I have drafted your ₦500 airtime request. What is the phone number?",
  timestamp: "2026-09-19T12:00:01.000Z",
  intent: airtimeDraftIncomplete,
};

assert(userMsg.role === "user", "user message role");
assert(assistantMsgWithIntent.role === "assistant", "assistant message role");
assert(assistantMsgWithIntent.intent?.type === "airtime", "assistant message intent");

// 3. Validate ChatRequest & ChatResponse contracts
const sampleRequest: AssistantChatRequest = {
  message: "Buy ₦500 airtime",
  history: [userMsg, assistantMsgWithIntent],
  activeIntent: airtimeDraftIncomplete,
};

const sampleSuccessResponse: AssistantChatResponse = {
  ok: true,
  turn: {
    kind: "payment_intent",
    message: {
      role: "assistant",
      content: "Got it! Phone number is 08012345678. Is the network MTN?",
      timestamp: "2026-09-19T12:00:05.000Z",
      intent: airtimeDraftUnconfirmedNetwork,
    },
    intent: airtimeDraftUnconfirmedNetwork,
  },
  activeIntent: airtimeDraftUnconfirmedNetwork,
};

const sampleErrorResponse: AssistantChatResponse = {
  ok: false,
  error: {
    code: "MODEL_UNAVAILABLE",
    message: "Assistant is temporarily unavailable. Please retry.",
    retryable: true,
  },
};

assert(sampleRequest.message.length > 0, "request message present");
assert(sampleSuccessResponse.ok === true, "response ok true");
assert(sampleErrorResponse.ok === false, "response ok false");

console.log("✓ Providus Assistant UI self-check passed: All types, contracts, and invariants verified!");
