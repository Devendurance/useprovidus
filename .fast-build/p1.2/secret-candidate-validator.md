# Candidate A: checksum-validated BIP39 blocking

## Problem

Shared-memory create and edit already validate user text, but keyword and long-hex checks do not recognize a valid BIP39 phrase written as ordinary words. Detection must guard every write before repository access, preserve short facts and preferences, and avoid loading wordlists on assistant reads. Ownership remains the verified SIWE session. Memory stays separate from chat, saved recipients, and payment ledgers. No key derivation, schema change, migration, or payment behavior belongs here.

## Usage (caller's view)

The service remains the only mutation boundary. Existing API handlers continue parsing the request and deriving the owner from SIWE:

```ts
const draft = parseSharedMemoryDraft(requestBody);
const saved = await createSharedMemory(ownerFromSiwe, draft);

const update = parseSharedMemoryUpdate(requestBody);
const saved = await updateSharedMemory(ownerFromSiwe, memoryId, update);
```

Both operations reject with the existing validation-error response before touching persistence when any stored text contains a valid recovery phrase. Reads used to build assistant context do not load or run the detector.

## Shape

Keep one private detector module, dynamically loaded by the existing write service:

```ts
// lib/shared-memory/recovery-phrase.ts
export type MemoryTextFields = readonly string[];

/** Rejects valid standard BIP39 phrases; never returns or logs matched text. */
export function containsBip39RecoveryPhrase(
  fields: MemoryTextFields,
): boolean; // not implemented
```

```ts
// lib/shared-memory/service.ts
async function assertSafeMemoryText(fields: readonly string[]): Promise<void> {
  const { containsBip39RecoveryPhrase } = await import("./recovery-phrase");
  if (containsBip39RecoveryPhrase(fields)) {
    throw new SharedMemoryValidationError("Recovery phrases cannot be saved.");
  }
}

export async function createSharedMemory(owner: OwnerId, draft: SharedMemoryDraft) {
  await assertSafeMemoryText([draft.label, draft.value]);
  // existing persistence path follows
}

export async function updateSharedMemory(owner: OwnerId, id: MemoryId, update: SharedMemoryUpdate) {
  if (update.label !== undefined || update.value !== undefined) {
    await assertSafeMemoryText([update.label ?? "", update.value ?? ""]);
  }
  // existing persistence path follows
}
```

`recovery-phrase.ts` holds the ten standard BIP39 wordlists: Czech, English, French, Italian, Japanese, Korean, Portuguese, simplified Chinese, Spanish, and traditional Chinese. Normalize each bounded field with Unicode NFKD, lowercase it, collapse Unicode whitespace, and strip punctuation at token edges. This handles compatibility forms and Japanese separators while retaining the original stored text. Scan contiguous windows of 12, 15, 18, 21, and 24 tokens. First check that every token belongs to a candidate wordlist, then run that list's `validateMnemonic` checksum validation. Return only a boolean. Do not call mnemonic-to-seed, account, private-key, or signing APIs.

The current maximum memory text length bounds the work. Build per-wordlist membership Sets once inside the lazily imported module. At most the bounded number of windows and ten lists are examined, and checksum validation runs only after a window passes the cheap membership prefilter. Promote the already-present `@scure/bip39` package to a direct pinned dependency if implementation confirms its current transitive version is the intended library; use its official wordlists and `validateMnemonic` only.

The service guard runs before duplicate-label reads, owner-row lookups, transactions, or writes on create and edit. Existing routes map the typed validation error to the normal client validation response without including submitted text. No route accepts an owner from the body, and no memory operation changes SIWE, intent, approval, or B5 verification rules. The small public surface hides normalization, wordlist coverage, scanning, and checksum policy inside one domain module, per boundary-discipline and minimize-reader-load.

## Synthesis decision

Candidate only. The parent orchestrator selects and synthesizes the base after comparing the independent candidate sketches.

## Tradeoffs accepted

- We accept a small one-time wordlist load on first create or edit in exchange for avoiding that cost on memory reads and assistant prompt construction.
- We accept rejecting a text field that exactly forms a valid standard BIP39 sequence. A checksum-valid collision in ordinary prose is possible, so keep the detector restricted to complete contiguous valid windows and test realistic benign prose.
- We accept depending on the maintained BIP39 wordlist package in exchange for correct checksum and Unicode handling across all standard languages.

## Alternatives considered

- Reject any 12-or-more consecutive words from a BIP39 list. This has a shallower implementation but would reject far more ordinary preferences and provides no checksum-level precision.
- Reject only explicit phrases such as “seed phrase” or “recovery phrase.” This preserves prose but misses bare secrets, the specific gap under repair.

## Implementation reconciliation

None. This file is a candidate design and changes no application code.

## Open questions and risks

- Does the installed `@scure/bip39` version expose all ten lists through stable package exports, and should it be promoted to a direct dependency at its existing lockfile version?
- Should punctuation between mnemonic words be treated as a separator? The proposed edge-punctuation handling catches surrounding prose while preserving the standard whitespace-separated phrase form.

## Next implementation step

Implement the detector behind the shared-memory service mutation boundary, then add a generated-entropy regression for create and edit before changing any stored data.

## Regression shape

Generate phrases at test runtime using `entropyToMnemonic(testEntropy, wordlist)` for each standard list; do not embed or print phrase text in source, snapshots, errors, or logs. Assert the detector rejects each generated phrase and that both create and edit reject before any repository method is called. Add cases for a phrase surrounded by prose and Unicode separators, plus safe short preferences and representative benign prose. Keep the test entropy synthetic and fixed. The test verifies text detection only, never derives a wallet or submits a transaction.
