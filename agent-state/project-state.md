# Providus — Project State

## P0.2 receipts, mobile navigation, and public copy, 2026-11-10
- P0.2 uses authenticated owner-scoped API reads across existing BOT B5 and Celo `agent_transactions` records. No schema migration or production database write.
- Added compact searchable/filterable receipt history and a responsive evidence dialog. BOT Verified requires B5 `confirmed` plus `verifiedAt`; Celo retains its source status.
- Actual gas is unavailable in both source ledgers and full recipient address is absent from Celo records. Approval transactions have no durable ledger and are excluded from payment history.
- Mobile navigation uses an opaque compact sticky header, safe-area spacing, and modal focus/scroll management. Public copy reflects BOT Mainnet 677 live and keeps Celo intact. Testnet remains historical/disabled publicly; utility settlement is unavailable pending verified settlement and provider delivery.
- Focused receipt and positioning self-checks, `test:all`, TypeScript, lint, build, `git diff --check`, and full Playwright browser QA pass. Local route fixtures covered 320, 375, 390, 768, desktop, mobile navigation, and modal dismissal/focus. Screenshots are in `output/playwright/`.

## P1.1 persistent conversation sessions, complete locally, 2026-11-10
- Local commits `75e6310`, `674092e`, `d5cc0a6`, `6f01024`, and `f894a3f` add SIWE owner-scoped sessions/messages, APIs, persistent assistant turns, desktop history, a mobile drawer, restore-race and refresh regressions, and restored-conversation screenshots.
- Migration `0007_conversation_sessions` adds separate session and message tables. Owners come from verified SIWE claims. A composite owner foreign key protects message/session attachment. Messages are text-only and never restore intents, approvals, signatures, or payment actions.
- Idempotent session creation, automatic titles, rename/delete, pagination, ordering, retry leases, stale response guards, and wallet-owner cache clearing are implemented. P0 payment, receipt, saved-recipient, and session data remain separate.
- Disposable Postgres 16 at `127.0.0.1:55432` has migrations `0000` through `0007`. Two synthetic owners' rows and hashes stayed unchanged across four existing ledger tables. Direct SQL and the service self-check reject cross-owner access.
- `test:all`, `test:conversation-db`, `test:p11-ui` (3 tests), typecheck, lint, build, and diff check passed. Browser routes used mocked wallet/SIWE/payment APIs. No real transactions occurred.
- Migration has not been applied to production. A reviewed production backup, restore validation, rollback plan, and separate authorization remain release blockers. P1.2 shared memory remains unstarted.
## P0.1 compact payment UX and public Mainnet activation, 2026-11-10
- Public BOT Chain Mainnet activation is complete at `7820480` for native BOT and Official USDT. BOT Testnet is hidden and disabled publicly. Existing Celo services remain intact. BOT-funded utilities are not live without independently verified settlement and provider delivery.
- The evidence-based UX audit and story-driven plan remain in `docs/ux/`. `DESIGN.md` is the current Providus design system.
- P0.1 is complete in `af13af3`, `c84da3f`, and `aa5b75d`: compact payment cards, one stage-specific primary action, B5-authoritative verified cleanup, explicit exact USDT allowance, and readable technical proof disclosure. The approval button stays hidden until the initial allowance read completes.
- Success requires B5 `confirmed` plus `verifiedAt`. A submitted hash stays pending. Unknown/failed/expired states keep their truthful recovery or stop state. Native and USDT wallet authorizations remain separate as required.
- P0.1 did not change B3/B5 execution, contracts, Safe ownership, production payment gates, Celo integrations, schema, migrations, or database data. No real transaction, push, or deploy occurred.
- Owner-supplied Mainnet transaction hashes remain recorded below. The UI fixture screenshots are synthetic and make no live-transaction claim.
- At P0.1 completion the remaining gaps included receipt history/modal, absent gas fee storage, no approval ledger, client-held chat, and no general memory. P0.2 now adds owner-scoped receipts. Gas/approval storage, sessions, and memory remain gaps.
- P0.2 and P1.1 are complete locally. P1.2 shared memory remains unstarted and needs its own owner-scoped design and authorization. P1.1 production migration still requires separate backup/restore review and authorization. See `.fast-build/STATE.md`.
- P0.1 checks passed: payment-card view (12 assertions), wallet assistant, web execution, submission, B5 verification, Mainnet policy, assistant, chain registry, wallet/network, Celo attribution, and ERC-20 UI self-checks. Playwright synthetic fixture verified cleanup, receipt link, proof disclosure, keyboard reachability, and no horizontal overflow at 390px. TypeScript, lint, build with `DATABASE_URL` unset, and diff check passed.

