import "server-only";

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { getAddress } from "viem";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { createDrizzleSharedMemoryStore } from "@/lib/shared-memory/repository";
import {
  createSharedMemory,
  deleteSharedMemory,
  listSharedMemories,
  parseSharedMemoryDraft,
  parseSharedMemoryDelete,
  parseSharedMemoryUpdate,
  SharedMemoryError,
  updateSharedMemory,
} from "@/lib/shared-memory/service";

function localDatabaseUrl(): string {
  const value = process.env.P12_LOCAL_DATABASE_URL;
  assert.ok(value, "Set P12_LOCAL_DATABASE_URL to the disposable local database.");
  const url = new URL(value);
  assert.equal(url.protocol, "postgres:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55432");
  assert.equal(url.pathname, "/providus_p11");
  return value;
}

function ownerAddress(): string {
  return getAddress(`0x${randomBytes(20).toString("hex")}`);
}

function isMemoryError(code: SharedMemoryError["code"]) {
  return (error: unknown) => error instanceof SharedMemoryError && error.code === code;
}

async function run() {
  const sql = postgres(localDatabaseUrl(), { max: 1, prepare: false });
  const db = drizzle(sql, { schema });
  const store = createDrizzleSharedMemoryStore(db);
  const ownerA = ownerAddress();
  const ownerB = ownerAddress();
  const suffix = randomUUID().replaceAll("-", "");
  const sessionId = `p12_session_${suffix}`;
  const sessionRequestId = `p12_create_${suffix}`;
  const requestId = `p12_memory_${suffix}`;
  const original = parseSharedMemoryDraft({
    requestId,
    kind: "preference",
    label: "Preferred explanation",
    value: "Use clear and concise steps.",
  });

  try {
    const [migration] = await sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`;
    assert.equal(migration.count, 9, "The P1.2 database check requires 0008 applied locally.");

    const [first, retried] = await Promise.all([
      createSharedMemory(store, ownerA, original),
      createSharedMemory(store, ownerA, original),
    ]);
    assert.equal(first.id, retried.id, "Concurrent retries converge to one row.");
    assert.equal((await listSharedMemories(store, ownerA)).length, 1);
    assert.equal((await listSharedMemories(store, ownerB)).length, 0);

    const ownerBMemory = await createSharedMemory(
      store,
      ownerB,
      parseSharedMemoryDraft({
        requestId: `p12_other_${suffix}`,
        kind: "fact",
        label: "Preferred explanation",
        value: "This belongs only to another owner.",
      }),
    );
    await assert.rejects(
      () => createSharedMemory(
        store,
        ownerA,
        parseSharedMemoryDraft({
          requestId: `p12_dupe_${suffix}`,
          kind: "fact",
          label: "preferred EXPLANATION",
          value: "A duplicate label.",
        }),
      ),
      isMemoryError("DUPLICATE_LABEL"),
    );

    const updated = await updateSharedMemory(
      store,
      ownerA,
      first.id,
      parseSharedMemoryUpdate({
        expectedVersion: 1,
        kind: "preference",
        label: "Preferred explanation",
        value: "Use short, numbered steps.",
      }),
    );
    assert.equal(updated.version, 2);
    await assert.rejects(
      () => updateSharedMemory(
        store,
        ownerA,
        first.id,
        parseSharedMemoryUpdate({
          expectedVersion: 1,
          kind: "preference",
          label: "Preferred explanation",
          value: "Do not overwrite the newer value.",
        }),
      ),
      isMemoryError("STALE_VERSION"),
    );
    await assert.rejects(
      () => updateSharedMemory(
        store,
        ownerB,
        first.id,
        parseSharedMemoryUpdate({
          expectedVersion: 2,
          kind: "fact",
          label: "Foreign update",
          value: "No access.",
        }),
      ),
      isMemoryError("NOT_FOUND"),
    );

    await db.insert(schema.conversationSessions).values({
      id: sessionId,
      ownerAddress: ownerA,
      createRequestId: sessionRequestId,
      title: "Temporary test chat",
    });
    await db
      .delete(schema.conversationSessions)
      .where(and(eq(schema.conversationSessions.id, sessionId), eq(schema.conversationSessions.ownerAddress, ownerA)));
    assert.equal((await listSharedMemories(store, ownerA)).some((row) => row.id === updated.id), true);

    await deleteSharedMemory(
      store,
      ownerA,
      updated.id,
      parseSharedMemoryDelete({ expectedVersion: updated.version }).expectedVersion,
    );
    await deleteSharedMemory(
      store,
      ownerA,
      updated.id,
      parseSharedMemoryDelete({ expectedVersion: updated.version }).expectedVersion,
    );
    assert.deepEqual(await listSharedMemories(store, ownerA), []);
    assert.deepEqual((await listSharedMemories(store, ownerB)).map((row) => row.id), [ownerBMemory.id]);
    console.log("Shared memory database self-check passed: 0008 gate, owner isolation, concurrent create retry, duplicate label, stale edit, and chat-delete independence.");
  } finally {
    await db.delete(schema.conversationSessions).where(eq(schema.conversationSessions.id, sessionId));
    await db.delete(schema.assistantMemories).where(eq(schema.assistantMemories.ownerAddress, ownerA));
    await db.delete(schema.assistantMemories).where(eq(schema.assistantMemories.ownerAddress, ownerB));
    await sql.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : "Shared memory database self-check failed.");
  process.exitCode = 1;
});
