import "server-only";

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import {
  beginConversationTurn,
  completeConversationTurn,
  createConversation,
  deleteConversation,
  failConversationTurn,
  listConversations,
  loadConversation,
  renameConversation,
} from "@/lib/conversations/service";

function localDatabaseUrl(): string {
  const value = process.env.P11_LOCAL_DATABASE_URL;
  if (!value) throw new Error("Set P11_LOCAL_DATABASE_URL to the disposable local database.");
  const url = new URL(value);
  if (url.hostname !== "127.0.0.1" || url.port !== "55432") {
    throw new Error("Conversation self-check only accepts 127.0.0.1:55432.");
  }
  return value;
}

function walletAddress(): string {
  return `0x${randomBytes(20).toString("hex")}`;
}

async function run() {
  const sql = postgres(localDatabaseUrl(), { max: 4, prepare: false, connect_timeout: 5 });
  const db = drizzle(sql, { schema });
  const ownerA = walletAddress();
  const ownerB = walletAddress();
  const requestId = randomUUID();
  try {
    const first = await createConversation(db, ownerA, requestId);
    const retriedCreate = await createConversation(db, ownerA, requestId);
    assert.equal(retriedCreate.id, first.id, "creation request retries return the same server session");

    await createConversation(db, ownerB, randomUUID());
    const pageA = await listConversations(db, ownerA, { limit: 1 });
    assert.equal(pageA.sessions.length, 1);
    assert.equal(pageA.sessions[0]?.id, first.id, "conversation pages are owner scoped");
    assert.equal(await loadConversation(db, ownerB, first.id), null, "foreign sessions look not found");
    assert.equal(await renameConversation(db, ownerB, first.id, "Intrusion"), null);
    assert.equal(await deleteConversation(db, ownerB, first.id), false);
    assert.deepEqual(
      await beginConversationTurn(db, { ownerAddress: ownerB, sessionId: first.id, turnId: randomUUID(), content: "private" }),
      { kind: "not_found" },
    );

    const concurrentIds = [randomUUID(), randomUUID()];
    const claims = await Promise.all(concurrentIds.map((turnId) =>
      beginConversationTurn(db, { ownerAddress: ownerA, sessionId: first.id, turnId, content: `Concurrent ${turnId}` }),
    ));
    const claimed = claims.find((claim) => claim.kind === "claimed");
    assert.ok(claimed && claimed.kind === "claimed", "one concurrent turn takes the session lease");
    assert.equal(claims.filter((claim) => claim.kind === "in_progress").length, 1, "a second live pending turn is rejected");

    await db.update(schema.conversationMessages)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000).toISOString() })
      .where(and(
        eq(schema.conversationMessages.ownerAddress, ownerA),
        eq(schema.conversationMessages.sessionId, first.id),
        eq(schema.conversationMessages.turnId, claimed.userMessage.turnId),
      ));
    const takeover = await beginConversationTurn(db, {
      ownerAddress: ownerA,
      sessionId: first.id,
      turnId: claimed.userMessage.turnId,
      content: claimed.userMessage.content,
    });
    assert.equal(takeover.kind, "claimed", "expired attempt leases can be reclaimed");
    assert.ok(takeover.kind === "claimed");
    const staleCompletion = await completeConversationTurn(db, {
      ownerAddress: ownerA,
      sessionId: first.id,
      turnId: claimed.userMessage.turnId,
      attemptId: claimed.attemptId,
      assistantText: "This stale attempt must not be stored.",
    });
    assert.equal(staleCompletion.kind, "stale", "a previous attempt cannot complete after takeover");
    await failConversationTurn(db, {
      ownerAddress: ownerA,
      sessionId: first.id,
      turnId: takeover.userMessage.turnId,
      attemptId: takeover.attemptId,
      failureCode: "assistant_unavailable",
    });
    const retry = await beginConversationTurn(db, {
      ownerAddress: ownerA,
      sessionId: first.id,
      turnId: takeover.userMessage.turnId,
      content: takeover.userMessage.content,
    });
    assert.equal(retry.kind, "claimed", "the latest failed turn can be retried with its stable ID");
    assert.ok(retry.kind === "claimed");
    const completed = await completeConversationTurn(db, {
      ownerAddress: ownerA,
      sessionId: first.id,
      turnId: retry.userMessage.turnId,
      attemptId: retry.attemptId,
      assistantText: "A text-only persisted reply.",
    });
    assert.equal(completed.kind, "completed");
    const replay = await beginConversationTurn(db, {
      ownerAddress: ownerA,
      sessionId: first.id,
      turnId: retry.userMessage.turnId,
      content: retry.userMessage.content,
    });
    assert.equal(replay.kind, "replay", "completed retry requests return the saved text pair");
    const afterReplay = await loadConversation(db, ownerA, first.id);
    assert.equal(afterReplay?.messages.filter((message) => message.turnId === retry.userMessage.turnId).length, 2, "replay does not duplicate messages");
    assert.deepEqual(afterReplay?.messages.map((message) => message.sequence), [1, 2], "message sequence is stable and ordered");

    for (let index = 0; index < 26; index += 1) {
      const turnId = randomUUID();
      const claim = await beginConversationTurn(db, {
        ownerAddress: ownerA,
        sessionId: first.id,
        turnId,
        content: `Page test message ${index + 1}`,
      });
      assert.equal(claim.kind, "claimed");
      assert.ok(claim.kind === "claimed");
      const result = await completeConversationTurn(db, {
        ownerAddress: ownerA,
        sessionId: first.id,
        turnId,
        attemptId: claim.attemptId,
        assistantText: `Reply ${index + 1}`,
      });
      assert.equal(result.kind, "completed");
    }
    const newestMessages = await loadConversation(db, ownerA, first.id);
    assert.equal(newestMessages?.messages.length, 50, "message history loads a bounded newest page");
    assert.equal(newestMessages?.messages[0]?.sequence, 5);
    assert.equal(newestMessages?.olderBeforeSequence, 5);
    const olderMessages = await loadConversation(db, ownerA, first.id, { beforeSequence: newestMessages!.olderBeforeSequence! });
    assert.deepEqual(olderMessages?.messages.map((message) => message.sequence), [1, 2, 3, 4]);
    assert.ok(newestMessages?.messages.every((message, index, rows) => index === 0 || rows[index - 1]!.sequence < message.sequence), "each page keeps message order");

    const manual = await createConversation(db, ownerA, randomUUID());
    const renamed = await renameConversation(db, ownerA, manual.id, "Monthly rent");
    assert.equal(renamed?.title, "Monthly rent");
    assert.equal(renamed?.titleSource, "manual");

    const paginationIds = [randomUUID(), randomUUID(), randomUUID()];
    const paginatedSessions = await Promise.all(paginationIds.map((id) => createConversation(db, ownerA, id)));
    assert.equal(paginatedSessions.length, 3);
    const firstPage = await listConversations(db, ownerA, { limit: 2 });
    assert.equal(firstPage.sessions.length, 2);
    assert.ok(firstPage.nextCursor);
    const secondPage = await listConversations(db, ownerA, { limit: 2, cursor: firstPage.nextCursor! });
    assert.ok(secondPage.sessions.length >= 1);
    assert.equal(new Set([...firstPage.sessions, ...secondPage.sessions].map((session) => session.id)).size, firstPage.sessions.length + secondPage.sessions.length, "session pagination has no duplicates");

    const deleteOwnerOnly = await deleteConversation(db, ownerA, manual.id);
    assert.equal(deleteOwnerOnly, true);
    assert.equal(await loadConversation(db, ownerA, manual.id), null);

    console.log("Conversation persistence self-check passed: owner isolation, stable create IDs, pagination, serialized attempts, stale attempt protection, retry, replay, rename and delete.");
  } finally {
    await db.delete(schema.conversationSessions)
      .where(eq(schema.conversationSessions.ownerAddress, ownerA));
    await db.delete(schema.conversationSessions)
      .where(eq(schema.conversationSessions.ownerAddress, ownerB));
    await sql.end();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
