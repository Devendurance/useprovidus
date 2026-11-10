# P1.1 Architecture Candidate B

## Problem

The assistant transcript is currently client-held, while wallet identity comes from a verified SIWE cookie and payment state lives in separate B3/B5 ledgers. A persistent send must survive retries and crashes without letting one wallet read another wallet's messages or treating a prior assistant action as payment approval. This candidate uses an explicit durable turn record to own idempotency and per-session concurrency.

## Usage

The dashboard consumes a single conversation controller. Its transport details stay private.

```ts
const conversations = useConversationWorkspace({ owner: auth.ownerAddress });
await conversations.startNew();
await conversations.select(sessionId);
await conversations.send(text, clientTurnId);
await conversations.rename(sessionId, title);
await conversations.delete(sessionId);
```

The sidebar loads pages with `GET /api/conversations?cursor=...`. Refresh restores the active session from `?conversation=<server-session-id>`. The API returns 404 for missing and foreign session IDs.

Two important call sites use the same controller:

```ts
// AssistantComposer creates one stable turn key and reuses it for a retry.
await conversations.send(message, pendingTurnId);

// Selecting a previous session clears current payment UI before loading text.
await conversations.select(session.id);
```

## Shape

### Data model

This candidate uses three separate tables. `conversation_sessions` is the owner-controlled conversation, `conversation_turns` is the idempotency and concurrency boundary for one request, and `conversation_messages` stores only readable user and assistant text.

```ts
type SessionId = string & { readonly __brand: "SessionId" };
type TurnId = string & { readonly __brand: "TurnId" };
type OwnerAddress = string & { readonly __brand: "OwnerAddress" };
type MessageRole = "user" | "assistant";
type TurnStatus = "running" | "complete" | "failed";

type ConversationSession = {
  id: SessionId;                 // server-generated UUID
  ownerAddress: OwnerAddress;    // immutable SIWE owner
  title: string;
  nextSequence: number;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
};

type ConversationTurn = {
  id: TurnId;                    // server-generated UUID
  sessionId: SessionId;
  ownerAddress: OwnerAddress;
  clientTurnId: string;          // client UUID, unique within this session
  status: TurnStatus;
  leaseExpiresAt: string;
  attemptCount: number;
  failureCode: "assistant_unavailable" | "invalid_output" | null;
};

type ConversationMessage = {
  id: string;                    // server-generated UUID
  sessionId: SessionId;
  turnId: TurnId;
  sequence: number;
  role: MessageRole;
  content: string;               // validated plain text, max 2,000 chars
  createdAt: string;
};
```

Suggested constraints for additive migration `0007`:

- Sessions: primary key `id`, unique `(id, owner_address)` for composite references, owner/title/timestamps, `next_sequence >= 1`, and index `(owner_address, updated_at DESC, id DESC)` for recent history.
- Turns: composite FK `(session_id, owner_address)` to sessions with cascade delete; unique `(session_id, owner_address, client_turn_id)`; unique `(id, session_id, owner_address)` for message ownership; status check; lease and attempt fields; partial unique index on `session_id` while status is `running`.
- Messages: composite FK to sessions and composite FK `(turn_id, session_id, owner_address)` to turns; unique `(session_id, sequence)`; unique `(turn_id, role)`; role check limited to `user` and `assistant`; index `(owner_address, session_id, sequence)`.
- Store no `PaymentIntent`, `WalletTransferAction`, allowance, hash submission state, wallet signature, or auth token. The existing verified payment card keeps its P0.1 receipt link and the shared Receipts route remains available. Messages do not become another payment ledger.

### API and module map

`lib/conversations/service.ts` owns owner-scoped session operations, cursor construction, title derivation, turn idempotency, sequence allocation, status transitions, and safe transcript mapping. It accepts the owner as an internal argument only after route authentication.

```ts
listSessions(db, owner, { cursor, search, limit }): Promise<SessionPage>;
createSession(db, owner): Promise<SessionSummary>;
loadSession(db, owner, sessionId, { beforeSequence, limit }): Promise<SessionPageDetail>;
renameSession(db, owner, sessionId, title): Promise<SessionSummary | null>;
deleteSession(db, owner, sessionId): Promise<boolean>;
beginTurn(db, owner, sessionId, clientTurnId, userText): Promise<TurnClaim>;
finishTurn(db, owner, turnId, assistantText): Promise<ConversationMessage>;
failTurn(db, owner, turnId, safeCode): Promise<void>;
```

Thin routes call `requireOwner` for reads and `requireOwnerForMutation` for writes. Neither session IDs nor an `x-providus-wallet` header prove ownership. The route conceals foreign IDs as 404. `GET /api/conversations` paginates by `(updatedAt, id)`. `GET /api/conversations/[id]` returns messages in sequence order, with a cursor for older messages.

