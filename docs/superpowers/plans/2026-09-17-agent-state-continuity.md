# Agent State Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Git-tracked Markdown state contract so a fresh agent can recover Providus project context, durable decisions, and the exact current handoff.

**Architecture:** Add three focused Markdown files under the repository-root `.agent-state/` directory. Extend the existing `AGENTS.md` with explicit read, update, conflict-resolution, and handoff rules; do not add runtime code, dependencies, hooks, or an application state store.

**Tech Stack:** Git-tracked Markdown, existing `AGENTS.md` instructions, Next.js repository verification commands (`npm run lint`, `npx tsc --noEmit`, and `npm run build`).

## Global Constraints

- Create a tracked directory at `.agent-state/` in the repository root.
- Create exactly three canonical files: `project-state.md`, `memory.md`, and `left-off.md`.
- Keep state entries concise, dated, and free of secrets, credentials, wallet keys, tokens, private user data, and generated build output.
- Treat source code, configuration, and tests as the source of truth when notes conflict with the repository.
- Preserve all existing user changes in the dirty worktree; do not clean or revert them.
- Do not modify application code, package manifests, `.gitignore`, or existing project documentation for this setup.
- Do not add runtime dependencies, hooks, scripts, or application behavior.
- Do not commit or push unless the user explicitly requests it.

---

## File Map

| File | Responsibility |
| --- | --- |
| `.agent-state/project-state.md` | Stable product, stack, architecture, important paths, integrations, and verification commands |
| `.agent-state/memory.md` | Durable decisions, conventions, discoveries, and recurring gotchas |
| `.agent-state/left-off.md` | Volatile task handoff with progress, changed files, verification, blockers, and one next action |
| `AGENTS.md` | Instructions that make reading and maintaining the state files part of every agent workflow |
| `docs/superpowers/specs/2026-09-17-agent-state-continuity-design.md` | Approved design reference; do not duplicate it into the state files |

## Task 1: Add the State Files

**Files:**
- Create: `.agent-state/project-state.md`
- Create: `.agent-state/memory.md`
- Create: `.agent-state/left-off.md`
- Read: `docs/providus_PRD.md`
- Read: `docs/PROVIDUS_ARCHITECTURE.md`
- Read: `package.json`
- Read: current repository tree and `git status --short`

**Interfaces:**
- Consumes: confirmed product facts from `docs/providus_PRD.md`, architecture notes from `docs/PROVIDUS_ARCHITECTURE.md`, actual dependencies from `package.json`, and the current worktree status.
- Produces: three Markdown files with the exact headings and responsibilities described below. Later tasks and future agents read these files by their fixed paths.

- [ ] **Step 1: Confirm the initial repository facts**

Run:

```bash
git status --short
```

Confirm that the existing worktree changes are still present. Use the source
files and `package.json` to correct any factual detail in the initial state
content before writing it. Do not include credentials, environment values, or
generated `.next/` output.

- [ ] **Step 2: Create `project-state.md` with the initial stable context**

Create `.agent-state/project-state.md` with this content, updating only facts
that the repository inspection proves have changed:

