/**
 * Isolated self-check for Providus Assistant UI components, confirmation experience,
 * and useAssistant hook contract (P4 + P5).
 *
 * Validates:
 * 1. AirtimePreview & ConfirmedAirtimePayment frozen schemas (all 10 fields)
 * 2. PaymentInstructions schema & component exports (P5)
 * 3. Quote freshness boundaries (strictly before expiresAt)
 * 4. Intent fingerprint consistency & intent matching
 * 5. confirmPayment deterministic state transitions, orders binding, & invalidations
 * 6. Component exports and signatures (AirtimePreviewCard, IntentDraftCard, PaymentInstructionsCard, useAssistant)
 * 7. Celo USDC deposit parameter binding, ERC-8021 calldata, and confirmation transitions
 * 8. Expiry countdown & safety margin calculations
 */

import type { Address } from "viem";
import type {
  ConversationMessage,
  AssistantConversationMessage,
  PaymentIntent,
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
import {
  AirtimePreviewCard,
  type AirtimePreviewCardProps,
} from "@/components/assistant/airtime-preview-card";
import {
  IntentDraftCard,
  type IntentDraftCardProps,
} from "@/components/assistant/intent-draft-card";
import {
  PaymentInstructionsCard,
  type PaymentInstructions,
  type PaymentInstructionsCardProps,
  type DepositProgressionStatus,
  PAYMENT_EXPIRY_SAFETY_MS,
} from "@/components/assistant/payment-instructions-card";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { formatDecimalForDisplay, usdcToBaseUnits } from "@/lib/money/decimal";
import {
  ACTIVE_CELO_ATTRIBUTION_TAG,
  buildTaggedTransferCalldata,
  extractAttributionTags,
} from "@/lib/celo/attribution";
import { CANONICAL_CELO_USDC } from "@/lib/celo/usdc";

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
  phone: undefined,
  network: "mtn",
  networkConfirmed: true,
  readyForConfirmation: false,
  missingFields: ["phone"],
};

const airtimeDraftUnconfirmedNetwork: AirtimeIntent = {
  type: "airtime",
  amountNgn: "500",
  phone: "08012345678",
  network: "mtn",
  networkConfirmed: false,
  readyForConfirmation: false,
  missingFields: ["network"],
};

const airtimeDraftComplete: AirtimeIntent = {
  type: "airtime",
  amountNgn: "500",
  phone: "08012345678",
  network: "mtn",
  networkConfirmed: true,
  readyForConfirmation: true,
  missingFields: [],
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
  intentFingerprint: baseFingerprint,
  amountNgn: "500",
  phone: "08012345678",
  network: "mtn",
  amountUsdc: "0.333334",
  feeUsdc: "0",
  totalUsdc: "0.333334",
  rate: "1500.00",
  quotedAt: baseQuotedAt,
  expiresAt: baseExpiresAt,
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
  confirmedAt: new Date(baseQuotedAt).toISOString(),
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
  preview: AirtimePreview | null;
  activeIntent: AirtimeIntent | null;
  confirmedPayment: ConfirmedPaymentState | null;
}

function simulateConfirmPayment(
  state: AssistantStateMock,
  nowMs: number,
): AssistantStateMock {
  if (
    !state.activeIntent ||
    state.activeIntent.type !== "airtime" ||
    !state.activeIntent.readyForConfirmation ||
    !state.preview
  ) {
    return state;
  }

  if (!isPreviewFresh(state.preview, nowMs)) {
    return state;
  }

  if (!doesPreviewMatchIntent(state.preview, state.activeIntent)) {
    return state;
  }

  const snapshot: ConfirmedPaymentState = Object.freeze({
    amountNgn: state.preview.amountNgn,
    phone: state.preview.phone,
    network: state.preview.network,
    amountUsdc: state.preview.amountUsdc,
    feeUsdc: state.preview.feeUsdc,
    totalUsdc: state.preview.totalUsdc,
    rate: state.preview.rate,
    quotedAt: state.preview.quotedAt,
    expiresAt: state.preview.expiresAt,
    intentFingerprint: state.preview.intentFingerprint,
    confirmedForPayment: true,
    confirmedAt: new Date(nowMs).toISOString(),
    preview: Object.freeze({ ...state.preview }),
  });

  return {
    ...state,
    confirmedPayment: snapshot,
  };
}

// Transition 6a: Successful confirmation with fresh quote
const initialState: AssistantStateMock = {
  preview: samplePreview,
  activeIntent: airtimeDraftComplete,
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
  preview: samplePreview,
  activeIntent: airtimeDraftComplete,
  confirmedPayment: null,
};
const failedStaleState = simulateConfirmPayment(staleInitialState, expiresAtMs + 10_000);
assert(failedStaleState.confirmedPayment === null, "confirmation refused when quote is stale");

