# Agent Memory

Last updated: 2026-09-17

## Decisions

### 2026-09-17: Use three tracked Markdown state files

- Stable project facts belong in `project-state.md`.
- Durable decisions and discoveries belong in `memory.md`.
- The active handoff belongs in `left-off.md`.
- The state files are tracked in Git and are not ignored.

### 2026-09-17: Treat the current Next.js source as authoritative

- The repository's actual implementation is Next.js App Router with React and TypeScript.
- The broader architecture document contains a recommended SvelteKit/Fastify/Supabase direction; it must not be mistaken for the current source architecture.

## Conventions

- Read all three state files at the start of every session or new task.
- Use relative links to authoritative project documents instead of copying their contents.
- Date meaningful state updates and keep each file concise.
- Record environment-variable names if needed, never their secret values.
- Follow the visual rules in `DESIGN.md` for UI work.

## Discoveries

### 2026-09-17: Domain code is split by wallet, money, and Paycrest

- Wallet behavior lives under `lib/wallet/` and the wallet provider components.
- Money conversion helpers live under `lib/money/`.
- Paycrest route and order behavior lives under `lib/paycrest/` and `app/api/paycrest/`.

## Known gotchas

- The worktree may contain user changes unrelated to the current task. Inspect and preserve them before editing.
- Do not treat `.next/`, TypeScript build info, or other generated output as project state.
- Quote, payment, and wallet behavior must not be described as complete unless source code and verification confirm it.

### 2026-09-17: Keep Next verification serial

- Running `next dev` while TypeScript or `next build` uses the same checkout can leave malformed `.next/dev/types` files. Stop the dev server, remove only generated `.next/`, and run verification serially.
