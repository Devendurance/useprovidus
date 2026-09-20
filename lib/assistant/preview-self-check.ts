/**
 * Self-check for the P4 quote/preview layer (BUILDER A).
 *
 * Proves, against a mocked Paycrest corridor and the real route handlers:
 *   1. `divideDecimalStrings` is exact BigInt math and rounds up by default,
 *      so the inverse quote can never under-fund the requested NGN value;
 *   2. `buildAirtimePreview` reads the *sell* rate, treats it as NGN per 1
 *      USDC, and emits the frozen ten-field `AirtimePreview` with the exact
 *      amounts, fingerprint, and 5-minute TTL;
 *   3. an incomplete or invalid intent fails before any network call;
 *   4. a failed, absent, or malformed provider quote never becomes a preview;
 *   5. the route exposes `{ ok: true, previewId, preview }` with
 *      `Cache-Control: no-store` and maps failures to non-200 responses
 *      without a preview (P5: the quote is issued to a wallet address and
 *      persisted under the returned `prev_${uuid}` identifier);
 *   6. every call that reaches the rate lookup emits exactly one safe
 *      `preview_timing` record carrying durations only — never the wallet, the
 *      phone number, the rate, or the quote — including failed lookups and
 *      failed writes, and emits nothing for a rejected intent.
 *
 * No live Paycrest calls, no wallet or blockchain transactions.
 * Run: npx tsx --conditions=react-server lib/assistant/preview-self-check.ts
 */

import "server-only";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { GET, POST } from "@/app/api/assistant/preview/route";
import { PREVIEW_TTL_MS, buildAirtimePreview } from "@/lib/assistant/preview";
import type { AirtimePreviewOptions } from "@/lib/assistant/preview";
import {
  FailClosedPreviewRepository,
  InMemoryPreviewRepository,
  setPreviewRepositoryForTesting,
} from "@/lib/assistant/preview-repository";
import type { AirtimePreviewRecordInput } from "@/lib/assistant/preview-repository";
import {
  addDecimalStrings,
  divideDecimalStrings,
  multiplyDecimalStrings,
} from "@/lib/money/decimal";

// Isolate Paycrest config before any call reads it.
process.env.PAYCREST_API_KEY = "test-key-not-real";
process.env.PAYCREST_BASE_URL = "https://api.paycrest.io/v2";

const AMOUNT_NGN = "500";
const PHONE = "08031234567";
const SELL_RATE = "1500";

/** P5: a preview is only issued to a wallet, and the wallet is normalized. */
const WALLET_ADDRESS = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

/** Exact NGN face value the ceiling quote covers: 0.333334 * 1500 >= 500. */
const EXACT_AMOUNT_USDC = "0.333334";

const SELL_CORRIDOR_PAYLOAD = {
  status: "success",
  data: {
    sell: {
      rate: SELL_RATE,
      providerIds: ["provider-1"],
      orderType: "regular",
      refundTimeoutMinutes: 10,
    },
    buy: {
      rate: "1400",
      providerIds: ["provider-1"],
      orderType: "regular",
      refundTimeoutMinutes: 10,
    },
  },
};

type CorridorRequest = { url: string; method: string; apiKey: string | null };

