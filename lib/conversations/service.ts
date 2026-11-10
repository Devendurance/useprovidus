import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, lt, or } from "drizzle-orm";
import type { DbClient } from "@/lib/db";
import {
  conversationMessages,
  conversationSessions,
  type ConversationMessage as ConversationMessageRow,
  type ConversationSession as ConversationSessionRow,
} from "@/lib/db/schema";
import type {
  ConversationDetail,
  ConversationFailureCode,
  ConversationListPage,
  ConversationMessageView,
  ConversationSummary,
  ConversationTurnClaim,
  ConversationTurnCompletion,
  ConversationTurnStatus,
} from "@/lib/conversations/types";

const TURN_LEASE_MS = 120_000;
const MODEL_CONTEXT_LIMIT = 24;
const MESSAGE_LIMIT = 50;
const TITLE_LIMIT = 80;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SessionCursor = { updatedAt: string; id: string };
type DbTransaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function summary(row: ConversationSessionRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    titleSource: row.titleSource as "automatic" | "manual",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastMessageAt: row.lastMessageAt,
  };
}

function messageView(row: ConversationMessageRow): ConversationMessageView {
  return {
    id: row.id,
    sessionId: row.sessionId,
    turnId: row.turnId,
    sequence: row.messageSequence,
    role: row.role,
    content: row.content,
    timestamp: row.createdAt,
    ...(row.role === "user"
      ? {
          turnStatus: row.turnStatus as ConversationTurnStatus,
          failureCode: row.failureCode as ConversationFailureCode | null,
        }
      : {}),
  };
}

function encodeCursor(cursor: SessionCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string | undefined): SessionCursor | null | false {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("updatedAt" in decoded) ||
      typeof decoded.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(decoded.updatedAt)) ||
      !("id" in decoded) ||
      typeof decoded.id !== "string" ||
      !isUuid(decoded.id)
    ) {
      return false;
    }
    return { updatedAt: decoded.updatedAt, id: decoded.id };
  } catch {
    return false;
  }
}

export function isConversationId(value: string): boolean {
  return isUuid(value);
}

export function isConversationRequestId(value: string): boolean {
  return isUuid(value);
}

export function isConversationTurnId(value: string): boolean {
  return isUuid(value);
}

export function isConversationCursor(value: string | undefined): boolean {
  return decodeCursor(value) !== false;
}

export function conversationTitle(text: string): string {
  const clean = text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= TITLE_LIMIT) return clean;
  return clean.slice(0, TITLE_LIMIT - 1).trimEnd() + "…";
}

function pageLimit(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.min(MESSAGE_LIMIT, Math.floor(value ?? fallback)));
}

function toHistory(rows: ConversationMessageRow[]): ConversationMessageView[] {
  return rows.map(messageView);
}

async function contextBefore(
  tx: DbTransaction,
  ownerAddress: string,
  sessionId: string,
  sequence: number,
): Promise<ConversationMessageView[]> {
  const rows = await tx
    .select()
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.sessionId, sessionId),
        eq(conversationMessages.ownerAddress, ownerAddress),
        lt(conversationMessages.messageSequence, sequence),
      ),
    )
    .orderBy(desc(conversationMessages.messageSequence))
    .limit(MODEL_CONTEXT_LIMIT);
  return toHistory(rows.reverse());
}

async function latestUserMessage(
  tx: DbTransaction,
  ownerAddress: string,
  sessionId: string,
) {
  const [row] = await tx
    .select()
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.sessionId, sessionId),
        eq(conversationMessages.ownerAddress, ownerAddress),
        eq(conversationMessages.role, "user"),
      ),
    )
    .orderBy(desc(conversationMessages.messageSequence))
    .limit(1);
  return row ?? null;
}

async function assistantForTurn(
  tx: DbTransaction,
  ownerAddress: string,
  sessionId: string,
  turnId: string,
) {
  const [row] = await tx
    .select()
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.sessionId, sessionId),
        eq(conversationMessages.ownerAddress, ownerAddress),
        eq(conversationMessages.turnId, turnId),
        eq(conversationMessages.role, "assistant"),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function updateMessageActivity(
  tx: DbTransaction,
  sessionId: string,
  updatedAt: string,
  lastMessageAt?: string,
) {
  await tx
    .update(conversationSessions)
    .set({
      updatedAt,
      ...(lastMessageAt ? { lastMessageAt } : {}),
    })
    .where(eq(conversationSessions.id, sessionId));
}

