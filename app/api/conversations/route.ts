import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  createConversation,
  isConversationCursor,
  isConversationRequestId,
  listConversations,
} from "@/lib/conversations/service";
import {
  errorResponse,
  isPlainObject,
  NO_STORE,
  readBody,
  requireOwner,
  requireOwnerForMutation,
} from "@/lib/recipients/routes";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const auth = await requireOwner(request);
  if ("response" in auth) return auth.response;
  const db = getDb();
  if (!db) {
    return errorResponse("CONVERSATIONS_UNAVAILABLE", "Conversation storage is not configured.", 503);
  }

  const params = new URL(request.url).searchParams;
  const cursor = params.get("cursor") ?? undefined;
  const rawLimit = params.get("limit");
  const limit = rawLimit && /^\d{1,2}$/.test(rawLimit) ? Number(rawLimit) : 20;
  if (limit < 1 || limit > 50 || (cursor && (cursor.length > 512 || !isConversationCursor(cursor)))) {
    return errorResponse("INVALID_REQUEST", "Conversation history filters are invalid.", 400);
  }

  try {
    const page = await listConversations(db, auth.owner, { cursor, limit });
    return NextResponse.json({ ok: true, ...page }, { headers: NO_STORE });
  } catch {
    return errorResponse("CONVERSATIONS_UNAVAILABLE", "Conversation history could not be loaded.", 500);
  }
}

export async function POST(request: Request) {
  const auth = await requireOwnerForMutation(request);
  if ("response" in auth) return auth.response;
  const db = getDb();
  if (!db) {
    return errorResponse("CONVERSATIONS_UNAVAILABLE", "Conversation storage is not configured.", 503);
  }
  const body = await readBody(request);
  if (!body.ok || !isPlainObject(body.value)) {
    return errorResponse("INVALID_REQUEST", "A conversation request ID is required.", body.ok ? 400 : 413);
  }
  const requestId = body.value.requestId;
  if (typeof requestId !== "string" || !isConversationRequestId(requestId)) {
    return errorResponse("INVALID_REQUEST", "A valid conversation request ID is required.", 400);
  }

  try {
    const session = await createConversation(db, auth.owner, requestId);
    return NextResponse.json({ ok: true, session }, { status: 201, headers: NO_STORE });
  } catch {
    return errorResponse("CONVERSATIONS_UNAVAILABLE", "A new conversation could not be created.", 500);
  }
}
