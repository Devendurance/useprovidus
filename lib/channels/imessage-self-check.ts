/**
 * P7A iMessage / Photon channel-proof self-check.
 *
 * Proves the adapter + webhook boundaries WITHOUT any provider mutation:
 * - malformed webhook bodies rejected;
 * - bad/stale/missing signatures rejected when a secret is configured;
 * - duplicate deliveries return the identical reply without re-processing;
 * - Spectrum + demo payload shapes normalize to the same ChannelMessage;
 * - channel ingestion performs zero repository writes (guarded proxy) and
 *   never creates previews/orders (no payment-service import path exercised);
 * - a ready airtime intent produces an approval handoff (approvalUrl +
 *   /dashboard link), never a payment;
 * - delivery-success text requires a verified `completed` terminal record;
 * - non-terminal/failed records produce status/recovery text, never success;
 * - receipt/status links are opaque `/receipt?tx=<id>` URLs (no PII in query).
 *
 * Run: npx tsx --conditions=react-server lib/channels/imessage-self-check.ts
 */

import "server-only";

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { POST } from "@/app/api/channels/imessage/webhook/route";
import {
  approvalUrlFor,
  extractSpectrumText,
  formatApprovalHandoff,
  formatDeliveryRecovery,
  formatDeliverySuccess,
  maskPhone,
  normalizeChannelPayload,
  receiptUrlFor,
  summarizeReadyIntent,
} from "@/lib/channels/imessage";
import { setAssistantProviderForTesting } from "@/lib/assistant/resolve";
import type {
  LlmCompletionRequest,
  LlmProvider,
  LlmResponse,
} from "@/lib/ai";
import {
  InMemoryTransactionRepository,
  setTransactionRepositoryForTesting,
  type TransactionRepository,
} from "@/lib/transactions";

const PHONE = "08031234567";
const APP_URL = "https://useprovidus.vercel.app";
const SECRET = "whsec_test_providus_p7a";

class FakeProvider implements LlmProvider {
  readonly id = "fake-channel-provider";
  calls = 0;
  constructor(private readonly respond: () => LlmResponse) {}
  async complete(request: LlmCompletionRequest): Promise<LlmResponse> {
    void request;
    this.calls += 1;
    return this.respond();
  }
}

function llmResponse(content: string): LlmResponse {
  return {
    provider: "fake-channel-provider",
    model: "fake-model",
    requestId: null,
    content,
    finishReason: "stop",
  };
}

const AIRTIME_CANDIDATE = JSON.stringify({
  mode: "payment_intent",
  reply: "Here is your airtime summary.",
  intent: { type: "airtime", amountNgn: "1000", phone: PHONE, network: "mtn" },
});

function spectrumBody(text: string, messageId: string): string {
  return JSON.stringify({
    event: "messages",
    space: { id: "iMessage;-;+15551234567", phone: "+15551234567", type: "dm" },
    message: {
      id: messageId,
      direction: "inbound",
      platform: "imessage",
      sender: { id: "+2348012345678", platform: "imessage" },
      content: { type: "text", text },
      timestamp: new Date().toISOString(),
    },
  });
}

function signedRequest(body: string, messageId: string): Request {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v0=${createHmac("sha256", SECRET)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex")}`;
  return new Request("http://localhost/api/channels/imessage/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-spectrum-signature": signature,
      "x-spectrum-timestamp": timestamp,
      "x-spectrum-event": "messages",
      "x-spectrum-webhook-id": `wh_${messageId}`,
    },
    body,
  });
}

