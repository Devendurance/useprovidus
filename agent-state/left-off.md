# Left off: P0.1 compact payment UX complete

## What we are doing
- P0.1 compact payment conversations and single-next-action UI are complete. Next is P0.2 receipt history and evidence modal.
- Public BOT Mainnet activation is complete at `7820480` for native BOT and Official USDT. BOT Testnet is hidden/disabled publicly. Celo remains intact.

## Done
- Commits `af13af3`, `c84da3f`, and `aa5b75d` add the compact status-driven cards, allowance-first flow, B5 precedence fix, recoverable pending/unknown UI, and verified cleanup. The allowance action stays hidden until its initial read completes.
- Verified card shows amount, recipient, network, status, and `View receipt`. Hash, contract, chain, gas, and evidence remain in a disclosure. Obsolete approval/retry/recheck actions are removed after verification.
- Captured synthetic-fixture Playwright screenshots at desktop and 390px mobile in `output/playwright/`.
- Updated `.fast-build/STATE.md`, `agent-state/project-state.md`, `agent-state/memory.md`, and AGENTS.md for current public status and P0.1.

## Next
1. Start P0.2 with searchable receipt history and responsive receipt detail. Support outside click, Escape, focus trap/restoration, copy hash, explorer link, and separate token approval records.
2. Reuse existing B5 and Celo persistence. Do not migrate without explicit review, backup/restore planning, and verified wallet isolation.

## Verification
- P0.1 resolver, assistant, web-execution, submission, verification, Mainnet policy, chain, wallet/network, Celo attribution, and ERC-20 UI self-checks pass.
- Playwright synthetic fixture asserts verified summary cleanup, receipt navigation, keyboard reachability, and no 390px horizontal overflow. Screenshots are local fixtures, not chain evidence.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` with `DATABASE_URL` unset, and `git diff --check` pass.
- No database migration/write, real wallet signature, transaction, push, or deploy occurred. Full wallet signing E2E and P0.2 modal behavior remain.

## Worktree and risks
- Preserve pre-existing untracked `.omp/`, `bridge/`, and `video-demo/` folders. `output/playwright/` contains this slice's requested screenshots.
- Do not change payment gates, run migrations, write production data, push, deploy, or initiate real transactions as part of P0.1.