/** Resolves after `ms`; gives the corridor stub and the write a measurable cost. */
async function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Corridor-endpoint stub: records every request, never touches the network. */
function stubFetch(
  status: number,
  body: unknown,
  requests: CorridorRequest[],
  delayMs = 0,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (delayMs > 0) {
      await delay(delayMs);
    }
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    requests.push({
      url,
      method: init?.method ?? "GET",
      apiKey: new Headers(init?.headers).get("api-key"),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function previewUrl(query: string): string {
  return `http://localhost/api/assistant/preview${query}`;
}

/**
 * The in-memory preview store with a measurable write latency, so the
 * self-check can prove the persistence timer wraps the write itself rather
 * than reporting a constant.
 */
class DelayedPreviewRepository extends InMemoryPreviewRepository {
  constructor(private readonly writeDelayMs: number) {
    super();
  }

  async createPreview(preview: AirtimePreviewRecordInput) {
    await delay(this.writeDelayMs);
    return super.createPreview(preview);
  }
}

/** Thrown by the throwing fixtures below; identity proves errors pass through unwrapped. */
const THROWN_WRITE_ERROR = new Error("driver write failed");
const THROWN_QUOTE_ERROR = new Error("rate lookup exploded");

/**
 * A store whose write takes measurable time and then throws instead of
 * returning a failure result, as a driver-level error escapes a repository that
 * does not convert it.
 */
class ThrowingPreviewRepository extends InMemoryPreviewRepository {
  async createPreview(): Promise<never> {
    await delay(30);
    throw THROWN_WRITE_ERROR;
  }
}

/**
 * Options whose provider function cannot be read, so the rate lookup itself
 * throws rather than resolving to a failure result.
 */
function throwingQuoteOptions(): AirtimePreviewOptions {
  return {
    get fetchFn(): typeof fetch {
      throw THROWN_QUOTE_ERROR;
    },
    walletAddress: WALLET_ADDRESS,
  };
}

/** Frozen `preview_timing` key set: a timing record may carry nothing else. */
const PREVIEW_TIMING_KEYS = [
  "dbPersistenceDurationMs",
  "rateLookupDurationMs",
  "tag",
  "totalMs",
];

interface PreviewTimingRecord {
  tag: string;
  rateLookupDurationMs: number;
  dbPersistenceDurationMs: number;
  totalMs: number;
}

/**
 * Captures the `preview_timing` records the preview layer emits, forwarding
 * every other `console.log` line (this check's own progress output) unchanged.
 */
function capturePreviewTiming(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    const [first] = args;
    if (typeof first === "string" && first.includes('"preview_timing"')) {
      lines.push(first);
      return;
    }
    original(...args);
  };
  return {
    lines,
    restore: () => {
      console.log = original;
    },
  };
}

/**
 * Parses one captured line and proves it is a closed timing record: exactly the
 * frozen keys, non-negative integer durations, and a total that covers both
 * measured steps. A smuggled field — a phone number, a wallet, a rate — fails
 * the key assertion, and a line that is not JSON throws out of `JSON.parse`.
 */
function parsePreviewTiming(line: string, label: string): PreviewTimingRecord {
  const parsed = JSON.parse(line) as unknown;
  assert.equal(
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed),
    true,
    `${label}: a timing record must be a JSON object (got ${line})`,
  );
  const fields = parsed as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(fields).sort(),
    PREVIEW_TIMING_KEYS,
    `${label}: a timing record may only carry durations`,
  );
  assert.equal(fields.tag, "preview_timing", `${label}: frozen tag`);
  for (const key of [
    "rateLookupDurationMs",
    "dbPersistenceDurationMs",
    "totalMs",
  ] as const) {
    const value = fields[key];
    assert.equal(
      typeof value === "number" && Number.isInteger(value) && value >= 0,
      true,
      `${label}: ${key} must be a non-negative integer`,
    );
  }
  const timing = fields as unknown as PreviewTimingRecord;
  assert.equal(
    timing.totalMs >= timing.rateLookupDurationMs,
    true,
    `${label}: totalMs must cover the rate lookup`,
  );
  assert.equal(
    timing.totalMs >= timing.dbPersistenceDurationMs,
    true,
    `${label}: totalMs must cover the persistence write`,
  );
  return timing;
}