```markdown
# Project State

Last updated: 2026-09-17

## Product

- Providus is a Celo route-intelligence agent that compares local fiat-to-Celo routes by effective received amount before money moves.
- The primary Route Check flow collects country, amount, payment method, and target asset, then presents a preview and an actionable route verdict.
- Providus recommends and hands off to providers; it does not custody user funds or execute the fiat purchase in the MVP.
- Authoritative product requirements: [Providus PRD](../docs/providus_PRD.md).

## Current status

- The repository contains a Next.js App Router implementation with Providus landing, route-check, preview, verdict, dashboard, receipt, and how-it-works screens.
- Wallet connectivity and Paycrest-related route/order helpers are present in the current source tree.
- The working tree contains pre-existing uncommitted application and design changes. Inspect `git status --short` before modifying files and preserve those changes.

## Stack

- Next.js 16.2.12 with the App Router.
- React 19.2.4 and TypeScript 5.
- Tailwind CSS 4 through the existing PostCSS configuration.
- `wagmi` 3.7.5 and `viem` 2.55.10 for wallet and Celo integration.
- GSAP and Lenis for the existing motion and scrolling implementation.

## Architecture

- `app/` owns pages, layouts, loading and not-found states, and Paycrest route handlers under `app/api/paycrest/`.
- `components/` contains reusable layout, provider, route-check, move-money, Providus, and UI components.
- `lib/wallet/` contains wallet configuration, connectors, supported tokens, provider identity, guards, formatting, and self-check logic.
- `lib/paycrest/` contains Paycrest types, client/server helpers, amount and recipient handling, order construction, and self-check logic.
- `lib/money/` contains decimal and USDC amount helpers plus self-check logic.
- The recommended future architecture in `docs/PROVIDUS_ARCHITECTURE.md` mentions SvelteKit, Fastify, Supabase, and Redis; the actual implementation in this repository is the Next.js application described above.

## Key paths

- `app/`: application routes and API handlers.
- `components/`: reusable UI and feature components.
- `lib/`: wallet, money, and Paycrest domain logic.
- `docs/providus_PRD.md`: product requirements and MVP boundaries.
- `docs/PROVIDUS_ARCHITECTURE.md`: broader target architecture and data model.
- `docs/PAYCREST_INTEGRATION.md`: Paycrest integration notes.
- `docs/WALLET_INTEGRATION.md`: wallet integration notes.
- `DESIGN.md`: repository visual design system.
- `package.json`: scripts and dependency versions.

## Integrations

- Celo wallet flows use the existing `wagmi` and `viem` configuration under `lib/wallet/` and `components/providers/`.
- Paycrest integration is exposed through the existing handlers under `app/api/paycrest/` and helpers under `lib/paycrest/`.
- Environment configuration is documented by `env.example`; secrets remain server-side and are never recorded in agent state.

## Verification

- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm run test:wallet-helpers`
- `npm run test:money-helpers`
- `npm run test:recipient-helpers`
- `npm run test:order-helpers`
- `npm run test:order-route`
```

- [ ] **Step 3: Create `memory.md` with only durable facts**

Create `.agent-state/memory.md` with this content:

```markdown
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
```

- [ ] **Step 4: Create `left-off.md` as the initial handoff**

Create `.agent-state/left-off.md` with this content:

```markdown
# Left Off

Last updated: 2026-09-17

## Current objective

Install the tracked agent-state workflow described in `docs/superpowers/specs/2026-09-17-agent-state-continuity-design.md`.

## Completed

- Inspected the repository instructions, package manifest, project documentation, current tree, and recent commits.
- Chose the tracked Markdown approach for agent continuity.
- Got user approval for the state model, workflow, file contracts, and integrity rules.
- Wrote and self-reviewed the approved design spec.

## In progress

- Add the three `.agent-state/` files.
- Add the Agent State Continuity section to `AGENTS.md` without overwriting existing user changes.

## Changed files

- The worktree already contains user changes across `AGENTS.md`, `DESIGN.md`, `app/`, and `components/`.
- `components/ui/route-check-cta.tsx` is an existing untracked user file.
- `docs/superpowers/specs/2026-09-17-agent-state-continuity-design.md` was added during the approved design phase.
- No existing application change has been reverted or cleaned.

## Verification

- `git diff --check` passed during design review; Git emitted only existing line-ending warnings for modified files.
- The final state-file setup checks have not run yet.

## Blockers

- None known for the state-file setup.

## Next action

Create the three state files, append the continuity rules to `AGENTS.md`, and run the documented tracking and repository quality checks.
```

- [ ] **Step 5: Inspect the three files for contract coverage**

Confirm that `project-state.md` has the eight stable-context sections,
`memory.md` has the five durable-memory sections, and `left-off.md` has the
eight handoff sections. Confirm that all links and paths point to files that
exist in the repository.

## Task 2: Add the `AGENTS.md` Continuity Contract

**Files:**
- Modify: `AGENTS.md` by appending one new `Agent State Continuity` section
- Read: `.agent-state/project-state.md`
- Read: `.agent-state/memory.md`
- Read: `.agent-state/left-off.md`

**Interfaces:**
- Consumes: the three state files created in Task 1 and the existing repository rules in `AGENTS.md`.
- Produces: an instruction section that tells every future agent exactly when to read, update, repair, and trust each state file.

- [ ] **Step 1: Re-read the current `AGENTS.md` before editing**

Preserve the existing rules and all user changes. Add the new section at the
end of the file so it does not alter the meaning or ordering of the existing
planning, change, database, testing, or UI instructions.

- [ ] **Step 2: Append the continuity rules**

Append this exact section to `AGENTS.md`:

```markdown
## AGENT STATE CONTINUITY

The repository state for future agent sessions lives in `.agent-state/`:

- `.agent-state/project-state.md` contains stable product, stack, architecture, key-path, integration, and verification facts.
- `.agent-state/memory.md` contains durable decisions, conventions, discoveries, and known gotchas.
- `.agent-state/left-off.md` contains the current objective, progress, changed files, verification, blockers, and exact next action.

