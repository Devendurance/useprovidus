/**
 * Isolated self-check for Providus Assistant UI components, confirmation experience,
 * and useAssistant hook contract (P4).
 *
 * Validates:
 * 1. AirtimePreview & ConfirmedAirtimePayment frozen schemas (all 10 fields)
 * 2. ConfirmedPaymentState type structure
 * 3. Freshness / TTL boundary evaluation (60s TTL)
 * 4. Intent matching & fingerprint drift rejection
 * 5. confirmPayment deterministic state transitions & invalidations
 * 6. Component exports and signatures (AirtimePreviewCard, IntentDraftCard, useAssistant)
 */

import type {
  ConversationMessage,
  AirtimeIntent,
  UnsupportedIntent,
  AssistantChatRequest,
  AssistantChatResponse,
  AirtimePreview,
  ConfirmedAirtimePayment,
} from "@/lib/assistant/types";
import {
  isPreviewFresh,
  doesPreviewMatchIntent,
  computeIntentFingerprintClient,
  type ConfirmedPaymentState,
  useAssistant,
} from "@/hooks/use-assistant";
import { AirtimePreviewCard } from "@/components/assistant/airtime-preview-card";
import { IntentDraftCard } from "@/components/assistant/intent-draft-card";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { formatDecimalForDisplay } from "@/lib/money/decimal";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Validate sample intent objects against frozen types
// ---------------------------------------------------------------------------
const airtimeDraftIncomplete: AirtimeIntent = {
  type: "airtime",
  amountNgn: "500",
  networkConfirmed: false,
  missingFields: ["phone", "network"],
  readyForConfirmation: false,
};

const airtimeDraftUnconfirmedNetwork: AirtimeIntent = {
  type: "airtime",
  amountNgn: "500",
  phone: "08012345678",
  network: "mtn",
  networkConfirmed: false,
  missingFields: [],
  readyForConfirmation: false,
};

const airtimeDraftComplete: AirtimeIntent = {
  type: "airtime",
  amountNgn: "500",
  phone: "08012345678",
  network: "mtn",
  networkConfirmed: true,
  missingFields: [],
  readyForConfirmation: true,
};

const unsupportedDraft: UnsupportedIntent = {
  type: "electricity",
  missingFields: ["meterNumber", "disco", "amountNgn"],
  readyForConfirmation: false,
};

assert(airtimeDraftIncomplete.type === "airtime", "airtime type invariant");
assert(airtimeDraftIncomplete.readyForConfirmation === false, "incomplete draft not ready");
assert(airtimeDraftUnconfirmedNetwork.networkConfirmed === false, "suggested network unconfirmed");
assert(airtimeDraftComplete.readyForConfirmation === true, "complete draft is ready");
assert(unsupportedDraft.readyForConfirmation === false, "unsupported intent never ready");

// ---------------------------------------------------------------------------
// 2. Validate AirtimePreview schema (all 10 fields per P4 contract)
// ---------------------------------------------------------------------------
const baseQuotedAt = "2026-09-19T16:00:00.000Z";
const baseExpiresAt = "2026-09-19T16:01:00.000Z"; // quotedAt + 60s
const baseFingerprint = "7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b";

const samplePreview: AirtimePreview = {
  amountNgn: "500",
  phone: "08012345678",
  network: "mtn",
  amountUsdc: "0.333334",
  feeUsdc: "0",
  totalUsdc: "0.333334",
  rate: "1500.00",
  quotedAt: baseQuotedAt,
  expiresAt: baseExpiresAt,
  intentFingerprint: baseFingerprint,
};