export async function createConversation(
  db: DbClient,
  ownerAddress: string,
  requestId: string,
): Promise<ConversationSummary> {
  if (!isUuid(requestId)) throw new Error("Invalid conversation request ID.");
  const id = randomUUID();
  const [created] = await db
    .insert(conversationSessions)
    .values({ id, ownerAddress, createRequestId: requestId })
    .onConflictDoNothing()
    .returning();
  if (created) return summary(created);

  const [existing] = await db
    .select()
    .from(conversationSessions)
    .where(
      and(
        eq(conversationSessions.ownerAddress, ownerAddress),
        eq(conversationSessions.createRequestId, requestId),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Conversation could not be created.");
  return summary(existing);
}

export async function listConversations(
  db: DbClient,
  ownerAddress: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<ConversationListPage> {
  const cursor = decodeCursor(options.cursor);
  if (cursor === false) throw new Error("Invalid conversation cursor.");
  const limit = pageLimit(options.limit, 20);
  const cursorClause = cursor
    ? or(
        lt(conversationSessions.updatedAt, cursor.updatedAt),
        and(
          eq(conversationSessions.updatedAt, cursor.updatedAt),
          lt(conversationSessions.id, cursor.id),
        ),
      )
    : undefined;
  const rows = await db
    .select()
    .from(conversationSessions)
    .where(
      cursorClause
        ? and(eq(conversationSessions.ownerAddress, ownerAddress), cursorClause)
        : eq(conversationSessions.ownerAddress, ownerAddress),
    )
    .orderBy(desc(conversationSessions.updatedAt), desc(conversationSessions.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    sessions: page.map(summary),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ updatedAt: last.updatedAt, id: last.id })
        : null,
  };
}

export async function loadConversation(
  db: DbClient,
  ownerAddress: string,
  sessionId: string,
  options: { beforeSequence?: number; limit?: number } = {},
): Promise<ConversationDetail | null> {
  if (!isUuid(sessionId)) return null;
  const [session] = await db
    .select()
    .from(conversationSessions)
    .where(
      and(
        eq(conversationSessions.id, sessionId),
        eq(conversationSessions.ownerAddress, ownerAddress),
      ),
    )
    .limit(1);
  if (!session) return null;

  const limit = pageLimit(options.limit, MESSAGE_LIMIT);
  const before = options.beforeSequence;
  if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) {
    throw new Error("Invalid message cursor.");
  }
  const where =
    before === undefined
      ? and(
          eq(conversationMessages.sessionId, sessionId),
          eq(conversationMessages.ownerAddress, ownerAddress),
        )
      : and(
          eq(conversationMessages.sessionId, sessionId),
          eq(conversationMessages.ownerAddress, ownerAddress),
          lt(conversationMessages.messageSequence, before),
        );
  const rows = await db
    .select()
    .from(conversationMessages)
    .where(where)
    .orderBy(desc(conversationMessages.messageSequence))
    .limit(limit + 1);
  const page = rows.slice(0, limit).reverse();
  return {
    session: summary(session),
    messages: page.map(messageView),
    olderBeforeSequence: rows.length > limit ? page[0]?.messageSequence ?? null : null,
  };
}

export async function renameConversation(
  db: DbClient,
  ownerAddress: string,
  sessionId: string,
  title: string,
): Promise<ConversationSummary | null> {
  const normalizedTitle = title.replace(/\s+/g, " ").trim();
  if (!normalizedTitle || normalizedTitle.length > TITLE_LIMIT) {
    throw new Error("Conversation title must be from 1 to 80 characters.");
  }
  const [row] = await db
    .update(conversationSessions)
    .set({
      title: normalizedTitle,
      titleSource: "manual",
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(conversationSessions.id, sessionId),
        eq(conversationSessions.ownerAddress, ownerAddress),
      ),
    )
    .returning();
  return row ? summary(row) : null;
}

export async function deleteConversation(
  db: DbClient,
  ownerAddress: string,
  sessionId: string,
): Promise<boolean> {
  const rows = await db
    .delete(conversationSessions)
    .where(
      and(
        eq(conversationSessions.id, sessionId),
        eq(conversationSessions.ownerAddress, ownerAddress),
      ),
    )
    .returning({ id: conversationSessions.id });
  return rows.length > 0;
}

export async function beginConversationTurn(
  db: DbClient,
  args: {
    ownerAddress: string;
    sessionId: string;
    turnId: string;
    content: string;
  },
): Promise<ConversationTurnClaim> {
  if (!isUuid(args.sessionId) || !isUuid(args.turnId)) return { kind: "not_found" };
  const content = args.content.trim();
  if (!content || content.length > 2_000) throw new Error("Invalid message content.");
  const now = new Date();
  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + TURN_LEASE_MS).toISOString();
  const attemptId = randomUUID();

  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(conversationSessions)
      .where(
        and(
          eq(conversationSessions.id, args.sessionId),
          eq(conversationSessions.ownerAddress, args.ownerAddress),
        ),
      )
      .for("update")
      .limit(1);
    if (!session) return { kind: "not_found" };

    const [existing] = await tx
      .select()
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.sessionId, args.sessionId),
          eq(conversationMessages.ownerAddress, args.ownerAddress),
          eq(conversationMessages.turnId, args.turnId),
          eq(conversationMessages.role, "user"),
        ),
      )
      .limit(1);
    if (existing) {
      if (existing.content !== content) return { kind: "conflict" };
      const assistant = await assistantForTurn(
        tx,
        args.ownerAddress,
        args.sessionId,
        args.turnId,
      );
      if (assistant) {
        return {
          kind: "replay",
          userMessage: messageView(existing),
          assistantMessage: messageView(assistant),
        };
      }
      if (existing.turnStatus === "superseded") return { kind: "stale" };
      if (existing.turnStatus === "pending" && existing.leaseExpiresAt) {
        if (Date.parse(existing.leaseExpiresAt) > now.getTime()) return { kind: "in_progress" };
        const [claimed] = await tx
          .update(conversationMessages)
          .set({
            attemptId,
            leaseExpiresAt,
            attemptCount: (existing.attemptCount ?? 0) + 1,
            failureCode: null,
          })
          .where(eq(conversationMessages.id, existing.id))
          .returning();
        await updateMessageActivity(tx, session.id, nowIso, nowIso);
        return {
          kind: "claimed",
          userMessage: messageView(claimed),
          context: await contextBefore(tx, args.ownerAddress, args.sessionId, claimed.messageSequence),
          attemptId,
        };
      }
      if (existing.turnStatus === "failed") {
        const latest = await latestUserMessage(tx, args.ownerAddress, args.sessionId);
        if (latest?.id !== existing.id) return { kind: "stale" };
        const [claimed] = await tx
          .update(conversationMessages)
          .set({
            turnStatus: "pending",
            attemptId,
            leaseExpiresAt,
            attemptCount: (existing.attemptCount ?? 0) + 1,
            failureCode: null,
          })
          .where(eq(conversationMessages.id, existing.id))
          .returning();
        await updateMessageActivity(tx, session.id, nowIso, nowIso);
        return {
          kind: "claimed",
          userMessage: messageView(claimed),
          context: await contextBefore(tx, args.ownerAddress, args.sessionId, claimed.messageSequence),
          attemptId,
        };
      }
      return { kind: "stale" };
    }

    const [pending] = await tx
      .select()
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.sessionId, args.sessionId),
          eq(conversationMessages.ownerAddress, args.ownerAddress),
          eq(conversationMessages.role, "user"),
          eq(conversationMessages.turnStatus, "pending"),
        ),
      )
      .limit(1);
    if (pending) {
      if (pending.leaseExpiresAt && Date.parse(pending.leaseExpiresAt) > now.getTime()) {
        return { kind: "in_progress" };
      }
      await tx
        .update(conversationMessages)
        .set({
          turnStatus: "superseded",
          attemptId: null,
          leaseExpiresAt: null,
        })
        .where(eq(conversationMessages.id, pending.id));
    }

    const latest = await latestUserMessage(tx, args.ownerAddress, args.sessionId);
    if (latest?.turnStatus === "failed") {
      await tx
        .update(conversationMessages)
        .set({ turnStatus: "superseded", failureCode: null })
        .where(eq(conversationMessages.id, latest.id));
    }

    const sequence = session.nextSequence;
    const [userMessage] = await tx
      .insert(conversationMessages)
      .values({
        id: randomUUID(),
        sessionId: args.sessionId,
        ownerAddress: args.ownerAddress,
        messageSequence: sequence,
        turnId: args.turnId,
        role: "user",
        content,
        turnStatus: "pending",
        attemptId,
        leaseExpiresAt,
        attemptCount: 1,
      })
      .returning();

    const newTitle =
      session.titleSource === "automatic" && session.lastMessageAt === null
        ? conversationTitle(content)
        : session.title;
    await tx
      .update(conversationSessions)
      .set({
        title: newTitle,
        nextSequence: sequence + 1,
        lastMessageAt: nowIso,
        updatedAt: nowIso,
      })
      .where(eq(conversationSessions.id, session.id));

    return {
      kind: "claimed",
      userMessage: messageView(userMessage),
      context: await contextBefore(tx, args.ownerAddress, args.sessionId, sequence),
      attemptId,
    };
  });
}

