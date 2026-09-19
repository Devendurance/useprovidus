import { NextResponse } from "next/server";
import {
  processPaycrestWebhook,
  verifyPaycrestWebhookSignature,
} from "@/lib/paycrest/server/webhook";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(request: Request) {
  const secret = process.env.PAYCREST_API_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Webhook endpoint not configured" },
      { status: 503, headers: NO_STORE },
    );
  }

  const sigHeader = request.headers.get("X-Paycrest-Signature");
  if (!sigHeader) {
    return NextResponse.json(
      { ok: false, error: "Missing signature header" },
      { status: 401, headers: NO_STORE },
    );
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not read request body" },
      { status: 400, headers: NO_STORE },
    );
  }

  const verify = verifyPaycrestWebhookSignature({
    rawBody,
    signatureHeader: sigHeader,
    apiSecret: secret,
  });

  if (!verify.valid) {
    return NextResponse.json(
      { ok: false, error: verify.reason || "Invalid signature" },
      { status: 401, headers: NO_STORE },
    );
  }

  let payload: unknown;
  try {
    payload = rawBody === "" ? null : JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Malformed JSON payload" },
      { status: 400, headers: NO_STORE },
    );
  }

  const result = await processPaycrestWebhook(payload);

  return NextResponse.json(
    {
      ok: true,
      processed: result.processed,
      ...(result.reason ? { reason: result.reason } : {}),
    },
    { status: 200, headers: NO_STORE },
  );
}
