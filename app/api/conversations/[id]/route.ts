import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  deleteConversation,
  isConversationId,
  loadConversation,
  renameConversation,
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

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const auth = await requireOwner(request);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!isConversationId(id)) {
    return errorResponse("NOT_FOUND", "Conversation not found.", 404);
  }
  const db = getDb();
  if (!db) {
    return errorResponse("CONVERSATIONS_UNAVAILABLE", "Conversation storage is not configured.", 503);
  }
  try {
    const detail = await loadConversation(db, auth.owner, id);
    if (!detail) return errorResponse("NOT_FOUND", "Conversation not found.", 404);
    return NextResponse.json({ ok: true, ...detail }, { headers: NO_STORE });
  } catch {
    return errorResponse("CONVERSATIONS_UNAVAILABLE", "Conversation could not be loaded.", 500);
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const auth = await requireOwnerForMutation(request);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!isConversationId(id)) {
    return errorResponse("NOT_FOUND", "Conversation not found.", 404);
  }
  const db = getDb();
  if (!db) {
    return errorResponse("CONVERSATIONS_UNAVAILABLE", "Conversation storage is not configured.", 503);
  }
  const body = await readBody(request);
  if (!body.ok || !isPlainObject(body.value) || typeof body.value.title !== "string") {
    return errorResponse("INVALID_REQUEST", "Enter a conversation title.", body.ok ? 400 : 413);
  }
  try {
    const session = await renameConversation(db, auth.owner, id, body.value.title);
    if (!session) return errorResponse("NOT_FOUND", "Conversation not found.", 404);
    return NextResponse.json({ ok: true, session }, { headers: NO_STORE });
  } catch {
    return errorResponse("INVALID_REQUEST", "Conversation titles must be 1 to 80 characters.", 400);
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const auth = await requireOwnerForMutation(request);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!isConversationId(id)) {
    return errorResponse("NOT_FOUND", "Conversation not found.", 404);
  }
  const db = getDb();
  if (!db) {
    return errorResponse("CONVERSATIONS_UNAVAILABLE", "Conversation storage is not configured.", 503);
  }
  const body = await readBody(request);
  if (!body.ok || !isPlainObject(body.value) || body.value.confirm !== true) {
    return errorResponse("CONFIRMATION_REQUIRED", "Confirm that you want to delete this conversation.", body.ok ? 400 : 413);
  }
  try {
    const deleted = await deleteConversation(db, auth.owner, id);
    if (!deleted) return errorResponse("NOT_FOUND", "Conversation not found.", 404);
    return NextResponse.json({ ok: true, deleted: true }, { headers: NO_STORE });
  } catch {
    return errorResponse("CONVERSATIONS_UNAVAILABLE", "Conversation could not be deleted.", 500);
  }
}
