# P1.1 Architecture Candidate A

## Problem

The assistant transcript currently lives in `useAssistant` memory and is sent as client-provided history to a stateless B6 route. Durable chat needs a server-owned transcript and a wallet-owner boundary, while existing SIWE, saved recipients, Celo transactions, BOT intents, and B5 submissions must keep their current jobs. Retries and wallet changes must not duplicate messages or restore an old payment action. Migration `0007` must be additive and verified against an isolated PostgreSQL database.

## Usage (caller's view)

The dashboard creates a session when the owner chooses New chat. The returned opaque session ID is placed in the dashboard URL so refresh can reopen it. An unauthenticated user keeps the existing ephemeral assistant behavior.

```ts
const session = await createConversation();
router.replace(`/dashboard?conversation=${session.id}`);
await assistant.openConversation(session.id);
```

Selecting a previous session fetches its owner-checked message page and replaces the visible transcript. It clears all current payment drafts before the load.

```ts
await assistant.openConversation(sessionId);
```

Sending a user turn uses one client-generated UUID across any network retry. Persistent mode sends only the current message, session ID, and turn ID. The server loads prior text from storage. It does not trust browser-supplied history as the conversation record.

```ts
await assistant.send(text, { sessionId, clientTurnId });
```

Rename and delete act on the selected session. Delete confirms that the conversation and its messages will be removed. Payment, recipient, and receipt records remain in their own stores.

## Shape

### Data model

Use exactly two new tables. Sessions own identity and list metadata. Messages own ordered text. `ownerAddress` is repeated on messages and constrained to the session owner by a composite foreign key, so a message cannot be attached to another wallet's session even if a caller gets the session ID wrong.

```ts
type SessionId = string & { readonly __brand: "SessionId" };
type TurnId = string & { readonly __brand: "TurnId" };
type Sequence = number & { readonly __brand: "Sequence" };

type ConversationSession = {
  id: SessionId;                 // generated server-side with randomUUID()
  ownerAddress: Address;         // immutable SIWE claim, canonical checksum
  title: string;
  titleSource: "automatic" | "manual";
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  nextSequence: Sequence;
  activeTurnId: TurnId | null;
  activeTurnClaimedAt: string | null;
};

type StoredMessage = {
  id: string;                    // generated server-side
  sessionId: SessionId;
  ownerAddress: Address;
  sequence: Sequence;
  turnId: TurnId;
  role: "user" | "assistant";
  content: string;
  createdAt: string;             // database time
};

type SessionSummary = Pick<ConversationSession,
  "id" | "title" | "createdAt" | "updatedAt" | "lastMessageAt"> & {
    preview: string | null;
  };

type SessionPage = { sessions: SessionSummary[]; nextCursor: string | null };
type MessagePage = { messages: StoredMessage[]; beforeSequence: number | null };
```

The PostgreSQL shape is:

```sql
conversation_sessions (
  id text primary key,
  owner_address text not null,
  title text not null,
  title_source text not null default 'automatic'
    check (title_source in ('automatic', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  next_sequence bigint not null default 1,
  active_turn_id text,
  active_turn_claimed_at timestamptz,
  unique (id, owner_address),
  check ((active_turn_id is null) = (active_turn_claimed_at is null))
)

conversation_messages (
  id text primary key,
  session_id text not null,
  owner_address text not null,
  sequence bigint not null,
  turn_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(trim(content)) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key (session_id, owner_address)
    references conversation_sessions(id, owner_address) on delete cascade,
  unique (session_id, owner_address, sequence),
  unique (session_id, owner_address, turn_id, role)
)
```

Add indexes for recent owner history `(owner_address, updated_at DESC, id DESC)` and message paging `(session_id, owner_address, sequence DESC)`. The unique turn/role constraint lets a retry reuse the same user row and allows one assistant row for that turn. The session sequence counter is advanced under a row lock inside the transaction that writes a message.

### Module map and public operations