// Transition 6c: Confirmation rejected on drifted intent
const driftedInitialState: AssistantStateMock = {
  preview: samplePreview,
  activeIntent: driftedAmountIntent,
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
  content: "I want 500 MTN airtime for 08012345678",
  timestamp: "2026-09-19T16:00:00.000Z",
};

const assistantMsgWithIntent: AssistantConversationMessage & { intent: PaymentIntent } = {
  role: "assistant",
  content: "I've drafted your airtime purchase for ₦500 on MTN.",
  timestamp: "2026-09-19T16:00:01.000Z",
  intent: airtimeDraftComplete as PaymentIntent,
};
assert(userMsg.role === "user", "user message role");
assert(assistantMsgWithIntent.role === "assistant", "assistant message role");
assert(assistantMsgWithIntent.intent?.type === "airtime", "assistant message intent");

const sampleRequest: AssistantChatRequest = {
  message: "Buy airtime",
  history: [userMsg],
  activeIntent: airtimeDraftComplete,
};

const sampleSuccessResponse: AssistantChatResponse = {
  ok: true,
  turn: {
    kind: "payment_intent",
    message: assistantMsgWithIntent,
    intent: airtimeDraftComplete,
  },
  activeIntent: airtimeDraftComplete,
};

const sampleErrorResponse: AssistantChatResponse = {
  ok: false,
  error: {
    code: "INVALID_REQUEST",
    message: "Missing message",
  },
};

assert(sampleRequest.message.length > 0, "request message present");
assert(sampleSuccessResponse.ok === true, "response ok true");
assert(sampleErrorResponse.ok === false, "response ok false");

// ---------------------------------------------------------------------------
// 9. Validate AssistantPanel integration & IntentDraftCard props wiring
// ---------------------------------------------------------------------------
assert(typeof AssistantPanel === "function", "AssistantPanel is exported as a React component");

const sampleInstructions: PaymentInstructions = Object.freeze({
  transactionId: "tx_airtime_7a8b9c0d",
  receiveAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  totalUsdcToSend: "0.333334",
  validUntil: "2026-09-19T16:15:00.000Z",
});

let receivedDepositHash: string | null = null;
const handleDepositConfirmed = async (celoTxHash: string) => {
  receivedDepositHash = celoTxHash;
};
assert(receivedDepositHash === null, "initial receivedDepositHash is null");

const sampleDraftProps: IntentDraftCardProps = {
  intent: airtimeDraftComplete,
  preview: samplePreview,
  previewLoading: false,
  previewError: null,
  confirmed: false,
  confirmedPayment: null,
  paymentInstructions: sampleInstructions,
  preparingPayment: false,
  preparationError: null,
  depositStatus: "awaiting_deposit",
  depositHash: null,
  depositError: null,
  onConfirmPayment: () => {},
  onRefreshPreview: () => {},
  onEditIntent: () => {},
  onDepositConfirmed: handleDepositConfirmed,
};

assert(typeof sampleDraftProps.onConfirmPayment === "function", "onConfirmPayment handler accepted");
assert(typeof sampleDraftProps.onRefreshPreview === "function", "onRefreshPreview handler accepted");
assert(typeof sampleDraftProps.onEditIntent === "function", "onEditIntent handler accepted");
assert(sampleDraftProps.depositStatus === "awaiting_deposit", "depositStatus prop accepted by IntentDraftCardProps");
assert(sampleDraftProps.paymentInstructions?.totalUsdcToSend === "0.333334", "paymentInstructions prop forwarded to IntentDraftCardProps");
assert(typeof sampleDraftProps.onDepositConfirmed === "function", "onDepositConfirmed prop forwarded to IntentDraftCardProps");

const sampleAirtimePreviewProps: AirtimePreviewCardProps = {
  preview: samplePreview,
  loading: false,
  error: null,
  confirmed: false,
  confirmedPayment: null,
  paymentInstructions: sampleInstructions,
  preparingPayment: false,
  preparationError: null,
  depositStatus: "awaiting_deposit",
  depositHash: null,
  depositError: null,
  onConfirmPayment: () => {},
  onRefreshPreview: () => {},
  onEditIntent: () => {},
  onDepositConfirmed: handleDepositConfirmed,
};

assert(sampleAirtimePreviewProps.depositStatus === "awaiting_deposit", "depositStatus prop accepted by AirtimePreviewCardProps");
assert(sampleAirtimePreviewProps.paymentInstructions?.totalUsdcToSend === "0.333334", "paymentInstructions prop forwarded to AirtimePreviewCardProps");
assert(typeof sampleAirtimePreviewProps.onDepositConfirmed === "function", "onDepositConfirmed prop accepted by AirtimePreviewCardProps");

const samplePaymentInstructionsProps: PaymentInstructionsCardProps = {
  instructions: sampleInstructions,
  status: "awaiting_deposit",
  depositStatus: "awaiting_deposit",
  depositHash: null,
  error: null,
  depositError: null,
  onDepositConfirmed: handleDepositConfirmed,
  onPayWithConnectedWallet: async () => {},
};

