# Left Off — B9 wallet UX hotfix

## What we are doing
- Finish the focused B9 frontend slice from `.audit/b9-ux-hotfix.todo.md`, then stop.
- Keep mainnet payment execution hard-gated. No push, deploy, migration, production write, or new payment transaction.

## Done
- Read current project state, UI system, skills, and wallet/auth/assistant/review flows.
- Cross-judged two independent designs. Decision and risks are in `.audit/b9-ux-hotfix-design.md`.
- Baseline `npm run test:all`, `npx tsc --noEmit`, and `npm run lint` all pass before source edits.
- Added `test:wallet-network`, wired into `test:all`. It covers B1 metadata, mocked add/switch/rejection/disconnect/RPC outcomes, auth states, and stale reviews. It passes; no real wallet or transaction was used.
- Wired all three registry networks into wagmi and the wallet dropdown. Connect no longer forces Celo. Network rows switch explicitly and show provider-confirmed state, balances, explorers, manual setup, and network availability.
- Added shared auth UI state, normalized wallet matching, stale-request suppression, owner-bound assistant draft clearing, and immediate plan/gas invalidation on account or chain events. Chain switches don't force logout under current server owner policy.
- Updated assistant examples, BOT review steps/status, and Celo airtime chain gating. 677 remains switchable and blocked at execution.
- Full `npm run test:all` passes, including `test:web-execution` for the mainnet hard gate. `npx tsc --noEmit`, `npm run lint`, and `git diff --check` pass.
- Existing connected-wallet browser tab and dev server were left untouched.

## Next
1. Commit the implementation and state checkpoint locally.
2. Build and run the UI in an isolated worktree with `DATABASE_URL` empty. Use a mocked provider for desktop and mobile wallet-menu screenshots and negative UI checks.
3. Inspect browser console/Next overlay, save screenshots under `.audit`, run final `npm run build` and `git diff --check`, then update state/audit and commit any corrections locally.
4. Stop without push, deploy, migration, database write, or transaction.

## Worktree and risks
- Preserve pre-existing untracked `.omp/`, `bridge/`, and `video-demo/` content.
- Existing `npm run dev` server at port 3000 may use live environment values. Do not use it for mock-wallet auth/browser tests or stop it without need.
- Never remount the payment review card on chain change. Preserve B5 hash and unknown-broadcast recovery.
