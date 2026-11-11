import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createDrizzleSharedMemoryStore } from "@/lib/shared-memory/repository";
import { SharedMemoryError } from "@/lib/shared-memory/service";

export const NO_STORE = { "Cache-Control": "no-store" };

export function getSharedMemoryStore() {
  const db = getDb();
  return db ? createDrizzleSharedMemoryStore(db) : null;
}

export function sharedMemoryErrorResponse(error: unknown) {
  if (error instanceof SharedMemoryError) {
    const status = {
      INVALID_OWNER: 401,
      INVALID_MEMORY: 400,
      DUPLICATE_LABEL: 409,
      REQUEST_ID_REUSED: 409,
      NOT_FOUND: 404,
      STALE_VERSION: 409,
    }[error.code];
    return NextResponse.json(
      { ok: false, error: { code: error.code, message: error.message } },
      { status, headers: NO_STORE },
    );
  }
  return NextResponse.json(
    { ok: false, error: { code: "SHARED_MEMORY_UNAVAILABLE", message: "Shared memory could not be saved right now." } },
    { status: 500, headers: NO_STORE },
  );
}