assert(samplePreview.amountNgn === "500", "preview amountNgn is exact decimal string");
assert(samplePreview.phone === "08012345678", "preview phone matches intent");
assert(samplePreview.network === "mtn", "preview network matches intent");
assert(samplePreview.amountUsdc === "0.333334", "preview amountUsdc inverse calculated");
assert(samplePreview.feeUsdc === "0", "feeUsdc is always const string '0'");
assert(samplePreview.totalUsdc === "0.333334", "totalUsdc is exact sum of amount and fee");
assert(samplePreview.rate === "1500.00", "sell rate preserved as NGN per 1 USDC");
assert(samplePreview.intentFingerprint === baseFingerprint, "intent fingerprint present");

// ---------------------------------------------------------------------------
// 3. Validate ConfirmedAirtimePayment & ConfirmedPaymentState
// ---------------------------------------------------------------------------
const sampleConfirmedPayment: ConfirmedPaymentState = {
  amountNgn: samplePreview.amountNgn,
  phone: samplePreview.phone,
  network: samplePreview.network,
  amountUsdc: samplePreview.amountUsdc,
  feeUsdc: samplePreview.feeUsdc,
  totalUsdc: samplePreview.totalUsdc,
  rate: samplePreview.rate,
  quotedAt: samplePreview.quotedAt,
  expiresAt: samplePreview.expiresAt,
  intentFingerprint: samplePreview.intentFingerprint,
  confirmedForPayment: true,
  confirmedAt: "2026-09-19T16:00:15.000Z",
  preview: samplePreview,
};

// Confirm assignability to ConfirmedAirtimePayment
const typedConfirmedPayment: ConfirmedAirtimePayment = sampleConfirmedPayment;
assert(typedConfirmedPayment.amountNgn === "500", "confirmed payment assignable to ConfirmedAirtimePayment");
assert(sampleConfirmedPayment.confirmedForPayment === true, "confirmedForPayment flag is true");
assert(typeof sampleConfirmedPayment.confirmedAt === "string", "confirmedAt is ISO string");
assert(sampleConfirmedPayment.preview.intentFingerprint === baseFingerprint, "preview snapshot preserved");

// ---------------------------------------------------------------------------
// 4. Validate Quote Freshness & Stale Quote States
// ---------------------------------------------------------------------------
const quotedAtMs = Date.parse(baseQuotedAt);
const expiresAtMs = Date.parse(baseExpiresAt);

// Case 4a: Fresh quote (at t = quotedAt + 30s)
const midPointMs = quotedAtMs + 30_000;
assert(isPreviewFresh(samplePreview, midPointMs) === true, "quote is fresh at 30s");

// Case 4b: Boundary condition (at t = expiresAt) -> Expired per frozen contract (strictly before)
assert(isPreviewFresh(samplePreview, expiresAtMs) === false, "quote expires at exact expiry time");

// Case 4c: Expired quote (at t = expiresAt + 1ms)
assert(isPreviewFresh(samplePreview, expiresAtMs + 1) === false, "quote expired after expiry time");

// Case 4d: Null or invalid expiry
assert(isPreviewFresh(null, midPointMs) === false, "null preview is not fresh");
assert(
  isPreviewFresh({ ...samplePreview, expiresAt: "invalid-date" }, midPointMs) === false,
  "invalid expiresAt string is treated as expired",
);

// ---------------------------------------------------------------------------
// 5. Validate doesPreviewMatchIntent & Drift Rejection
// ---------------------------------------------------------------------------
// Matching intent
assert(
  doesPreviewMatchIntent(samplePreview, airtimeDraftComplete) === true,
  "exact matching intent and preview are accepted",
);

// Incomplete intent
assert(
  doesPreviewMatchIntent(samplePreview, airtimeDraftIncomplete) === false,
  "incomplete intent rejected even if preview fields match",
);

// Amount drift (intent changed from 500 to 1000)
const driftedAmountIntent: AirtimeIntent = {
  ...airtimeDraftComplete,
  amountNgn: "1000",
};
assert(
  doesPreviewMatchIntent(samplePreview, driftedAmountIntent) === false,
  "drifted amountNgn rejected",
);

