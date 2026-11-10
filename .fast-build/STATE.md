# Fast Build State

## Product
- Name: Providus
- Outcome: Make conversational wallet payments clear from request through verified proof.
- Primary path: Ask, review exact terms, authorize each required wallet action, then inspect verified evidence.
- Public status: BOT Chain Mainnet native BOT and Official USDT payments are live on chain 677, activation `7820480`. Celo services remain intact. BOT Testnet is hidden from public marketing and blocked from public execution. BOT-funded utility settlement remains unavailable without verified settlement and provider delivery.

## P0.2 complete
- Owner-scoped receipt list and detail routes derive the wallet from `requireOwner`. No client-supplied owner is trusted.
- Reuses existing `transfer_submissions` plus `wallet_transfer_intents` for BOT and `agent_transactions` for Celo. No schema changes, migration, or production database writes.
- Only B5 `confirmed` plus `verifiedAt` is Verified. Celo keeps source status. Approval transactions are excluded because no durable approval ledger exists.
- Existing records lack actual gas fee data. Celo records lack the recipient full address. UI reports unavailable rather than inventing evidence.
- Search, network/token/status filters, pagination, compact previews, and an accessible responsive evidence dialog are implemented. Verified BOT card links include the intent ID.
- Mobile header uses an opaque compact sticky bar, safe-area spacing, and a modal menu with Escape/outside/navigation close, focus control, and background scroll lock. The dialog uses an explicit closed state and restores trigger focus.
- Public copy describes live BOT Mainnet payments, current Celo availability, historic-only Testnet evidence, and unavailable utility settlement.
- P0.1 payment cards and B3/B5 payment semantics are preserved. No contract, Safe, payment engine, production gate, Celo integration, database schema, signature, or transaction changed.

## Verification
- `npm run test:all` passed, including 10 receipt-domain assertions and 28 positioning assertions.
- `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `git diff --check` passed.
- `npm run test:p02-ui` passed 3 Playwright tests: 320, 375, 390, 768, and desktop layouts, no horizontal overflow, mobile menu keyboard/Escape/outside/navigation/scroll lock, and receipt modal X/Escape/outside/focus restoration.
- Playwright fixtures were route-mocked locally. No wallet transactions or production API data were used.
- Screenshots are in `output/playwright/`, including five receipt viewports, mobile open menu, and desktop/mobile receipt detail.
- No real wallet transactions, database writes, migrations, push, or deployment occurred.

## Remaining
- No durable token-approval history exists. Adding it needs an additive schema or reviewed chain-discovery design, explicit review, backup/restore planning, and verified wallet isolation.
- iOS Safari and Android browser-chrome behavior were not established by Chromium emulation.
- P1 persistent conversations and shared memory remain unstarted.