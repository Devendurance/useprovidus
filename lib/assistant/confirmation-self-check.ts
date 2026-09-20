/**
 * Deterministic self-check for airtime confirmation safety.
 *
 * Proves the safety-critical properties of the confirmation gate: the intent
 * fingerprint is stable and sensitive, a preview only binds to the exact intent
 * it was priced for, completeness and freshness are enforced at runtime, the
 * quoted price is recomputed from the locked rate, the validity window is
 * pinned to the fixed quote TTL, and a confirmation transition never yields a
 * payment payload for a missing, stale, tampered, or mismatched quote.
 *
 * Run: npx tsx --conditions=react-server lib/assistant/confirmation-self-check.ts
 */

import "server-only";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateConfirmationTransition,
  type ConfirmationTransitionResult,
} from "@/lib/assistant/confirmation";
import {
  computeIntentFingerprint,
  validatePreviewBinding,
  type PreviewBindingReason,
  type PreviewBindingResult,
} from "@/lib/assistant/fingerprint";
import type {
  AirtimeIntent,
  AirtimePreview,
  PaymentNetwork,
} from "@/lib/assistant/types";
import { addDecimalStrings, divideDecimalStrings } from "@/lib/money/decimal";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const AMOUNT_NGN = "1000";
const PHONE = "08031234567";
const ALT_PHONE = "08029876543";
const NETWORK: PaymentNetwork = "mtn";
const ALT_NETWORK: PaymentNetwork = "airtel";
const OTHER_NETWORKS: readonly PaymentNetwork[] = ["glo", "9mobile"];

const QUOTED_AT = "2026-09-19T00:00:00.000Z";
const FRESH_MS = Date.parse(QUOTED_AT);
/** The quote lifetime is frozen at 5 minutes, exactly as the server prices it. */
const PREVIEW_TTL_MS = 5 * 60_000;
const EXPIRES_AT = new Date(FRESH_MS + PREVIEW_TTL_MS).toISOString();
const EXPIRES_AT_MS = Date.parse(EXPIRES_AT);

const RATE = "1538.461538";
/** The exact inverse quote the server would emit, never a hand-typed number. */
const AMOUNT_USDC = divideDecimalStrings(AMOUNT_NGN, RATE, 6, "ceil");
const TOTAL_USDC = addDecimalStrings(AMOUNT_USDC, "0");

function airtimeIntent(overrides: Partial<AirtimeIntent> = {}): AirtimeIntent {
  return {
    type: "airtime",
    amountNgn: AMOUNT_NGN,
    phone: PHONE,
    network: NETWORK,
    networkConfirmed: true,
    missingFields: [],
    readyForConfirmation: true,
    ...overrides,
  };
}

