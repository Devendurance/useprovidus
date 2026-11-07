# Providus — Project State

## B7 current checkpoint, 2026-11-08
- Current task is B7 BOT wallet frontend in the existing dashboard. B8/B9 are excluded. No push, deploy, migration, or production database mutation.
- Repository HEAD is `52ff058`. B1-B6 already exist as dirty/untracked work and must remain intact. Historical notes below predate those changes.
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