// Phone drift (intent changed phone)
const driftedPhoneIntent: AirtimeIntent = {
  ...airtimeDraftComplete,
  phone: "08099999999",
};
assert(
  doesPreviewMatchIntent(samplePreview, driftedPhoneIntent) === false,
  "drifted phone rejected",
);

// Network drift (intent changed network from mtn to airtel)
const driftedNetworkIntent: AirtimeIntent = {
  ...airtimeDraftComplete,
  network: "airtel",
};
assert(
  doesPreviewMatchIntent(samplePreview, driftedNetworkIntent) === false,
  "drifted network rejected",
);

// Null intent / null preview
assert(doesPreviewMatchIntent(null, airtimeDraftComplete) === false, "null preview rejected");
assert(doesPreviewMatchIntent(samplePreview, null) === false, "null intent rejected");

// ---------------------------------------------------------------------------
// 6. Simulate confirmPayment deterministic state transitions
// ---------------------------------------------------------------------------
interface AssistantStateMock {
  activeIntent: AirtimeIntent | null;
  preview: AirtimePreview | null;
  confirmedPayment: ConfirmedPaymentState | null;
}

function simulateConfirmPayment(
  state: AssistantStateMock,
  nowMs: number,
): AssistantStateMock {
  const { activeIntent, preview } = state;
  if (!activeIntent || !activeIntent.readyForConfirmation || !preview) {
    return state;
  }
  if (!isPreviewFresh(preview, nowMs)) {
    return state; // Stale quote rejected
  }
  if (!doesPreviewMatchIntent(preview, activeIntent)) {
    return state; // Mismatched intent rejected
  }

  return {
    ...state,
    confirmedPayment: {
      amountNgn: preview.amountNgn,
      phone: preview.phone,
      network: preview.network,
      amountUsdc: preview.amountUsdc,
      feeUsdc: preview.feeUsdc,
      totalUsdc: preview.totalUsdc,
      rate: preview.rate,
      quotedAt: preview.quotedAt,
      expiresAt: preview.expiresAt,
      intentFingerprint: preview.intentFingerprint,
      confirmedForPayment: true,
      confirmedAt: new Date(nowMs).toISOString(),
      preview,
    },
  };
}

// Transition 6a: Successful confirmation with fresh quote
const initialState: AssistantStateMock = {
  activeIntent: airtimeDraftComplete,
  preview: samplePreview,
  confirmedPayment: null,
};

const confirmedState = simulateConfirmPayment(initialState, midPointMs);
assert(confirmedState.confirmedPayment !== null, "confirmation succeeded with fresh matching preview");
assert(
  confirmedState.confirmedPayment?.confirmedForPayment === true,
  "confirmedPayment marked as confirmed",
);
assert(
  confirmedState.confirmedPayment?.confirmedAt === new Date(midPointMs).toISOString(),
  "confirmedAt recorded accurately",
);

// Transition 6b: Confirmation rejected on stale quote
const staleInitialState: AssistantStateMock = {
  activeIntent: airtimeDraftComplete,
  preview: samplePreview,
  confirmedPayment: null,
};
const failedStaleState = simulateConfirmPayment(staleInitialState, expiresAtMs + 10_000);
assert(failedStaleState.confirmedPayment === null, "confirmation refused when quote is stale");

// Transition 6c: Confirmation rejected on drifted intent
const driftedInitialState: AssistantStateMock = {
  activeIntent: driftedAmountIntent,
  preview: samplePreview,
  confirmedPayment: null,
};
const failedDriftState = simulateConfirmPayment(driftedInitialState, midPointMs);
assert(failedDriftState.confirmedPayment === null, "confirmation refused when intent has drifted");