- `lib/db/schema.ts` defines the two tables and inferred row types.
- `drizzle/0007_*.sql` creates only the new tables and indexes.
- `lib/conversations/service.ts` owns title derivation, cursor parsing, owner-scoped session/message operations, request idempotency, and turn claiming.
- `lib/conversations/repository.ts` owns Drizzle and memory-store implementations. It does not expose Drizzle or PostgreSQL rows to the UI.
- `app/api/conversations/route.ts` handles owner-scoped create and paginated recent list.
- `app/api/conversations/[id]/route.ts` handles owner-scoped metadata, rename, and delete.
- `app/api/conversations/[id]/messages/route.ts` reads an older-message page for the selected session.
- `app/api/assistant/chat/route.ts` keeps its existing B6 resolution. When `sessionId` is present it uses `requireOwner`, ignores `history`, loads recent stored text, persists the user turn and assistant text, and returns the current in-memory B6 action only for that response. Without a `sessionId`, the route keeps the existing ephemeral flow.
- `hooks/use-assistant.ts` remains the single owner of active session ID, transcript, and in-memory payment context. Its existing context revision aborts and ignores stale requests when the authenticated wallet changes.
- `components/assistant/assistant-panel.tsx` owns only presentation state for the sidebar/drawer, rename dialog, and delete confirmation. It reads the active session from `useAssistant` rather than keeping a second active ID.

The session service surface is intentionally small:

```ts
createSession(store, { ownerAddress }): Promise<ConversationSession>;
listSessions(store, { ownerAddress, cursor, search, limit }): Promise<SessionPage>;
readSession(store, { ownerAddress, sessionId, beforeSequence, limit }): Promise<{ session: ConversationSession; page: MessagePage }>;
renameSession(store, { ownerAddress, sessionId, title }): Promise<ConversationSession>;
deleteSession(store, { ownerAddress, sessionId }): Promise<{ deleted: true }>;
appendTurn(store, { ownerAddress, sessionId, turnId, content }): Promise<BeginTurnResult>;
completeTurn(store, { ownerAddress, sessionId, turnId, assistantText }): Promise<StoredMessage>;
```

`BeginTurnResult` is a discriminated union: `claimed` includes the stored user message and bounded prior context, `replay` includes the existing assistant message, and `in_progress` is a retryable conflict. Unknown and foreign session IDs both return 404.

### Turn flow, idempotency, and concurrency

1. The chat route validates `sessionId` and UUID `turnId` at the boundary, then derives `ownerAddress` from the SIWE cookie. No body field establishes ownership.
2. `appendTurn` locks the matching `(session id, owner)` row. If the same turn already has an assistant message, it returns that text without invoking B6 again. If the user message exists without a reply, a retry with the same turn ID may reclaim it. A new turn cannot replace an unresolved turn.
3. The service atomically claims the session's `activeTurnId`, inserts the user message once, allocates its sequence, updates `lastMessageAt`, and sets the automatic title from the first user text. Automatic title is a short deterministic first-sentence truncation. Rename switches `titleSource` to `manual`, so later messages cannot overwrite it.
4. `resolveAssistantTurn` receives the last 24 persisted role/content entries and the current in-memory `activeIntent` after existing B6 validation. It receives no old action or intent from stored messages. Full transcript pages remain available in the UI even though model context retains the current 24-message cap.
5. `completeTurn` inserts one assistant text row using the same turn ID and a new sequence, then clears the claim and updates the session timestamps. The database uniqueness constraint protects the result if two identical retries race. The request that wins returns the persisted assistant text. A retry of an already completed turn returns only saved text, never a persisted `WalletTransferAction`.
6. If the server fails after the user row is written, the user row remains visible with a retry affordance that reuses the same turn ID. A short claim lease allows a retry to reclaim a crashed turn. It does not allow a different turn to skip that pending request.
7. Different sessions have independent row locks, so one wallet can continue separate chats concurrently. A single session accepts one unresolved turn at a time to preserve turn order.

The session list uses keyset pagination ordered by `(updated_at DESC, id DESC)`. Messages are ordered by the server-owned sequence. The UI loads the newest page first and can fetch older pages by `beforeSequence`. A search query matches session titles and any displayed preview, not a claimed global message index.