export async function completeConversationTurn(
  db: DbClient,
  args: {
    ownerAddress: string;
    sessionId: string;
    turnId: string;
    attemptId: string;
    assistantText: string;
  },
): Promise<ConversationTurnCompletion> {
  const content = args.assistantText.trim().slice(0, 2_000);
  if (!content) throw new Error("Assistant response is empty.");
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(conversationSessions)
      .where(
        and(
          eq(conversationSessions.id, args.sessionId),
          eq(conversationSessions.ownerAddress, args.ownerAddress),
        ),
      )
      .for("update")
      .limit(1);
    if (!session) return { kind: "not_found" };

    const [user] = await tx
      .select()
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.sessionId, args.sessionId),
          eq(conversationMessages.ownerAddress, args.ownerAddress),
          eq(conversationMessages.turnId, args.turnId),
          eq(conversationMessages.role, "user"),
        ),
      )
      .limit(1);
    if (!user) return { kind: "not_found" };
    const assistant = await assistantForTurn(
      tx,
      args.ownerAddress,
      args.sessionId,
      args.turnId,
    );
    if (assistant && user.turnStatus === "complete") {
      return {
        kind: "replay",
        userMessage: messageView(user),
        assistantMessage: messageView(assistant),
      };
    }
    if (user.turnStatus !== "pending" || user.attemptId !== args.attemptId) {
      return { kind: "stale" };
    }

    const now = new Date().toISOString();
    const [assistantMessage] = await tx
      .insert(conversationMessages)
      .values({
        id: randomUUID(),
        sessionId: args.sessionId,
        ownerAddress: args.ownerAddress,
        messageSequence: session.nextSequence,
        turnId: args.turnId,
        role: "assistant",
        content,
      })
      .returning();
    const [completedUser] = await tx
      .update(conversationMessages)
      .set({
        turnStatus: "complete",
        attemptId: null,
        leaseExpiresAt: null,
        failureCode: null,
      })
      .where(eq(conversationMessages.id, user.id))
      .returning();
    await tx
      .update(conversationSessions)
      .set({
        nextSequence: session.nextSequence + 1,
        lastMessageAt: now,
        updatedAt: now,
      })
      .where(eq(conversationSessions.id, session.id));
    return {
      kind: "completed",
      userMessage: messageView(completedUser),
      assistantMessage: messageView(assistantMessage),
    };
  });
}

