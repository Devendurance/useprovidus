/**
 * /api/recipients — GET lists the caller's compact summaries (masked),
 * POST saves a recipient for the authenticated owner.
 */

import { NextResponse } from "next/server";
import {
  listRecipients,
  saveRecipient,
  toRecipientSummary,
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

export async function GET(request: Request) {
  const auth = await requireOwner(request);
  if ("response" in auth) return auth.response;
  const store = getStore();
  if (!store) {
    return errorResponse("RECIPIENTS_UNAVAILABLE", "Recipient storage is not configured.", 503);
  }
  try {
    const rows = await listRecipients(store, auth.owner);
    return NextResponse.json(
      { ok: true, recipients: rows.map(toRecipientSummary) },
      { headers: NO_STORE },
    );
  } catch (err) {
    return recipientErrorResponse(err);
  }
}

export async function POST(request: Request) {
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
  const { label, chainId, address } = body.value;
  try {
    const saved = await saveRecipient(store, {
      ownerAddress: auth.owner,
      label,
      chainId,
      address,
    });
    return NextResponse.json({ ok: true, recipient: saved }, { status: 201, headers: NO_STORE });
  } catch (err) {
    return recipientErrorResponse(err);
  }
}