The existing `/api/assistant/chat` gains an authenticated session mode containing `sessionId` and `clientTurnId`. In that mode the server ignores client `history`, loads the owner's stored text transcript, then calls the existing `resolveAssistantTurn`. The existing unauthenticated mode remains ephemeral. B3 `/api/transfers` and B5 submission/status routes remain separate and unchanged.

### Turn lifecycle and idempotency

1. Parse the request at the route boundary, require a verified owner, validate the UUID session and turn key, and enforce the existing message size bound.
2. In a short transaction, lock the owned session, claim or find the turn by `(sessionId, ownerAddress, clientTurnId)`, and insert the user message once. The unique turn key makes a network retry return the same user row. The partial active-turn index rejects a different simultaneous turn in the same session, while separate sessions remain concurrent.
3. Commit the claim before calling the model. Run `resolveAssistantTurn` with server-loaded plain-text history. This avoids holding a database transaction open during the model request.
4. On success, insert one assistant text message and mark the turn complete in one transaction. The unique `(turnId, role)` constraint makes duplicate completions return the stored assistant row.
5. On a safe upstream failure, mark the turn failed and keep the user text. A retry with the same key reuses those rows. An expired running lease is reclaimed only by an authenticated retry. Do not leak raw provider errors into the conversation.
6. A duplicate completed request returns the stored assistant text with no stale action or intent payload. A fresh payment request is always parsed and reviewed through the existing B3 flow.

Sequence numbers are allocated from the locked session row. The active-turn uniqueness keeps messages in request order without serializing different sessions. A hard delete is available only after explicit UI confirmation. The cascade removes that session's turns and messages, while payment, receipt, and saved-recipient tables remain untouched.

### UI

`AssistantPanel` remains the conversation surface. A controller owns active session, transcript, load/send state, cursor, and owner revision. The desktop sidebar can collapse, lists recent titled sessions, marks the active row, and offers New chat, rename, delete, and Load more. The mobile drawer is an overlay dialog with a 44px close target, Escape/outside/selection dismissal, focus trap/restoration, and body scroll lock. The composer remains the reading focus.

On wallet/account change the controller clears sessions/messages/payment drafts immediately, aborts pending reads and sends, increments its owner revision, and only accepts responses for the current owner. Restoring a session loads text only. Old payment cards, active intents, approvals, signatures, and payment instructions are never reconstructed from rows. The existing signed-out assistant remains ephemeral and shows a clear sign-in-to-save-history state.

### Migration and verification

Generate `0007` from the Drizzle schema. Run the complete migration chain in a disposable local PostgreSQL database, seed sentinel rows in `agent_transactions`, `saved_recipients`, `wallet_transfer_intents`, and `transfer_submissions` for two owners, apply `0007`, and assert every existing row and owner value is unchanged. Then test session creation, page order, message uniqueness, expired-turn retry, foreign-owner 404, delete cascade, and independent concurrent sessions. No production database query or migration is part of this candidate.

Before any future production apply, require a reviewed full backup, a checksum/restore validation in an isolated database, a recorded table-count and owner-scoping preflight, a maintenance/release window, and a tested application rollback. Because users can create sessions after release, rollback should normally roll back the app while leaving the additive tables intact. Do not drop live conversation data or restore an old snapshot without explicit approval and a user-data loss review. The existing JSON snapshots are not a verified production backup.

### Interface depth

The public controller hides three-table turns, leases, sequence allocation, and retry states behind session-oriented methods. Callers pass only a session ID, text, and one stable client turn key. The cost is one extra durable table and more schema checks, accepted to make duplicate, failed, expired, and concurrent sends explicit instead of implicit.

## Synthesis decision

Pending cross-judge and base selection.

## Tradeoffs accepted

- We accept one extra table and migration complexity in exchange for explicit request leases and retry state.
- We accept serial sends inside one conversation in exchange for deterministic transcript order. Different sessions can still run concurrently.
- We accept storing a user turn before the assistant reply in exchange for surviving refresh and recoverable network failures.
- We accept returning text-only output for a completed retry in exchange for never replaying a previous payment action.
- We accept hard deletion after confirmation in exchange for making “delete” remove the session and its messages, while leaving financial records intact.

## Alternatives considered

- Two tables with a client idempotency key directly on messages: smaller and easier to query, but retry status and same-session concurrency have to be inferred from missing assistant rows.
- One JSON message array on each session: exposes little API surface, but mixes session and message concepts, makes pagination and row-level idempotency awkward, and rewrites a growing transcript for every send.

## Open questions and risks

- Should a failed turn remain retryable indefinitely, or should the UI offer “Retry reply” only for a bounded period?
- What retention and recovery promises should the app publish before users rely on persistent conversations?
- Is 2,000 characters per user/assistant message sufficient for long assistant replies while keeping the existing chat route request bound?

## Next implementation step

Prototype the `conversation_turns` claim and lease transitions with a local PostgreSQL migration fixture before wiring the assistant UI.