export async function failConversationTurn(
  db: DbClient,
  args: {
    ownerAddress: string;
    sessionId: string;
    turnId: string;
    attemptId: string;
    failureCode: ConversationFailureCode;
  },
): Promise<boolean> {
  const now = new Date().toISOString();
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({ id: conversationSessions.id })
      .from(conversationSessions)
      .where(
        and(
          eq(conversationSessions.id, args.sessionId),
          eq(conversationSessions.ownerAddress, args.ownerAddress),
        ),
      )
      .for("update")
      .limit(1);
    if (!session) return false;
    const rows = await tx
      .update(conversationMessages)
      .set({
        turnStatus: "failed",
        attemptId: null,
        leaseExpiresAt: null,
        failureCode: args.failureCode,
      })
      .where(
        and(
          eq(conversationMessages.sessionId, args.sessionId),
          eq(conversationMessages.ownerAddress, args.ownerAddress),
          eq(conversationMessages.turnId, args.turnId),
          eq(conversationMessages.role, "user"),
          eq(conversationMessages.turnStatus, "pending"),
          eq(conversationMessages.attemptId, args.attemptId),
        ),
      )
      .returning({ id: conversationMessages.id });
    if (rows.length > 0) {
      await updateMessageActivity(tx, session.id, now);
      return true;
    }
    return false;
  });
}