/** A preview priced for `intent`, with the fingerprint bound to that intent. */
function airtimePreview(
  intent: AirtimeIntent,
  overrides: Partial<AirtimePreview> = {},
): AirtimePreview {
  return {
    intentFingerprint: computeIntentFingerprint(intent),
    amountNgn: intent.amountNgn ?? "",
    phone: intent.phone ?? "",
    network: intent.network ?? NETWORK,
    amountUsdc: AMOUNT_USDC,
    feeUsdc: "0",
    totalUsdc: TOTAL_USDC,
    rate: RATE,
    quotedAt: QUOTED_AT,
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

/** First non-comment statement of a source file, for server-boundary checks. */
function firstStatement(relativePath: string): string {
  const source = readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").trimStart();
  return withoutComments.split("\n")[0].trim();
}

/** Pins the exact rejection reason so no drift can pass as a mere "invalid". */
function expectRejection(
  result: PreviewBindingResult,
  reason: PreviewBindingReason,
  label: string,
): void {
  assert.deepEqual(result, { valid: false, reason }, label);
}

function run() {
  console.log("Starting assistant confirmation self-check...");

  /* ---------------------------------------------------------------- */
  /* Server boundary                                                   */
  /* ---------------------------------------------------------------- */
  for (const serverModule of [
    "lib/assistant/fingerprint.ts",
    "lib/assistant/confirmation.ts",
    "lib/assistant/confirmation-self-check.ts",
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
  /* Fingerprint: deterministic, lowercase hex, order-independent      */
  /* ---------------------------------------------------------------- */
  const intent = airtimeIntent();
  const fingerprint = computeIntentFingerprint(intent);

  assert.match(fingerprint, /^[0-9a-f]{64}$/, "fingerprint is lowercase hex sha-256");
  assert.equal(
    fingerprint,
    computeIntentFingerprint(airtimeIntent()),
    "same intent yields an identical fingerprint",
  );
  assert.equal(
    fingerprint,
    computeIntentFingerprint({
      amountNgn: AMOUNT_NGN,
      phone: PHONE,
      network: NETWORK,
    }),
    "fingerprint depends only on the three canonical fields",
  );
  assert.equal(
    fingerprint,
    computeIntentFingerprint({
      network: NETWORK,
      phone: PHONE,
      amountNgn: AMOUNT_NGN,
    }),
    "field insertion order never changes the fingerprint",
  );

  /* ---------------------------------------------------------------- */
  /* Fingerprint: sensitive to every bound field                       */
  /* ---------------------------------------------------------------- */
  const driftSamples: Array<[string, string]> = [
    ["amount", computeIntentFingerprint({ amountNgn: "2000", phone: PHONE, network: NETWORK })],
    ["phone", computeIntentFingerprint({ amountNgn: AMOUNT_NGN, phone: ALT_PHONE, network: NETWORK })],
    ["network", computeIntentFingerprint({ amountNgn: AMOUNT_NGN, phone: PHONE, network: ALT_NETWORK })],
    ["missing phone", computeIntentFingerprint({ amountNgn: AMOUNT_NGN, network: NETWORK })],
    ["missing amount", computeIntentFingerprint({ phone: PHONE, network: NETWORK })],
    ["empty intent", computeIntentFingerprint({})],
  ];
  for (const network of OTHER_NETWORKS) {
    driftSamples.push([
      `network ${network}`,
      computeIntentFingerprint({ amountNgn: AMOUNT_NGN, phone: PHONE, network }),
    ]);
  }
  for (const [label, drifted] of driftSamples) {
    assert.notEqual(drifted, fingerprint, `changed ${label} must change the fingerprint`);
  }

  const allFingerprints = [fingerprint, ...driftSamples.map(([, value]) => value)];
  for (let i = 0; i < allFingerprints.length; i += 1) {
    for (let j = i + 1; j < allFingerprints.length; j += 1) {
      assert.notEqual(
        allFingerprints[i],
        allFingerprints[j],
        `fingerprints ${i} and ${j} must differ`,
      );
    }
  }

  /* ---------------------------------------------------------------- */
  /* Binding: matching fresh preview for every supported network       */
  /* ---------------------------------------------------------------- */
  for (const network of [NETWORK, ALT_NETWORK, ...OTHER_NETWORKS]) {
    const boundIntent = airtimeIntent({ network });
    assert.deepEqual(
      validatePreviewBinding(airtimePreview(boundIntent), boundIntent, FRESH_MS),
      { valid: true },
      `fresh preview binds for network ${network}`,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Binding: strict freshness, including the exact expiry instant     */
  /* ---------------------------------------------------------------- */
  const freshPreview = airtimePreview(intent);
  assert.deepEqual(
    validatePreviewBinding(freshPreview, intent, EXPIRES_AT_MS - 1),
    { valid: true },
    "one millisecond before expiry is still fresh",
  );
  expectRejection(
    validatePreviewBinding(freshPreview, intent, EXPIRES_AT_MS),
    "EXPIRED",
    "the exact expiry instant is already expired",
  );
  expectRejection(
    validatePreviewBinding(freshPreview, intent, EXPIRES_AT_MS + 1),
    "EXPIRED",
    "after expiry is expired",
  );
  expectRejection(
    validatePreviewBinding(freshPreview, intent, Number.NaN),
    "EXPIRED",
    "a non-comparable clock can never prove freshness",
  );
  // The default clock must accept a quote that is genuinely fresh *and* still
  // inside its fixed 5-minute window, so freshness is proven against the
  // real clock rather than a supplied one.
  const liveQuoteMs = Date.now();
  assert.deepEqual(
    validatePreviewBinding(
      airtimePreview(intent, {
        quotedAt: new Date(liveQuoteMs).toISOString(),
        expiresAt: new Date(liveQuoteMs + PREVIEW_TTL_MS).toISOString(),
      }),
      intent,
    ),
    { valid: true },
    "the default clock accepts a genuinely fresh quote",
  );

  /* ---------------------------------------------------------------- */
  /* Binding: tampered preview fields are rejected                     */
  /* ---------------------------------------------------------------- */
  expectRejection(
    validatePreviewBinding(airtimePreview(intent, { amountNgn: "2000" }), intent, FRESH_MS),
    "FIELD_MISMATCH",
    "preview amount must equal the intent amount",
  );
  expectRejection(
    validatePreviewBinding(airtimePreview(intent, { phone: ALT_PHONE }), intent, FRESH_MS),
    "FIELD_MISMATCH",
    "preview phone must equal the intent phone",
  );
  expectRejection(
    validatePreviewBinding(airtimePreview(intent, { network: ALT_NETWORK }), intent, FRESH_MS),
    "FIELD_MISMATCH",
    "preview network must equal the intent network",
  );
  expectRejection(
    validatePreviewBinding(
      { ...airtimePreview(intent), feeUsdc: "1" } as unknown as AirtimePreview,
      intent,
      FRESH_MS,
    ),
    "FIELD_MISMATCH",
    "a non-zero fee can never be confirmed",
  );
  expectRejection(
    validatePreviewBinding(
      airtimePreview(intent, { intentFingerprint: "0".repeat(64) }),
      intent,
      FRESH_MS,
    ),
    "FINGERPRINT_MISMATCH",
    "a forged fingerprint never binds",
  );
  expectRejection(
    validatePreviewBinding(airtimePreview(intent, { intentFingerprint: "" }), intent, FRESH_MS),
    "FINGERPRINT_MISMATCH",
    "an empty fingerprint never binds",
  );

  const emptySnapshotFields: Array<[string, Partial<AirtimePreview>]> = [
    ["amountUsdc", { amountUsdc: "" }],
    ["totalUsdc", { totalUsdc: "" }],
    ["rate", { rate: "" }],
    ["quotedAt", { quotedAt: "" }],
  ];
  for (const [field, override] of emptySnapshotFields) {
    expectRejection(
      validatePreviewBinding(airtimePreview(intent, override), intent, FRESH_MS),
      "FIELD_MISMATCH",
      `an empty ${field} is never a confirmable snapshot`,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Binding: tampered economics and forged validity window never bind */
  /* ---------------------------------------------------------------- */
  expectRejection(
    validatePreviewBinding(airtimePreview(intent, { amountUsdc: "0.01" }), intent, FRESH_MS),
    "FIELD_MISMATCH",
    "a tampered amountUsdc is never the inverse quote at the locked rate",
  );
  expectRejection(
    validatePreviewBinding(airtimePreview(intent, { totalUsdc: "0.01" }), intent, FRESH_MS),
    "FIELD_MISMATCH",
    "a tampered totalUsdc never equals the amount plus the fee",
  );
  // Consistent-looking cheapening: both numbers lowered together still fails,
  // because the price is recomputed from the locked rate, not self-compared.
  expectRejection(
    validatePreviewBinding(
      airtimePreview(intent, { amountUsdc: "0.5", totalUsdc: "0.5" }),
      intent,
      FRESH_MS,
    ),
    "FIELD_MISMATCH",
    "a cheaper self-consistent price is not the quote the rate locked",
  );
  for (const unusableRate of ["0", "not-a-rate"]) {
    expectRejection(
      validatePreviewBinding(airtimePreview(intent, { rate: unusableRate }), intent, FRESH_MS),
      "FIELD_MISMATCH",
      `a quote priced at rate ${JSON.stringify(unusableRate)} is never confirmable`,
    );
  }
  expectRejection(
    validatePreviewBinding(
      airtimePreview(intent, { expiresAt: "2999-01-01T00:00:00.000Z" }),
      intent,
      FRESH_MS,
    ),
    "FIELD_MISMATCH",
    "a forged far-future expiry can never extend a quote",
  );
  expectRejection(
    validatePreviewBinding(airtimePreview(intent, { expiresAt: "not-a-date" }), intent, FRESH_MS),
    "FIELD_MISMATCH",
    "an unparseable expiry can never be a valid quote snapshot",
  );
  expectRejection(
    validatePreviewBinding(airtimePreview(intent, { quotedAt: EXPIRES_AT }), intent, FRESH_MS),
    "FIELD_MISMATCH",
    "a shifted quotedAt cannot claim the original expiry as its horizon",
  );

  /* ---------------------------------------------------------------- */
  /* Binding: intent drift invalidates a stale quote                   */
  /* ---------------------------------------------------------------- */
  const driftedIntents: Array<[string, AirtimeIntent]> = [
    ["amount", airtimeIntent({ amountNgn: "2000" })],
    ["phone", airtimeIntent({ phone: ALT_PHONE })],
    ["network", airtimeIntent({ network: ALT_NETWORK })],
  ];
  for (const [label, driftedIntent] of driftedIntents) {
    expectRejection(
      validatePreviewBinding(freshPreview, driftedIntent, FRESH_MS),
      "FINGERPRINT_MISMATCH",
      `changed intent ${label} must invalidate the existing quote`,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Binding: incomplete or non-canonical intents are not confirmable  */
  /* ---------------------------------------------------------------- */
  const incompleteIntents: Array<[string, AirtimeIntent]> = [
    ["missing amount", airtimeIntent({ amountNgn: undefined })],
    ["empty amount", airtimeIntent({ amountNgn: "" })],
    ["missing phone", airtimeIntent({ phone: undefined })],
    ["empty phone", airtimeIntent({ phone: "" })],
    ["missing network", airtimeIntent({ network: undefined })],
    [
      "unsupported network",
      { ...airtimeIntent(), network: "etisalat" } as unknown as AirtimeIntent,
    ],
  ];
  for (const [label, incomplete] of incompleteIntents) {
    expectRejection(
      validatePreviewBinding(airtimePreview(incomplete), incomplete, FRESH_MS),
      "NOT_READY",
      `an intent with a ${label} is not confirmable`,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Binding: readiness and fixed precedence                           */
  /* ---------------------------------------------------------------- */
  const notReady = airtimeIntent({
    network: undefined,
    networkConfirmed: false,
    missingFields: ["network"],
    readyForConfirmation: false,
  });
  expectRejection(
    validatePreviewBinding(freshPreview, notReady, FRESH_MS),
    "NOT_READY",
    "an intent awaiting details can never be confirmed",
  );
  expectRejection(
    validatePreviewBinding(freshPreview, notReady, EXPIRES_AT_MS + 1),
    "NOT_READY",
    "readiness is reported before freshness",
  );
  expectRejection(
    validatePreviewBinding(
      airtimePreview(intent, { intentFingerprint: "0".repeat(64) }),
      intent,
      EXPIRES_AT_MS + 1,
    ),
    "FINGERPRINT_MISMATCH",
    "binding is reported before freshness",
  );

  /* ---------------------------------------------------------------- */
  /* Transition: success only for a bound, fresh quote                 */
  /* ---------------------------------------------------------------- */
  const confirmed = validateConfirmationTransition(intent, freshPreview, FRESH_MS);
  assert.equal(confirmed.ok, true, "a bound fresh quote confirms");
  if (confirmed.ok) {
    assert.deepEqual(confirmed.data, {
      amountNgn: AMOUNT_NGN,
      phone: PHONE,
      network: NETWORK,
      amountUsdc: AMOUNT_USDC,
      feeUsdc: "0",
      totalUsdc: TOTAL_USDC,
      rate: RATE,
      quotedAt: QUOTED_AT,
      expiresAt: EXPIRES_AT,
      intentFingerprint: fingerprint,
    });
  }
  assert.deepEqual(
    validateConfirmationTransition(intent, freshPreview, FRESH_MS),
    confirmed,
    "the transition is deterministic",
  );

  /* ---------------------------------------------------------------- */
  /* Transition: rejection is stable, truthful, and payload-free       */
  /* ---------------------------------------------------------------- */
  const rejections: Array<{
    label: string;
    result: ConfirmationTransitionResult;
    code: PreviewBindingReason;
  }> = [
    {
      label: "expired quote",
      result: validateConfirmationTransition(intent, freshPreview, EXPIRES_AT_MS),
      code: "EXPIRED",
    },
    {
      label: "fingerprint mismatch",
      result: validateConfirmationTransition(
        airtimeIntent({ phone: ALT_PHONE }),
        freshPreview,
        FRESH_MS,
      ),
      code: "FINGERPRINT_MISMATCH",
    },
    {
      label: "field mismatch",
      result: validateConfirmationTransition(
        intent,
        airtimePreview(intent, { amountNgn: "2000" }),
        FRESH_MS,
      ),
      code: "FIELD_MISMATCH",
    },
    {
      label: "not ready",
      result: validateConfirmationTransition(notReady, freshPreview, FRESH_MS),
      code: "NOT_READY",
    },
    {
      label: "incomplete intent",
      result: validateConfirmationTransition(
        airtimeIntent({ amountNgn: undefined }),
        freshPreview,
        FRESH_MS,
      ),
      code: "NOT_READY",
    },
  ];

  for (const { label, result, code } of rejections) {
    if (result.ok) assert.fail(`${label} must not confirm`);
    assert.equal(result.code, code, `${label} maps to ${code}`);
    assert.ok(result.message.length > 0, `${label} carries a message`);
    assert.equal("data" in result, false, `${label} must not leak a payment payload`);
  }

  console.log("Assistant confirmation self-check: ALL ASSERTIONS PASSED!");
}

run();
