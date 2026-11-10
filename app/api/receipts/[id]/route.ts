import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  errorResponse,
  NO_STORE,
  requireOwner,
} from "@/lib/recipients/routes";
import { getOwnerReceiptDetail } from "@/lib/receipts/service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireOwner(request);
  if ("response" in auth) return auth.response;
  const db = getDb();
  if (!db) {
    return errorResponse("RECEIPTS_UNAVAILABLE", "Receipt storage is not configured.", 503);
  }
  const { id } = await context.params;
  try {
    const receipt = await getOwnerReceiptDetail(db, auth.owner, id);
    if (!receipt) {
      return errorResponse("NOT_FOUND", "Receipt not found for this wallet.", 404);
    }
    return NextResponse.json({ ok: true, receipt }, { headers: NO_STORE });
  } catch {
    return errorResponse("RECEIPTS_UNAVAILABLE", "Receipt could not be loaded right now.", 500);
  }
}
