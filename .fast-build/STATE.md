# Fast Build State

## Product
- Name: Providus
- Outcome: Make conversational wallet payments clear from request through verified proof.
- Primary path: Ask, review exact terms, authorize each required wallet action, then inspect verified evidence.
- Public status: BOT Chain Mainnet native BOT and Official USDT payments are live on chain 677, activation `7820480`. Celo services remain intact. BOT Testnet is hidden from public marketing and blocked from public execution. BOT-funded utility settlement remains unavailable without verified settlement and provider delivery.

## P1.2 shared user memory implemented locally
- Added separate `assistant_memories` records in additive migration `0008_shared_memories`. Memories remain separate from conversation sessions/messages, saved recipients, and payment ledgers.
- Users must explicitly add each fact or preference. The SIWE owner scopes every list, create, edit, and delete operation. Per-row versions prevent silent overwrite, and request IDs make create retries idempotent.
- The assistant receives at most eight saved memories and 1,800 characters as untrusted background context. Memory cannot set payment terms, identify a recipient, restore an intent, approve a transfer, or replace fresh B3 review and wallet authorization.
- Recipient names and addresses still come only from `saved_recipients` and its confirmation flow. Chat deletion leaves shared memory intact.
- The memory panel supports add, inspect, edit, delete, conflict recovery, keyboard dismissal, focus trapping/restoration, mobile scrolling, and owner-change cleanup. Wallet changes close the old owner's panel and discard stale requests.
- The two earlier privacy review findings are addressed in code. Create and edit dynamically load a checksum-based BIP39 detector for all ten standard wordlists before any repository call. The assistant filters payment candidates against current user text and the app-tracked draft, so shared memory cannot fill new terms. Final review also caught and fixed numeric chain IDs being mistaken for amounts or network selection. Regression tests cover BIP39 phrases, wallet/airtime terms, active drafts, and explicit chain-ID context. No key derivation occurs.
- Migration `0008` was generated and applied only to disposable Postgres 16 at `127.0.0.1:55432`, after `0007`. The isolation check confirmed all 11 existing public tables are unchanged. Production was not queried or changed.
- Screenshots: `output/playwright/p1.2-memory-mobile.png` and `output/playwright/p1.2-memory-desktop.png`.
- Local checkpoint: `698e4b8 feat: add shared owner-scoped assistant memory`. No remote push or deployment.
- Production release remains blocked on a reviewed Neon backup, a verified restore in isolation, a rollback plan, and separate authorization. Take a fresh backup or branch, test restore, apply the additive migration, and verify owner isolation before releasing code. Roll back the app first and retain the additive table. Drop it only under a separate reviewed export and recovery plan.
- No push, deploy, real wallet transaction, or production database write occurred.

## P1.2 verification
- Final source passed `npm run test:all`, `npm run test:conversation-db`, `npm run test:shared-memory-db`, six P1.1/P1.2 Playwright tests, `npx tsc --noEmit`, `npm run lint`, `npm run build` with `DATABASE_URL` empty, and `git diff --check`.
- Migration 0008 isolation verification passed against disposable Postgres 16 after migration 0007. All 11 existing public tables were unchanged. Browser tests used mocked wallet/SIWE/API flows. No blockchain broadcast occurred.
- Typecheck initially found malformed ignored `.next/dev/types/routes.d.ts` generated during browser testing. A fresh local dev server regenerated the route types, then typecheck and production build passed.
- The six Playwright tests cover memory create/edit/delete, dismissal/focus, mobile/desktop layout, session restoration, and stale-owner response handling. Screenshots: `output/playwright/p1.2-memory-mobile.png` and `output/playwright/p1.2-memory-desktop.png`.

