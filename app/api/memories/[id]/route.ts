import { NextResponse } from "next/server";
import {
  deleteSharedMemory,
  parseSharedMemoryDelete,
  parseSharedMemoryUpdate,
  updateSharedMemory,
} from "@/lib/shared-memory/service";
import { getSharedMemoryStore, NO_STORE, sharedMemoryErrorResponse } from "@/lib/shared-memory/routes";
import {
  errorResponse,
  isPlainObject,
  readBody,
  requireOwnerForMutation,
} from "@/lib/recipients/routes";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireOwnerForMutation(request);
  if ("response" in auth) return auth.response;
  const store = getSharedMemoryStore();
  if (!store) return errorResponse("SHARED_MEMORY_UNAVAILABLE", "Shared memory storage is not configured.", 503);
  const body = await readBody(request);
  if (!body.ok || !isPlainObject(body.value)) {
    return errorResponse("INVALID_REQUEST", "Request body must be a small JSON object.", body.ok ? 400 : 413);
  }
  const { id } = await context.params;
  try {
    const memory = await updateSharedMemory(
      store,
      auth.owner,
      id,
      parseSharedMemoryUpdate(body.value),
    );
    return NextResponse.json({ ok: true, memory }, { headers: NO_STORE });
  } catch (error) {
    return sharedMemoryErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireOwnerForMutation(request);
  if ("response" in auth) return auth.response;
  const store = getSharedMemoryStore();
  if (!store) return errorResponse("SHARED_MEMORY_UNAVAILABLE", "Shared memory storage is not configured.", 503);
  const body = await readBody(request);
  if (!body.ok || !isPlainObject(body.value)) {
    return errorResponse("INVALID_REQUEST", "Request body must be a small JSON object.", body.ok ? 400 : 413);
  }
  const { id } = await context.params;
  try {
    await deleteSharedMemory(
      store,
      auth.owner,
      id,
      parseSharedMemoryDelete(body.value).expectedVersion,
    );
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return sharedMemoryErrorResponse(error);
  }
}
