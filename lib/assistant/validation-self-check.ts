/**
 * Deterministic self-check for the assistant intent validation engine.
 *
 * Covers the safety-critical rules only: canonicalization, bounds, network
 * confirmation semantics (prefix suggestion vs explicit naming vs bare
 * affirmation), draft merge/reset behavior, and strict model-output parsing.
 *
 * Run: npx tsx --conditions=react-server lib/assistant/validation-self-check.ts
 */

import "server-only";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AirtimeIntent,
  ConversationMessage,
  PaymentIntent,
} from "@/lib/assistant/types";
import {
  AIRTIME_MISSING_FIELD_ORDER,
  deriveNetworkConfirmedFromHistory,
  detectExplicitNetworks,
  detectMessageNetwork,
  detectPromptedNetwork,
  extractPhoneCandidates,
  isAffirmative,
  normalizeAirtimeAmountNgn,
  normalizePaymentNetwork,
  normalizePhoneNumber,
  parseAssistantModelOutput,
  resolveIntent,
  sanitizeIncomingIntent,
} from "@/lib/assistant/validation";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const PHONE = "08031234567";
const ALT_PHONE = "08029876543";
const TIMESTAMP = "2026-09-19T00:00:00.000Z";

function assistantMessage(
  content: string,
  intent?: PaymentIntent,
): ConversationMessage {
  return intent
    ? { role: "assistant", content, timestamp: TIMESTAMP, intent }
    : { role: "assistant", content, timestamp: TIMESTAMP };
}

function userMessage(content: string): ConversationMessage {
  return { role: "user", content, timestamp: TIMESTAMP };
}

function airtimeDraft(overrides: Partial<AirtimeIntent> = {}): AirtimeIntent {
  return {
    type: "airtime",
    amountNgn: "500",
    phone: PHONE,
    network: "mtn",
    networkConfirmed: true,
    missingFields: [],
    readyForConfirmation: true,
    ...overrides,
  };
}

function expectInvalidModelOutput(raw: unknown): void {
  const result = parseAssistantModelOutput(raw);
  assert.equal(
    result.ok,
    false,
    `expected invalid model output for ${JSON.stringify(raw)}`,
  );
  if (!result.ok) assert.equal(result.code, "MODEL_INVALID_OUTPUT");
}

/** First non-comment statement of a source file, for server-boundary checks. */
function firstStatement(relativePath: string): string {
  const source = readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").trimStart();
  return withoutComments.split("\n")[0].trim();
}