## P1.1 complete locally
- Local commits: `75e6310` owner-scoped persistence/API, `674092e` chat history UX, `d5cc0a6` restore race fix, `6f01024` restored desktop screenshot, and `f894a3f` refresh-restoration regression. No push or deployment.
- Added separate `conversation_sessions` and `conversation_messages` tables in additive migration `0007_conversation_sessions`. The migration was generated and applied only to disposable Postgres 16 at `127.0.0.1:55432`.
- Session ownership is derived from verified SIWE claims in every API route. Messages have a composite `(session_id, owner_address)` foreign key. Missing and foreign sessions return the same not-found response. The client wallet header can only be checked against the SIWE owner.
- Server-created UUID sessions support idempotent create retries, automatic titles, rename, delete, paginated history, ordered messages, stable turn IDs, retry leases, and stale-attempt rejection.
- Authenticated dashboard users can restore and continue text history through a collapsible desktop sidebar and focus-managed mobile drawer. Wallet and session changes clear prior-owner conversation state and discard stale fetch results. A saved conversation restores text only, never a prior intent, approval, signature, or payment action. Payment and receipt ledgers remain separate.
- Independent review found and fixed a restore bug where `reset()` immediately aborted the newly started session fetch. A browser regression now connects a mocked wallet, signs in through mocked SIWE endpoints, restores a saved conversation, refreshes the page, and confirms payment approval actions do not reappear.
- Migration isolation evidence: two synthetic owners' rows and SHA-256 checksums remain unchanged in `agent_transactions`, `saved_recipients`, `wallet_transfer_intents`, and `transfer_submissions`. A direct SQL probe confirmed cross-owner message attachment is rejected.
- Production migration remains blocked on a reviewed backup and tested restore plan plus separate production authorization. No production database was queried or changed.

## P0.2 complete
- Owner-scoped receipt list and detail routes derive the wallet from `requireOwner`. No client-supplied owner is trusted.
- Reuses existing `transfer_submissions` plus `wallet_transfer_intents` for BOT and `agent_transactions` for Celo. No schema changes, migration, or production database writes.
- Only B5 `confirmed` plus `verifiedAt` is Verified. Celo keeps source status. Approval transactions are excluded because no durable approval ledger exists.
- Existing records lack actual gas fee data. Celo records lack the recipient full address. UI reports unavailable rather than inventing evidence.
- Search, network/token/status filters, pagination, compact previews, and an accessible responsive evidence dialog are implemented. Verified BOT card links include the intent ID.
- Mobile header uses an opaque compact sticky bar, safe-area spacing, and a modal menu with Escape/outside/navigation close, focus control, and background scroll lock. The dialog uses an explicit closed state and restores trigger focus.
- Public copy describes live BOT Mainnet payments, current Celo availability, historic-only Testnet evidence, and unavailable utility settlement.
- P0.1 payment cards and B3/B5 payment semantics are preserved. No contract, Safe, payment engine, production gate, Celo integration, database schema, signature, or transaction changed.

## P0.2 Verification
- `npm run test:all` passed, including 10 receipt-domain assertions and 28 positioning assertions.
- `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `git diff --check` passed.
- `npm run test:p02-ui` passed 3 Playwright tests: 320, 375, 390, 768, and desktop layouts, no horizontal overflow, mobile menu keyboard/Escape/outside/navigation/scroll lock, and receipt modal X/Escape/outside/focus restoration.
- Playwright fixtures were route-mocked locally. No wallet transactions or production API data were used.
- Screenshots are in `output/playwright/`, including five receipt viewports, mobile open menu, and desktop/mobile receipt detail.
- No real wallet transactions, database writes, migrations, push, or deployment occurred.

## Remaining
- No durable token-approval history exists. Adding it needs an additive schema or reviewed chain-discovery design, explicit review, backup/restore planning, and verified wallet isolation.
- iOS Safari and Android browser-chrome behavior were not established by Chromium emulation.
- Chat history does not store structured receipt pointers. Payment records and receipt navigation remain separate from informational conversation text.
- P2 remains out of scope. Production migration `0008` needs the backup, restore, rollback review, and separate authorization described above.

## P1.1 Verification
- Passed `npm run test:all`, `npm run test:conversation-db` against the explicit disposable local database, `npm run test:p11-ui` (3 browser tests), the focused post-refresh restore test, `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `git diff --check`.
- Browser fixtures use a mocked wallet and mocked SIWE/API responses. Coverage includes 320, 375, 390, 768, and desktop layout overflow, mobile drawer focus/escape/outside dismissal/scroll lock, and authenticated saved-session restoration without restoring payment controls.
- Screenshots: `output/playwright/p1.1-assistant-{320,375,390,768}.png`, `p1.1-assistant-desktop-panel.png`, `p1.1-assistant-mobile-drawer-390.png`, `p1.1-assistant-restored-chat-{desktop,390}.png`.
- No wallet transaction, contract change, production write, production migration, push, or deployment occurred.
