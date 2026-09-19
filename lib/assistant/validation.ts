/**
 * Deterministic validation for the conversational payment intent engine.
 *
 * Trust model: the model output is a *candidate* only. Nothing here trusts
 * model-computed missingFields/readyForConfirmation/networkConfirmed, and no
 * payment-critical value is accepted unless it survives the same canonical
 * rules used by the ClubKonnect fulfilment boundary.
 */

import "server-only";

import { normalizeAndValidatePhone } from "@/lib/clubkonnect/server/client";
import type {
  AirtimeIntent,
  AssistantModelOutput,
  ConversationMessage,
  ModelIntentCandidate,
  PaymentIntent,
  PaymentIntentType,
  PaymentNetwork,
  UnsupportedIntent,
  UnsupportedIntentType,
} from "@/lib/assistant/types";

export const MIN_AIRTIME_AMOUNT_NGN = 50;
export const MAX_AIRTIME_AMOUNT_NGN = 50_000;

/** Canonical order of airtime fields the assistant still needs. */
export const AIRTIME_MISSING_FIELD_ORDER = [
  "amountNgn",
  "phone",
  "network",
] as const;

export type AirtimeMissingField = (typeof AIRTIME_MISSING_FIELD_ORDER)[number];

export const SUPPORTED_PAYMENT_NETWORKS: readonly PaymentNetwork[] = [
  "mtn",
  "airtel",
  "glo",
  "9mobile",
];

const PAYMENT_INTENT_TYPES: readonly PaymentIntentType[] = [
  "airtime",
  "data",
  "electricity",
  "cable",
  "unsupported",
];

export type ValidationErrorCode = "MODEL_INVALID_OUTPUT";

/** Failure code for structurally invalid model output. */
const MODEL_INVALID_OUTPUT: ValidationErrorCode = "MODEL_INVALID_OUTPUT";

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ValidationErrorCode; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

/* -------------------------------------------------------------------------- */
/* Field canonicalization                                                     */
/* -------------------------------------------------------------------------- */

const NETWORK_ALIASES: Record<string, PaymentNetwork> = {
  mtn: "mtn",
  airtel: "airtel",
  glo: "glo",
  globacom: "glo",
  "9mobile": "9mobile",
  "9 mobile": "9mobile",
  etisalat: "9mobile",
};

/** Canonicalizes a network token; returns null for anything unrecognized. */
export function normalizePaymentNetwork(value: unknown): PaymentNetwork | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  return NETWORK_ALIASES[key] ?? null;
}

/**
 * Normalizes a Nigerian mobile number to canonical 11-digit local form
 * (`0` + 10 digits) using the exact rule enforced at the ClubKonnect boundary.
 */
export function normalizePhoneNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return normalizeAndValidatePhone(value);
}

/**
 * Parses an exact integer NGN amount. Floats, exponents, signs, and decimal
 * points are rejected outright — never rounded.
 */