function run() {
  console.log("Starting assistant validation self-check...");

  /* ---------------------------------------------------------------- */
  /* Server boundary                                                   */
  /* ---------------------------------------------------------------- */
  for (const serverModule of [
    "lib/assistant/validation.ts",
    "lib/assistant/resolve.ts",
    "lib/assistant/status.ts",
    "lib/assistant/validation-self-check.ts",
    "lib/assistant/status-self-check.ts",
    "lib/assistant/chat-route-self-check.ts",
  ]) {
    assert.equal(
      firstStatement(serverModule),
      'import "server-only";',
      `${serverModule} must start with import "server-only";`,
    );
  }
  assert.equal(
    readFileSync(path.join(REPO_ROOT, "lib/assistant/types.ts"), "utf8").includes(
      "server-only",
    ),
    false,
    "lib/assistant/types.ts must stay client-safe",
  );

  /* ---------------------------------------------------------------- */
  /* Amount: exact integer, inclusive 50..50,000, never rounded        */
  /* ---------------------------------------------------------------- */
  assert.equal(normalizeAirtimeAmountNgn("500"), "500");
  assert.equal(normalizeAirtimeAmountNgn(500), "500");
  assert.equal(normalizeAirtimeAmountNgn(" 50 "), "50");
  assert.equal(normalizeAirtimeAmountNgn("50000"), "50000");
  assert.equal(normalizeAirtimeAmountNgn("50,000"), "50000");
  assert.equal(normalizeAirtimeAmountNgn("₦500"), "500");
  assert.equal(normalizeAirtimeAmountNgn("49"), null);
  assert.equal(normalizeAirtimeAmountNgn("0"), null);
  assert.equal(normalizeAirtimeAmountNgn("50001"), null);
  assert.equal(normalizeAirtimeAmountNgn("1000000"), null);
  assert.equal(normalizeAirtimeAmountNgn("500.5"), null);
  assert.equal(normalizeAirtimeAmountNgn(500.5), null);
  assert.equal(normalizeAirtimeAmountNgn("1e3"), null);
  assert.equal(normalizeAirtimeAmountNgn("-500"), null);
  assert.equal(normalizeAirtimeAmountNgn(""), null);
  assert.equal(normalizeAirtimeAmountNgn(null), null);
  assert.equal(normalizeAirtimeAmountNgn(Number.NaN), null);

  /* ---------------------------------------------------------------- */
  /* Phone: ClubKonnect canonical 11-digit local form                  */
  /* ---------------------------------------------------------------- */
  assert.equal(normalizePhoneNumber(PHONE), PHONE);
  assert.equal(normalizePhoneNumber("+2348031234567"), PHONE);
  assert.equal(normalizePhoneNumber("2348031234567"), PHONE);
  assert.equal(normalizePhoneNumber("0803 123 4567"), PHONE);
  assert.equal(normalizePhoneNumber("0803123456"), null);
  assert.equal(normalizePhoneNumber("080312345678"), null);
  assert.equal(normalizePhoneNumber("8031234567"), null);
  assert.equal(normalizePhoneNumber(8031234567), null);

  /* ---------------------------------------------------------------- */
  /* Network canonicalization                                          */
  /* ---------------------------------------------------------------- */
  assert.equal(normalizePaymentNetwork("MTN"), "mtn");
  assert.equal(normalizePaymentNetwork(" 9Mobile "), "9mobile");
  assert.equal(normalizePaymentNetwork("etisalat"), "9mobile");
  assert.equal(normalizePaymentNetwork("globacom"), "glo");
  assert.equal(normalizePaymentNetwork("vodafone"), null);
  assert.equal(normalizePaymentNetwork(""), null);
  assert.equal(normalizePaymentNetwork(null), null);

  /* ---------------------------------------------------------------- */
  /* Explicit naming vs. affirmation                                   */
  /* ---------------------------------------------------------------- */
  assert.deepEqual(detectExplicitNetworks("buy mtn airtime"), ["mtn"]);
  assert.deepEqual(detectExplicitNetworks("is it glo or airtel?"), [
    "airtel",
    "glo",
  ]);
  assert.deepEqual(detectExplicitNetworks("the glow of the screen"), []);
  assert.equal(isAffirmative("Yes."), true);
  assert.equal(isAffirmative(" yes please "), true);
  assert.equal(isAffirmative("yes but use glo"), false);
  assert.equal(isAffirmative("no"), false);
  assert.equal(isAffirmative(""), false);

  const unconfirmedDraft = airtimeDraft({
    networkConfirmed: false,
    missingFields: ["network"],
    readyForConfirmation: false,
  });

  assert.equal(
    detectPromptedNetwork([
      assistantMessage(
        "That looks like it may be MTN. Is MTN correct?",
        unconfirmedDraft,
      ),
    ]),
    "mtn",
  );
  assert.equal(
    detectPromptedNetwork([assistantMessage("Which network should I use?")]),
    null,
  );
  assert.equal(detectPromptedNetwork([userMessage("yes")]), null);
  assert.equal(
    detectMessageNetwork(assistantMessage("Which one, mtn or glo?")),
    null,
  );

  /* ---------------------------------------------------------------- */
  /* History replay: server-derived confirmation evidence              */
  /* ---------------------------------------------------------------- */
  assert.deepEqual(extractPhoneCandidates(`call me on ${PHONE} please`), [PHONE]);
  assert.deepEqual(
    extractPhoneCandidates("+234 803 123 4567"),
    [PHONE],
  );
  assert.deepEqual(extractPhoneCandidates("amount 50000"), []);

  const statedPhoneHistory: ConversationMessage[] = [
    userMessage(`send 500 airtime to ${PHONE}`),
    assistantMessage("That looks like MTN. Is MTN correct?"),
    userMessage("Yes."),
  ];
  assert.equal(
    deriveNetworkConfirmedFromHistory(statedPhoneHistory, "mtn", PHONE),
    true,
  );
  assert.equal(
    deriveNetworkConfirmedFromHistory(statedPhoneHistory, "glo", PHONE),
    false,
  );
  assert.equal(
    deriveNetworkConfirmedFromHistory(
      [userMessage(`send it to ${PHONE} on glo`)],
      "glo",
      PHONE,
    ),
    true,
  );
  assert.equal(
    deriveNetworkConfirmedFromHistory(
      [userMessage(`send ${PHONE} on glo`), userMessage("actually mtn")],
      "glo",
      PHONE,
    ),
    false,
  );

  // A phone change after the confirmation resets it, even for the new number.
  assert.equal(
    deriveNetworkConfirmedFromHistory(
      [
        userMessage(`send ${PHONE} on mtn`),
        userMessage(`change it to ${ALT_PHONE}`),
      ],
      "mtn",
      ALT_PHONE,
    ),
    false,
  );

  // A confirmation re-established after the change holds.
  assert.equal(
    deriveNetworkConfirmedFromHistory(
      [
        userMessage(`send ${PHONE} on mtn`),
        userMessage(`change it to ${ALT_PHONE}`),
        assistantMessage("That looks like MTN. Is MTN correct?"),
        userMessage("Yes."),
      ],
      "mtn",
      ALT_PHONE,
    ),
    true,
  );

  // Continuity that cannot be proven is never confirmed.
  assert.equal(
    deriveNetworkConfirmedFromHistory(
      [assistantMessage("Is MTN correct?"), userMessage("Yes.")],
      "mtn",
      PHONE,
    ),
    false,
  );
  assert.equal(deriveNetworkConfirmedFromHistory([], "mtn", PHONE), false);
  assert.equal(
    deriveNetworkConfirmedFromHistory(
      [userMessage(`send ${PHONE} on mtn`)],
      "mtn",
      null,
    ),
    false,
  );

  /* ---------------------------------------------------------------- */
  /* Inbound draft sanitization: derived fields are never trusted      */
  /* ---------------------------------------------------------------- */
  const forged = sanitizeIncomingIntent(
    {
      type: "airtime",
      amountNgn: "500",
      phone: PHONE,
      network: "mtn",
      networkConfirmed: true,
      missingFields: [],
      readyForConfirmation: true,
    },
    [],
  );
  assert.equal(forged.ok, true);
  if (forged.ok) {
    const intent = forged.intent as AirtimeIntent;
    assert.equal(intent.networkConfirmed, false);
    assert.deepEqual(intent.missingFields, ["network"]);
    assert.equal(intent.readyForConfirmation, false);
  }

  const supported = sanitizeIncomingIntent(
    { type: "airtime", amountNgn: "500", phone: PHONE, network: "mtn" },
    [
      userMessage(`send 500 airtime to ${PHONE}`),
      assistantMessage("That looks like MTN. Is MTN correct?"),
      userMessage("Yes."),
    ],
  );
  assert.equal(supported.ok, true);
  if (supported.ok) {
    const intent = supported.intent as AirtimeIntent;
    assert.equal(intent.networkConfirmed, true);
    assert.deepEqual(intent.missingFields, []);
    assert.equal(intent.readyForConfirmation, true);
  }

  const canonicalized = sanitizeIncomingIntent(
    { type: "airtime", amountNgn: "1e3", phone: "+2348031234567", network: "MTN" },
    [],
  );
  assert.equal(canonicalized.ok, true);
  if (canonicalized.ok) {
    const intent = canonicalized.intent as AirtimeIntent;
    assert.equal(intent.amountNgn, undefined);
    assert.equal(intent.phone, PHONE);
    assert.equal(intent.network, "mtn");
    assert.deepEqual(intent.missingFields, ["amountNgn", "network"]);
  }

  const unsupportedDraft = sanitizeIncomingIntent({ type: "data" }, []);
  assert.equal(unsupportedDraft.ok, true);
  if (unsupportedDraft.ok) {
    assert.equal(unsupportedDraft.intent?.type, "data");
    assert.equal(unsupportedDraft.intent?.readyForConfirmation, false);
  }

  const noDraft = sanitizeIncomingIntent(null, []);
  assert.equal(noDraft.ok, true);
  if (noDraft.ok) assert.equal(noDraft.intent, null);

  assert.equal(sanitizeIncomingIntent({ type: "telepathy" }, []).ok, false);
  assert.equal(sanitizeIncomingIntent("nope", []).ok, false);

  /* ---------------------------------------------------------------- */
  /* Model output parsing                                              */
  /* ---------------------------------------------------------------- */
  const chatOutput = parseAssistantModelOutput(
    '{"mode":"chat","reply":"Hi! How can I help?","intent":null}',
  );
  assert.equal(chatOutput.ok, true);
  if (chatOutput.ok) {
    assert.equal(chatOutput.data.intent, null);
    assert.equal(chatOutput.data.reply, "Hi! How can I help?");
  }

  const intentOutput = parseAssistantModelOutput({
    mode: "payment_intent",
    reply: "Got it.",
    intent: { type: "airtime", amountNgn: "500", phone: PHONE, network: "MTN" },
  });
  assert.equal(intentOutput.ok, true);
  if (intentOutput.ok) {
    assert.equal(intentOutput.data.intent?.network, "mtn");
    assert.equal(intentOutput.data.intent?.amountNgn, "500");
  }

  for (const invalid of [
    "not json",
    "",
    "[]",
    "null",
    '{"mode":"other","reply":"x","intent":null}',
    '{"mode":"chat","reply":"   ","intent":null}',
    '{"mode":"chat","reply":"x","intent":{"type":"airtime"}}',
    '{"mode":"payment_intent","reply":"x","intent":null}',
    '{"mode":"payment_intent","reply":"x","intent":{"type":"telepathy"}}',
    '{"mode":"payment_intent","reply":"x","intent":{"type":"airtime","network":"vodafone"}}',
    '{"mode":"payment_intent","reply":"x","intent":{"type":"airtime","amountNgn":500}}',
    '{"mode":"payment_intent","reply":"x","intent":{"type":"airtime","phone":8031234567}}',
  ]) {
    expectInvalidModelOutput(invalid);
  }

  /* ---------------------------------------------------------------- */
  /* Intent resolution                                                 */
  /* ---------------------------------------------------------------- */
  const chatTurn = resolveIntent({
    candidate: null,
    userMessage: "hey",
    history: [],
    activeIntent: airtimeDraft(),
  });
  assert.equal(chatTurn, null, "a chat turn must not fabricate an intent");

  const unsupported = resolveIntent({
    candidate: { type: "data" },
    userMessage: "buy 1GB data",
    history: [],
    activeIntent: null,
  });
  assert.equal(unsupported?.type, "data");
  assert.equal(unsupported?.readyForConfirmation, false);
  assert.deepEqual(unsupported?.missingFields, []);

  const thresholdCandidate = {
    type: "airtime" as const,
    amountNgn: "500",
    phone: PHONE,
    network: "mtn" as const,
  };

  // Prefix-only suggestion is never a confirmation.
  const suggested = resolveIntent({
    candidate: thresholdCandidate,
    userMessage: `Buy 500 airtime for ${PHONE}`,
    history: [],
    activeIntent: null,
  }) as AirtimeIntent;
  assert.equal(suggested.network, "mtn");
  assert.equal(suggested.networkConfirmed, false);
  assert.deepEqual(suggested.missingFields, ["network"]);
  assert.equal(suggested.readyForConfirmation, false);

  // Explicit naming confirms.
  const explicit = resolveIntent({
    candidate: thresholdCandidate,
    userMessage: `send 500 mtn airtime to ${PHONE}`,
    history: [],
    activeIntent: null,
  }) as AirtimeIntent;
  assert.equal(explicit.networkConfirmed, true);
  assert.deepEqual(explicit.missingFields, []);
  assert.equal(explicit.readyForConfirmation, true);

  // Bare affirmation directly after a prompt naming the network confirms.
  const affirmed = resolveIntent({
    candidate: thresholdCandidate,
    userMessage: "Yes.",
    history: [
      assistantMessage("That looks like MTN. Is MTN correct?", unconfirmedDraft),
    ],
    activeIntent: unconfirmedDraft,
  }) as AirtimeIntent;
  assert.equal(affirmed.networkConfirmed, true);
  assert.deepEqual(affirmed.missingFields, []);
  assert.equal(affirmed.readyForConfirmation, true);

  // The same affirmation is not confirmation when the prompt named no network.
  const affirmWithoutPrompt = resolveIntent({
    candidate: thresholdCandidate,
    userMessage: "Yes.",
    history: [assistantMessage("Which network should I use?")],
    activeIntent: null,
  }) as AirtimeIntent;
  assert.equal(affirmWithoutPrompt.networkConfirmed, false);
  assert.deepEqual(affirmWithoutPrompt.missingFields, ["network"]);

  // Canonical phone from an international format.
  const international = resolveIntent({
    candidate: { ...thresholdCandidate, phone: "+2348031234567" },
    userMessage: "send 500 mtn airtime to +2348031234567",
    history: [],
    activeIntent: null,
  }) as AirtimeIntent;
  assert.equal(international.phone, PHONE);

  // Changing the phone resets network confirmation.
  const phoneChanged = resolveIntent({
    candidate: { type: "airtime", phone: ALT_PHONE, network: "mtn" },
    userMessage: `change the number to ${ALT_PHONE}`,
    history: [],
    activeIntent: airtimeDraft(),
  }) as AirtimeIntent;
  assert.equal(phoneChanged.phone, ALT_PHONE);
  assert.equal(phoneChanged.amountNgn, "500");
  assert.equal(phoneChanged.networkConfirmed, false);
  assert.deepEqual(phoneChanged.missingFields, ["network"]);
  assert.equal(phoneChanged.readyForConfirmation, false);

  // A changed recipient number resets confirmation, even when a network is
  // named in the same turn: confirmation must be re-established.
  const newPhoneExplicitNetwork = resolveIntent({
    candidate: { type: "airtime", phone: ALT_PHONE, network: "mtn" },
    userMessage: `send it to ${ALT_PHONE} on mtn`,
    history: [],
    activeIntent: airtimeDraft(),
  }) as AirtimeIntent;
  assert.equal(newPhoneExplicitNetwork.phone, ALT_PHONE);
  assert.equal(newPhoneExplicitNetwork.networkConfirmed, false);
  assert.deepEqual(newPhoneExplicitNetwork.missingFields, ["network"]);
  assert.equal(newPhoneExplicitNetwork.readyForConfirmation, false);

  // Naming the network for the number the user just typed still confirms.
  const firstTurnExplicitNetwork = resolveIntent({
    candidate: {
      type: "airtime",
      amountNgn: "500",
      phone: ALT_PHONE,
      network: "mtn",
    },
    userMessage: `send 500 mtn airtime to ${ALT_PHONE}`,
    history: [],
    activeIntent: null,
  }) as AirtimeIntent;
  assert.equal(firstTurnExplicitNetwork.networkConfirmed, true);
  assert.equal(firstTurnExplicitNetwork.readyForConfirmation, true);

  // A present-but-invalid amount clears the old value instead of keeping it.
  const badAmount = resolveIntent({
    candidate: { type: "airtime", amountNgn: "20", phone: PHONE, network: "mtn" },
    userMessage: "make it 20 naira",
    history: [],
    activeIntent: airtimeDraft(),
  }) as AirtimeIntent;
  assert.equal(badAmount.amountNgn, undefined);
  assert.deepEqual(badAmount.missingFields, ["amountNgn"]);
  assert.equal(badAmount.readyForConfirmation, false);

  const fractionalAmount = resolveIntent({
    candidate: {
      type: "airtime",
      amountNgn: "500.5",
      phone: PHONE,
      network: "mtn",
    },
    userMessage: "500.5 naira on mtn",
    history: [],
    activeIntent: null,
  }) as AirtimeIntent;
  assert.equal(fractionalAmount.amountNgn, undefined);

  // A present-but-invalid phone clears the old value and resets confirmation.
  const badPhone = resolveIntent({
    candidate: { type: "airtime", amountNgn: "500", phone: "12345", network: "mtn" },
    userMessage: "use 12345",
    history: [],
    activeIntent: airtimeDraft(),
  }) as AirtimeIntent;
  assert.equal(badPhone.phone, undefined);
  assert.equal(badPhone.networkConfirmed, false);
  assert.deepEqual(badPhone.missingFields, ["phone", "network"]);

  // An unrelated change preserves an already confirmed draft.
  const preserved = resolveIntent({
    candidate: { type: "airtime", amountNgn: "1000", phone: PHONE, network: "mtn" },
    userMessage: "make it 1000",
    history: [],
    activeIntent: airtimeDraft(),
  }) as AirtimeIntent;
  assert.equal(preserved.amountNgn, "1000");
  assert.equal(preserved.networkConfirmed, true);
  assert.equal(preserved.readyForConfirmation, true);

  // Adding a field to an unconfirmed draft never makes it ready.
  const stillUnconfirmed = resolveIntent({
    candidate: { type: "airtime", amountNgn: "300", phone: PHONE, network: "mtn" },
    userMessage: "make it 300",
    history: [],
    activeIntent: unconfirmedDraft,
  }) as AirtimeIntent;
  assert.equal(stillUnconfirmed.networkConfirmed, false);
  assert.deepEqual(stillUnconfirmed.missingFields, ["network"]);
  assert.equal(stillUnconfirmed.readyForConfirmation, false);

  // An explicit network that changes the draft resets confirmation.
  const overridden = resolveIntent({
    candidate: thresholdCandidate,
    userMessage: "actually send it on glo",
    history: [],
    activeIntent: airtimeDraft(),
  }) as AirtimeIntent;
  assert.equal(overridden.network, "glo");
  assert.equal(overridden.networkConfirmed, false);
  assert.deepEqual(overridden.missingFields, ["network"]);
  assert.equal(overridden.readyForConfirmation, false);

  // Naming a network for a draft that had none confirms it.
  const networkAdded = resolveIntent({
    candidate: thresholdCandidate,
    userMessage: "use glo for it",
    history: [],
    activeIntent: airtimeDraft({
      network: undefined,
      networkConfirmed: false,
      missingFields: ["network"],
      readyForConfirmation: false,
    }),
  }) as AirtimeIntent;
  assert.equal(networkAdded.network, "glo");
  assert.equal(networkAdded.networkConfirmed, true);
  assert.equal(networkAdded.readyForConfirmation, true);

  // Ambiguous naming never confirms.
  const ambiguous = resolveIntent({
    candidate: thresholdCandidate,
    userMessage: "is it mtn or glo?",
    history: [],
    activeIntent: null,
  }) as AirtimeIntent;
  assert.equal(ambiguous.networkConfirmed, false);
  assert.equal(ambiguous.readyForConfirmation, false);

  // Canonical missing-field order.
  const empty = resolveIntent({
    candidate: { type: "airtime", amountNgn: null, phone: null, network: null },
    userMessage: "buy airtime",
    history: [],
    activeIntent: null,
  }) as AirtimeIntent;
  assert.deepEqual(empty.missingFields, [...AIRTIME_MISSING_FIELD_ORDER]);
  assert.equal(empty.readyForConfirmation, false);

  console.log("Assistant validation self-check: ALL ASSERTIONS PASSED!");
}

run();
