import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isConversationId, loadConversation } from "@/lib/conversations/service";
import { errorResponse, NO_STORE, requireOwner } from "@/lib/recipients/routes";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const auth = await requireOwner(request);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!isConversationId(id)) {
    return errorResponse("NOT_FOUND", "Conversation not found.", 404);
  }
  const rawBefore = new URL(request.url).searchParams.get("beforeSequence");
  const beforeSequence =
    rawBefore && /^\d{1,16}$/.test(rawBefore) ? Number(rawBefore) : undefined;
  if (rawBefore && (!beforeSequence || !Number.isSafeInteger(beforeSequence))) {
    return errorResponse("INVALID_REQUEST", "The message page cursor is invalid.", 400);
  }
  const db = getDb();
  if (!db) {
    return errorResponse("CONVERSATIONS_UNAVAILABLE", "Conversation storage is not configured.", 503);
  }
  try {
    const detail = await loadConversation(db, auth.owner, id, { beforeSequence });
    if (!detail) return errorResponse("NOT_FOUND", "Conversation not found.", 404);
    return NextResponse.json(
      {
        ok: true,
        session: detail.session,
        messages: detail.messages,
        olderBeforeSequence: detail.olderBeforeSequence,
      },
      { headers: NO_STORE },
    );
  } catch {
    return errorResponse("CONVERSATIONS_UNAVAILABLE", "Earlier messages could not be loaded.", 500);
  }
}
