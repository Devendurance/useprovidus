/**
 * /api/transfers — GET lists the caller's intents, POST prepares one.
 * Preparation only: no signing, no broadcasting, no execution.
 */

import { NextResponse } from "next/server";
import { AmountError } from "@/lib/transfers/amounts";
import {
  listTransferIntents,
  prepareTransferIntent,
  TransferError,
} from "@/lib/transfers/service";
import {
  errorResponse,
  getStore,
  isPlainObject,
  NO_STORE,
  readBody,
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
      : err.code === "IDEMPOTENCY_CONFLICT" ? 409
      : err.code === "INTENT_ALREADY_CANCELLED" ? 409
      : 400;
    // NOT_FOUND covers missing and foreign IDs alike: no owner leakage.
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

export async function GET(request: Request) {
  const auth = await requireOwner(request);
  if ("response" in auth) return auth.response;
  const intents = intentStore();
  if (!intents) {
    return errorResponse("RECIPIENTS_UNAVAILABLE", "Transfer storage is not configured.", 503);
  }
  const rows = await listTransferIntents(intents, auth.owner);
  const nowMs = Date.now();
  return NextResponse.json(
    {
      ok: true,
      intents: rows.map((intent) => ({
        intent,
        expired: Date.parse(intent.expiresAt) <= nowMs,
      })),
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  const auth = await requireOwnerForMutation(request);
  if ("response" in auth) return auth.response;
  const intents = intentStore();
  const recipients = getStore();
  if (!intents || !recipients) {
    return errorResponse("RECIPIENTS_UNAVAILABLE", "Transfer storage is not configured.", 503);
  }
  const body = await readBody(request);
  if (!body.ok || !isPlainObject(body.value)) {
    return errorResponse("INVALID_REQUEST", "Request body must be a small JSON object.", body.ok ? 400 : 413);
  }
  const { recipient, chainId, asset, amount, idempotencyKey } = body.value;
  try {
    const prepared = await prepareTransferIntent(intents, recipients, {
      ownerAddress: auth.owner,
      recipient: recipient as { type: "saved"; label: string },
      chainId,
      asset,
      amount,
      idempotencyKey: idempotencyKey ?? undefined,
    });
    return NextResponse.json(
      {
        ok: true,
        intent: prepared.intent,
        deduplicated: prepared.deduplicated,
        expired: prepared.expired,
      },
      { status: prepared.deduplicated ? 200 : 201, headers: NO_STORE },
    );
  } catch (err) {
    return transferErrorResponse(err);
  }
}
