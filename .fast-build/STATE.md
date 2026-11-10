# Fast Build State

## Product
- Name: Providus
- Outcome: Make conversational wallet payments clear from request through verified proof.
- Primary demo path: Ask for a BOT transfer, review exact terms, authorize required wallet transactions, inspect B5-verified receipt.

## Existing capabilities
- BOT wallet transfers, review authorization, immutable intents, pending and unknown recovery, and B5 receipt verification exist. Evidence: `components/assistant/wallet-transfer-card.tsx`, `app/api/transfers/[id]/status/route.ts`, and `agent-state/project-state.md`.
- Celo airtime and cash-out flows exist and must remain intact. Evidence: `README.md` and `agent-state/project-state.md`.
- Neon/Drizzle payment and recipient persistence exists. `saved_recipients` is owner-scoped. Evidence: `lib/db/schema.ts`.
- Chat is stateless and accepts bounded client-held history. No conversation, message, or general memory tables exist. Evidence: `app/api/assistant/chat/route.ts` and `lib/db/schema.ts`.

## MVP slices
- [x] Correct Mainnet status copy to separate verified transaction evidence from gated production availability.
- [ ] Compact contextual payment review and verified completion without changing B3/B5 or wallet authorization.
- [ ] Searchable Celo and BOT receipt history, evidence detail, and separate approval inspection.
- [ ] Owner-scoped persistent conversation sessions after migration review.
- [ ] One owner-scoped, explicitly managed memory layer after session storage review.
- [ ] Desktop/mobile, keyboard, accessibility, and Celo/BOT regression sweep.

## Current slice
- UX audit and story-driven experience plan are complete. The Mainnet status-copy slice is complete. No verified-card cleanup was started because BOT receipt detail and durable gas/approval evidence are not available as a contained UI change.

## Completed
- Confirmed the repository is Providus and read the existing project handoff, design system, README, and package scripts.
- Confirmed the starting worktree has only pre-existing untracked `.omp/`, `bridge/`, and `video-demo/` paths.
- Saved the evidence-based audit and experience plan under `docs/ux/`.
- Updated `DESIGN.md` to match the shipped Providus system and added shared Mainnet status copy. The production gate and payment code remain unchanged.

## Remaining MVP gaps
- Verified BOT payment UI does not link to a Providus receipt. The receipt page reads Celo transactions only.
- B5 does not store gas used or effective gas price. No approval transaction ledger exists.
- Persistent conversation sessions and general shared memory are missing.

## Blockers
- Any schema migration requires explicit review, a backup and restore plan, and verified wallet isolation.

## Verification
- Live dashboard and receipt pages, B8/B9 screenshots, targeted source paths, and the landing page were inspected. No wallet signature or payment was triggered.
- Playwright CLI reload reports zero errors and zero warnings after correcting the BOT logo aspect ratio. The 390px viewport has no horizontal overflow.
- `npm run test:b8-positioning`, `npm run test:web-execution`, `npx tsc --noEmit`, `npm run lint`, and `git diff --check` pass.
- `npm run build` passes in an isolated worktree with `DATABASE_URL` unset. The active dev output was not used.
- Full desktop/mobile payment E2E, keyboard, modal, and wallet-state coverage remains for the dedicated QA slice.

## Next action
- Build the compact payment review and verified completion slice. First settle its read-only receipt data shape against B5. Keep submitted and unknown recovery evidence mounted.