## B9 UX hotfix completed, 2026-11-09
- This captures the pre-activation state. Public BOT Mainnet activation completed at `7820480` on 2026-11-10, as summarized above.
- Scope: multichain wallet dropdown/switching, session-state clarity, assistant and review copy. No payment execution rebuild, contract/backend/schema change, push, deploy, production write, or mainnet transaction.
- B1 registry defines Celo 42220, BOT Mainnet 677, BOT Testnet 968. Wagmi registers all three while existing Celo-only readiness remains required by cash-out and airtime.
- Design checkpoint: shared auth controller plus registry-derived network display. See `.audit/b9-ux-hotfix-design.md`. The independent review found and recorded the forced-Celo connect risk and wagmi 4902 add behavior.
- The wallet menu shows the confirmed network, chain ID, active native balance, network explorer, authentication state, supported switches, and disconnect. Connect preserves the wallet's network. wagmi handles 4902 add-chain from B1 data, with one retry only for its accepted-add-but-not-selected marker.
- Shared wallet auth state normalizes addresses, prevents a session probe from invalidating an active sign-in, ignores stale responses after account changes, and keeps chain changes from forcing logout under current `requireOwner` policy. Account changes hide and clear old-owner assistant drafts.
- Chain/account watcher revisions invalidate BOT Testnet plans and gas immediately. B5 hash and unknown recovery stay mounted and recoverable. Celo airtime controls now require Celo Mainnet before submission.
- Assistant starter examples cover BOT Testnet transfers and Celo MTN airtime. Mainnet remains switchable and payment-disabled. `test:all` now includes the existing 677 execution hard-gate regression.
- `npm run test:all`, `npx tsc --noEmit`, `npm run lint`, `npm run build` with `DATABASE_URL` empty, and `git diff --check` pass. The suite includes the web execution hard-gate check and 14 local contract unit tests.
- Mocked-provider UI checks cover supported and unsupported chains, switch paths, wallet rejection, missing switch support, disconnect, RPC failure, and no transaction broadcast. The existing live-wallet browser tab and dev server remain untouched.
- Visual captures: `.audit/b9-ux-hotfix/providus-wallet-menu-desktop-mainnet.jpg` at 1365x900 and `.audit/b9-ux-hotfix/providus-wallet-menu-mobile-testnet.jpg` at 390x844. The production build has no Next image dimension warning or overlay error.
- Local source checkpoints: `7fa05ac` and `519bc88`. No push, deploy, migration, production database write, or mainnet transaction.

## B8 current checkpoint, 2026-11-08
- B8 repositions the public product as a multichain conversational payment platform while preserving B1-B7 execution code and the Celo service flows.
- Added shared positioning in `lib/product/positioning.ts` for Celo live, BOT Testnet verified, BOT mainnet pending B9, and utility roadmap statuses.
- Updated homepage, dashboard, trust walkthrough, assistant prompts, navigation, footer, metadata, README, and product messaging. Added the official BOT Chain wordmark and safe website, mainnet explorer, and testnet explorer links.
- Added browser evidence in `docs/b8-evidence/` and the positioning report in `docs/b8-product-positioning.md`.
- Focused positioning self-check, full tests, TypeScript, lint, production build, and diff check pass. No schema change, migration, payment execution feature, mainnet transaction, push, or deploy was performed.
- B8 source checkpoint is `79b3556`. Existing B1-B7 dirty and untracked files remain outside the B8 checkpoint and must not be reset, cleaned, or overwritten.

## B7 current checkpoint, 2026-11-08
- Current task is B7 BOT wallet frontend in the existing dashboard. B8/B9 are excluded. No push, deploy, migration, or production database mutation.
- B7 source checkpoint is `503160c`. Session started at `52ff058`. B1-B6 already exist as dirty/untracked work and must remain intact. Historical notes below predate those changes.
- Added owner-only session read and execution-plan endpoint. Plan uses stored B3 terms, B4 freshness checks, B5 duplicate-submission guard, canonical 968 contract, and hard mainnet gate.
- Existing assistant now retains B6 structured actions. Wallet ownership login, recipient cards, exact stored review, explicit wallet send, hash retention, recovery and B5 receipt are wired into AssistantPanel.
- Existing Celo quote, airtime and cash-out paths remain separate and unchanged.
- Full test suite, B7 security/HTTP/consent/ERC-20 UI tests, real isolated SIWE HTTP smoke and fixture browser scenario pass. Production build passes. Browser payment and confirmation are simulated, with no real extension or funded testnet broadcast.
- `scripts/check-b7-env.mjs` prints presence/config checks only. Local required values exist and 968 contract matches. Local APP_ORIGINS lacks production domain. Actual production environment is uninspected.
- next.config.ts pins the repository root. Default Turbopack production build passes. Browser screenshots and detailed evidence are in `docs/b7-wallet-payment-experience.md` and `docs/b7-evidence/`.
- Existing backend source remains unstaged to preserve pre-existing B1-B6 work. A reversible B7-only patch is captured as `.audit/b7-existing-backend-edits.patch.b64` for the local checkpoint.

Last updated: 2026-09-21 (HEAD `4e6a0e5`, checkpoint P6.10–P6.14 committed)

## What this is
Celo-native conversational payments agent. Turns user-approved Celo USDC into Nigerian financial outcomes.
Core principle: **LLM owns language; deterministic code owns money.**

