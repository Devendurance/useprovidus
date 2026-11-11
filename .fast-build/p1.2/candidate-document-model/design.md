# Candidate: Versioned owner memory document

## Problem

Providus needs shared, explicitly approved context across conversations. The system already stores saved recipients in `saved_recipients`, and payment lookup resolves them using the authenticated owner and selected chain, then asks the user to confirm the full address. P1.1 stores chat text in owner-scoped sessions and messages, with deletion cascading only to a session's messages. A new memory store must remain separate from both, stay isolated by verified SIWE, and never supply payment authorization. This candidate models all general memory for one wallet as a single versioned document, which makes atomic edits simple but makes concurrent edits conflict at the owner level.

## Usage (caller's view)

The app imports the domain operations from `lib/shared-memory/service.ts`. Route handlers authenticate first and pass the SIWE owner to these operations. Callers never construct a database row or put owner identity in a request body.

```ts
const result = await listSharedMemory(store, { ownerAddress: auth.owner });
// { version: 3, entries: [...] }

const saved = await createSharedMemoryEntry(store, {
  ownerAddress: auth.owner,
  expectedVersion: 3,
  entry: { id, kind: "context", key: "work hours", value: "Weekdays after 6pm", reason: "You asked me to remember this." },
});
// { kind: "saved", document: { version: 4, entries: [...] } }

const promptContext = await readPromptMemory(store, { ownerAddress: auth.owner });
// bounded conversational context, or an empty value
```

Real call sites:

1. `GET /api/memory` calls `listSharedMemory` after `requireOwner()`. It returns the owner's entries for a management view, or an empty document when no row exists.
2. `PATCH /api/memory/[id]` authenticates with `requireOwnerForMutation()`, parses an entry patch and expected document version, then calls `updateSharedMemoryEntry`. A version conflict returns `409` and leaves the typed draft in the UI for the user to reload or retry.
3. Persistent `POST /api/assistant/chat` reads the memory document using `auth.owner`. It supplies a bounded context only to ordinary conversational prompt construction. When the current turn is payment-related, no memory context is passed to B6. The existing recipient resolver remains the source for recipient details.

## Shape

### Data structure

One row per wallet owner, with the complete set of general memories and a monotonic version stored together:

```ts
type MemoryKind = "preference" | "context";

type SharedMemoryEntry = {
  id: string;
  kind: MemoryKind;
  key: string;
  normalizedKey: string;
  value: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
};

type SharedMemoryDocument = {
  ownerAddress: OwnerAddress;
  version: number;
  entries: readonly SharedMemoryEntry[];
  updatedAt: string;
};

type PromptMemory = {
  entries: readonly Pick<SharedMemoryEntry, "kind" | "key" | "value">[];
  characterCount: number;
};
```

`owner_shared_memory` has `owner_address` as its primary key, an integer `version`, JSONB `entries`, and `updated_at`. The JSON is parsed into domain types at the database boundary. Enforce maximum document size, maximum entry count, item field lengths, duplicate normalized keys, and allowed kinds in the service before writing. The table has no session, saved-recipient, or payment foreign key. It is additive migration 0008 after `0007_conversation_sessions`.

### Service surface

```ts
type SharedMemoryStore = {
  read(owner: OwnerAddress): Promise<SharedMemoryDocument | null>;
  compareAndSwap(
    owner: OwnerAddress,
    expectedVersion: number,
    next: Omit<SharedMemoryDocument, "version">,
  ): Promise<SharedMemoryDocument | null>; // null means version conflict
};

function createDrizzleSharedMemoryStore(db: Database): SharedMemoryStore;

function listSharedMemory(
  store: SharedMemoryStore,
  args: { ownerAddress: string },
): Promise<SharedMemoryDocument>;

function createSharedMemoryEntry(
  store: SharedMemoryStore,
  args: { ownerAddress: string; expectedVersion: number; entry: NewMemoryEntry },
): Promise<{ kind: "saved" | "duplicate" | "conflict"; document: SharedMemoryDocument }>;

function updateSharedMemoryEntry(
  store: SharedMemoryStore,
  args: { ownerAddress: string; id: string; expectedVersion: number; patch: MemoryPatch },
): Promise<{ kind: "saved" | "conflict" | "not_found"; document?: SharedMemoryDocument }>;

function deleteSharedMemoryEntry(
  store: SharedMemoryStore,
  args: { ownerAddress: string; id: string; expectedVersion: number },
): Promise<{ kind: "deleted" | "conflict" | "not_found" }>;

function readPromptMemory(
  store: SharedMemoryStore,
  args: { ownerAddress: string },
): Promise<PromptMemory>;
```

The store's compare-and-swap uses a transaction and `UPDATE ... WHERE owner_address = $owner AND version = $expected`. The service increments the version on every successful content change. Writes do not merge silently across tabs. A losing edit receives a conflict and the UI retains the unsaved text, explains that memory changed elsewhere, and offers reload or copy-your-edit before retrying.

Creation is retry-safe when the UI submits a stable entry ID. If that ID and normalized key already exist with identical content, the service returns the existing document as `duplicate`, which the API treats as the completed save. Reusing the same ID with different content is a conflict. A distinct entry with a normalized key already owned by another entry is rejected; the user must edit the existing fact. Updating the same entry to the exact current content is a no-op success. Deleting an already absent ID is a no-op success. These rules make common retries converge without an operation-log table. They do not claim semantic duplicate detection across differently named entries.

