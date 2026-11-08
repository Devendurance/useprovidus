# Left Off — resume here

## B8 complete, 2026-11-08
- B8 public positioning is complete. Stop after B8. No push, deploy, mainnet execution, production database write, or migration.
- Done: shared Celo/BOT availability registry, homepage repositioning, network cards, dashboard copy, trust walkthrough, assistant prompts, navigation, footer partner acknowledgement, metadata, README, and product messaging.
- Done: official BOT Chain wordmark and links to the official website, mainnet explorer, and Testnet explorer. BOT mainnet and BOT-funded utilities remain clearly gated for B9 or later verification.
- Done: browser screenshots in `docs/b8-evidence/`, B8 positioning report, and focused source self-check. Desktop/mobile surfaces have no observed horizontal overflow in the tested dashboard and trust layouts.
- Verification passed: `npm run test:all`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `git diff --check`. B7 fixture browser scenario still passes with simulated signing and no funded broadcast.
- Checkpoint: local commit `79b3556 feat: position Providus across Celo and BOT Chain`. The remaining B1-B7 dirty/untracked tree is preserved outside this commit. Next is the final report with production environment blockers and B9 readiness. Do not push or deploy.

## B7 supersedes the historical notes below, 2026-11-08
- Doing B7 frontend wallet payments. Stop after B7. No push/deploy/prod DB writes or migrations.
- HEAD at start `52ff058`. B1-B6 and unrelated files were already dirty/untracked. Preserve them. Scope is in `.audit/b7.todo.md`.
- B7 source checkpoint is `503160c`. A small continuity commit records this hash. No commits were pushed.
- Done: authenticated session read, testnet-only execution endpoint, B6 actions, SIWE UI, recipient flow, stored review, explicit wallet send, B5 receipt/status, uncertain/hash recovery and gated ERC-20 approval UI/helper.
- Done: B6 save-refusal and stored cancellation regressions fixed. B7 consent/execution/HTTP/ERC-20 UI checks and B6 rerun pass. Full `npm run test:all` passes, including Celo and 14 contract tests. Default `npm run build` passes. Final source review gives qualified PASS.
- Browser scenario passed with actual local SIWE signatures and simulated payment/receipt. It preserved the Celo draft, tested rejected signing, full-address review, registration failure, reload recovery, mobile overflow and wallet switching. Screenshots are in `docs/b7-evidence/`.
- Browser limitations: no real funded extension transaction, no live verified testnet receipt. A hydration warning occurred during injected-wallet reconnection. Production database was disabled in all browser/HTTP smokes. Dev/fixture/browser processes stopped.
- Final standalone tsc, lint and staged/unstaged diff checks pass after cleanup. B7 is complete within the signing-boundary test limit. Stop after B7, await a new milestone instruction.
- Existing dirty backend files remain in working tree. `.audit/b7-existing-backend-edits.patch.b64` preserves only B7 edits inside them, avoiding inclusion of the pre-existing B1-B6 baseline in the local commit.

Updated: 2026-09-21, HEAD `4e6a0e5` (P6.10–P6.14 committed; P6.14D deploy+smoke PASSED, no mutation).

## Where we are
- P6.10–P6.14 are COMMITTED (`4e6a0e5 feat: checkpoint Providus P6.10-P6.14`, 45 files). The old "uncommitted P6.10" state from 2026-09-20 is resolved — do not treat it as dirty.
- Worktree has ONE modified file: `AGENTS.md` (expanded rules: source-of-truth, planning/change modes, safety boundaries, DB policy, testing, milestone execution, state continuity). Uncommitted — do not lose.
- Untracked: `agent-state/` (this folder), `.omp/` (session artifact), `bridge/trusted-read-01`, `bridge/trusted-read-04`.
- P6.14D complete: production `https://useprovidus.vercel.app` smoke-passed, REAL USER SPRINT READY: YES. No live payment performed; AskBots not run.
- No M9/next-milestone prompt has been issued. Per sprint rules, next is data bundles (P7) ONLY if airtime is stable — do not assume; wait for user's explicit milestone instruction.

## First actions in the new session
1. Read `agent-state/project-state.md`, `agent-state/memory.md`, and this file.
2. Run `git status --short` and `git log --oneline -5` to confirm the tree above is intact.
3. Run health check: `npx tsc --noEmit`, `npm run lint`, `npm run test:all`.
4. Then ask the user for the next milestone prompt (or proceed if already pasted).

## Known risks / do-not-touch
- Local `.env` holds live credentials (gitignored). Never print values. Rotate if the workspace/logs are ever shared.
- Prior live tx `tx_48b9c6d0…` (`completed`) and failed tx `tx_45713ee2…` must remain untouched.
- `app/receipt/receipt-client.tsx` has a history of line-patch JSX fragility — re-verify with `tsc` after any edit.
- `hooks/use-transaction-status.ts` previously had an options-identity polling loop; confirm terminal-halt + stable-deps are still present before touching polling.
- `bridge/` and `.omp/` contents are unverified artifacts — inspect before trusting or deleting.

## What "next" likely is
Build plan order suggests P7 data bundles — but DO NOT assume. Sprint gate requires airtime stable first. Wait for the user's explicit milestone prompt.
