import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  errorResponse,
  NO_STORE,
  requireOwner,
} from "@/lib/recipients/routes";
import { isReceiptNetworkKey, isValidReceiptCursor, listOwnerReceipts } from "@/lib/receipts/service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS_FILTERS = new Set([
  "verified", "pending", "unknown", "failed", "completed", "settled",
  "settling", "processing", "refunded",
]);

export async function GET(request: Request) {
  const auth = await requireOwner(request);
  if ("response" in auth) return auth.response;
  const db = getDb();
  if (!db) {
    return errorResponse("RECEIPTS_UNAVAILABLE", "Receipt storage is not configured.", 503);
  }

  const params = new URL(request.url).searchParams;
  const networkRaw = params.get("network")?.trim() ?? "";
  if (networkRaw && !isReceiptNetworkKey(networkRaw)) {
    return errorResponse("INVALID_FILTER", "Choose a supported network filter.", 400);
  }
  const status = (params.get("status") ?? "").trim().toLowerCase();
  if (status && !STATUS_FILTERS.has(status)) {
    return errorResponse("INVALID_FILTER", "Choose a supported status filter.", 400);
  }
  const token = (params.get("token") ?? "").trim();
  if (token && !/^[a-zA-Z0-9]{2,12}$/.test(token)) {
    return errorResponse("INVALID_FILTER", "Choose a supported token filter.", 400);
  }
  const rawLimit = params.get("limit");
  const limit = rawLimit && /^\d{1,2}$/.test(rawLimit) ? Number(rawLimit) : 20;
  if (limit < 1 || limit > 50) {
    return errorResponse("INVALID_FILTER", "Page size must be from 1 to 50.", 400);
  }
  const cursor = params.get("cursor") ?? undefined;
  if (cursor && (cursor.length > 512 || !isValidReceiptCursor(cursor))) {
    return errorResponse("INVALID_CURSOR", "The receipt page cursor is invalid.", 400);
  }

  try {
    const result = await listOwnerReceipts(db, auth.owner, {
      search: params.get("q") ?? "",
      network: networkRaw ? networkRaw as "celo" | "bot-mainnet" | "bot-testnet" : undefined,
      token,
      status,
      cursor,
      limit,
    });
    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch {
    return errorResponse("RECEIPTS_UNAVAILABLE", "Receipts could not be loaded right now.", 500);
  }
}