- At the start of every session or new task, read all three state files before exploring or changing the codebase.
- Treat source code, configuration, and tests as the source of truth. If they conflict with state notes, verify the repository and correct the notes.
- Update `left-off.md` after meaningful implementation checkpoints, failed verification, blockers, or changes in direction.
- Update `project-state.md` when product status, architecture, stack, key paths, or integrations change.
- Update `memory.md` when a decision, convention, discovery, or gotcha should survive beyond the current task.
- Before ending a session or handing work to another agent, record verified results, unresolved issues, and one exact next action in `left-off.md`.
- Keep state entries concise and dated. Never write secrets, credentials, wallet keys, tokens, private user data, generated build output, caches, or temporary files.
- If a required state file is missing, recreate it using the file contracts above.
- If a state note is stale or unknown, verify it against the repository and update the note instead of inventing a result.
- Preserve existing user changes in a dirty worktree; never clean or revert them merely to make the handoff look tidy.
```

- [ ] **Step 3: Review the focused diff**

Run:

```bash
git diff -- AGENTS.md
```

Expected: the diff contains the new continuity section and does not remove or
rewrite any existing rule. Keep the existing spelling and line-ending behavior
outside the added section.

## Task 3: Verify the Setup Without Touching Existing Work

**Files:**
- Inspect: `.agent-state/project-state.md`
- Inspect: `.agent-state/memory.md`
- Inspect: `.agent-state/left-off.md`
- Inspect: `AGENTS.md`
- Inspect: `.gitignore`
- Do not modify: existing application files, package files, or existing user changes

**Interfaces:**
- Consumes: the completed state contract and repository instructions from Tasks 1 and 2.
- Produces: verified documentation setup with no ignored state files, whitespace errors, or application regressions attributable to the setup.

- [ ] **Step 1: Confirm state files are not ignored**

Run:

```bash
git check-ignore -- .agent-state/project-state.md .agent-state/memory.md .agent-state/left-off.md
```

Expected: no output and exit status `1`, meaning no state file matches an
ignore rule. Do not add an ignore rule to make the command pass.

- [ ] **Step 2: Check Markdown and instruction whitespace**

Run:

```bash
git diff --check
```

Expected: exit status `0`. Existing Git line-ending warnings are informational;
they are not a reason to rewrite unrelated files.

- [ ] **Step 3: Confirm the focused file set**

Run:

```bash
git status --short -- AGENTS.md .agent-state docs/superpowers/specs/2026-09-17-agent-state-continuity-design.md
```

Expected: `AGENTS.md` is modified, the three state files and approved design
spec are untracked additions, and no application or package file appears in
this focused result. Existing unrelated worktree changes remain untouched.

- [ ] **Step 4: Run the repository quality checks**

Run each command from the repository root:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

Expected: each command exits successfully. If an existing application change
causes a failure, report the exact command and error without changing unrelated
source as part of this documentation-only setup.

- [ ] **Step 5: Refresh the handoff after verification**

Update `.agent-state/left-off.md` so that:

- `Current objective` says the state continuity setup is installed.
- `Completed` lists the three files, the `AGENTS.md` section, and the checks that passed.
- `In progress` says `None` when no setup work remains.
- `Verification` contains the actual results of `git diff --check`, `git check-ignore`, lint, TypeScript, and build.
- `Blockers` says `None` only if the commands and file inspections found no blocker.
- `Next action` names the next real project task or says `No follow-up is required for the state setup` if the user has not supplied another task.

- [ ] **Step 6: Review without committing**

Run:

```bash
git diff --check
git status --short
```

Confirm that only the intended continuity files were added or modified by this
plan and that existing user changes remain present. Do not commit or push unless
the user explicitly requests it.

## Self-Review Checklist

- [ ] Every requirement in `docs/superpowers/specs/2026-09-17-agent-state-continuity-design.md` maps to Task 1, Task 2, or Task 3.
- [ ] The three state files have distinct responsibilities and fixed paths.
- [ ] `AGENTS.md` instructs agents to read state before work and update the correct file at each lifecycle event.
- [ ] Missing files, stale conflicts, unknown status, sensitive information, dirty worktrees, and generated artifacts have explicit handling.
- [ ] The plan introduces no source, dependency, runtime, hook, or `.gitignore` changes.
- [ ] All verification commands and expected outcomes are concrete.
- [ ] The plan contains no secret values or unresolved design decisions.
