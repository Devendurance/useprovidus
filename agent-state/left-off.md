# Left off: P1.1 planning and migration baseline

## What we are doing
- Implement durable wallet-owner-scoped Providus assistant sessions and conversation history.
- Preserve P0.1/P0.2, payment behavior, Celo, and existing records. Do not push, deploy, run live payments, or migrate production.

## Done
- Read `.fast-build/STATE.md`, the story-driven UX skill, the UX audit, and the experience plan.
- Traced SIWE ownership, stateless chat flow, the `useAssistant` hook, saved recipients, and separate B3/B5 ledgers.
- Compared two designs. Selected two tables with a composite owner foreign key and idempotent turn state on user messages. See `.fast-build/P1.1-ARCHITECTURE.md`.
- Started isolated Postgres 16 at `127.0.0.1:55432` and applied migrations `0000` through `0007` to that disposable database only.
- Added `scripts/p11-migration-isolation-self-check.mjs`. Prepared two synthetic owners and recorded counts and SHA-256 baselines in `.fast-build/p11-ledger-baseline.json`.
- Verified all four existing ledger tables retain their baseline counts and checksums after `0007`. A SQL probe confirmed that the composite owner foreign key rejects a cross-owner message.
- Planning and the migration harness are committed locally in `b4f8a42`. The code worker owns isolated worktree `C:/Users/USER/Documents/ideas/providus-p11` on `codex/p11-persistent-chat`. Root remains on the shared workspace and owns migration review, local DB application, and final verification.
- Existing untracked `.omp/`, `.playwright-cli/`, `bridge/`, `video-demo/`, and P0.2 screenshots must be preserved.

## Next
- Review the worker's service/API/UI changes and tests. Do not rerun the local migration.
- Implement the owner-scoped routes, persisted chat mode, active session UI, desktop sidebar, mobile drawer, and regressions.
- Run the requested tests, browser checks, typecheck, lint, build, and diff check. Update all state files. Stop before production migration, push, deploy, P1.2 memory, or P2.