function parseIntegerAmountNgn(raw: unknown): number | null {
  let text: string;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) return null;
    text = String(raw);
  } else if (typeof raw === "string") {
    text = raw
      .trim()
      .toLowerCase()
      .replace(/^₦/, "")
      .replace(/^ngn/, "")
      .replace(/^naira/, "");
    text = text.replace(/[\s,]/g, "");
  } else {
    return null;
  }

  if (!/^\d{1,9}$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Returns the canonical integer-string amount when it is a valid airtime
 * face value (50..50,000 NGN inclusive), otherwise null.
 */
export function normalizeAirtimeAmountNgn(raw: unknown): string | null {
  const value = parseIntegerAmountNgn(raw);
  if (value === null) return null;
  if (value < MIN_AIRTIME_AMOUNT_NGN || value > MAX_AIRTIME_AMOUNT_NGN) {
    return null;
  }
  return String(value);
}

/* -------------------------------------------------------------------------- */
/* Message-level language analysis                                            */
/* -------------------------------------------------------------------------- */

const NETWORK_PATTERNS: ReadonlyArray<{
  network: PaymentNetwork;
  pattern: RegExp;
}> = [
  { network: "mtn", pattern: /(?<!\w)mtn(?!\w)/i },
  { network: "airtel", pattern: /(?<!\w)airtel(?!\w)/i },
  { network: "glo", pattern: /(?<!\w)(?:glo|globacom)(?!\w)/i },
  { network: "9mobile", pattern: /(?<!\w)(?:9\s?mobile|etisalat)(?!\w)/i },
];

/**
 * Networks the user explicitly named in their own words.
 * Prefix-derived suggestions never count as naming.
 */
export function detectExplicitNetworks(message: string): PaymentNetwork[] {
  if (typeof message !== "string" || !message.trim()) return [];
  const found: PaymentNetwork[] = [];
  for (const { network, pattern } of NETWORK_PATTERNS) {
    if (pattern.test(message)) found.push(network);
  }
  return found;
}

const AFFIRMATIVES: Record<string, true> = {
  yes: true,
  yeah: true,
  yep: true,
  yup: true,
  correct: true,
  right: true,
  sure: true,
  ok: true,
  okay: true,
  confirm: true,
  confirmed: true,
  "that is right": true,
  "that's right": true,
  "thats right": true,
  "that is correct": true,
  "that's correct": true,
  "thats correct": true,
  "it is correct": true,
  "it's correct": true,
  "its correct": true,
  "yes please": true,
  "yes correct": true,
  "yes that is right": true,
  "yes that's right": true,
  "yes thats right": true,
  "yes it is": true,
  "yes it's correct": true,
  "yes its correct": true,
};

/** True only when the whole message is a bare affirmation. */
export function isAffirmative(message: string): boolean {
  if (typeof message !== "string") return false;
  const normalized = message
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, " ")
    .replace(/[.!?,\u2026]+$/g, "")
    .trim();
  return AFFIRMATIVES[normalized] === true;
}

/**
 * The single network a message identifies, from its text or its captured
 * intent. Returns null when zero or several networks are identifiable, so
 * ambiguity can never be resolved into a confirmation.
 */
