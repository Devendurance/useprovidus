# P1.2 Architecture Decision

## Selected shape

Persist one user-approved fact or preference per row in an `assistant_memories` table. Each row has an owner, kind, label, normalized label, value, stable request ID, optimistic version, and timestamps. Unique owner/label and owner/request keys make duplicate facts and retried creates explicit. Updates and deletes require the version the user last read.

Expose domain operations for list, create, update, delete, and bounded prompt projection. Routes derive owner from SIWE. The persistent chat route loads a small projection using that owner and passes it to B6 as user-saved, untrusted background context. Memory values do not contain or replace saved recipients, payment intents, approvals, signatures, or receipts. Recipient lookup continues through the existing owner-and-chain-scoped service and full-address confirmation.

The memory manager lives alongside the existing conversation controls. Users create a memory through a labeled form, inspect the saved value and why it is available to future chats, edit it with conflict recovery, or delete it with a consequence confirmation. Assistant output never writes memory. Account changes synchronously hide the previous owner's state, abort old requests, and ignore stale responses.

## Candidate comparison

The row-per-memory candidate scored higher on retries/concurrent edits and schema enforcement. The owner-document candidate scored well on bounded prompt projection, but one document version makes unrelated edits conflict and moves entry constraints into JSON validation. The judge recommended the row model.

Graft from the document candidate: when an edit conflicts, preserve the user's draft and provide a reload path. Keep memory useful as conversational context while the system prompt states that it is untrusted and cannot override current intent, payment review, or wallet authorization. Never persist assistant suggestions without an explicit user save.

## Verification gates

- Apply migration 0008 only to the disposable database already at 0007, after confirming its local host and database name.
- Compare pre-existing payment/receipt table snapshots before and after migration.
- Exercise owner isolation, idempotent create retry, stale update conflict, delete isolation, and conversation deletion independence.
- Exercise bounded prompt content and prompt-injection-shaped memory text while retaining existing B3/B5 behavior.
- Verify memory controls at desktop and mobile sizes, including keyboard and wallet account changes.
- Do not apply production migrations or run wallet transactions.

## Recovery phrase privacy decision

Use `@scure/bip39` checksum validation from the shared-memory service's create and update boundary. The detector is loaded only for writes, scans bounded normalized text across all ten standard wordlists, and returns only a boolean. It never derives a seed, key, account, or signature. The guard runs before every repository read or write so rejected text cannot persist or trigger a preflight lookup. Regression values are generated from synthetic entropy at runtime for all ten wordlists and each valid word count, and exercise prose wrapping, Unicode spacing, and content split across label and value.

The alternate word-sequence detector is rejected because it would block ordinary long text without validating the BIP39 checksum. Add `@scure/bip39` as a direct dependency at the already locked `1.6.0` version because production code imports its validator and official wordlists.