function unsignedRequest(body: string): Request {
  return new Request("http://localhost/api/channels/imessage/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

/**
 * Wraps the repository so ANY write fails loudly; the channel path must only
 * ever call the two status reads.
 */
function guardReadOnly(repository: TransactionRepository): TransactionRepository {
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const name = String(property);
        if (name !== "findById" && name !== "findByPaycrestOrderId") {
          throw new Error(`channel ingestion must not call repository.${name}()`);
        }
        return (value as (...inner: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as TransactionRepository;
}

async function seedTerminalDelivered(): Promise<InMemoryTransactionRepository> {
  const repo = new InMemoryTransactionRepository();
  await repo.create({
    id: "tx_channel_delivered_1",
    idempotencyKey: "idem_channel_delivered_1",
    type: "airtime",
    walletAddress: "0x1111111111111111111111111111111111111111",
    amountUsdc: "1.00",
    amountNgn: "1000",
    paycrestReference: "ref_channel_delivered_1",
    paycrestStatus: "validated",
    metadata: {
      phone: "+2348012345678",
      network: "MTN",
    },
  });
  await repo.updateStatus("tx_channel_delivered_1", {
    status: "settling",
    paycrestStatus: "fulfilling",
  });
  await repo.updateStatus("tx_channel_delivered_1", {
    status: "settled",
    paycrestStatus: "validated",
  });
  const reserved = await repo.acquireAirtimeFulfilmentReservation({
    transactionId: "tx_channel_delivered_1",
    requestId: "req_channel_delivered_1",
  });
  assert.equal(reserved.ok, true, "seed must acquire fulfilment reservation");
  const claimed = await repo.claimAirtimeFulfilmentAttempt({
    transactionId: "tx_channel_delivered_1",
    requestId: "req_channel_delivered_1",
  });
  assert.equal(claimed.ok, true, "seed must claim fulfilment attempt");
  const outcome = await repo.recordAirtimeFulfilmentOutcome({
    transactionId: "tx_channel_delivered_1",
    requestId: "req_channel_delivered_1",
    normalizedStatus: "completed",
    statusCode: "200",
    rawStatus: "ORDER_COMPLETED",
    orderId: "ck_seed_1",
    reconciliationRequired: false,
  });
  assert.equal(outcome.ok, true, "seed must record verified delivery");

  // Non-terminal row: the success-text gate must never fire for it, even when
  // model/chat wording claims delivery.
  await repo.create({
    id: "tx_channel_pending_1",
    idempotencyKey: "idem_channel_pending_1",
    type: "airtime",
    walletAddress: "0x1111111111111111111111111111111111111111",
    amountUsdc: "1.00",
    amountNgn: "1000",
    paycrestReference: "ref_channel_pending_1",
    metadata: { phone: "+2348012345678", network: "MTN" },
  });

  // Failed row: the recovery branch must fire (never success text).
  await repo.create({
    id: "tx_channel_failed_1",
    idempotencyKey: "idem_channel_failed_1",
    type: "airtime",
    walletAddress: "0x1111111111111111111111111111111111111111",
    amountUsdc: "1.00",
    amountNgn: "1000",
    paycrestReference: "ref_channel_failed_1",
    metadata: { phone: "+2348012345678", network: "MTN" },
  });
  await repo.updateStatus("tx_channel_failed_1", {
    status: "settling",
    paycrestStatus: "fulfilling",
  });
  await repo.updateStatus("tx_channel_failed_1", { status: "failed" });
  return repo;
}

async function run() {
  console.log("Starting iMessage channel self-check...");
  const previousSecret = process.env.IMESSAGE_WEBHOOK_SECRET;

  /* ---- Pure adapter: normalization + formatting (no secret needed) ---- */
  {
    const spectrum = normalizeChannelPayload(
      JSON.parse(spectrumBody("Buy ₦1000 MTN airtime for 08031234567", "msg_pure_1")),
    );
    assert.equal(spectrum.ok, true);
    if (spectrum.ok) {
      assert.equal(spectrum.message.channel, "imessage");
      assert.equal(
        spectrum.message.externalConversationId,
        "iMessage;-;+15551234567",
      );
      assert.equal(spectrum.message.externalSenderId, "+2348012345678");
      assert.equal(spectrum.eventId, "msg_pure_1");
    }

    const demo = normalizeChannelPayload({
      conversationId: "conv_demo_1",
      senderId: "sender_demo_1",
      text: "  hello  ",
    });
    assert.equal(demo.ok, true);
    if (demo.ok) assert.equal(demo.message.text, "hello");

    assert.equal(
      normalizeChannelPayload({ nope: true }).ok,
      false,
      "unknown shape rejected",
    );
    assert.equal(
      normalizeChannelPayload({ conversationId: "a", senderId: "b", text: "  " })
        .ok,
      false,
      "blank text rejected",
    );
    assert.equal(
      normalizeChannelPayload({
        conversationId: "a",
        senderId: "b",
        text: "x".repeat(2001),
      }).ok,
      false,
      "overlong text rejected",
    );
    const echo = normalizeChannelPayload(
      JSON.parse(
        spectrumBody("hi", "msg_echo_1").replace("inbound", "outbound"),
      ),
    );
    assert.equal(echo.ok, false, "outbound echo ignored");

    assert.equal(
      extractSpectrumText({ type: "attachment", name: "pic.png" }),
      "",
      "attachments yield no text",
    );
    assert.equal(maskPhone(PHONE), "*******4567");
    assert.deepEqual(summarizeReadyIntent({}), ["Airtime request"]);
    const summary = summarizeReadyIntent({
      amountNgn: "1000",
      phone: maskPhone(PHONE),
      network: "mtn",
    });
    assert.ok(summary[0].includes("₦1000"));
    assert.equal(approvalUrlFor(APP_URL), `${APP_URL}/dashboard?channel=imessage`);
    assert.equal(
      receiptUrlFor(APP_URL, "tx_abc"),
      `${APP_URL}/receipt?tx=tx_abc`,
    );
    const handoff = formatApprovalHandoff(summary, approvalUrlFor(APP_URL));
    assert.match(handoff, /Review and approve securely/);
    assert.match(formatDeliverySuccess(`${APP_URL}/receipt?tx=x`), /Airtime delivered/);
    assert.match(
      formatDeliveryRecovery(`${APP_URL}/receipt?tx=x`),
      /could not verify completion yet/,
    );
  }

  /* ---- Webhook: auth, dedupe, approval handoff (signed mode) ---- */
  process.env.IMESSAGE_WEBHOOK_SECRET = SECRET;
  const readyProvider = new FakeProvider(() => llmResponse(AIRTIME_CANDIDATE));
  setAssistantProviderForTesting(readyProvider);
  const liveRepo = await seedTerminalDelivered();
  setTransactionRepositoryForTesting(guardReadOnly(liveRepo));
  try {
    // Unsigned delivery rejected when a secret is configured.
    const unsigned = await POST(
      unsignedRequest(spectrumBody("Buy ₦1000 MTN airtime", "msg_auth_1")),
    );
    assert.equal(unsigned.status, 401, "unsigned delivery must fail closed");

    // Bad signature rejected.
    const badBody = spectrumBody("Buy ₦1000 MTN airtime", "msg_auth_2");
    const bad = await POST(
      new Request("http://localhost/api/channels/imessage/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-spectrum-signature": "v0=deadbeef",
          "x-spectrum-timestamp": String(Math.floor(Date.now() / 1000)),
        },
        body: badBody,
      }),
    );
    assert.equal(bad.status, 401, "bad signature must fail closed");

    // Stale timestamp rejected.
    const staleBody = spectrumBody("Buy ₦1000 MTN airtime", "msg_auth_3");
    const staleTs = String(Math.floor(Date.now() / 1000) - 601);
    const staleSig = `v0=${createHmac("sha256", SECRET)
      .update(`v0:${staleTs}:${staleBody}`)
      .digest("hex")}`;
    const stale = await POST(
      new Request("http://localhost/api/channels/imessage/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-spectrum-signature": staleSig,
          "x-spectrum-timestamp": staleTs,
        },
        body: staleBody,
      }),
    );
    assert.equal(stale.status, 400, "stale timestamp must be rejected");

    // Malformed JSON rejected.
    const malformed = await POST(
      new Request("http://localhost/api/channels/imessage/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
    );
    assert.equal(malformed.status, 400);

    // Ready intent -> approval handoff, never a payment.
    const readyBody = spectrumBody(
      "Buy ₦1000 MTN airtime for 08031234567",
      "msg_ready_1",
    );
    const first = await POST(signedRequest(readyBody, "msg_ready_1"));
    assert.equal(first.status, 200);
    const firstJson = (await first.json()) as Record<string, unknown>;
    assert.equal(firstJson.kind, "approval");
    assert.equal(
      firstJson.approvalUrl,
      `${APP_URL}/dashboard?channel=imessage`,
    );
    assert.match(String(firstJson.reply), /Review and approve securely/);
    assert.equal(firstJson.simulated, true, "reply rides in webhook response (simulated transport)");
    // Duplicate delivery -> identical reply, no re-processing.
    const callsBeforeDuplicate = readyProvider.calls;
    const second = await POST(signedRequest(readyBody, "msg_ready_1"));
    assert.equal(second.status, 200);
    const secondJson = (await second.json()) as Record<string, unknown>;
    assert.equal(secondJson.duplicate, true);
    assert.equal(secondJson.reply, firstJson.reply);
    assert.equal(
      readyProvider.calls,
      callsBeforeDuplicate,
      "duplicate must not re-invoke the assistant provider",
    );

    // Same message id under a different delivery id -> still duplicate
    // (independent message-key dedupe, not tuple semantics).
    const redeliveredBody = spectrumBody(
      "Buy ₦1000 MTN airtime for 08031234567",
      "msg_ready_1",
    );
    const redeliveredTs = String(Math.floor(Date.now() / 1000));
    const redeliveredSig = `v0=${createHmac("sha256", SECRET)
      .update(`v0:${redeliveredTs}:${redeliveredBody}`)
      .digest("hex")}`;
    const redelivered = await POST(
      new Request("http://localhost/api/channels/imessage/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-spectrum-signature": redeliveredSig,
          "x-spectrum-timestamp": redeliveredTs,
          "x-spectrum-event": "messages",
          "x-spectrum-webhook-id": "wh_different_delivery_id",
        },
        body: redeliveredBody,
      }),
    );
    const redeliveredJson = (await redelivered.json()) as Record<string, unknown>;
    assert.equal(redeliveredJson.duplicate, true);
    assert.equal(redeliveredJson.reply, firstJson.reply);

    // Unsupported Spectrum event -> rejected, never processed as chat.
    const badEventBody = spectrumBody("hello", "msg_event_1").replace(
      '"event":"messages"',
      '"event":"typing"',
    );
    const badEventTs = String(Math.floor(Date.now() / 1000));
    const badEventSig = `v0=${createHmac("sha256", SECRET)
      .update(`v0:${badEventTs}:${badEventBody}`)
      .digest("hex")}`;
    const badEvent = await POST(
      new Request("http://localhost/api/channels/imessage/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-spectrum-signature": badEventSig,
          "x-spectrum-timestamp": badEventTs,
          "x-spectrum-event": "typing",
          "x-spectrum-webhook-id": "wh_msg_event_1",
        },
        body: badEventBody,
      }),
    );
    assert.equal(badEvent.status, 400);

    // Clarification path: missing fields -> assistant question, no approval URL.
    setAssistantProviderForTesting(
      new FakeProvider(() =>
        llmResponse(
          JSON.stringify({
            mode: "payment_intent",
            reply: "Which network should I use?",
            intent: { type: "airtime", amountNgn: "1000", phone: PHONE },
          }),
        ),
      ),
    );
    const clarify = await POST(
      signedRequest(spectrumBody("Buy ₦1000 airtime", "msg_clarify_1"), "msg_clarify_1"),
    );
    const clarifyJson = (await clarify.json()) as Record<string, unknown>;
    assert.equal(clarifyJson.kind, "clarification");
    assert.equal(clarifyJson.approvalUrl, undefined);
    assert.equal(String(clarifyJson.reply), "Which network should I use?");

    // Incomplete intent + success-claim wording -> sanitized clarification.
    setAssistantProviderForTesting(
      new FakeProvider(() =>
        llmResponse(
          JSON.stringify({
            mode: "payment_intent",
            reply: "Airtime delivered successfully. Which network?",
            intent: { type: "airtime", amountNgn: "1000", phone: PHONE },
          }),
        ),
      ),
    );
    const clarifyLeak = await POST(
      signedRequest(spectrumBody("Buy ₦1000 airtime", "msg_clarify_2"), "msg_clarify_2"),
    );
    const clarifyLeakJson = (await clarifyLeak.json()) as Record<string, unknown>;
    assert.equal(clarifyLeakJson.kind, "clarification");
    assert.match(String(clarifyLeakJson.reply), /could not verify completion yet/);

    // Unsupported intent + success-claim wording -> sanitized notice.
    setAssistantProviderForTesting(
      new FakeProvider(() =>
        llmResponse(
          JSON.stringify({
            mode: "payment_intent",
            reply: "Airtime delivered successfully.",
            intent: { type: "data" },
          }),
        ),
      ),
    );
    const unsupportedLeak = await POST(
      signedRequest(spectrumBody("Buy data", "msg_unsup_1"), "msg_unsup_1"),
    );
    const unsupportedLeakJson = (await unsupportedLeak.json()) as Record<string, unknown>;
    assert.equal(unsupportedLeakJson.kind, "unsupported");
    assert.match(String(unsupportedLeakJson.reply), /could not verify completion yet/);
    assert.match(String(unsupportedLeakJson.reply), /Supported on this channel today/);

    // Verified terminal delivery -> success + receipt link.
    setAssistantProviderForTesting(
      new FakeProvider(() =>
        llmResponse(
          JSON.stringify({
            mode: "chat",
            reply:
              "Airtime delivered — Reference: tx_channel_delivered_1. Anything else?",
            intent: null,
          }),
        ),
      ),
    );
    const delivered = await POST(
      signedRequest(
        spectrumBody("status of tx_channel_delivered_1?", "msg_status_1"),
        "msg_status_1",
      ),
    );
    const deliveredJson = (await delivered.json()) as Record<string, unknown>;
    assert.equal(deliveredJson.kind, "delivered");
    // Resolver short-circuits to the deterministic formatter, so the fake
    // model reply above is never used: the verified record drives success.
    assert.match(String(deliveredJson.reply), /Airtime delivered/);
    assert.equal(
      deliveredJson.receiptUrl,
      `${APP_URL}/receipt?tx=tx_channel_delivered_1`,
    );
    // Non-terminal record: the resolver short-circuits to the deterministic
    // formatter, and the route re-gates to a status line that never claims
    // delivery. The fake model reply is never used.
    setAssistantProviderForTesting(
      new FakeProvider(() => llmResponse('{"mode":"chat","reply":"unused","intent":null}')),
    );
    const pending = await POST(
      signedRequest(
        spectrumBody("status of tx_channel_pending_1?", "msg_status_2"),
        "msg_status_2",
      ),
    );
    const pendingJson = (await pending.json()) as Record<string, unknown>;
    assert.equal(pendingJson.kind, "status");
    assert.equal(
      String(pendingJson.reply).includes("Airtime delivered"),
      false,
      "non-terminal stage must never emit delivery-success text",
    );
    assert.match(String(pendingJson.reply), /Open the payment status/);
    assert.equal(
      pendingJson.receiptUrl,
      `${APP_URL}/receipt?tx=tx_channel_pending_1`,
    );

    // Unknown reference: the resolver short-circuits to the deterministic
    // NOT_FOUND answer; the route surfaces it without echoing model text and
    // without a receipt link. The fake model reply is never used.
    setAssistantProviderForTesting(
      new FakeProvider(() => llmResponse('{"mode":"chat","reply":"unused","intent":null}')),
    );
    const unknown = await POST(
      signedRequest(
        spectrumBody("what is the status of tx_nope_missing_1?", "msg_status_3"),
        "msg_status_3",
      ),
    );
    const unknownJson = (await unknown.json()) as Record<string, unknown>;
    assert.equal(unknownJson.kind, "recovery");
    assert.match(String(unknownJson.reply), /could not find a transaction/);
    assert.equal(
      String(unknownJson.reply).includes("Airtime delivered"),
      false,
      "unknown reference must never emit delivery-success text",
    );
    assert.equal(unknownJson.receiptUrl, undefined);

    // Unreferenced chat claiming delivery: every success variant is sanitized,
    // never echoed, no link.
    const noRefVariants = [
      "Airtime delivered successfully.",
      "Airtime delivery completed successfully.",
      "Airtime delivered ✓\nView verified receipt:",
      "Your payment is complete.",
      "Airtime done.",
      "Airtime fulfilled.",
      "Airtime has gone through.",
      "Airtime went through.",
    ];
    for (let index = 0; index < noRefVariants.length; index += 1) {
      const variant = noRefVariants[index];
      setAssistantProviderForTesting(
        new FakeProvider(() =>
          llmResponse(JSON.stringify({ mode: "chat", reply: variant, intent: null })),
        ),
      );
      const probe = await POST(
        signedRequest(spectrumBody("hello there", `msg_noref_${index}`), `msg_noref_${index}`),
      );
      const probeJson = (await probe.json()) as Record<string, unknown>;
      assert.equal(probeJson.kind, "chat");
      assert.match(String(probeJson.reply), /could not verify completion yet/);
      assert.equal(probeJson.receiptUrl, undefined);
    }

    // Plain clarification without success context passes through untouched.
    setAssistantProviderForTesting(
      new FakeProvider(() =>
        llmResponse(
          JSON.stringify({
            mode: "chat",
            reply: "Which network should I use?",
            intent: null,
          }),
        ),
      ),
    );
    const plain = await POST(
      signedRequest(spectrumBody("hi", "msg_plain_1"), "msg_plain_1"),
    );
    const plainJson = (await plain.json()) as Record<string, unknown>;
    assert.equal(plainJson.kind, "chat");
    assert.equal(String(plainJson.reply), "Which network should I use?");

    // Failed record: recovery branch fires, never success text.
    setAssistantProviderForTesting(
      new FakeProvider(() => llmResponse('{"mode":"chat","reply":"unused","intent":null}')),
    );
    const failed = await POST(
      signedRequest(
        spectrumBody("status of tx_channel_failed_1?", "msg_status_4"),
        "msg_status_4",
      ),
    );
    const failedJson = (await failed.json()) as Record<string, unknown>;
    assert.equal(failedJson.kind, "recovery");
    assert.equal(
      /airtime delivered/i.test(String(failedJson.reply)),
      false,
      "failed stage must never emit delivery-success text",
    );
    assert.match(String(failedJson.reply), /could not verify completion yet/);
    assert.equal(
      failedJson.receiptUrl,
      `${APP_URL}/receipt?tx=tx_channel_failed_1`,
    );
  } finally {
    setAssistantProviderForTesting(null);
    setTransactionRepositoryForTesting(null);
    if (previousSecret === undefined) delete process.env.IMESSAGE_WEBHOOK_SECRET;
    else process.env.IMESSAGE_WEBHOOK_SECRET = previousSecret;
  }

  console.log("iMessage channel self-check passed.");
}

run().catch((error) => {
  console.error("iMessage channel self-check FAILED:", error);
  process.exit(1);
});