Deleting a session is a hard delete after an explicit confirmation. `ON DELETE CASCADE` removes its messages. The tables have no foreign keys to `saved_recipients`, `agent_transactions`, `wallet_transfer_intents`, or `transfer_submissions`, so deleting conversation history cannot delete payment evidence.

### UI and payment safety

Desktop keeps the conversation as the main reading column and adds a collapsible left sidebar with New chat, recent titles, active state, Load more, rename, delete, and a real Receipts link. Mobile uses a native `<dialog>` drawer with a named close button, Escape/outside/selection dismissal, a 44px target, focus restoration, and body scroll lock. Both use existing Providus tokens and the P0.2 dialog patterns. No decorative motion is needed.

On session selection, New chat, logout, or wallet switch, clear `activeIntent`, pending payment UI, and any approval context before rendering the new transcript. A restored history row contains only role, text, server ID, turn ID, sequence, and timestamp. It cannot restore an approval or a review card. If a user asks to repeat an earlier transfer, B6 starts from text and a fresh B3 intent is prepared only through the existing explicit review flow. Current verified payment cards keep their existing P0.2 receipt link, and the sidebar links to the existing Receipts route. The message store does not copy transaction facts.

### Migration verification and release boundary

Generate `0007` with the Drizzle generator. In a disposable local PostgreSQL container, apply migrations `0000` through `0006`, seed representative Celo, saved-recipient, BOT intent, and B5 submission rows for two owners, record their counts and values, apply `0007`, and assert those existing rows are unchanged. Then test the composite foreign key, duplicate turn/role rejection, owner-A versus owner-B list/detail, pagination, and cascade delete on the isolated database. Never point these commands at Neon production. No production migration, backup, or deployment is implied.

Before any later production migration, the operator must capture a native database snapshot or custom-format `pg_dump`, record its checksum and restore point, restore it into a separate isolated database, apply the migration there, and verify both old ledger rows and wallet-isolation cases. Production execution requires separate approval. Since the migration only adds tables, a code rollback can disable session writes and revert the app while leaving the tables and new conversations intact. Do not drop populated session tables or restore over production as an automatic rollback. A corrective forward migration is preferred. Restore from the pre-migration backup only after the operator accepts that conversations created after the snapshot would be lost.

## Synthesis decision

Candidate A. This is one proposal in the architect arena and has not yet been selected by the cross-judge.

## Tradeoffs accepted

- We accept a duplicated immutable `ownerAddress` on messages in exchange for a composite database constraint that blocks cross-owner attachment and supports direct owner filters.
- We accept a small active-turn lease on the session row in exchange for stable per-session ordering across retries and multiple application instances without a third table.
- We accept a 24-message model context cap in exchange for retaining the existing B6 request bounds. Older text remains stored and readable in the transcript.
- We accept hard-delete confirmation in exchange for a truthful user action that removes private conversation text while leaving the separate payment ledger untouched.
- We accept that a retry after a completed model turn returns saved text without old B6 action state in exchange for never reviving a payment action from durable history.

## Alternatives considered

- Keep messages owner-normalized and scope them only by joining through the parent session. This removes duplicated owner text but moves the safety rule into every query and gives the database no composite owner/session constraint.
- Add a third `conversation_turns` table to store request status, leases, and retries. It makes in-flight state explicit but adds a table and another persistence boundary for a short request lifecycle. Candidate A keeps this state on the session row and message idempotency on the unique turn/role key.
- Store the whole transcript in a JSON column on sessions. This exposes one growing document, complicates pagination and message idempotency, and merges sessions with message history, so it fails the explicit domain boundary.

## Open questions and risks

- What retention rule should apply to sessions that an owner never deletes? The safe initial behavior is to retain until the owner deletes and to describe storage plainly, without claiming client-side encryption.
- How long may an interrupted assistant turn remain claimable? The lease must exceed normal B6 latency and allow the same client turn ID to recover after a crashed request.
- A PostgreSQL instance is now available locally, but the migration has not yet been generated or applied. No production backup or restore procedure was verified.

## Next implementation step

Build a disposable PostgreSQL fixture from migrations `0000` through `0006`, seed existing ledger rows for two owners, and verify the `0007` composite owner constraint before wiring any assistant UI.
