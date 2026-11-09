/**
 * /api/recipients/[id] — GET full record (owner confirmation view),
 * PATCH rename and/or change address (explicit, version-checked),
 * DELETE soft-delete.
 */

import { NextResponse } from "next/server";
import {
  changeRecipientAddress,
  getRecipient,
  removeRecipient,
  renameRecipient,
} from "@/lib/recipients/service";
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

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner(request);
  if ("response" in auth) return auth.response;
  const store = getStore();
  if (!store) {
    return errorResponse("RECIPIENTS_UNAVAILABLE", "Recipient storage is not configured.", 503);
  }
  const { id } = await context.params;
  try {
    const recipient = await getRecipient(store, { ownerAddress: auth.owner, id });
    return NextResponse.json({ ok: true, recipient }, { headers: NO_STORE });
  } catch (err) {
    return recipientErrorResponse(err);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireOwnerForMutation(request);
  if ("response" in auth) return auth.response;
  const store = getStore();
  if (!store) {
    return errorResponse("RECIPIENTS_UNAVAILABLE", "Recipient storage is not configured.", 503);
  }
  const body = await readBody(request);
  if (!body.ok || !isPlainObject(body.value)) {
    return errorResponse("INVALID_REQUEST", "Request body must be a small JSON object.", body.ok ? 400 : 413);
  }
  const { id } = await context.params;
  const { label, address, expectedVersion } = body.value;
  if (typeof expectedVersion !== "number") {
    return errorResponse("INVALID_REQUEST", "expectedVersion (the version you read) is required.", 400);
  }
  if (label === undefined && address === undefined) {
    return errorResponse("INVALID_REQUEST", "Nothing to update: provide label and/or address.", 400);
  }
  try {
    const current = await getRecipient(store, { ownerAddress: auth.owner, id });
    if (expectedVersion !== current.version) {
      return errorResponse("STALE_VERSION", "Recipient changed since you last read it. Refresh and retry.", 409);
    }
    let recipient = current;
    if (label !== undefined) {
      recipient = await renameRecipient(store, {
        ownerAddress: auth.owner,
        id,
        newLabel: label,
        expectedVersion: recipient.version,
      });
    }
    if (address !== undefined) {
      recipient = await changeRecipientAddress(store, {
        ownerAddress: auth.owner,
        id,
        newAddress: address,
        expectedVersion: recipient.version,
      });
    }
    return NextResponse.json({ ok: true, recipient }, { headers: NO_STORE });
  } catch (err) {
    return recipientErrorResponse(err);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireOwnerForMutation(request);
  if ("response" in auth) return auth.response;
  const store = getStore();
  if (!store) {
    return errorResponse("RECIPIENTS_UNAVAILABLE", "Recipient storage is not configured.", 503);
  }
  const { id } = await context.params;
  try {
    const result = await removeRecipient(store, { ownerAddress: auth.owner, id });
    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch (err) {
    return recipientErrorResponse(err);
  }
}