## Stack
- Next.js 16 App Router + TypeScript + wagmi/viem
- Celo mainnet (42220), canonical Circle USDC `0xcebA...32118C`
- Paycrest off-ramp (quotes/orders/reconciliation), ClubKonnect VTU (airtime)
- Neon Postgres + Drizzle ORM (`agent_transactions`, `airtime_previews`)
- DeepSeek LLM (server-side only)
- ERC-8004 Agent #9851, ERC-8021 tag `celo_8190b99392a2`

## Architecture (current)
Browser/UI → Assistant/DeepSeek → deterministic intent + preview engine → Neon/Postgres → Paycrest → Celo → reconciliation → ClubKonnect → receipt/status UX.
- Preview: 5-min TTL (`PREVIEW_TTL_MS = 5*60_000`), single-use, wallet-bound, fingerprint-bound.
- Payment: preview freezes NGN + base USDC; Paycrest order authoritatively binds `senderFee`/`transactionFee`/`totalUsdcToSend`.
- Fulfilment: only after Paycrest `validated`/`settled`; deterministic RequestID `ck+prefix+sha256`; one-shot attempt claim; Query API only on unknown.
- Status: `pending → settling → settled → processing → completed/failed`; only numeric ClubKonnect `200` completes.
- Receipt rehydration: `GET /api/transactions/[id]?paymentInstructions=true&walletAddress=` (durable payment instructions).

## Completed milestones (repo source of truth)
- P0: financial integrity + attribution hardening
- P1: persistence + Paycrest finality
- P2: ClubKonnect server boundary
- P3: conversational assistant + intent engine
- P4: preview + confirmation UX
- P5: payment orchestration
- P6: Paycrest→ClubKonnect bridge
- P6.6: provider-fee binding fix
- P6.7/7A: 5-min TTL + contract cleanup
- P6.8: durable payment-instruction rehydration
- P6.9: deterministic confirmation fast-path + safe diagnostics
- P6.10–P6.14 (COMMITTED in `4e6a0e5`): live evidence doc + README rewrite + terminal/receipt UX + receipt rehydration + positioning/architecture/PRD docs refresh + landing/how-it-works/check UI updates

## Live proof (human-gated, real mainnet)
- ₦1,000 MTN airtime, tx `tx_48b9c6d0-dff3-45be-a5dd-8daecc765492` → `completed`
- Celo tx `0xfb952e...e0ce9`, 0.736312 USDC (0.732612 base + 0.0037 fee)
- Paycrest `7d4ea880...` (`settled`), ClubKonnect `6720476887` (200/success)
- Doc: `docs/live-airtime-e2e.md`. Recipient masked `*******6560` everywhere.

## Key files
- Assistant: `lib/assistant/{resolve,preview,payment-service,preview-repository,fingerprint}.ts`, `app/api/assistant/{chat,preview,orders}/route.ts`, `hooks/use-assistant.ts`
- Transactions: `lib/transactions/{types,status,repository,transitions,receipt}.ts`, `hooks/use-transaction-status.ts`
- ClubKonnect: `lib/clubkonnect/server/{client,orchestration,reconciliation}.ts`
- UI: `components/assistant/{assistant-panel,intent-draft-card,airtime-preview-card,payment-instructions-card}.tsx`, `app/{dashboard,receipt,check,how-it-works}/`
- Receipt rehydration: `app/receipt/receipt-client.tsx`, `app/api/transactions/[id]/route.ts`
- Docs: `docs/{live-airtime-e2e,PROVIDUS_ARCHITECTURE,providus_PRD,positioning,competitive-positioning,providus-brand-messaging}.md`, `README.md`
- Sprint plan (historical, gaps superseded): `docs/providus-accelerated-build-plan.md`
- Tests: `npm run test:all` (13 suites incl. receipt), `tests/status-ux.test.ts`, `tests/p610-terminal-ux.test.ts`

## Verification commands
`npm run test:assistant`, `npm run test:all`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, `git diff --check`

## Worktree state (2026-09-21)
- HEAD: `4e6a0e5 feat: checkpoint Providus P6.10-P6.14` (committed; prior P6.10 dirty work is now safe)
- Modified (uncommitted): `AGENTS.md` (expanded continuity/safety/milestone rules — do not lose)
- Untracked: `agent-state/` (this folder), `.omp/` (session artifact, contains AGENTS.md), `bridge/trusted-read-01`, `bridge/trusted-read-04`

## P6.14D deploy + smoke (2026-09-21, verified, no financial mutation)
- Deployed SHA `4e6a0e5` = HEAD; Vercel Production `success` 2026-09-21T01:41:14Z; auto-deploy via GitHub integration (no vercel.json needed).
- Production URL: `https://useprovidus.vercel.app` (200, public). Per-deployment hash URLs are SSO-gated — use canonical alias for testing.
- Smoke: `/`, `/how-it-works`, `/dashboard`, `/receipt`, `/check` all 200 with correct content; APIs `institutions`/`support` 200 live, tx-lookup clean 404, no 500s.
- Safety: no secrets/full-PII/Supabase/false-guarantees; PII masked; future channels labeled "Roadmap only"; celoscan + receipt links live.
- Verdict: REAL USER SPRINT READY: YES. No push/commit was needed (main == origin/main; only excluded files dirty).