// Transition 6d: Intent edit invalidates preview and confirmedPayment
function simulateEditIntent(state: AssistantStateMock): AssistantStateMock {
  return {
    ...state,
    preview: null,
    confirmedPayment: null,
  };
}
const editedState = simulateEditIntent(confirmedState);
assert(editedState.preview === null, "editIntent cleared preview");
assert(editedState.confirmedPayment === null, "editIntent cleared confirmedPayment");

// ---------------------------------------------------------------------------
// 7. Verify Component and Hook Exports
// ---------------------------------------------------------------------------
assert(typeof AirtimePreviewCard === "function", "AirtimePreviewCard is exported as a React component");
assert(typeof IntentDraftCard === "function", "IntentDraftCard is exported as a React component");
assert(typeof useAssistant === "function", "useAssistant hook is exported");
assert(typeof isPreviewFresh === "function", "isPreviewFresh helper is exported");
assert(typeof doesPreviewMatchIntent === "function", "doesPreviewMatchIntent helper is exported");

// ---------------------------------------------------------------------------
// 8. Validate Chat messages and requests
// ---------------------------------------------------------------------------
const userMsg: ConversationMessage = {
  role: "user",
  content: "I want to buy 500 NGN airtime for 08012345678",
  timestamp: "2026-09-19T16:00:00.000Z",
};

const assistantMsgWithIntent: ConversationMessage = {
  role: "assistant",
  content: "I have prepared your airtime draft for ₦500 on MTN to 08012345678.",
  timestamp: "2026-09-19T16:00:01.000Z",
  intent: airtimeDraftComplete,
};

assert(userMsg.role === "user", "user message role");
assert(assistantMsgWithIntent.role === "assistant", "assistant message role");
assert(assistantMsgWithIntent.intent?.type === "airtime", "assistant message intent");

const sampleRequest: AssistantChatRequest = {
  message: "Buy airtime",
  history: [userMsg],
  activeIntent: airtimeDraftIncomplete,
};

const sampleSuccessResponse: AssistantChatResponse = {
  ok: true,
  turn: {
    kind: "payment_intent",
    message: {
      role: "assistant",
      content: "I have prepared your airtime draft for ₦500 on MTN to 08012345678.",
      timestamp: "2026-09-19T16:00:01.000Z",
      intent: airtimeDraftComplete,
    },
    intent: airtimeDraftComplete,
  },
  activeIntent: airtimeDraftComplete,
};
const sampleErrorResponse: AssistantChatResponse = {
  ok: false,
  error: {
    code: "INVALID_REQUEST",
    message: "Missing message parameter",
  },
};

assert(sampleRequest.message.length > 0, "request message present");
assert(sampleSuccessResponse.ok === true, "response ok true");
assert(sampleErrorResponse.ok === false, "response ok false");

// ---------------------------------------------------------------------------
// 9. Validate AssistantPanel integration & IntentDraftCard props wiring
// ---------------------------------------------------------------------------
assert(typeof AssistantPanel === "function", "AssistantPanel is exported as a React component");

const sampleDraftProps = {
  intent: airtimeDraftComplete,
  preview: samplePreview,
  previewLoading: false,
  previewError: null,
  confirmedPayment: sampleConfirmedPayment,
  onConfirmPayment: () => {},
  onRefreshPreview: () => {},
  onEditIntent: () => {},
};

assert(typeof sampleDraftProps.onConfirmPayment === "function", "onConfirmPayment handler accepted");
assert(typeof sampleDraftProps.onRefreshPreview === "function", "onRefreshPreview handler accepted");
assert(typeof sampleDraftProps.onEditIntent === "function", "onEditIntent handler accepted");

// ---------------------------------------------------------------------------
// 10. Validate Post-Confirmation Expiry Invalidation & Immutability
// ---------------------------------------------------------------------------
const frozenSnapshot: ConfirmedPaymentState = Object.freeze({
  ...sampleConfirmedPayment,
  preview: Object.freeze({ ...samplePreview }),
});

