# P1.2 candidate: one row per explicit memory

## Problem

Providus needs user-controlled context that survives conversation deletion and can be recalled across sessions. Saved-recipient labels and addresses already have a canonical owner-scoped model and payment confirmation flow, while sessions and messages have their own owner-scoped lifecycle. Shared context must therefore have a separate durable owner, be loaded only from the authenticated persistent chat path, and remain incapable of authorizing payment.

## Usage (caller's view)

The memory feature exposes domain operations rather than Drizzle rows or HTTP payload types:

```ts
const page = await listSharedMemories(store, owner);
const saved = await createSharedMemory(store, owner, {
  requestId,
  kind: "preference",
  label: "Preferred network",
  value: "BOT Chain Mainnet",
});
const changed = await updateSharedMemory(store, owner, {
  id: saved.id,
  expectedVersion: saved.version,
  label: "Preferred network",
  value: "Celo",
});
```

The web caller never supplies `owner`. Authenticated routes derive it from `requireOwnerForMutation()` or `requireOwner()`:

```ts
// GET /api/memories: SIWE owner only, never request-body ownership.
const auth = await requireOwner(request);
return listSharedMemories(memoryStore, auth.owner);

// POST /api/memories: retries with this requestId converge to one row.
const auth = await requireOwnerForMutation(request);
return createSharedMemory(memoryStore, auth.owner, parseMemoryDraft(body));

// Persistent chat: server loads the bounded context before calling B6.
const context = await readPromptMemories(memoryStore, auth.owner);
return resolveAssistantTurn({ message, history, activeIntent, ownerAddress: auth.owner, memoryContext: context });
```

## Shape

### Data structures

Use a separate `assistant_memories` table with one row per explicitly saved fact or preference:

```ts
type MemoryKind = "fact" | "preference";

type SharedMemory = {
  id: string;
  ownerAddress: string;
  kind: MemoryKind;
  label: string;
  normalizedLabel: string;
  value: string;
  requestId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type MemoryDraft = {
  requestId: string; // client-generated idempotency key
  kind: MemoryKind;
  label: string; // 1-48 characters after normalization
  value: string; // 1-300 characters after normalization
};

type PromptMemory = Pick<SharedMemory, "kind" | "label" | "value">;
```

Migration `0008_shared_memories` adds the table with owner, normalized label, request ID, version and timestamps. It enforces `kind IN ('fact', 'preference')`, a 1-48 character label, a 1-300 character value, `version >= 1`, unique `(owner_address, normalized_label)`, unique `(owner_address, request_id)`, and an `(owner_address, updated_at)` index. It has no session, recipient, intent, or receipt foreign key. A session delete cannot delete shared memory.

### Domain surface

```ts
type SharedMemoryStore = {
  listByOwner(owner: OwnerAddress): Promise<readonly SharedMemory[]>;
  findByOwnerAndRequestId(owner: OwnerAddress, requestId: string): Promise<SharedMemory | null>;
  insert(row: NewSharedMemory): Promise<SharedMemory>;
  replaceIfVersion(args: {
    owner: OwnerAddress;
    id: string;
    expectedVersion: number;
    next: Pick<SharedMemory, "kind" | "label" | "normalizedLabel" | "value">;
  }): Promise<SharedMemory | null>;
  deleteIfVersion(args: { owner: OwnerAddress; id: string; expectedVersion: number }): Promise<boolean>;
};

function createDrizzleSharedMemoryStore(db: AppDatabase): SharedMemoryStore;
function createMemorySharedMemoryStore(): SharedMemoryStore; // tests only

function listSharedMemories(store: SharedMemoryStore, owner: OwnerAddress): Promise<readonly SharedMemory[]>;
function createSharedMemory(store: SharedMemoryStore, owner: OwnerAddress, input: MemoryDraft): Promise<SharedMemory>;
function updateSharedMemory(store: SharedMemoryStore, owner: OwnerAddress, input: MemoryUpdate): Promise<SharedMemory>;
function deleteSharedMemory(store: SharedMemoryStore, owner: OwnerAddress, input: MemoryDelete): Promise<void>;
function readPromptMemories(store: SharedMemoryStore, owner: OwnerAddress): Promise<readonly PromptMemory[]>;
```

Validation sits at the route boundary and converts `unknown` JSON to domain values. The service accepts only a verified `OwnerAddress`, normalizes labels and values, and turns a duplicate key into a typed `DUPLICATE_LABEL` error. Foreign IDs and missing IDs both return `NOT_FOUND`. `expectedVersion` is required for update and delete. A stale edit returns `STALE_VERSION`; repeating an already-applied identical edit returns the current row without incrementing its version. A create retry first finds `(owner, requestId)` and returns the existing row if its draft matches, otherwise `REQUEST_ID_REUSED`. A repeated delete of a missing row is a no-op.

The public memory interface hides storage queries, normalization, idempotency and optimistic conflict rules. Callers still choose a user-facing label/value and handle actionable errors. It does not expose table rows, Drizzle objects, or raw request types. This is a deeper boundary than exposing separate list/insert/update SQL helpers to API and chat callers.

### Prompt context