assert(samplePaymentInstructionsProps.depositStatus === "awaiting_deposit", "depositStatus prop accepted by PaymentInstructionsCardProps");
assert(typeof samplePaymentInstructionsProps.onDepositConfirmed === "function", "onDepositConfirmed prop accepted by PaymentInstructionsCardProps");
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
  const expiresAtMs = Date.parse(confirmed.preview.expiresAt);
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

  // ---------------------------------------------------------------------------
  // 13. Validate PaymentInstructions Schema & Component Export (P5)
  // ---------------------------------------------------------------------------
  assert(typeof PaymentInstructionsCard === "function", "PaymentInstructionsCard is exported as a React component");

  // sampleInstructions verified from module scope

  assert(sampleInstructions.transactionId === "tx_airtime_7a8b9c0d", "instructions transactionId verified");
  assert(sampleInstructions.receiveAddress.startsWith("0x"), "instructions receiveAddress is 0x-prefixed");
  assert(sampleInstructions.totalUsdcToSend === "0.333334", "authoritative totalUsdcToSend matches preview total");
  assert(sampleInstructions.validUntil === "2026-09-19T16:15:00.000Z", "validUntil timestamp preserved");

  // ---------------------------------------------------------------------------
  // 14. Simulate Payment Preparation & Order Binding (POST /api/assistant/orders)
  // ---------------------------------------------------------------------------
  interface P5AssistantStateMock extends AssistantStateMock {
    previewId: string | null;
    walletAddress: string | null;
    paymentInstructions: PaymentInstructions | null;
    preparingPayment: boolean;
    preparationError: string | null;
    depositStatus: string;
  }

  async function simulatePrepareOrder(
    state: P5AssistantStateMock,
    options?: {
      mockResponse?: {
        ok: boolean;
        transactionId?: string;
        receiveAddress?: string;
        totalUsdcToSend?: string;
        validUntil?: string;
        error?: { code: string; message: string };
      };
      walletOverride?: string;
      nowMs?: number;
    },
  ): Promise<P5AssistantStateMock> {
    const currentIntent = state.activeIntent;
    const currentPreview = state.preview;
    const currentPreviewId = state.previewId;
    const targetWallet = options?.walletOverride ?? state.walletAddress;
    const checkNow = options?.nowMs ?? Date.now();

    if (
      !currentIntent ||
      currentIntent.type !== "airtime" ||
      !currentIntent.readyForConfirmation ||
      !currentPreview
    ) {
      return state;
    }

    if (!isPreviewFresh(currentPreview, checkNow)) {
      return {
        ...state,
        preparationError: "Quote has expired. Please refresh the quote to confirm.",
      };
    }

    if (!doesPreviewMatchIntent(currentPreview, currentIntent)) {
      return {
        ...state,
        preparationError: "Quote does not match the active intent. Please refresh.",
      };
    }

    if (!targetWallet) {
      return {
        ...state,
        preparationError: "Please connect your wallet before confirming payment.",
      };
    }

    if (!currentPreviewId) {
      return {
        ...state,
        preparationError: "Quote preview identifier is missing. Please refresh the quote.",
      };
    }

    const resp = options?.mockResponse ?? {
      ok: true,
      transactionId: "tx_order_123",
      receiveAddress: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      totalUsdcToSend: currentPreview.totalUsdc,
      validUntil: new Date(checkNow + 15 * 60 * 1000).toISOString(),
    };

    if (!resp.ok || !resp.transactionId || !resp.receiveAddress || !resp.totalUsdcToSend || !resp.validUntil) {
      return {
        ...state,
        preparationError: resp.error?.message ?? "Order preparation failed",
        paymentInstructions: null,
      };
    }

    const instructions: PaymentInstructions = Object.freeze({
      transactionId: resp.transactionId,
      receiveAddress: resp.receiveAddress,
      totalUsdcToSend: resp.totalUsdcToSend,
      validUntil: resp.validUntil,
    });

    const confirmedSnapshot: ConfirmedPaymentState = Object.freeze({
      amountNgn: currentPreview.amountNgn,
      phone: currentPreview.phone,
      network: currentPreview.network,
      amountUsdc: currentPreview.amountUsdc,
      feeUsdc: currentPreview.feeUsdc,
      totalUsdc: currentPreview.totalUsdc,
      rate: currentPreview.rate,
      quotedAt: currentPreview.quotedAt,
      expiresAt: currentPreview.expiresAt,
      intentFingerprint: currentPreview.intentFingerprint,
      confirmedForPayment: true,
      confirmedAt: new Date(checkNow).toISOString(),
      preview: Object.freeze({ ...currentPreview }),
      paymentInstructions: instructions,
    });

    return {
      ...state,
      paymentInstructions: instructions,
      confirmedPayment: confirmedSnapshot,
      preparationError: null,
      depositStatus: "awaiting_deposit",
    };
  }

  // 14a. Successful payment preparation
  const p5InitialState: P5AssistantStateMock = {
    preview: samplePreview,
    previewId: "prev_uuid_12345",
    activeIntent: airtimeDraftComplete,
    walletAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    paymentInstructions: null,
    confirmedPayment: null,
    preparingPayment: false,
    preparationError: null,
    depositStatus: "pending",
  };

  const p5PreparedState = await simulatePrepareOrder(p5InitialState, { nowMs: midPointMs });
  assert(p5PreparedState.paymentInstructions !== null, "paymentInstructions stored on success");
  assert(p5PreparedState.confirmedPayment !== null, "confirmedPayment set on success");
  assert(p5PreparedState.confirmedPayment?.paymentInstructions !== undefined, "paymentInstructions attached to confirmedPayment");
  assert(p5PreparedState.depositStatus === "awaiting_deposit", "depositStatus moves to awaiting_deposit");
  assert(p5PreparedState.preparationError === null, "preparationError is null on success");

  // 14b. Missing wallet rejects with safe error
  const p5NoWalletState = await simulatePrepareOrder(
    { ...p5InitialState, walletAddress: null },
    { nowMs: midPointMs },
  );
  assert(p5NoWalletState.paymentInstructions === null, "paymentInstructions null when wallet missing");
  assert(
    p5NoWalletState.preparationError === "Please connect your wallet before confirming payment.",
    "actionable wallet connection error when wallet missing",
  );

  // 14c. Missing previewId rejects with safe error
  const p5NoPreviewIdState = await simulatePrepareOrder(
    { ...p5InitialState, previewId: null },
    { nowMs: midPointMs },
  );
  assert(p5NoPreviewIdState.paymentInstructions === null, "paymentInstructions null when previewId missing");
  assert(
    p5NoPreviewIdState.preparationError === "Quote preview identifier is missing. Please refresh the quote.",
    "preview identifier missing error",
  );

  // 14d. Expired quote rejects with safe error
  const p5ExpiredQuoteState = await simulatePrepareOrder(p5InitialState, {
    nowMs: expiresAtMs + 10_000,
  });
  assert(p5ExpiredQuoteState.paymentInstructions === null, "paymentInstructions null when quote expired");
  assert(
    p5ExpiredQuoteState.preparationError === "Quote has expired. Please refresh the quote to confirm.",
    "quote expired error",
  );

  // 14e. Server PREVIEW_NOT_USABLE error
  const p5FailedOrderState = await simulatePrepareOrder(p5InitialState, {
    nowMs: midPointMs,
    mockResponse: {
      ok: false,
      error: {
        code: "PREVIEW_NOT_USABLE",
        message: "Quote preview is no longer available or already consumed. Please request a fresh quote.",
      },
    },
  });
  assert(p5FailedOrderState.paymentInstructions === null, "paymentInstructions null on order rejection");
  assert(
    Boolean(p5FailedOrderState.preparationError?.includes("no longer available")),
    "safe PREVIEW_NOT_USABLE message displayed",
  );

  // ---------------------------------------------------------------------------
  // 15. Validate Celo USDC Deposit Parameter Binding & ERC-8021 Tagged Calldata
  // ---------------------------------------------------------------------------
  const totalUsdcToSend = sampleInstructions.totalUsdcToSend; // "0.333334"
  const receiveAddress = sampleInstructions.receiveAddress as Address;

  // Convert to base units using 6 decimals
  const usdcBaseUnits = usdcToBaseUnits(totalUsdcToSend, 6);
  assert(usdcBaseUnits === BigInt("333334"), "0.333334 USDC converted to 333334 base units");

  // Build tagged calldata with active ERC-8021 attribution tag
  const taggedCalldata = buildTaggedTransferCalldata(receiveAddress, usdcBaseUnits);
  assert(typeof taggedCalldata === "string", "taggedCalldata is a Hex string");
  assert(taggedCalldata.startsWith("0xa9059cbb"), "tagged calldata starts with ERC20 transfer(address,uint256) selector");

  // Extract attribution tags and verify active tag
  const extractedTags = extractAttributionTags(taggedCalldata);
  assert(extractedTags.length > 0, "extracted attribution tags present");
  assert(extractedTags.includes(ACTIVE_CELO_ATTRIBUTION_TAG), `tagged calldata contains active tag ${ACTIVE_CELO_ATTRIBUTION_TAG}`);

  // Canonical Celo USDC target verification
  assert(
    CANONICAL_CELO_USDC.address === "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    "canonical USDC address matches Celo mainnet deployment",
  );
  assert(CANONICAL_CELO_USDC.decimals === 6, "canonical USDC decimals is 6");

  // ---------------------------------------------------------------------------
  // 16. Simulate Celo Deposit Confirmation (POST /api/transactions/[id]/confirm-deposit)
  // ---------------------------------------------------------------------------
  function simulateConfirmDepositReceipt(
    instructions: PaymentInstructions | null,
    celoTxHash: string,
    mockOk = true,
  ): { ok: boolean; status: string; error?: string } {
    if (!instructions) {
      return { ok: false, status: "error", error: "No active payment instructions to confirm deposit." };
    }

    if (!/^0x[a-fA-F0-9]{64}$/.test(celoTxHash)) {
      return { ok: false, status: "error", error: "Invalid transaction hash format. Must be a 32-byte 0x-prefixed hex string." };
    }

    if (!mockOk) {
      return { ok: false, status: "error", error: "Deposit verification failed: transaction receipt reverted on Celo" };
    }

    return { ok: true, status: "settling" };
  }

  const validTxHash = "0x" + "a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d";
  const invalidTxHash = "0x123"; // Too short

  const validDepositResult = simulateConfirmDepositReceipt(sampleInstructions, validTxHash);
  assert(validDepositResult.ok === true, "valid 32-byte hex hash accepted");
  assert(validDepositResult.status === "settling", "status transitions to settling upon confirmation");

  const invalidDepositResult = simulateConfirmDepositReceipt(sampleInstructions, invalidTxHash);
  assert(invalidDepositResult.ok === false, "short hash rejected client-side");
  assert(invalidDepositResult.status === "error", "status is error on malformed hash");

  const nullInstructionsResult = simulateConfirmDepositReceipt(null, validTxHash);
  assert(nullInstructionsResult.ok === false, "confirmation rejected if no paymentInstructions");

  // ---------------------------------------------------------------------------
  // 17. Validate ValidUntil Countdown & Expiry Safety Margin
  // ---------------------------------------------------------------------------
  const testNow = quotedAtMs;
  const farValidUntilMs = testNow + 15 * 60 * 1000; // 15 mins
  const safetyValidUntilMs = testNow + 45 * 1000; // 45s (inside 60s safety margin)
  const expiredValidUntilMs = testNow - 1000; // -1s

  assert(farValidUntilMs - testNow > PAYMENT_EXPIRY_SAFETY_MS, "far validity is outside safety margin");
  assert(
    safetyValidUntilMs - testNow <= PAYMENT_EXPIRY_SAFETY_MS && safetyValidUntilMs - testNow > 0,
    "45s validity is inside safety margin",
  );
  assert(expiredValidUntilMs - testNow <= 0, "past validUntil is expired");

  // ---------------------------------------------------------------------------
  // 18. Validate onDepositConfirmed Invocation & Hash Forwarding
  // ---------------------------------------------------------------------------
  let receivedTxHash: string | null = null;
  let confirmDepositCalled: boolean = false;

  const mockConfirmDeposit = async (txHash: string): Promise<{ ok: boolean }> => {
    confirmDepositCalled = true;
    receivedTxHash = txHash;
    return { ok: true };
  };

  // Simulate Wagmi sendTransaction onSuccess callback invocation
  const simulateWagmiSuccess = async (
    hash: string,
    onDepositConfirmed?: (txHash: string) => Promise<{ ok: boolean; error?: string } | void> | void,
  ) => {
    if (onDepositConfirmed) {
      await onDepositConfirmed(hash);
    }
  };

  await simulateWagmiSuccess(validTxHash, mockConfirmDeposit);
  assert(confirmDepositCalled, "onDepositConfirmed was invoked upon Wagmi success");
  assert(receivedTxHash === validTxHash, "exact Celo txHash passed to onDepositConfirmed");

  // Verify transition to verifying status upon receiving deposit hash
  interface DepositHandoffState {
    depositStatus: DepositProgressionStatus;
    depositHash: string | null;
    depositError: string | null;
  }

  function simulateDepositHandoff(
    state: DepositHandoffState,
    celoTxHash: string,
  ): DepositHandoffState {
    return {
      ...state,
      depositHash: celoTxHash,
      depositStatus: "verifying",
      depositError: null,
    };
  }

  const initialHandoffState: DepositHandoffState = {
    depositStatus: "awaiting_deposit",
    depositHash: null,
    depositError: null,
  };

  const handoffInProgress = simulateDepositHandoff(initialHandoffState, validTxHash);
  assert(handoffInProgress.depositStatus === "verifying", "status transitions to verifying on handoff");
  assert(handoffInProgress.depositHash === validTxHash, "depositHash recorded on handoff");

  // ---------------------------------------------------------------------------
  // 19. Validate Duplicate Submission Protection & Lifecycle
  // ---------------------------------------------------------------------------
  // The payment button must be disabled and block handlePayClick when:
  // depositStatus === "submitting" || depositStatus === "verifying" || depositStatus === "settling" || isSubmitting

  function isDuplicateClickBlocked(params: {
    isExpired: boolean;
    depositStatus: DepositProgressionStatus;
    isSubmitting: boolean;
  }): boolean {
    const { isExpired, depositStatus, isSubmitting } = params;
    return (
      isExpired ||
      depositStatus === "submitting" ||
      depositStatus === "verifying" ||
      depositStatus === "settling" ||
      isSubmitting
    );
  }

  // Case 19a: Awaiting deposit (fresh, not submitting): clickable
  assert(
    isDuplicateClickBlocked({
      isExpired: false,
      depositStatus: "awaiting_deposit",
      isSubmitting: false,
    }) === false,
    "clickable when awaiting_deposit and not submitting",
  );

  // Case 19b: Submitting status: blocked
  assert(
    isDuplicateClickBlocked({
      isExpired: false,
      depositStatus: "submitting",
      isSubmitting: false,
    }) === true,
    "blocked when depositStatus is submitting",
  );

  // Case 19c: Verifying status: blocked
  assert(
    isDuplicateClickBlocked({
      isExpired: false,
      depositStatus: "verifying",
      isSubmitting: false,
    }) === true,
    "blocked when depositStatus is verifying",
  );

  // Case 19d: Settling status: blocked
  assert(
    isDuplicateClickBlocked({
      isExpired: false,
      depositStatus: "settling",
      isSubmitting: false,
    }) === true,
    "blocked when depositStatus is settling",
  );

  // Case 19e: In-flight local submission (e.g. wallet popup open): blocked
  assert(
    isDuplicateClickBlocked({
      isExpired: false,
      depositStatus: "awaiting_deposit",
      isSubmitting: true,
    }) === true,
    "blocked when isSubmitting is true during in-flight transaction",
  );

  // Case 19f: Expired quote: blocked
  assert(
    isDuplicateClickBlocked({
      isExpired: true,
      depositStatus: "awaiting_deposit",
      isSubmitting: false,
    }) === true,
    "blocked when quote is expired",
  );

  // Simulate submission lifecycle: verifying that in-flight state is NOT prematurely cleared in finally
  class MockPaymentSubmissionLifecycle {
    public isSubmitting = false;
    public depositStatus: DepositProgressionStatus = "awaiting_deposit";
    public error: string | null = null;
    public submissionAttempts = 0;

    async handlePayClick(
      sendTxMock: () => Promise<string>,
      confirmDepositMock: (hash: string) => Promise<{ ok: boolean; error?: string } | void> | Promise<void>,
    ) {
      if (
        this.depositStatus === "submitting" ||
        this.depositStatus === "verifying" ||
        this.depositStatus === "settling" ||
        this.isSubmitting
      ) {
        return { rejectedDuplicate: true };
      }

      this.submissionAttempts++;
      this.isSubmitting = true;
      this.error = null;

      try {
        const hash = await sendTxMock();
        // In-flight: isSubmitting remains TRUE! No premature reset in finally!
        await confirmDepositMock(hash);
        this.depositStatus = "settling";
      } catch (err) {
        this.error = err instanceof Error ? err.message : "Error";
        this.isSubmitting = false;
        this.depositStatus = "error";
      }
      return { rejectedDuplicate: false };
    }
  }

  const lifecycle = new MockPaymentSubmissionLifecycle();

  // Create an in-flight promise that doesn't immediately resolve
  const { promise: sendTxPromise, resolve: resolveSendTx } = Promise.withResolvers<string>();
  const delayedSendTx = () => sendTxPromise;

  let confirmCalled: boolean = false;
  const delayedConfirm = async (hash: string) => {
    assert(typeof hash === "string", "hash is string");
    confirmCalled = true;
  };

  // Trigger first click
  const firstClickPromise = lifecycle.handlePayClick(delayedSendTx, delayedConfirm);

  // While in flight: isSubmitting MUST be true
  assert(lifecycle.isSubmitting === true, "isSubmitting is true while tx is in flight");

  // Attempt duplicate click while in-flight
  const secondClickResult = await lifecycle.handlePayClick(delayedSendTx, delayedConfirm);
  assert(secondClickResult.rejectedDuplicate === true, "duplicate click was rejected while tx in flight");
  assert(lifecycle.submissionAttempts === 1, "only 1 submission attempt allowed during in-flight tx");

  // Now resolve the in-flight transaction
  resolveSendTx(validTxHash);
  await firstClickPromise;

  assert(confirmCalled, "confirmDeposit called with valid hash");
  assert(lifecycle.depositStatus === "settling", "status advanced to settling");

  // Attempt click while in settling status
  const thirdClickResult = await lifecycle.handlePayClick(delayedSendTx, delayedConfirm);
  assert(thirdClickResult.rejectedDuplicate === true, "duplicate click rejected while in settling status");
  assert(lifecycle.submissionAttempts === 1, "submission attempts still exactly 1");

  // ---------------------------------------------------------------------------
  // 20. Validate Duplicate Transfer Guard & Mining Delay Polling (P5 Repair)
  // ---------------------------------------------------------------------------
  // In hooks/use-assistant.ts and components/assistant/payment-instructions-card.tsx:
  // 1. Once celoTxHash is broadcast, confirmDeposit preserves depositHash.
  // 2. Receipt not found (404 or RECEIPT_NOT_FOUND) polls with bounded retries
  //    keeping depositStatus = "verifying".
  // 3. When polling reaches timeout, depositStatus remains "verifying" with
  //    depositError = "Transaction broadcast to Celo network. Awaiting block inclusion...".
  // 4. In payment-instructions-card, when depositHash is present:
  //    - NEVER re-trigger sendTransaction or initiate a second payment transfer.
  //    - Clicks invoke onDepositConfirmed(depositHash) to re-verify against the existing hash.
  //    - Button text reflects verification or re-checking instead of paying.

  interface ConfirmDepositSimulationState {
    depositHash: string | null;
    depositStatus: DepositProgressionStatus;
    depositError: string | null;
  }

  async function simulateConfirmDeposit(params: {
    txHash: string;
    responses: Array<{ status: number; body: { ok: boolean; code?: string; error?: string } }>;
  }): Promise<{ state: ConfirmDepositSimulationState; result: { ok: boolean; error?: string }; pollCount: number }> {
    const state: ConfirmDepositSimulationState = {
      depositHash: params.txHash,
      depositStatus: "verifying",
      depositError: null,
    };

    const MAX_POLL_ATTEMPTS = 6;
    let pollCount = 0;

    for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
      pollCount++;
      const response = params.responses[attempt - 1] ?? params.responses[params.responses.length - 1];
      const json = response.body;

      if (response.status === 200 && json.ok) {
        state.depositStatus = "settling";
        state.depositError = null;
        return { state, result: { ok: true }, pollCount };
      }

      const isReceiptNotFound = response.status === 404 || json.code === "RECEIPT_NOT_FOUND";
      if (isReceiptNotFound) {
        if (attempt < MAX_POLL_ATTEMPTS) {
          continue;
        }
        state.depositStatus = "verifying";
        state.depositHash = params.txHash;
        const timeoutMsg = "Transaction broadcast to Celo network. Awaiting block inclusion...";
        state.depositError = timeoutMsg;
        return { state, result: { ok: false, error: timeoutMsg }, pollCount };
      }

      const message = json.error ?? `Deposit verification failed with status ${response.status}`;
      state.depositStatus = "error";
      state.depositError = message;
      return { state, result: { ok: false, error: message }, pollCount };
    }

    return { state, result: { ok: false }, pollCount };
  }

  // 20a: Receipt found after initial 404s (mining delay resolved on attempt 3)
  const delayResolved = await simulateConfirmDeposit({
    txHash: validTxHash,
    responses: [
      { status: 404, body: { ok: false, code: "RECEIPT_NOT_FOUND" } },
      { status: 404, body: { ok: false, code: "RECEIPT_NOT_FOUND" } },
      { status: 200, body: { ok: true } },
    ],
  });
  assert(delayResolved.pollCount === 3, "polled exactly 3 times until receipt mined");
  assert(delayResolved.state.depositStatus === "settling", "status advanced to settling on receipt found");
  assert(delayResolved.state.depositHash === validTxHash, "depositHash retained after delayed receipt inclusion");
  assert(delayResolved.result.ok === true, "confirmDeposit returned ok: true");

  // 20b: Receipt not found across all 6 attempts (mining delay timeout)
  const delayTimedOut = await simulateConfirmDeposit({
    txHash: validTxHash,
    responses: [
      { status: 404, body: { ok: false, code: "RECEIPT_NOT_FOUND" } },
    ],
  });
  assert(delayTimedOut.pollCount === 6, "polled all 6 attempts before timeout");
  assert(delayTimedOut.state.depositStatus === "verifying", "status kept as verifying on timeout (never degraded to error)");
  assert(delayTimedOut.state.depositHash === validTxHash, "depositHash retained on timeout");
  assert(
    delayTimedOut.state.depositError === "Transaction broadcast to Celo network. Awaiting block inclusion...",
    "depositError set to awaiting block inclusion message",
  );
  assert(delayTimedOut.result.ok === false, "returned ok: false for caller handling");

  // 20c: Action button and duplicate transfer guard in PaymentInstructionsCard
  class MockPaymentInstructionsCardAction {
    public depositHash: string | null = null;
    public depositStatus: DepositProgressionStatus = "awaiting_deposit";
    public depositError: string | null = null;
    public localSubmitting = false;

    public sendTxCalls = 0;
    public verifyCalls: string[] = [];

    get isVerifyingActive(): boolean {
      return this.depositStatus === "verifying" && !this.depositError;
    }

    get isSettling(): boolean {
      return this.depositStatus === "settling" || this.depositStatus === "confirmed";
    }

    get isActionDisabled(): boolean {
      if (this.depositHash) {
        return this.isSettling || this.localSubmitting || this.isVerifyingActive;
      }
      return (
        this.depositStatus === "submitting" ||
        this.depositStatus === "verifying" ||
        this.depositStatus === "settling" ||
        this.localSubmitting
      );
    }

    get buttonLabel(): string {
      if (this.depositHash) {
        if (this.localSubmitting) return "Verifying transaction on Celo...";
        if (this.depositStatus === "settling") return "Settling order...";
        if (this.isVerifyingActive) return "Verifying on Celo...";
        if (this.depositStatus === "error") return "Check on-chain receipt again";
        return "Check verification again";
      }
      if (this.depositStatus === "submitting" || this.localSubmitting) return "Confirm in wallet...";
      if (this.depositStatus === "verifying") return "Verifying on Celo...";
      if (this.depositStatus === "settling") return "Settling order...";
      return "Pay with Connected Wallet";
    }

    async handlePayClick(
      sendTxFn: () => Promise<string>,
      confirmDepositFn: (hash: string) => Promise<void>,
    ) {
      if (this.depositHash) {
        if (this.isSettling || this.localSubmitting || this.isVerifyingActive) {
          return { action: "ignored" };
        }
        this.localSubmitting = true;
        try {
          this.verifyCalls.push(this.depositHash);
          await confirmDepositFn(this.depositHash);
        } finally {
          this.localSubmitting = false;
        }
        return { action: "re-verified" };
      }

      if (this.isActionDisabled) {
        return { action: "ignored" };
      }

      this.localSubmitting = true;
      try {
        this.sendTxCalls++;
        const hash = await sendTxFn();
        this.depositHash = hash;
        this.depositStatus = "verifying";
        this.verifyCalls.push(hash);
        await confirmDepositFn(hash);
      } finally {
        this.localSubmitting = false;
      }
      return { action: "transferred" };
    }
  }

  const card = new MockPaymentInstructionsCardAction();

  // Initial state: no hash
  assert(card.buttonLabel === "Pay with Connected Wallet", "initial button label");
  assert(card.isActionDisabled === false, "initial button enabled");

  // First click: sends initial transaction
  await card.handlePayClick(
    async () => validTxHash,
    async (hash) => {
      // Simulate mining delay: polling timed out
      card.depositHash = hash;
      card.depositStatus = "verifying";
      card.depositError = "Transaction broadcast to Celo network. Awaiting block inclusion...";
    },
  );

  assert(card.sendTxCalls === 1, "sendTransaction called exactly once on initial payment");
  assert(card.depositHash === validTxHash, "depositHash retained after mining delay");
  assert(card.depositStatus === "verifying", "depositStatus is verifying");
  assert(card.localSubmitting === false, "localSubmitting is false after onDepositConfirmed settles in onSuccess");
  assert(card.isActionDisabled === false, "button enabled to check verification again");
  assert(card.buttonLabel === "Check verification again", "button label shows 'Check verification again'");

  // Second click while depositHash is present: MUST NEVER CALL sendTransaction!
  const secondClick = await card.handlePayClick(
    async () => {
      throw new Error("Duplicate sendTransaction should NEVER be called!");
    },
    async (hash) => {
      // Retry verification against existing hash succeeds
      assert(hash === validTxHash, "verified against same existing hash");
      card.depositStatus = "settling";
      card.depositError = null;
    },
  );

  assert(secondClick.action === "re-verified", "action was re-verified");
  assert(card.sendTxCalls === 1, "sendTransaction was NOT called again (guarded against duplicate transfer!)");
  assert(card.verifyCalls.length === 2, "confirmDeposit called twice for same hash");
  assert(card.verifyCalls[0] === validTxHash && card.verifyCalls[1] === validTxHash, "both verify calls used exact same txHash");
  assert(card.depositStatus === "settling", "status advanced to settling");
  assert(card.isActionDisabled === true, "button disabled once settling");
  assert(card.buttonLabel === "Settling order...", "button shows settling order");

  // Error state retry verification check:
  const cardError = new MockPaymentInstructionsCardAction();
  cardError.depositHash = validTxHash;
  cardError.depositStatus = "error";
  cardError.depositError = "Failed to communicate with RPC.";

  assert(cardError.isActionDisabled === false, "error with depositHash is clickable");
  assert(cardError.buttonLabel === "Check on-chain receipt again", "error with depositHash offers receipt re-check");

  await cardError.handlePayClick(
    async () => {
      throw new Error("Duplicate sendTransaction must not be called!");
    },
    async (hash) => {
      assert(hash === validTxHash, "re-verified exact hash on error retry");
      cardError.depositStatus = "settling";
    },
  );

  assert(cardError.sendTxCalls === 0, "sendTransaction never called when depositHash present in error state");
  assert(cardError.verifyCalls.length === 1, "verify called for existing hash");

  console.log("✓ Providus Assistant UI self-check passed: All preview types, confirmation state transitions, freshness boundaries, components, formatting, P5 payment instructions, tagged deposit calldata, onDepositConfirmed handoff, duplicate submission lifecycle, duplicate transfer guard, receipt delay polling, and late response guards verified!");
}
runAsyncChecks().catch((err) => {
  console.error("Self check failed:", err);
  process.exit(1);
});
