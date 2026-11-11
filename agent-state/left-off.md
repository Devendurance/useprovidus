# Left off: P1.2 complete locally

## What we are doing
- P1.2 shared wallet-owner memory is implemented and committed locally as `698e4b8`. Final verification and local review pass. No push, deploy, or production migration occurred.

## Done
- Added the separate `assistant_memories` table in additive migration `0008_shared_memories`. Applied it only to disposable Postgres 16 at `127.0.0.1:55432`, after migration `0007`.
- Verified all 11 existing public table snapshots stayed unchanged. Owner isolation, idempotency, duplicate-label handling, optimistic conflicts, and independence from chat deletion pass the local DB check.
- Added SIWE owner-scoped memory APIs, explicit create/list/edit/delete, and bounded untrusted prompt context. Recipient data remains in `saved_recipients` and payment records remain in their own ledgers.
- Added the responsive memory panel with save explanation, conflict recovery, focus trap/restoration, dismissal controls, and wallet-switch cleanup.
- Final checks pass: `npm run test:all`, `npm run test:conversation-db`, `npm run test:shared-memory-db`, migration isolation, six P1.1/P1.2 browser tests, `npx tsc --noEmit`, lint, build with `DATABASE_URL` empty, and diff check.
- Screenshots: `output/playwright/p1.2-memory-mobile.png` and `output/playwright/p1.2-memory-desktop.png`.
- No production DB access or writes, real wallet transaction, push, or deploy occurred.
- The local `node_modules/@playwright/test` junction still points to the P1.1 worktree, and `test-results/.last-run.json` remains. The environment blocked their removal, so keep both out of the commit.
- Review found that a valid BIP39 recovery phrase written as bare words could pass the keyword and hex checks. The service-level detector now closes that gap.
- Added a lazy-loaded server-side BIP39 checksum detector for create/edit using all ten standard wordlists. The focused test failed before the fix and passed after it. It generates all five valid phrase lengths at runtime and verifies create/edit reject before repository access, plus prose, Unicode spaces, and label/value splitting.
- Final local code review caught a chain-ID grounding ambiguity: an active draft missing its amount could accept the chain ID as that amount, and an amount matching a chain ID could select that network. Added regressions first, then require explicit chain/network context for numeric chain IDs and always exclude those IDs from amount evidence.

## Next
- Stop after P1.2. Start a future slice only when authorized. Keep P2 out of this checkpoint.
- Before any production release, review a Neon backup or branch, verify restore in isolation, and approve a rollback plan. Apply `0008` only with separate authorization. Roll back app code first and retain the additive memory table.
- Preserve the existing unrelated untracked `.omp/`, `.playwright-cli/`, `bridge/`, `video-demo/`, and P0.2 screenshots.
- P2 remains out of scope.
