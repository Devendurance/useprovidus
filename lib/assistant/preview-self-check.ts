/**
 * Self-check for the P4 quote/preview layer (BUILDER A).
 *
 * Proves, against a mocked Paycrest corridor and the real route handlers:
 *   1. `divideDecimalStrings` is exact BigInt math and rounds up by default,
 *      so the inverse quote can never under-fund the requested NGN value;
 *   2. `buildAirtimePreview` reads the *sell* rate, treats it as NGN per 1
 *      USDC, and emits the frozen ten-field `AirtimePreview` with the exact
 *      amounts, fingerprint, and 60-second TTL;
 *   3. an incomplete or invalid intent fails before any network call;
 *   4. a failed, absent, or malformed provider quote never becomes a preview;
 *   5. the route exposes `{ ok: true, preview }` with `Cache-Control: no-store`
 *      and maps failures to non-200 responses without a preview.
 *
 * No live Paycrest calls, no wallet or blockchain transactions.
 * Run: npx tsx --conditions=react-server lib/assistant/preview-self-check.ts
 */

import "server-only";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { GET, POST } from "@/app/api/assistant/preview/route";
import { PREVIEW_TTL_MS, buildAirtimePreview } from "@/lib/assistant/preview";
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

/** Corridor-endpoint stub: records every request, never touches the network. */
function stubFetch(
  status: number,
  body: unknown,
  requests: CorridorRequest[],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
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

async function run() {
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
    { fetchFn: stubFetch(200, SELL_CORRIDOR_PAYLOAD, previewRequests) },
  );
  assert.equal(previewResult.ok, true);
  if (!previewResult.ok) {
    throw new Error("expected a preview");
  }
  const preview = previewResult.data;

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
  assert.equal(Date.parse(preview.expiresAt) - quotedMs, 60_000);
  assert.equal(Math.abs(Date.now() - quotedMs) < 5_000, true);

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
    { fetchFn: stubFetch(200, SELL_CORRIDOR_PAYLOAD, normalizedRequests) },
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
    { fetchFn: stubFetch(401, { message: "unauthorized" }, failureRequests) },
  );
  assert.equal(upstreamFailure.ok, false);
  assert.equal(!upstreamFailure.ok && upstreamFailure.error.code, "QUOTE_UNAVAILABLE");
  assert.equal(!upstreamFailure.ok && upstreamFailure.error.retryable, true);
  assert.equal("data" in upstreamFailure, false);

  const noProvider = await buildAirtimePreview(
    { amountNgn: AMOUNT_NGN, phone: PHONE, network: "mtn" },
    {
      fetchFn: stubFetch(404, { message: "no provider available" }, failureRequests),
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
        previewUrl(`?amountNgn=${AMOUNT_NGN}&phone=${PHONE}&network=mtn`),
      ),
    );
    assert.equal(okResponse.status, 200);
    assert.equal(okResponse.headers.get("cache-control"), "no-store");
    const okBody = (await okResponse.json()) as {
      ok: boolean;
      preview: typeof preview;
    };
    assert.deepEqual(Object.keys(okBody).sort(), ["ok", "preview"]);
    assert.equal(okBody.ok, true);
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
        }),
      }),
    );
    assert.equal(postResponse.status, 200);
    assert.equal(postResponse.headers.get("cache-control"), "no-store");
    const postBody = (await postResponse.json()) as { ok: boolean };
    assert.equal(postBody.ok, true);

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
        previewUrl(`?amountNgn=${AMOUNT_NGN}&phone=${PHONE}&network=mtn`),
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

  console.log("preview self-check: all assertions passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