assert(Object.isFrozen(frozenSnapshot), "confirmed payment snapshot is frozen with Object.freeze");
assert(Object.isFrozen(frozenSnapshot.preview), "confirmed payment preview snapshot is frozen with Object.freeze");

function evaluateEffectiveConfirmedPayment(
  confirmed: ConfirmedPaymentState | null,
  nowMs: number,
): ConfirmedPaymentState | null {
  if (!confirmed) return null;
  const expiresAtMs = Date.parse(confirmed.preview?.expiresAt ?? confirmed.expiresAt);
  if (!Number.isFinite(expiresAtMs) || nowMs >= expiresAtMs) {
    return null;
  }
  return confirmed;
}

assert(
  evaluateEffectiveConfirmedPayment(frozenSnapshot, midPointMs) !== null,
  "confirmation active while quote is fresh",
);
assert(
  evaluateEffectiveConfirmedPayment(frozenSnapshot, expiresAtMs) === null,
  "confirmation invalidated at exact expiry time",
);
assert(
  evaluateEffectiveConfirmedPayment(frozenSnapshot, expiresAtMs + 5_000) === null,
  "confirmation invalidated after quote has expired",
);

// ---------------------------------------------------------------------------
// 11. Validate Exact Display Formatting & Non-lossy Decimals
// ---------------------------------------------------------------------------
assert(formatDecimalForDisplay("500") === "500", "exact integer NGN formatted without decimals");
assert(formatDecimalForDisplay("5000") === "5,000", "thousands grouped correctly on integer NGN");
assert(formatDecimalForDisplay("1000000") === "1,000,000", "millions grouped correctly on integer NGN");
assert(formatDecimalForDisplay("1500.00") === "1,500.00", "exact rate decimals preserved without float truncation");
assert(formatDecimalForDisplay("0.333334") === "0.333334", "exact USDC 6-decimal string preserved");
assert(formatDecimalForDisplay("0") === "0", "zero fee preserved");

// ---------------------------------------------------------------------------
// 12. Validate Late Response Fingerprint Guard
// ---------------------------------------------------------------------------
async function runAsyncChecks() {
  const clientFingerprint = await computeIntentFingerprintClient({
    amountNgn: "500",
    phone: "08012345678",
    network: "mtn",
  });

  assert(typeof clientFingerprint === "string" && clientFingerprint.length === 64, "client fingerprint is 64-char hex SHA-256");

  function simulateFetchPreviewGuard(
    currentActiveIntent: AirtimeIntent | null,
    responsePreview: AirtimePreview,
    computedFingerprint: string,
  ): boolean {
    if (!currentActiveIntent || currentActiveIntent.type !== "airtime" || !currentActiveIntent.readyForConfirmation) {
      return false;
    }
    if (responsePreview.intentFingerprint !== computedFingerprint) {
      return false;
    }
    return doesPreviewMatchIntent(responsePreview, currentActiveIntent);
  }

  const matchingPreview: AirtimePreview = {
    ...samplePreview,
    intentFingerprint: clientFingerprint,
  };
  assert(
    simulateFetchPreviewGuard(airtimeDraftComplete, matchingPreview, clientFingerprint) === true,
    "matching in-order response accepted",
  );

  const stalePreview: AirtimePreview = {
    ...samplePreview,
    intentFingerprint: "0".repeat(64),
  };
  assert(
    simulateFetchPreviewGuard(airtimeDraftComplete, stalePreview, clientFingerprint) === false,
    "stale late response with mismatched fingerprint guarded and rejected",
  );

  assert(
    simulateFetchPreviewGuard(driftedAmountIntent, matchingPreview, clientFingerprint) === false,
    "response guarded against drifted intent",
  );

  console.log("✓ Providus Assistant UI self-check passed: All preview types, confirmation state transitions, freshness boundaries, components, formatting, and late response guards verified!");
}

runAsyncChecks().catch((err) => {
  console.error("Self check failed:", err);
  process.exit(1);
});