export function detectMessageNetwork(
  message: ConversationMessage,
): PaymentNetwork | null {
  if (!message) return null;
  const candidates: PaymentNetwork[] =
    typeof message.content === "string"
      ? detectExplicitNetworks(message.content)
      : [];
  const intent = message.intent;
  if (
    intent &&
    intent.type === "airtime" &&
    intent.network &&
    !candidates.includes(intent.network)
  ) {
    candidates.push(intent.network);
  }
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Network named by the assistant message immediately preceding this user turn.
 */
export function detectPromptedNetwork(
  history: readonly ConversationMessage[],
): PaymentNetwork | null {
  if (!Array.isArray(history) || history.length === 0) return null;
  const last = history[history.length - 1];
  if (!last || last.role !== "assistant") return null;
  return detectMessageNetwork(last);
}

/** Nigerian mobile numbers as users actually type them, with separators removed. */
const PHONE_CANDIDATE_PATTERN = /(?:\+?234|0)[789][01]\d{8}/g;

/** Canonical phone numbers mentioned in one piece of user text. */
export function extractPhoneCandidates(text: string): string[] {
  if (typeof text !== "string" || !text.trim()) return [];
  const compact = text.replace(/[\s\-().]/g, "");
  const found: string[] = [];
  for (const match of compact.matchAll(PHONE_CANDIDATE_PATTERN)) {
    const normalized = normalizePhoneNumber(match[0]);
    if (normalized) found.push(normalized);
  }
  return found;
}

/**
 * Replays user-side network confirmation evidence from the conversation.
 *
 * A client-supplied `networkConfirmed` flag is never trusted, so the server
 * rebuilds the state from user-authored evidence only:
 * - a user message that explicitly named a single network;
 * - a bare affirmation directly after an assistant message naming that
 *   network (a later explicit naming of another network supersedes it).
 *
 * The confirmation is additionally anchored to the recipient: the draft phone
 * must be a number the user actually wrote, and the confirmation must not
 * predate the user's most recent phone mention. That is what makes "changing
 * the phone resets confirmation" hold across turns without server-side state;
 * when continuity cannot be proven, confirmation is dropped rather than kept.
 */
export function deriveNetworkConfirmedFromHistory(
  history: readonly ConversationMessage[],
  network: PaymentNetwork,
  phone: string | null,
): boolean {
  if (!Array.isArray(history) || !phone) return false;

  let confirmedIndex = -1;
  let lastMentionedPhone: string | null = null;
  let lastMentionedPhoneIndex = -1;

  for (let index = 0; index < history.length; index += 1) {
    const entry = history[index];
    if (!entry || entry.role !== "user" || typeof entry.content !== "string") {
      continue;
    }

    const mentioned = extractPhoneCandidates(entry.content);
    if (mentioned.length > 0) {
      lastMentionedPhone = mentioned[mentioned.length - 1];
      lastMentionedPhoneIndex = index;
    }

    const named = detectExplicitNetworks(entry.content);
    if (named.length === 1) {
      confirmedIndex = named[0] === network ? index : -1;
      continue;
    }
    if (named.length > 1) {
      confirmedIndex = -1;
      continue;
    }

    if (!isAffirmative(entry.content)) continue;
    const prior = history[index - 1];
    if (prior && prior.role === "assistant" && detectMessageNetwork(prior) === network) {
      confirmedIndex = index;
    }
  }

  if (confirmedIndex < 0) return false;
  if (lastMentionedPhone !== phone) return false;
  return confirmedIndex >= lastMentionedPhoneIndex;
}

/* -------------------------------------------------------------------------- */
/* Inbound draft sanitization                                                 */
/* -------------------------------------------------------------------------- */

export type IncomingIntentResult =
  | { ok: true; intent: PaymentIntent | null }
  | { ok: false; message: string };

/**
 * Canonicalizes a client-supplied draft and recomputes every derived field.
 * The client's `networkConfirmed`, `missingFields`, and `readyForConfirmation`
 * are ignored entirely.
 */
export function sanitizeIncomingIntent(
  raw: unknown,
  history: readonly ConversationMessage[],
): IncomingIntentResult {
  if (raw === null || raw === undefined) return { ok: true, intent: null };

  if (!isPlainObject(raw)) {
    return { ok: false, message: "activeIntent must be an object or null." };
  }

  const type = raw.type;
  if (typeof type !== "string" || !PAYMENT_INTENT_TYPES.includes(type as PaymentIntentType)) {
    return { ok: false, message: "activeIntent.type is not a supported intent type." };
  }

  if (type !== "airtime") {
    return {
      ok: true,
      intent: {
        type: type as UnsupportedIntentType,
        missingFields: [],
        readyForConfirmation: false,
      },
    };
  }

  const amountNgn = normalizeAirtimeAmountNgn(raw.amountNgn);
  const phone = normalizePhoneNumber(raw.phone);
  const network = normalizePaymentNetwork(raw.network);
  const networkConfirmed = network
    ? deriveNetworkConfirmedFromHistory(history, network, phone)
    : false;

  const missingFields: AirtimeMissingField[] = [];
  if (!amountNgn) missingFields.push("amountNgn");
  if (!phone) missingFields.push("phone");
  if (!network || !networkConfirmed) missingFields.push("network");

  return {
    ok: true,
    intent: {
      type: "airtime",
      ...(amountNgn ? { amountNgn } : {}),
      ...(phone ? { phone } : {}),
      ...(network ? { network } : {}),
      networkConfirmed,
      missingFields,
      readyForConfirmation: missingFields.length === 0,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Model output parsing                                                       */
/* -------------------------------------------------------------------------- */

const MAX_REPLY_LENGTH = 2000;

function parseIntentCandidate(
  raw: Record<string, unknown>,
): ValidationResult<ModelIntentCandidate> {
  const type = raw.type;
  if (typeof type !== "string" || !PAYMENT_INTENT_TYPES.includes(type as PaymentIntentType)) {
    return {
      ok: false,
      code: MODEL_INVALID_OUTPUT,
      message: "Model intent had an unsupported type.",
    };
  }

  const readOptionalString = (
    key: string,
    maxLength: number,
  ): ValidationResult<string | null> => {
    const value = raw[key];
    if (value === undefined || value === null) return { ok: true, data: null };
    if (typeof value !== "string") {
      return {
        ok: false,
        code: MODEL_INVALID_OUTPUT,
        message: `Model intent field '${key}' had an invalid type.`,
      };
    }
    const trimmed = value.trim();
    if (!trimmed) return { ok: true, data: null };
    return { ok: true, data: trimmed.slice(0, maxLength) };
  };

  const amount = readOptionalString("amountNgn", 32);
  if (!amount.ok) return amount;
  const phone = readOptionalString("phone", 32);
  if (!phone.ok) return phone;

  const networkRaw = raw.network;
  let network: PaymentNetwork | null = null;
  if (networkRaw !== undefined && networkRaw !== null) {
    network = normalizePaymentNetwork(networkRaw);
    if (!network) {
      return {
        ok: false,
        code: MODEL_INVALID_OUTPUT,
        message: "Model intent field 'network' was not a supported network.",
      };
    }
  }

  return {
    ok: true,
    data: {
      type: type as PaymentIntentType,
      amountNgn: amount.data,
      phone: phone.data,
      network,
    },
  };
}

/**
 * Strictly parses a raw model response (JSON string or already-parsed value)
 * into the frozen `AssistantModelOutput` shape. Any structural deviation is a
 * hard failure — it is never repaired or guessed.
 */
export function parseAssistantModelOutput(
  raw: unknown,
): ValidationResult<AssistantModelOutput> {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) {
      return {
        ok: false,
        code: MODEL_INVALID_OUTPUT,
        message: "Model returned an empty response.",
      };
    }
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        ok: false,
        code: MODEL_INVALID_OUTPUT,
        message: "Model response was not valid JSON.",
      };
    }
  }

  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      code: MODEL_INVALID_OUTPUT,
      message: "Model response must be a JSON object.",
    };
  }

  const mode = parsed.mode;
  if (mode !== "chat" && mode !== "payment_intent") {
    return {
      ok: false,
      code: MODEL_INVALID_OUTPUT,
      message: "Model response had an unknown mode.",
    };
  }

  const reply = parsed.reply;
  if (typeof reply !== "string" || !reply.trim()) {
    return {
      ok: false,
      code: MODEL_INVALID_OUTPUT,
      message: "Model response was missing a reply.",
    };
  }
  const boundedReply = reply.trim().slice(0, MAX_REPLY_LENGTH);

  const intentRaw = parsed.intent;
  if (mode === "chat") {
    if (intentRaw !== undefined && intentRaw !== null) {
      return {
        ok: false,
        code: MODEL_INVALID_OUTPUT,
        message: "Chat responses must not carry a payment intent.",
      };
    }
    return {
      ok: true,
      data: { mode: "chat", reply: boundedReply, intent: null },
    };
  }

  if (!isPlainObject(intentRaw)) {
    return {
      ok: false,
      code: MODEL_INVALID_OUTPUT,
      message: "Payment intent responses must include an intent object.",
    };
  }
  const candidate = parseIntentCandidate(intentRaw);
  if (!candidate.ok) return candidate;

  return {
    ok: true,
    data: {
      mode: "payment_intent",
      reply: boundedReply,
      intent: candidate.data,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Intent resolution                                                          */
/* -------------------------------------------------------------------------- */

export function isAirtimeIntent(
  intent: PaymentIntent | null | undefined,
): intent is AirtimeIntent {
  return Boolean(intent) && intent!.type === "airtime";
}

export interface ResolveIntentInput {
  candidate: ModelIntentCandidate | null;
  userMessage: string;
  history: readonly ConversationMessage[];
  activeIntent: PaymentIntent | null;
}

/**
 * Merges a validated model candidate with the active draft and recomputes
 * every derived field. Returns null when the turn carries no intent at all, in
 * which case the caller keeps the existing draft unchanged.
 */
export function resolveIntent({
  candidate,
  userMessage,
  history,
  activeIntent,
}: ResolveIntentInput): PaymentIntent | null {
  if (!candidate) return null;

  if (candidate.type !== "airtime") {
    const unsupported: UnsupportedIntent = {
      type: candidate.type,
      missingFields: [],
      readyForConfirmation: false,
    };
    return unsupported;
  }

  const draft = isAirtimeIntent(activeIntent) ? activeIntent : null;

  // A candidate field that is absent (null/undefined) means "the user did not
  // restate it" -> keep the draft. A field that is present but not canonical
  // means the user tried to change it to something unusable -> clear it rather
  // than silently keeping the previous value.
  const amountPresent =
    candidate.amountNgn !== null && candidate.amountNgn !== undefined;
  const phonePresent =
    candidate.phone !== null && candidate.phone !== undefined;

  const candidateAmount = normalizeAirtimeAmountNgn(candidate.amountNgn);
  const candidatePhone = normalizePhoneNumber(candidate.phone);
  const amountNgn = amountPresent
    ? candidateAmount ?? undefined
    : draft?.amountNgn;
  const phone = phonePresent ? candidatePhone ?? undefined : draft?.phone;

  const phoneChanged = Boolean(draft) && draft!.phone !== phone;
  const namedNetworks = detectExplicitNetworks(userMessage);
  const promptedNetwork = detectPromptedNetwork(history);
  const suggestedNetwork = candidate.network ?? draft?.network;

  let network: PaymentNetwork | undefined;
  let networkConfirmed = false;

  if (namedNetworks.length === 1) {
    // The user named exactly one network in their own words.
    network = namedNetworks[0];
    networkConfirmed = true;
  } else if (namedNetworks.length > 1) {
    // Ambiguous naming can never confirm a network.
    network = suggestedNetwork;
    networkConfirmed = false;
  } else if (promptedNetwork && isAffirmative(userMessage)) {
    // A bare "yes" confirms the network that was just asked about.
    network = promptedNetwork;
    networkConfirmed = true;
  } else {
    network = suggestedNetwork;
    const networkUnchanged = Boolean(draft) && draft!.network === network;
    networkConfirmed = Boolean(draft?.networkConfirmed && networkUnchanged);
  }

  // Unconditional per contract: changing the recipient or the network resets
  // network confirmation, even when a network is named in the same turn.
  // Confirmation must be re-established for the new (phone, network) pair,
  // because mobile number portability makes a carried-over network unsafe.
  const networkChanged =
    draft !== null &&
    draft.network !== undefined &&
    draft.network !== network;
  if (phoneChanged || networkChanged) networkConfirmed = false;
  if (!network) networkConfirmed = false;

  const missingFields: AirtimeMissingField[] = [];
  if (!amountNgn) missingFields.push("amountNgn");
  if (!phone) missingFields.push("phone");
  if (!network || !networkConfirmed) missingFields.push("network");

  const intent: AirtimeIntent = {
    type: "airtime",
    ...(amountNgn ? { amountNgn } : {}),
    ...(phone ? { phone } : {}),
    ...(network ? { network } : {}),
    networkConfirmed,
    missingFields,
    readyForConfirmation: missingFields.length === 0,
  };

  return intent;
}
