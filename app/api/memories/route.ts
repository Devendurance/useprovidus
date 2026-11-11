import { NextResponse } from "next/server";
import { listSharedMemories, createSharedMemory, parseSharedMemoryDraft } from "@/lib/shared-memory/service";
import { getSharedMemoryStore, NO_STORE, sharedMemoryErrorResponse } from "@/lib/shared-memory/routes";
import {
  errorResponse,
  isPlainObject,
  readBody,
  requireOwner,
  requireOwnerForMutation,
} from "@/lib/recipients/routes";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const auth = await requireOwner(request);
  if ("response" in auth) return auth.response;
  const store = getSharedMemoryStore();
  if (!store) return errorResponse("SHARED_MEMORY_UNAVAILABLE", "Shared memory storage is not configured.", 503);
  try {
    const memories = await listSharedMemories(store, auth.owner);
    return NextResponse.json({ ok: true, memories }, { headers: NO_STORE });
  } catch (error) {
    return sharedMemoryErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireOwnerForMutation(request);
  if ("response" in auth) return auth.response;
  const store = getSharedMemoryStore();
  if (!store) return errorResponse("SHARED_MEMORY_UNAVAILABLE", "Shared memory storage is not configured.", 503);
  const body = await readBody(request);
  if (!body.ok || !isPlainObject(body.value)) {
    return errorResponse("INVALID_REQUEST", "Request body must be a small JSON object.", body.ok ? 400 : 413);
  }
  try {
    const memory = await createSharedMemory(store, auth.owner, parseSharedMemoryDraft(body.value));
    return NextResponse.json({ ok: true, memory }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return sharedMemoryErrorResponse(error);
  }
}
