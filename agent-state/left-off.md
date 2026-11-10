# Left off: P1.1 complete locally

## What we are doing
- P1.1 wallet-owner-scoped persistent assistant conversations are implemented locally.
- Preserve P0.1/P0.2 and all payment semantics. Do not push, deploy, migrate production, run live payments, or start P1.2/P2.

## Done
- Added separate `conversation_sessions` and `conversation_messages` tables in migration `0007`. Migration was applied only to disposable Postgres 16 at `127.0.0.1:55432`.
- Added SIWE owner-scoped list/create/read/rename/delete/message APIs, idempotent session/turn retries, ordered messages, automatic titles, and pagination.
- Added the desktop recent-chat sidebar and accessible mobile drawer. Restored history is plain text and cannot restore payment intents, approvals, signatures, or actions.
- Fixed a restore race where `reset()` aborted the new conversation request. An authenticated Playwright regression restores a saved session, reloads it from the URL, and confirms no payment action returns.
- Verified the four synthetic existing ledger tables by row count and SHA-256 after migration. A direct composite-FK probe rejected cross-owner message attachment.
- Local `main` commits: `75e6310`, `674092e`, `d5cc0a6`, `6f01024`, `f894a3f`. No push/deploy.
- Passed `npm run test:all`, local `npm run test:conversation-db`, `npm run test:p11-ui` (3 tests), `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `git diff --check`.
- Screenshots: `output/playwright/p1.1-assistant-restored-chat-{desktop,390}.png`, responsive viewport captures, desktop history sidebar, and mobile drawer.
- Root workspace unrelated untracked `.omp/`, `.playwright-cli/`, `bridge/`, `video-demo/`, and P0.2 screenshots were preserved.

## Next
- P1.2 shared memory remains unstarted. Add no memory schema until separately scoped and authorized.
- Before production migration, obtain and review a complete backup, validate restore in isolation, and document rollback. Do not rerun migration `0007` on the local database.
- No structured receipt pointer is stored in chat. Existing payment receipts remain in their own ledger and navigation.