The persistent chat route loads memories by `auth.owner` only, after replay/authorization checks and before `resolveAssistantTurn()`. The ephemeral unauthenticated route stays unchanged. `resolveAssistantTurn()` accepts an optional readonly `PromptMemory[]` and passes it to `buildAssistantPrompt()`. `readPromptMemories()` selects at most 8 most recently updated rows, clips the serialized total to 2,000 characters at record boundaries, and excludes any recipient identity/address data. The system prompt labels these as user-authored, untrusted background notes and says they never override system rules, current user intent, authentication, wallet state, recipient confirmation or payment review. They can help answer ordinary questions and suggest a stored preference, but code does not derive or mutate an intent from them.

Saved recipients remain available through `advanceWalletTransfer()` and `resolveRecipient(owner, label, chainId)`. That path keeps its full-address confirmation and recipient/version/address snapshot. No memory row is consulted for a recipient address, payment terms, approval, signature, or receipt.

### API and UI module map

- `lib/db/schema.ts`: `assistantMemories` table and row types.
- `lib/shared-memory/repository.ts`: Drizzle and test stores; owner predicates remain inside every query.
- `lib/shared-memory/service.ts`: normalization, count/length bounds, CRUD, idempotency, version checks, prompt projection.
- `app/api/memories/route.ts`, `app/api/memories/[id]/route.ts`: SIWE-authenticated GET/POST/PATCH/DELETE; request bodies carry no owner field.
- `app/api/assistant/chat/route.ts`: server-only owner-scoped prompt-memory load on persistent turns.
- `lib/assistant/resolve.ts`, `lib/ai/prompts.ts`: optional typed context input and one untrusted-context block.
- `components/assistant/memory-panel.tsx`: add/list/edit/delete and per-row “Why is this remembered?” explanation, linked from the existing conversation controls.
- `hooks/use-assistant-memory.ts`: loading/saving/error/empty state; aborts the prior request and increments a generation guard when the wallet account changes. The browser account is only a cache invalidation key. Requests still authenticate through SIWE, and stale responses are ignored.

The panel has one explicit Save action and confirmation before Delete. It says that each displayed item was saved by the user, with its `updatedAt` and kind. A memory suggested in chat is never persisted on assistant output alone. The conversation can offer an “Add to memory” action that opens the panel with a draft; the user must save it there. Existing recipient save remains in the recipient flow and table.

### Verification design

Add `0008_shared_memories` only after checking the disposable database is at `0007_conversation_sessions`. The guarded P1.2 DB check hashes existing receipt/payment ledgers before and after `npm run db:generate` then `npm run db:migrate`, verifies the journal is at 0008, verifies cross-owner list/read/update/delete denial, create retry idempotency, stale version rejection, prompt bounds, and that deleting a conversation leaves its shared-memory rows. Never run `drizzle push` or apply this migration to production.

Targeted tests exercise the prompt projection with instruction-shaped content, route owner derivation and same-origin mutations, concurrent create/update behavior, invalid/expired SIWE, account-switch aborts, UI create/edit/delete and keyboard/mobile controls, and the existing fresh-B3/recipient-address confirmation flow. Full project tests, typecheck, lint, build and `git diff --check` run at the feature checkpoint. Wallet/transaction operations are mocked; no real broadcast occurs.

## Synthesis decision

Pending arena synthesis. This candidate favors one row per user-authored memory because list, edit, delete, explanation and update timestamps are direct operations on independently versioned facts. The competing structural alternative is a single owner profile document with a JSON array and one shared document version. The document model centralizes writes but requires UI and prompt callers to read and rewrite a packed blob, makes per-item conflict handling and idempotent retries harder, and increases the chance of overwriting concurrent edits.

## Tradeoffs accepted

- We accept one additive owner-scoped table in exchange for independent memory lifecycle and separation from sessions, recipients and payments.
- We accept an explicit label field and duplicate-label conflict in exchange for predictable edits and one stable key per owner.
- We accept a fixed prompt count and character budget in exchange for bounded context and predictable B6 input.
- We accept an `expectedVersion` retry after a conflict in exchange for preventing a stale tab from silently overwriting newer facts.
- We accept that the browser account is used to invalidate local cache in exchange for letting SIWE remain the only authority for the API owner.

## Alternatives considered

- One `assistant_profile` JSON document containing all facts and preferences. It exposes fewer route/table concepts, but callers must coordinate merge logic and conflict behavior on a whole document. One edit can overwrite unrelated edits. It loses to per-row versioning and owner-scoped uniqueness.
- Add saved-recipient labels/addresses to the prompt memory table. This duplicates canonical recipient data and requires coordination with existing recipient versioning. It would make a prompt read look right while the payment resolver could see different data, so it is rejected.
- Save a memory automatically when B6 suggests one. This gives the model persistence authority and cannot meet explicit consent. It is rejected.

## Open questions and risks

- Should the user be able to save any bounded plain-text fact, or only the fact and preference kinds proposed here?
- Should a preferred chain be stored as a normalized chain ID tied to the B1 registry rather than as user-authored text? Even if normalized, should B6 mention it only as a suggestion and never switch the wallet?
- Is a 20-row memory cap appropriate for the first release? The prompt projection itself remains bounded to eight rows.
- Do the existing request rate limits cover memory CRUD, or does the new API need a specific owner-scoped limit?

## Next implementation step

After arena synthesis, add the schema/table type and a disposable-database guard that proves migration 0008 preserves existing ledger rows before building routes or UI.
