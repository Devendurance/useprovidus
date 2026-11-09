/**
 * /api/transfers/[id] — GET returns the intent plus version freshness,
 * DELETE cancels a pending intent. Owner-scoped; foreign IDs read as 404.
 */

import { NextResponse } from "next/server";
import { AmountError } from "@/lib/transfers/amounts";
import {
  cancelTransferIntent,
  checkIntentFreshness,
  TransferError,
} from "@/lib/transfers/service";
import {
  errorResponse,
  getStore,
  NO_STORE,
  recipientErrorResponse,
  requireOwner,
  requireOwnerForMutation,
} from "@/lib/recipients/routes";
import { createDrizzleIntentStore } from "@/lib/transfers/repository";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function transferErrorResponse(err: unknown) {
  if (err instanceof TransferError) {
    const status =
      err.code === "NOT_AUTHENTICATED" ? 401
      : err.code === "NOT_FOUND" ? 404
      : err.code === "INTENT_ALREADY_CANCELLED" ? 409
      : 400;
    return errorResponse(err.code, err.message, status);
  }
  if (err instanceof AmountError) {
    return errorResponse(err.code, err.message, 400);
  }
  return recipientErrorResponse(err);
}

function intentStore() {
  const db = getDb();
  return db ? createDrizzleIntentStore(db) : null;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner(request);
  if ("response" in auth) return auth.response;
  const intents = intentStore();
  const recipients = getStore();
  if (!intents || !recipients) {
    return errorResponse("RECIPIENTS_UNAVAILABLE", "Transfer storage is not configured.", 503);
  }
  const { id } = await context.params;
  try {
    const result = await checkIntentFreshness(intents, recipients, {
      ownerAddress: auth.owner,
      id,
    });
    return NextResponse.json(
      { ok: true, ...result },
      { headers: NO_STORE },
    );
  } catch (err) {
    return transferErrorResponse(err);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireOwnerForMutation(request);
  if ("response" in auth) return auth.response;
  const intents = intentStore();
  if (!intents) {
    return errorResponse("RECIPIENTS_UNAVAILABLE", "Transfer storage is not configured.", 503);
  }
  const { id } = await context.params;
  try {
    const intent = await cancelTransferIntent(intents, { ownerAddress: auth.owner, id });
    return NextResponse.json({ ok: true, intent }, { headers: NO_STORE });
  } catch (err) {
    return transferErrorResponse(err);
  }
}
