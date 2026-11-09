/**
 * GET /api/recipients/resolve?label=&chainId= — chain-scoped resolution.
 * Returns the FULL address: the caller is the authenticated owner confirming
 * a payment recipient.
 */

import { NextResponse } from "next/server";
import { resolveRecipient } from "@/lib/recipients/service";
import {
  errorResponse,
  getStore,
  NO_STORE,
  recipientErrorResponse,
  requireOwner,
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
  let label: string | null = null;
  let chainId = NaN;
  try {
    const url = new URL(request.url);
    label = url.searchParams.get("label");
    chainId = Number(url.searchParams.get("chainId"));
  } catch {
    return errorResponse("INVALID_REQUEST", "label and chainId are required.", 400);
  }
  if (!label) {
    return errorResponse("INVALID_REQUEST", "label is required.", 400);
  }
  try {
    const recipient = await resolveRecipient(store, {
      ownerAddress: auth.owner,
      label,
      chainId,
    });
    return NextResponse.json({ ok: true, recipient }, { headers: NO_STORE });
  } catch (err) {
    return recipientErrorResponse(err);
  }
}
