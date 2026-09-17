# Agent State Continuity Design

**Date:** 2026-09-17  
**Status:** Design approved; implementation pending

## Context

This repository is a Next.js application for Providus. It already has project
documentation for the product, architecture, integrations, and visual system,
but it has no standard place for short-lived agent handoff context or durable
engineering memory. The repository also contains existing uncommitted user
changes that must remain untouched.

The chosen approach is a small, Git-tracked Markdown contract. It does not add
runtime behavior, dependencies, hooks, or an application state store.

## Goals

- Let a fresh agent recover the current project context quickly.
- Separate stable project facts, durable decisions, and the current handoff.
- Make state maintenance an explicit `AGENTS.md` workflow.
- Keep the state portable across branches, clones, and future sessions.
- Keep the files concise enough to review and correct in Git.

## Non-Goals

- Build an automatic semantic state generator.
- Store a complete transcript or append-only activity log.
- Duplicate the existing PRD, architecture, or design documentation.
- Store secrets, credentials, wallet keys, tokens, or private user data.
- Change application behavior or add a runtime dependency.

## State Directory

Create a tracked directory at `.agent-state/` in the repository root. It will
contain exactly three canonical files:

| File | Responsibility | Update frequency |
| --- | --- | --- |
| `project-state.md` | Stable product, stack, architecture, paths, integrations, and high-level status | When stable project facts change |
| `memory.md` | Durable decisions, conventions, discoveries, and recurring gotchas | When future work would benefit from the information |
| `left-off.md` | Current objective, progress, changed files, verification, blockers, and next action | At meaningful checkpoints and before handoff |

The files use relative links to authoritative repository documents where useful
instead of copying their full contents.

## File Contracts

### `project-state.md`

Use these sections:

- `Last updated`
- `Product`
- `Current status`
- `Stack`
- `Architecture`
- `Key paths`
- `Integrations`
- `Verification`

Seed this file from the existing Providus PRD, architecture document,
`package.json`, and repository structure. Record only confirmed facts.

### `memory.md`

Use these sections:

- `Last updated`
- `Decisions`
- `Conventions`
- `Discoveries`
- `Known gotchas`

Entries use dated headings and describe information that is likely to matter in
a later session. Remove or revise information that is disproven.

### `left-off.md`

Use these sections:

- `Last updated`
- `Current objective`
- `Completed`
- `In progress`
- `Changed files`
- `Verification`
- `Blockers`
- `Next action`

This file is a concise handoff, not a chronological log. Replace stale task
details at each checkpoint and always finish with one concrete next action.

## `AGENTS.md` Workflow

Add an `Agent State Continuity` section to the repository instructions with the
following behavior:

1. At the start of every session or new task, read all three files before
   exploring or changing the codebase.
2. Treat source code, configuration, and tests as the source of truth. If they
   conflict with state notes, correct the notes after verifying the code.
3. Update `left-off.md` after meaningful implementation checkpoints, failed
   verification, blockers, or changes in direction.
4. Update `project-state.md` when product status, architecture, stack, key
   paths, or integrations change.
5. Update `memory.md` when a decision, convention, discovery, or gotcha should
   survive beyond the current task.
6. Before ending a session or handing work to another agent, record verified
   results, unresolved issues, and the exact next action in `left-off.md`.
7. Keep all state entries concise, date them, and never include secrets or
   generated build output.
8. If a required state file is missing, recreate it using its file contract.
9. Preserve existing user changes; do not clean or revert a dirty worktree just
   to make the handoff look tidy.

## Session Flow

The intended flow is:

1. Read `AGENTS.md` and the three state files.
2. Use the handoff and project state to focus repository exploration.
3. Implement and verify the requested work.
4. Record checkpoint-specific progress in `left-off.md`.
5. Record durable decisions or discoveries in `memory.md`.
6. Refresh `project-state.md` only when its stable facts changed.
7. Leave one actionable next step for the next session.

When state notes are stale, the agent should update them as part of the same
checkpoint rather than creating a second competing source of truth.

## Failure Handling

- **Missing file:** Recreate the file with its required headings and current
  confirmed information.
- **Conflicting note:** Verify against code, configuration, and tests, then
  correct the state note.
- **Unknown status:** Mark it as unknown and identify how it can be verified;
  do not invent a result.
- **Sensitive information:** Remove it and retain only a safe reference such
  as an environment-variable name.
- **Dirty worktree:** Document relevant existing changes in `left-off.md` and
  leave them intact.
- **Generated artifacts:** Exclude build output, caches, and temporary files
  from state notes.

## Verification

The implementation is complete when:

- `.agent-state/project-state.md`, `.agent-state/memory.md`, and
  `.agent-state/left-off.md` exist and follow their contracts.
- `AGENTS.md` tells a fresh agent when to read and update each file.
- The initial state matches confirmed repository facts and links to existing
  documentation instead of duplicating it.
- `.agent-state/` is not ignored by Git.
- `git diff --check` reports no whitespace errors.
- No source files, package dependencies, or runtime behavior change as part of
  the setup.

Because this is a documentation-only workflow change, no application test
cases are added. The repository's normal lint, type-check, and build commands
remain the verification requirement for future code changes, as already
specified in `AGENTS.md`.

## Planned Implementation Changes

After this spec receives final user review, implement only:

- Add the three `.agent-state/` Markdown files with current project context.
- Add the workflow section to `AGENTS.md`.
- Do not modify `.gitignore`, application code, package manifests, or existing
  project documentation unless required to correct a factual state reference.
