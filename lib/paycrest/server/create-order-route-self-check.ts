/**
 * Mocked production-path tests for createOfframpOrder + route error mapping.
 * No live Paycrest or blockchain calls.
 * Run: npx tsx lib/paycrest/server/create-order-route-self-check.ts
 */

import assert from "node:assert/strict";
import { getAddress } from "viem";

// Isolate env before importing client
process.env.PAYCREST_API_KEY = "test-key-not-real";
process.env.PAYCREST_BASE_URL = "https://api.paycrest.io/v2";

async function run() {
  const { createOfframpOrder, buildOfframpOrderPayload } = await import(
    "@/lib/paycrest/server/client"
  );
  const { resolvePaycrestUrl } = await import("@/lib/paycrest/server/config");

  const refund = getAddress("0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa");
  const originalFetch = globalThis.fetch;
  let lastUrl = "";
  let lastMethod = "";
  let lastHeaders: HeadersInit | undefined;
  let lastBody = "";
  let fetchCalls = 0;

  function mockFetch(
    handler: (url: string, init?: RequestInit) => Promise<Response>,
  ) {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls += 1;
      const url = typeof input === "string" ? input : input.toString();
      lastUrl = url;
      lastMethod = init?.method ?? "GET";
      lastHeaders = init?.headers;
      lastBody = typeof init?.body === "string" ? init.body : "";
      return handler(url, init);
    }) as typeof fetch;
  }

  function headerMap(h: HeadersInit | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!h) return out;
    if (h instanceof Headers) {
      h.forEach((v, k) => {
        out[k.toLowerCase()] = v;
      });
      return out;
    }
    if (Array.isArray(h)) {
      for (const [k, v] of h) out[k.toLowerCase()] = v;
      return out;
    }
    for (const [k, v] of Object.entries(h)) {
      if (typeof v === "string") out[k.toLowerCase()] = v;
    }
    return out;
  }

  try {
    // Successful create shape — still mocked, no real network
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          status: "success",
          data: {
            id: "ord-1",
            amount: "1",
            senderFee: "0",
            transactionFee: "0",
            providerAccount: {
              network: "celo",
              receiveAddress: "0x00000000000000000000000000000000000000ab",
              validUntil: new Date(Date.now() + 600_000).toISOString(),
            },
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );

    const ok = await createOfframpOrder({
      amount: "1",
      reference: "p4b_mockref",
      refundAddress: refund,
      institution: "GTBINGLA",
      accountIdentifier: "0123456789",
      accountName: "TEST USER",
    });
    assert.equal(ok.ok, true);
    assert.equal(
      lastUrl,
      resolvePaycrestUrl("https://api.paycrest.io/v2", "/sender/orders"),
    );
    assert.equal(lastUrl, "https://api.paycrest.io/v2/sender/orders");
    assert.equal(lastMethod, "POST");
    const headers = headerMap(lastHeaders);
    assert.ok("api-key" in headers);
    assert.equal(headers["content-type"], "application/json");
    // Never assert key value beyond presence of non-empty string type
    assert.equal(typeof headers["api-key"], "string");
    assert.ok(headers["api-key"].length > 0);

    const sent = JSON.parse(lastBody) as ReturnType<typeof buildOfframpOrderPayload>;
    const expected = buildOfframpOrderPayload({
      amount: "1",
      reference: "p4b_mockref",
      refundAddress: refund,
      institution: "GTBINGLA",
      accountIdentifier: "0123456789",
      accountName: "TEST USER",
    });
    assert.deepEqual(sent, expected);
    assert.equal(typeof sent.amount, "string");
    assert.equal("amountIn" in sent, false);

    // redactOfframpOutgoingBody must mirror that same structure without PII
    const { redactOfframpOutgoingBody } = await import(
      "@/lib/paycrest/offramp-payload"
    );
    const redactedFromSent = redactOfframpOutgoingBody(sent);
    assert.equal(redactedFromSent.amount, sent.amount);
    assert.equal(redactedFromSent.source.type, sent.source.type);
    assert.equal(redactedFromSent.source.currency, sent.source.currency);
    assert.equal(redactedFromSent.source.network, sent.source.network);
    assert.equal(redactedFromSent.destination.recipient.institution, "GTBINGLA");
    assert.equal(redactedFromSent.destination.recipient.memo, sent.destination.recipient.memo);
    assert.equal(redactedFromSent.reference, sent.reference);
    assert.equal(redactedFromSent.source.refundAddress, "<redacted-wallet>");
    assert.equal(
      redactedFromSent.destination.recipient.accountIdentifier,
      "<redacted-account>",
    );
    assert.equal(
      redactedFromSent.destination.recipient.accountName,
      "<redacted-name>",
    );
    const redactedLog = JSON.stringify({
      tag: "paycrest_outgoing_body",
      body: redactedFromSent,
    });
    assert.ok(!redactedLog.includes(refund));
    assert.ok(!redactedLog.includes("0123456789"));
    assert.ok(!redactedLog.includes("TEST USER"));
    assert.ok(redactedLog.includes("paycrest_outgoing_body"));

    // Message-only 400 → PAYCREST_ORDER_REJECTED (never UPSTREAM_ERROR)
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          status: "error",
          message: "Failed to validate payload",
          data: null,
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    const rejected = await createOfframpOrder({
      amount: "1",
      reference: "p4b_rej",
      refundAddress: refund,
      institution: "GTBINGLA",
      accountIdentifier: "0123456789",
      accountName: "TEST USER",
    });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) {
      assert.equal(rejected.code, "PAYCREST_ORDER_REJECTED");
      assert.notEqual(rejected.code, "UPSTREAM_ERROR");
      assert.ok(rejected.diagnosticId);
      assert.equal(rejected.message, "Failed to validate payload");
    }

    // Structured data[] 400 → PAYCREST_VALIDATION_FAILED
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          status: "error",
          message: "Failed to validate payload",
          data: [{ field: "amount", message: "too small" }],
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    const validated = await createOfframpOrder({
      amount: "1",
      reference: "p4b_val",
      refundAddress: refund,
      institution: "GTBINGLA",
      accountIdentifier: "0123456789",
      accountName: "TEST USER",
    });
    assert.equal(validated.ok, false);
    if (!validated.ok) {
      assert.equal(validated.code, "PAYCREST_VALIDATION_FAILED");
      assert.ok(validated.validationDetails?.length);
      assert.notEqual(validated.code, "UPSTREAM_ERROR");
    }

    // Empty body 400
    mockFetch(async () => new Response("", { status: 400 }));
    const empty = await createOfframpOrder({
      amount: "1",
      reference: "p4b_empty",
      refundAddress: refund,
      institution: "GTBINGLA",
      accountIdentifier: "0123456789",
      accountName: "TEST USER",
    });
    assert.equal(empty.ok, false);
    if (!empty.ok) {
      assert.equal(empty.code, "PAYCREST_ORDER_REJECTED");
      assert.ok(empty.diagnosticId);
    }

    // Plain text 400
    mockFetch(
      async () =>
        new Response("Failed to validate payload", {
          status: 400,
          headers: { "content-type": "text/plain" },
        }),
    );
    const plain = await createOfframpOrder({
      amount: "1",
      reference: "p4b_plain",
      refundAddress: refund,
      institution: "GTBINGLA",
      accountIdentifier: "0123456789",
      accountName: "TEST USER",
    });
    assert.equal(plain.ok, false);
    if (!plain.ok) assert.equal(plain.code, "PAYCREST_ORDER_REJECTED");

    // 500 → UPSTREAM_ERROR
    mockFetch(
      async () =>
        new Response(JSON.stringify({ message: "internal" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );
    const serverErr = await createOfframpOrder({
      amount: "1",
      reference: "p4b_500",
      refundAddress: refund,
      institution: "GTBINGLA",
      accountIdentifier: "0123456789",
      accountName: "TEST USER",
    });
    assert.equal(serverErr.ok, false);
    if (!serverErr.ok) assert.equal(serverErr.code, "UPSTREAM_ERROR");

    // No automatic retry — single fetch per create
    const callsBefore = fetchCalls;
    mockFetch(
      async () =>
        new Response(JSON.stringify({ message: "no" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    );
    await createOfframpOrder({
      amount: "1",
      reference: "p4b_once",
      refundAddress: refund,
      institution: "GTBINGLA",
      accountIdentifier: "0123456789",
      accountName: "TEST USER",
    });
    assert.equal(fetchCalls - callsBefore, 1);

    // Route mapping simulation: INVALID_INPUT/ORDER_REJECTED must not become UPSTREAM_ERROR
    function mapCreateCodeToRoute(
      code: string,
    ): "PAYCREST_VALIDATION_FAILED" | "PAYCREST_ORDER_REJECTED" | "UPSTREAM_ERROR" {
      if (code === "PAYCREST_VALIDATION_FAILED") return "PAYCREST_VALIDATION_FAILED";
      if (code === "PAYCREST_ORDER_REJECTED" || code === "INVALID_INPUT") {
        return "PAYCREST_ORDER_REJECTED";
      }
      if (code === "UPSTREAM_ERROR") return "UPSTREAM_ERROR";
      return "UPSTREAM_ERROR";
    }
    assert.equal(mapCreateCodeToRoute("PAYCREST_ORDER_REJECTED"), "PAYCREST_ORDER_REJECTED");
    assert.equal(mapCreateCodeToRoute("INVALID_INPUT"), "PAYCREST_ORDER_REJECTED");
    assert.equal(
      mapCreateCodeToRoute("PAYCREST_VALIDATION_FAILED"),
      "PAYCREST_VALIDATION_FAILED",
    );
    assert.notEqual(mapCreateCodeToRoute("INVALID_INPUT"), "UPSTREAM_ERROR");

    console.log("create-order route self-check: all assertions passed");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
