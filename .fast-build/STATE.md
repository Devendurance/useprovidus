# Fast Build State

## Product
- Name: Providus
- Outcome: Make conversational wallet payments clear from request through verified proof.
- Primary demo path: Ask for a BOT transfer, review exact terms, authorize required wallet transactions, inspect B5-verified receipt.
- Public status: BOT Chain Mainnet is live for native BOT and Official USDT at commit `7820480`. BOT Testnet is hidden and disabled publicly. Existing Celo services remain intact. BOT-funded utilities are not live without independent settlement and provider delivery.

## Existing capabilities
- BOT wallet transfers, review authorization, immutable intents, pending and unknown recovery, and B5 receipt verification exist. Evidence: `components/assistant/wallet-transfer-card.tsx`, `app/api/transfers/[id]/status/route.ts`, and `agent-state/project-state.md`.
- Celo airtime and cash-out flows exist and must remain intact. Evidence: `README.md` and `agent-state/project-state.md`.
- Neon/Drizzle payment and recipient persistence exists. `saved_recipients` is owner-scoped. Evidence: `lib/db/schema.ts`.
- Chat is stateless and accepts bounded client-held history. No conversation, message, or general memory tables exist. Evidence: `app/api/assistant/chat/route.ts` and `lib/db/schema.ts`.

## MVP slices
- [x] Correct Mainnet status copy and availability labels.
- [x] Compact contextual payment cards, single-next-action hierarchy, and verified completion cleanup without changing B3/B5 or wallet authorization.
- [ ] Searchable Celo and BOT receipt history, full evidence modal, and separate approval inspection (P0.2).
- [ ] Owner-scoped persistent conversation sessions after migration review.
- [ ] One owner-scoped, explicitly managed memory layer after session storage review.
- [ ] Broader desktop/mobile, keyboard, accessibility, and Celo/BOT regression sweep.

## Current slice
- P0.1 is complete. `resolvePaymentCardView` derives the displayed stage from persisted B3/B5 status plus current wallet, network, review, allowance, and recovery facts. B5 `confirmed` plus `verifiedAt` is the only success state. Native payment needs one review and wallet confirmation. USDT uses a separate exact allowance approval only when required, then its own payment confirmation.
- Verified UI now shows a compact amount, recipient, network, verified status, and the existing `/receipt` action. Hash, contract, chain ID, allowance, gas estimate, and verification evidence sit under “Transaction proof”. The full recipient address stays visible during review and in proof details.
- No payment engine, contract, production gate, Celo flow, database schema, migration, production data, push, deploy, or real wallet transaction changed.

## Completed
- Confirmed the repository is Providus and read the existing project handoff, design system, README, and package scripts.
- Confirmed the starting worktree has only pre-existing untracked `.omp/`, `bridge/`, and `video-demo/` paths.
- Saved the evidence-based audit and experience plan under `docs/ux/`.
- Updated `DESIGN.md` to match the shipped Providus system and added shared Mainnet status copy. The production gate and payment code remain unchanged.
- Implemented P0.1 in commits `af13af3`, `c84da3f`, and `aa5b75d`: compact cards, explicit states, allowance recheck before approval affordance, B5 status precedence, recoverable unknown transactions, and verified action cleanup. The allowance button stays hidden until its initial read-only check finishes.
- Saved synthetic-fixture Playwright before/after desktop and mobile screenshots under `output/playwright/`.

## Remaining MVP gaps
- BOT `View receipt` reuses the existing navigation, but the receipt page remains Celo-only. P0.2 must add BOT history and a full evidence modal.
- B5 does not store gas used or effective gas price. Approval transactions have no separate durable ledger.
- Persistent conversation sessions and general shared memory are missing.

## Blockers
- Any schema migration requires explicit review, a backup and restore plan, and verified wallet isolation.

## Verification
- `npm run test:payment-card-view` (12 assertions), `test:wallet-assistant`, `test:web-execution`, `test:submission`, `test:verification`, `test:mainnet-policy`, `test:assistant`, `test:chains`, `test:wallet-network`, `test:attribution`, and `lib/wallet/b7-token-ui-self-check.tsx` pass.
- Playwright used only a local synthetic B5 fixture. Verified cleanup, receipt link, full-address disclosure, keyboard reachability, and 390px no-overflow assertions pass. Before/after screenshots are in `output/playwright/`.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` with `DATABASE_URL` unset, and `git diff --check` pass. No database, wallet signature, or transaction was used.
- Wallet signing and real provider transaction journeys were not automated. State and duplicate-submission safeguards are covered by existing local self-checks. Receipt modal behavior remains P0.2.

## Next action
- Start P0.2: searchable receipt history and a responsive evidence modal, including separate approval transaction inspection. First map existing B5 evidence fields. Any schema change needs explicit review, backup/restore planning, and wallet-isolation verification.
