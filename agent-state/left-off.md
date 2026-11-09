# Left Off — B9 wallet UX hotfix

## What we are doing
- Finish the focused B9 frontend slice from `.audit/b9-ux-hotfix.todo.md`.
- Keep mainnet payment execution hard-gated. No push, deploy, migration, production write, or new payment transaction.

## Done
- Read current project state, UI system, skills, and wallet/auth/assistant/review flows.
- Cross-judged two independent designs. Decision and risks are in `.audit/b9-ux-hotfix-design.md`.
- Baseline `npm run test:all`, `npx tsc --noEmit`, and `npm run lint` all pass before source edits.
- Added `test:wallet-network`, wired into `test:all`. It covers B1 metadata, mocked add/switch/rejection/disconnect/RPC outcomes, auth states, and stale reviews. It passes; no real wallet or transaction was used.
- Existing connected-wallet browser tab and dev server were left untouched.

## Next
1. Wire the tested network and auth models into the wallet hook, provider, menu, and assistant.
2. Implement safe owner cleanup and chain-bound review invalidation, then clarify assistant/payment states.
3. Verify with a fake wallet on an isolated server with `DATABASE_URL` empty, capture desktop/mobile images, then run the full requested checks.
4. Review exact diff, update state/audit, and commit locally without push.

## Worktree and risks
- Preserve pre-existing untracked `.omp/`, `bridge/`, and `video-demo/` content.
- Existing `npm run dev` server at port 3000 may use live environment values. Do not use it for mock-wallet auth/browser tests or stop it without need.
- Never remount the payment review card on chain change. Preserve B5 hash and unknown-broadcast recovery.
