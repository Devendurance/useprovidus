# Fast Build State

## Product
- Name: Providus
- Outcome: Make conversational wallet payments clear from request through verified proof.
- Primary path: Ask, review exact terms, authorize each required wallet action, then inspect verified evidence.
- Public status: BOT Chain Mainnet native BOT and Official USDT payments are live on chain 677, activation `7820480`. Celo services remain intact. BOT Testnet is hidden from public marketing and blocked from public execution. BOT-funded utility settlement remains unavailable without verified settlement and provider delivery.

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
- P1.2 shared memory remains unstarted. P2 remains out of scope.

## P1.1 Verification
- Passed `npm run test:all`, `npm run test:conversation-db` against the explicit disposable local database, `npm run test:p11-ui` (3 browser tests), the focused post-refresh restore test, `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `git diff --check`.
- Browser fixtures use a mocked wallet and mocked SIWE/API responses. Coverage includes 320, 375, 390, 768, and desktop layout overflow, mobile drawer focus/escape/outside dismissal/scroll lock, and authenticated saved-session restoration without restoring payment controls.
- Screenshots: `output/playwright/p1.1-assistant-{320,375,390,768}.png`, `p1.1-assistant-desktop-panel.png`, `p1.1-assistant-mobile-drawer-390.png`, `p1.1-assistant-restored-chat-{desktop,390}.png`.
- No wallet transaction, contract change, production write, production migration, push, or deployment occurred.