async function run() {
  // Every preview attempt in this check — including the sections below — emits
  // a timing record. They are captured for the whole run and asserted on in
  // section 6 instead of printing raw log lines.
  const timing = capturePreviewTiming();

  // P5: every successful preview is persisted server-side and returned with a
  // `prev_${uuid}` identifier. The in-memory repository keeps this check
  // offline; the persisted-preview behaviour itself is covered by
  // preview-authority-self-check.ts.
  setPreviewRepositoryForTesting(new InMemoryPreviewRepository());

  /* ------------------------------------------------------------------ */
  /* 1. Exact inverse-quote division                                     */
  /* ------------------------------------------------------------------ */

  assert.equal(divideDecimalStrings("500", "1500", 6, "ceil"), EXACT_AMOUNT_USDC);
  assert.equal(divideDecimalStrings("500", "1500", 6, "floor"), "0.333333");
  assert.equal(divideDecimalStrings("500", "1500", 6, "half_up"), "0.333333");
  assert.equal(divideDecimalStrings("500", "1500"), EXACT_AMOUNT_USDC); // ceil is the default
  assert.equal(divideDecimalStrings("1", "2"), "0.5");
  assert.equal(divideDecimalStrings("1500", "1500"), "1");
  assert.equal(divideDecimalStrings("0", "1500"), "0");
  assert.equal(divideDecimalStrings("100", "1500.5"), "0.066645");
  assert.equal(divideDecimalStrings("1", "3", 8, "ceil"), "0.33333334");
  assert.equal(divideDecimalStrings("1", "3", 8, "half_up"), "0.33333333");

  // Ceiling is load-bearing: the truncated quote would not cover the face value.
  assert.equal(multiplyDecimalStrings(EXACT_AMOUNT_USDC, SELL_RATE), "500.001");
  assert.equal(multiplyDecimalStrings("0.333333", SELL_RATE), "499.9995");

  assert.throws(() => divideDecimalStrings("1", "0"), /Division by zero/);
  assert.throws(
    () => divideDecimalStrings("1", "twelve"),
    /Invalid decimal string for division/,
  );
  assert.throws(
    () => divideDecimalStrings("", "2"),
    /Invalid decimal string for division/,
  );
  assert.throws(
    () => divideDecimalStrings("1", "1", -1),
    /Invalid maxDecimals/,
  );
  assert.throws(
    () => divideDecimalStrings("1", "1", 1.5),
    /Invalid maxDecimals/,
  );

  /* ------------------------------------------------------------------ */
  /* 2. Exact preview from the sell-side corridor rate                   */
  /* ------------------------------------------------------------------ */

  const previewRequests: CorridorRequest[] = [];
  const previewResult = await buildAirtimePreview(
    { amountNgn: AMOUNT_NGN, phone: PHONE, network: "mtn" },
    {
      fetchFn: stubFetch(200, SELL_CORRIDOR_PAYLOAD, previewRequests),
      walletAddress: WALLET_ADDRESS,
    },
  );
  assert.equal(previewResult.ok, true);
  if (!previewResult.ok) {
    throw new Error("expected a preview");
  }
  const preview = previewResult.data;
  assert.equal(/^prev_[0-9a-f-]{36}$/.test(previewResult.previewId), true);

  // Exactly one provider read, of the sell side, with the credential attached.
  assert.equal(previewRequests.length, 1);
  assert.equal(
    previewRequests[0].url,
    "https://api.paycrest.io/v2/rates/celo/USDC/1/NGN?side=sell",
  );
  assert.equal(previewRequests[0].method, "GET");
  assert.equal(previewRequests[0].apiKey, "test-key-not-real");

  // Exactly the frozen ten fields.
  assert.deepEqual(
    Object.keys(preview).sort(),
    [
      "amountNgn",
      "amountUsdc",
      "expiresAt",
      "feeUsdc",
      "intentFingerprint",
      "network",
      "phone",
      "quotedAt",
      "rate",
      "totalUsdc",
    ].sort(),
  );

  assert.equal(preview.amountNgn, AMOUNT_NGN);
  assert.equal(preview.phone, PHONE);
  assert.equal(preview.network, "mtn");
  assert.equal(preview.rate, SELL_RATE); // NGN per 1 USDC, never inverted
  assert.equal(preview.amountUsdc, EXACT_AMOUNT_USDC);
  assert.equal(preview.feeUsdc, "0");
  assert.equal(preview.totalUsdc, EXACT_AMOUNT_USDC);
  assert.equal(
    preview.totalUsdc,
    addDecimalStrings(preview.amountUsdc, preview.feeUsdc),
  );

  const quotedMs = Date.parse(preview.quotedAt);
  assert.equal(Number.isFinite(quotedMs), true);
  assert.equal(preview.expiresAt, new Date(quotedMs + PREVIEW_TTL_MS).toISOString());
  assert.equal(Date.parse(preview.expiresAt) - quotedMs, 5 * 60_000);
  assert.equal(Math.abs(Date.now() - quotedMs) < 5_000, true);
  // 5-minute TTL boundary assertions:
  assert.equal(quotedMs + 60_000 < Date.parse(preview.expiresAt), true, "preview remains fresh at 60s");
  assert.equal(quotedMs + 299_000 < Date.parse(preview.expiresAt), true, "preview remains fresh just before 5 minutes");
  assert.equal(quotedMs + 300_000 < Date.parse(preview.expiresAt), false, "preview is expired at exact 5-minute mark");
  assert.equal(quotedMs + 301_000 < Date.parse(preview.expiresAt), false, "preview is expired after 5 minutes");
  // SHA-256 over the exact canonical `amountNgn:phone:network` string.
  assert.equal(
    preview.intentFingerprint,
    createHash("sha256").update("500:08031234567:mtn", "utf8").digest("hex"),
  );
  assert.equal(preview.intentFingerprint.length, 64);

  // A differently typed but equivalent phone normalizes to the same intent.
  const normalizedRequests: CorridorRequest[] = [];
  const normalizedResult = await buildAirtimePreview(
    { amountNgn: "500", phone: "+2348031234567", network: "mtn" },
    {
      fetchFn: stubFetch(200, SELL_CORRIDOR_PAYLOAD, normalizedRequests),
      walletAddress: WALLET_ADDRESS,
    },
  );
  assert.equal(normalizedResult.ok, true);
  if (!normalizedResult.ok) {
    throw new Error("expected a preview");
  }
  assert.equal(normalizedResult.data.phone, PHONE);
  assert.equal(
    normalizedResult.data.intentFingerprint,
    preview.intentFingerprint,
  );

  /* ------------------------------------------------------------------ */
  /* 3. Incomplete / invalid intents fail before the quote               */
  /* ------------------------------------------------------------------ */

  const guardedRequests: CorridorRequest[] = [];
  const guardedFetch = stubFetch(200, SELL_CORRIDOR_PAYLOAD, guardedRequests);

  const incomplete = await buildAirtimePreview(
    { amountNgn: "", phone: PHONE, network: "mtn" },
    { fetchFn: guardedFetch },
  );
  assert.equal(incomplete.ok, false);
  assert.equal(!incomplete.ok && incomplete.error.code, "INCOMPLETE_INTENT");
  assert.equal("data" in incomplete, false);

  const invalidAmount = await buildAirtimePreview(
    { amountNgn: "12", phone: PHONE, network: "mtn" }, // below the 50 NGN floor
    { fetchFn: guardedFetch },
  );
  assert.equal(invalidAmount.ok, false);
  assert.equal(!invalidAmount.ok && invalidAmount.error.code, "INVALID_INTENT");

  const invalidPhone = await buildAirtimePreview(
    { amountNgn: AMOUNT_NGN, phone: "12345", network: "mtn" },
    { fetchFn: guardedFetch },
  );
  assert.equal(invalidPhone.ok, false);
  assert.equal(!invalidPhone.ok && invalidPhone.error.code, "INVALID_INTENT");

  const invalidNetwork = await buildAirtimePreview(
    {
      amountNgn: AMOUNT_NGN,
      phone: PHONE,
      network: "not-a-network" as never,
    },
    { fetchFn: guardedFetch },
  );
  assert.equal(invalidNetwork.ok, false);
  assert.equal(!invalidNetwork.ok && invalidNetwork.error.code, "INVALID_INTENT");

  assert.equal(guardedRequests.length, 0); // no quote was fetched for any of them

  /* ------------------------------------------------------------------ */
  /* 4. Provider failures never become a preview                         */
  /* ------------------------------------------------------------------ */

  const failureRequests: CorridorRequest[] = [];
  const upstreamFailure = await buildAirtimePreview(
    { amountNgn: AMOUNT_NGN, phone: PHONE, network: "mtn" },
    {
      fetchFn: stubFetch(401, { message: "unauthorized" }, failureRequests),
      walletAddress: WALLET_ADDRESS,
    },
  );
  assert.equal(upstreamFailure.ok, false);
  assert.equal(!upstreamFailure.ok && upstreamFailure.error.code, "QUOTE_UNAVAILABLE");
  assert.equal(!upstreamFailure.ok && upstreamFailure.error.retryable, true);
  assert.equal("data" in upstreamFailure, false);

  const noProvider = await buildAirtimePreview(
    { amountNgn: AMOUNT_NGN, phone: PHONE, network: "mtn" },
    {
      fetchFn: stubFetch(404, { message: "no provider available" }, failureRequests),
      walletAddress: WALLET_ADDRESS,
    },
  );
  assert.equal(noProvider.ok, false);
  assert.equal(!noProvider.ok && noProvider.error.code, "RATE_UNAVAILABLE");
  assert.equal("data" in noProvider, false);

  const zeroRate = await buildAirtimePreview(
    { amountNgn: AMOUNT_NGN, phone: PHONE, network: "mtn" },
    {
      fetchFn: stubFetch(
        200,
        { status: "success", data: { sell: { rate: "0", providerIds: [] } } },
        failureRequests,
      ),
      walletAddress: WALLET_ADDRESS,
    },
  );
  assert.equal(zeroRate.ok, false);
  assert.equal(!zeroRate.ok && zeroRate.error.code, "INVALID_RATE");
  assert.equal("data" in zeroRate, false);

  const malformedRate = await buildAirtimePreview(
    { amountNgn: AMOUNT_NGN, phone: PHONE, network: "mtn" },
    {
      fetchFn: stubFetch(
        200,
        { status: "success", data: { sell: { rate: "1,500 NGN" } } },
        failureRequests,
      ),
      walletAddress: WALLET_ADDRESS,
    },
  );
  assert.equal(malformedRate.ok, false);
  assert.equal(!malformedRate.ok && malformedRate.error.code, "INVALID_RATE");

  /* ------------------------------------------------------------------ */
  /* 5. Route contract                                                   */
  /* ------------------------------------------------------------------ */

  const originalFetch = globalThis.fetch;
  try {
    const routeRequests: CorridorRequest[] = [];
    globalThis.fetch = stubFetch(200, SELL_CORRIDOR_PAYLOAD, routeRequests);

    const okResponse = await GET(
      new Request(
        previewUrl(
          `?amountNgn=${AMOUNT_NGN}&phone=${PHONE}&network=mtn&walletAddress=${WALLET_ADDRESS}`,
        ),
      ),
    );
    assert.equal(okResponse.status, 200);
    assert.equal(okResponse.headers.get("cache-control"), "no-store");
    const okBody = (await okResponse.json()) as {
      ok: boolean;
      previewId: string;
      preview: typeof preview;
    };
    assert.deepEqual(Object.keys(okBody).sort(), ["ok", "preview", "previewId"]);
    assert.equal(okBody.ok, true);
    assert.equal(/^prev_[0-9a-f-]{36}$/.test(okBody.previewId), true);
    assert.equal(okBody.preview.amountUsdc, EXACT_AMOUNT_USDC);
    assert.equal(okBody.preview.totalUsdc, EXACT_AMOUNT_USDC);
    assert.equal(okBody.preview.rate, SELL_RATE);
    assert.equal(okBody.preview.phone, PHONE);
    assert.equal(okBody.preview.network, "mtn");
    assert.equal(okBody.preview.intentFingerprint, preview.intentFingerprint);
    assert.equal(routeRequests.length, 1);

    const postResponse = await POST(
      new Request(previewUrl(""), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amountNgn: AMOUNT_NGN,
          phone: PHONE,
          network: "mtn",
          walletAddress: WALLET_ADDRESS,
        }),
      }),
    );
    assert.equal(postResponse.status, 200);
    assert.equal(postResponse.headers.get("cache-control"), "no-store");
    const postBody = (await postResponse.json()) as {
      ok: boolean;
      previewId: string;
    };
    assert.equal(postBody.ok, true);
    assert.equal(/^prev_[0-9a-f-]{36}$/.test(postBody.previewId), true);

    const incompleteResponse = await GET(
      new Request(previewUrl(`?amountNgn=${AMOUNT_NGN}`)),
    );
    assert.equal(incompleteResponse.status, 400);
    const incompleteBody = (await incompleteResponse.json()) as {
      ok: boolean;
      preview?: unknown;
      error: { code: string };
    };
    assert.equal(incompleteBody.ok, false);
    assert.equal(incompleteBody.error.code, "INCOMPLETE_INTENT");
    assert.equal("preview" in incompleteBody, false);

    const badJsonResponse = await POST(
      new Request(previewUrl(""), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    );
    assert.equal(badJsonResponse.status, 400);
    const badJsonBody = (await badJsonResponse.json()) as {
      error: { code: string };
    };
    assert.equal(badJsonBody.error.code, "INVALID_REQUEST");

    globalThis.fetch = stubFetch(401, { message: "unauthorized" }, routeRequests);
    const upstreamResponse = await GET(
      new Request(
        previewUrl(
          `?amountNgn=${AMOUNT_NGN}&phone=${PHONE}&network=mtn&walletAddress=${WALLET_ADDRESS}`,
        ),
      ),
    );
    assert.equal(upstreamResponse.status, 503);
    const upstreamBody = (await upstreamResponse.json()) as {
      ok: boolean;
      preview?: unknown;
    };
    assert.equal(upstreamBody.ok, false);
    assert.equal("preview" in upstreamBody, false);
  } finally {
    globalThis.fetch = originalFetch;
  }

  /* ------------------------------------------------------------------ */
  /* 6. Safe latency instrumentation (durations only, no PII)             */
  /* ------------------------------------------------------------------ */

  const timingBaseline = timing.lines.length;
  try {
    assert.equal(
      timingBaseline >= 9,
      true,
      "Every earlier preview attempt reached the lookup and was timed",
    );

    // A slow lookup and a slow write are both measured, and the total covers them.
    const slowRequests: CorridorRequest[] = [];
    setPreviewRepositoryForTesting(new DelayedPreviewRepository(30));
    const slowStartedAt = Date.now();
    const slowPreview = await buildAirtimePreview(
      { amountNgn: AMOUNT_NGN, phone: PHONE, network: "mtn" },
      {
        fetchFn: stubFetch(200, SELL_CORRIDOR_PAYLOAD, slowRequests, 30),
        walletAddress: WALLET_ADDRESS,
      },
    );
    const slowElapsedMs = Date.now() - slowStartedAt;
    assert.equal(slowPreview.ok, true, "Instrumentation must not change the result");
    assert.equal(
      timing.lines.length,
      timingBaseline + 1,
      "Exactly one timing record per preview attempt that reached the lookup",
    );
    const successTiming = parsePreviewTiming(
      timing.lines[timingBaseline],
      "successful preview",
    );
    assert.equal(
      successTiming.rateLookupDurationMs >= 20,
      true,
      "The rate lookup duration must be measured, not reported as zero",
    );
    assert.equal(
      successTiming.dbPersistenceDurationMs >= 20,
      true,
      "The persistence duration must be measured, not reported as zero",
    );
    assert.equal(
      successTiming.totalMs >=
        successTiming.rateLookupDurationMs + successTiming.dbPersistenceDurationMs,
      true,
      "The two measured steps are sequential and must fit inside totalMs",
    );
    assert.equal(
      successTiming.totalMs <= slowElapsedMs,
      true,
      "totalMs can never exceed the call's own wall clock",
    );

    // A failed lookup is still measured, and the write that never ran reports 0.
    const failedLookupRequests: CorridorRequest[] = [];
    const failedLookup = await buildAirtimePreview(
      { amountNgn: AMOUNT_NGN, phone: PHONE, network: "mtn" },
      {
        fetchFn: stubFetch(401, { message: "unauthorized" }, failedLookupRequests, 30),
        walletAddress: WALLET_ADDRESS,
      },
    );
    assert.equal(!failedLookup.ok && failedLookup.error.code, "QUOTE_UNAVAILABLE");
    assert.equal(timing.lines.length, timingBaseline + 2, "A failed lookup is still timed");
    const failedLookupTiming = parsePreviewTiming(
      timing.lines[timingBaseline + 1],
      "failed lookup",
    );
    assert.equal(failedLookupTiming.rateLookupDurationMs >= 20, true);
    assert.equal(
      failedLookupTiming.dbPersistenceDurationMs,
      0,
      "A step that was never attempted reports 0",
    );

    // A store failure is timed too, and still fails closed.
    const storeFailureRequests: CorridorRequest[] = [];
    setPreviewRepositoryForTesting(new FailClosedPreviewRepository());
    const storeFailure = await buildAirtimePreview(
      { amountNgn: AMOUNT_NGN, phone: PHONE, network: "mtn" },
      {
        fetchFn: stubFetch(200, SELL_CORRIDOR_PAYLOAD, storeFailureRequests),
        walletAddress: WALLET_ADDRESS,
      },
    );
    assert.equal(!storeFailure.ok && storeFailure.error.code, "PREVIEW_STORE_UNAVAILABLE");
    assert.equal(timing.lines.length, timingBaseline + 3, "A failed write is still timed");
    const storeFailureTiming = parsePreviewTiming(
      timing.lines[timingBaseline + 2],
      "failed write",
    );
    assert.equal(storeFailureTiming.rateLookupDurationMs >= 0, true);
    assert.equal("data" in storeFailure, false);

    // A write that throws is timed and rethrown unchanged: instrumentation must
    // never turn a driver failure into a payment outcome.
    setPreviewRepositoryForTesting(new ThrowingPreviewRepository());
    let thrownWriteOutcome: unknown = "no error";
    try {
      thrownWriteOutcome = await buildAirtimePreview(
        { amountNgn: AMOUNT_NGN, phone: PHONE, network: "mtn" },
        {
          fetchFn: stubFetch(200, SELL_CORRIDOR_PAYLOAD, []),
          walletAddress: WALLET_ADDRESS,
        },
      );
    } catch (error) {
      thrownWriteOutcome = error;
    }
    assert.equal(
      thrownWriteOutcome,
      THROWN_WRITE_ERROR,
      "A thrown write must propagate unchanged",
    );
    assert.equal(timing.lines.length, timingBaseline + 4, "A thrown write is still timed");
    const thrownWriteTiming = parsePreviewTiming(
      timing.lines[timingBaseline + 3],
      "thrown write",
    );
    assert.equal(
      thrownWriteTiming.dbPersistenceDurationMs >= 20,
      true,
      "A thrown write is measured, not reported as zero",
    );

    // A lookup that throws is timed the same way.
    let thrownQuoteOutcome: unknown = "no error";
    try {
      thrownQuoteOutcome = await buildAirtimePreview(
        { amountNgn: AMOUNT_NGN, phone: PHONE, network: "mtn" },
        throwingQuoteOptions(),
      );
    } catch (error) {
      thrownQuoteOutcome = error;
    }
    assert.equal(
      thrownQuoteOutcome,
      THROWN_QUOTE_ERROR,
      "A thrown lookup must propagate unchanged",
    );
    assert.equal(timing.lines.length, timingBaseline + 5, "A thrown lookup is still timed");
    const thrownQuoteTiming = parsePreviewTiming(
      timing.lines[timingBaseline + 4],
      "thrown lookup",
    );
    assert.equal(
      thrownQuoteTiming.dbPersistenceDurationMs,
      0,
      "A write that was never reached reports 0",
    );

    // An intent rejected before the lookup never reaches the network and so is
    // never timed: there is no lookup or write latency to report.
    setPreviewRepositoryForTesting(new InMemoryPreviewRepository());
    const untimedRequests: CorridorRequest[] = [];
    const untimedFetch = stubFetch(200, SELL_CORRIDOR_PAYLOAD, untimedRequests);
    const untimedIncomplete = await buildAirtimePreview(
      { amountNgn: "12", phone: PHONE, network: "mtn" },
      { fetchFn: untimedFetch, walletAddress: WALLET_ADDRESS },
    );
    assert.equal(!untimedIncomplete.ok && untimedIncomplete.error.code, "INVALID_INTENT");
    const untimedWallet = await buildAirtimePreview(
      { amountNgn: AMOUNT_NGN, phone: PHONE, network: "mtn" },
      { fetchFn: untimedFetch },
    );
    assert.equal(!untimedWallet.ok && untimedWallet.error.code, "WALLET_CONTEXT_INVALID");
    assert.equal(untimedRequests.length, 0);
    assert.equal(
      timing.lines.length,
      timingBaseline + 5,
      "A rejected intent emits no timing record",
    );

    // Every record the whole check produced — sections 2 to 5 included — is a
    // closed, validated timing record.
    for (const [index, line] of timing.lines.entries()) {
      parsePreviewTiming(line, `captured timing record ${index}`);
    }

    // And none of them carries a wallet, phone number, credential, or quote.
    const timingText = timing.lines.join("\n");
    for (const forbidden of [
      PHONE,
      WALLET_ADDRESS,
      "test-key-not-real",
      preview.intentFingerprint,
      "mtn",
    ]) {
      assert.equal(
        timingText.includes(forbidden),
        false,
        `Timing records must never contain ${forbidden}`,
      );
    }
  } finally {
    timing.restore();
  }

  console.log("preview self-check: all assertions passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
