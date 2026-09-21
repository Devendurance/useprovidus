/**
 * P7A demo: judgeable iMessage / Photon channel proof (simulated transport).
 *
 * Runs the full adapter chain without credentials, network, or mutation:
 *   incoming Photon-style message
 *   -> normalized ChannelMessage
 *   -> ready-intent summary (deterministic fixture)
 *   -> approval handoff (existing web flow)
 *   -> receipt/status reply formats for verified terminal vs recovery states
 *
 * Clearly labeled SIMULATED TRANSPORT throughout. Never claims payment
 * success: the only "success" shown is the text format gated on a verified
 * terminal record in the self-check, not here.
 *
 * Run: npx tsx scripts/imessage-channel-demo.ts
 */
import {
  approvalUrlFor,
  extractSpectrumText,
  formatApprovalHandoff,
  formatDeliveryRecovery,
  formatDeliverySuccess,
  normalizeChannelPayload,
  receiptUrlFor,
  summarizeReadyIntent,
} from "@/lib/channels/imessage";

const APP_URL = "https://useprovidus.vercel.app";

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function main(): void {
  console.log("P7A iMessage / Photon channel proof — SIMULATED TRANSPORT");
  console.log("No live iMessage sent. No payment executed. No provider called.");

  section("1. Incoming Photon-style message");
  const inbound = {
    event: "messages",
    space: { id: "iMessage;-;+15551234567", phone: "+15551234567", type: "dm" },
    message: {
      id: "msg_demo_1",
      direction: "inbound",
      platform: "imessage",
      sender: { id: "+2348012345678", platform: "imessage" },
      content: { type: "text", text: "Buy \u20A61,000 MTN airtime for 08031234567" },
      timestamp: new Date().toISOString(),
    },
  };
  console.log(JSON.stringify(inbound.message.content));

  section("2. Normalized channel message");
  const normalized = normalizeChannelPayload(inbound);
  if (!normalized.ok) throw new Error(`demo normalize failed: ${normalized.error}`);
  console.log({
    channel: normalized.message.channel,
    externalConversationId: normalized.message.externalConversationId,
    externalSenderId: normalized.message.externalSenderId,
    text: normalized.message.text,
    eventId: normalized.eventId,
  });
  console.log(
    "extractSpectrumText mirrors the official adapter extractor:",
    JSON.stringify(extractSpectrumText(inbound.message.content)),
  );

  section("3. Ready intent -> approval handoff (never a payment)");
  const summary = summarizeReadyIntent({
    amountNgn: "1000",
    phone: "08031234567",
    network: "mtn",
  });
  const approvalUrl = approvalUrlFor(APP_URL);
  console.log(formatApprovalHandoff(summary, approvalUrl));
  console.log(`(opens existing web flow: ${approvalUrl})`);

  section("4a. Verified-terminal success TEXT FORMAT (sample only — the self-check gates actual records)");
  console.log("(format sample; no payment executed, no record behind this link)");
  console.log(formatDeliverySuccess(receiptUrlFor(APP_URL, "tx_demo_delivered")));
  section("4b. Unverified/failed -> recovery + status link (never success)");
  console.log(formatDeliveryRecovery(receiptUrlFor(APP_URL, "tx_demo_pending")));

  section("Result");
  console.log(
    "PROOF: iMessage text -> Providus intent summary -> web approval URL -> " +
      "existing execution -> receipt/status reply format. Transport: SIMULATED.",
  );
}

main();