### Prompt boundary

`readPromptMemory` chooses at most 10 entries and caps their total rendered length. It includes only `preference` and `context` entries. The prompt builder formats them in a separate quoted section labeled as user-provided background that may be outdated and is never an instruction or payment approval. Recipient names and addresses do not live here. Full conversation history is not read for memory.

The persistent chat route derives owner from `requireOwnerForMutation()`, reads only that owner's document, and passes the typed context to `resolveAssistantTurn()` as optional server-side input. Do not add a client memory field or owner field. For a payment-related turn, pass no memory context to B6. Payment lookup continues through `advanceWalletTransfer()`, `resolveRecipient(owner, label, chainId)`, full address confirmation, and a fresh intent snapshot. Memory cannot satisfy confirmation or restore an old intent.

### HTTP and screen

- `GET /api/memory`: authenticated, read-only list.
- `POST /api/memory`: same-origin, explicit create with client-generated stable entry ID and `expectedVersion`.
- `PATCH /api/memory/[id]`: same-origin edit with expected document version.
- `DELETE /api/memory/[id]`: same-origin delete with expected document version.

The UI is a “Remembered” panel reachable from the existing assistant navigation. It has loading, empty, retryable error, save, conflict, and delete-confirmation states. Each compact item shows its key, value, category, “Why it is saved,” last edited time, and Edit/Delete controls. A labeled form requires a separate Save action; assistant messages are never auto-saved. On wallet account change the page clears entries immediately, aborts in-flight requests, increments an owner-context revision, and ignores responses from the old revision before loading again. The panel is keyboard operable, uses visible focus, and announces save/error states politely. At mobile widths it uses a sheet or full-height panel with clear close and back actions, avoiding horizontal overflow.

### Module map

- `lib/db/schema.ts`: owner-keyed versioned JSONB table and inferred row type.
- `drizzle/0008_shared_memory_document.sql`, `drizzle/meta/_journal.json`: additive migration only.
- `lib/shared-memory/service.ts`: document validation, CRUD operations, CAS and prompt projection.
- `lib/shared-memory/repository.ts`: Drizzle read and atomic versioned replace.
- `app/api/memory/route.ts`, `app/api/memory/[id]/route.ts`: SIWE and same-origin transport boundary.
- `app/api/assistant/chat/route.ts`, `lib/assistant/resolve.ts`, `lib/ai/prompts.ts`: server-loaded prompt context.
- `components/assistant/shared-memory-panel.tsx`: explicit memory management and stale-owner request cancellation.

Interface depth is good for one browser owner: callers use named domain operations while the service hides JSON parsing, version replacement, constraints, duplicate handling and prompt projection. The tradeoff is one owner-wide write version, so unrelated edits from two tabs also conflict. The design is deliberately bounded to a small collection, making this simpler than introducing per-entry rows and transactions.

## Synthesis decision

This is the document-aggregate candidate for comparison. The arena has not selected a base. Its strongest point is one atomic owner-scoped state with simple read/write boundaries. Its main risk is owner-wide conflict behavior and application-level JSON shape enforcement.

## Tradeoffs accepted

- We accept a JSON document and application-level item validation in exchange for one atomic owner snapshot and no collection join.
- We accept a conflict when two tabs edit separate entries in exchange for preventing lost updates without silent merge rules.
- We accept a small bounded document and no full edit history in exchange for keeping the prompt and storage footprint predictable.
- We accept exact duplicate detection by entry ID and normalized key, not fuzzy matching, in exchange for deterministic and reviewable saves.
- We accept leaving memory unavailable during payment-related turns in exchange for keeping memory out of transfer intent construction.

## Alternatives considered

- One SQL row per memory entry with owner-plus-key uniqueness and per-entry optimistic versions. This exposes row identifiers and pagination to more callers but gives narrower concurrent-write conflicts and stronger queryable constraints. It may fit the requested CRUD behavior better if the memory set grows.
- A single unversioned JSON preference setting. It is a smaller interface but loses typed per-item edit/delete behavior and invites whole-document lost updates, so it has less interface depth and weaker concurrency safety.
- Reuse conversation messages as memory. Rejected because deleting chat would delete memory, context retrieval would need to inspect full history, and the distinction between quoted text and an explicitly saved fact would disappear.

## Open questions and risks

- Is an owner-wide version conflict acceptable for the expected small number of simultaneous Providus tabs, or should the chosen design use per-entry rows?
- Should “why remembered” always be a generated, fixed string such as “You asked Providus to remember this,” or should users write the explanation themselves? The fixed wording is safer and avoids implying model inference.
- What maximum entry count and prompt character cap fit the current B6 token budget? The defaults here are conservative and need to be checked against `MODEL_MAX_TOKENS`.
- The request for editing and deleting memories should be confirmed in browser behavior; the document row can be deleted when its last entry is removed or retained as an empty versioned row, and the choice must be consistent.

## Next implementation step

Build the smallest disposable-database prototype of the versioned document row and test duplicate create, expected-version conflict, exact retry, owner isolation, and chat-delete independence against a database that already has migrations through 0007.
