/**
 * GET /api/transfers/[id]/status — authoritative payment/submission state.
 *
 * Read-only from durable storage: intent + latest submission + saved-recipient
 * freshness. No live chain calls here (serverless-safe); use POST submission
 * with { recheck:true } for bounded on-chain re-verification.
 */

import { NextResponse } from "next/server";
import { createDrizzleIntentStore } from "@/lib/transfers/repository";
import { checkIntentFreshness } from "@/lib/transfers/service";
import { createDrizzleSubmissionStore } from "@/lib/transfers/submissions";
import {
  errorResponse,
  getStore,
  NO_STORE,
  requireOwner,
} from "@/lib/recipients/routes";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner(request);
  if ("response" in auth) return auth.response;
  const db = getDb();
  const recipients = getStore();
  if (!db || !recipients) {
    return errorResponse("RECIPIENTS_UNAVAILABLE", "Transfer storage is not configured.", 503);
  }
  const { id } = await context.params;
  const intents = createDrizzleIntentStore(db);
  const submissions = createDrizzleSubmissionStore(db);
  try {
    const result = await checkIntentFreshness(intents, recipients, {
      ownerAddress: auth.owner,
      id,
    });
    const submission = await submissions.findByIntent(id);
    if (!submission || submission.ownerAddress !== auth.owner) {
      return NextResponse.json(
        { ok: true, ...result, submission: null },
        { headers: NO_STORE },
      );
    }
    return NextResponse.json(
      { ok: true, ...result, submission },
      { headers: NO_STORE },
    );
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "NOT_FOUND") {
      return errorResponse("NOT_FOUND", "Payment intent not found.", 404);
    }
    return errorResponse("STATUS_UNAVAILABLE", "Status request failed.", 500);
  }
}
