# B9 wallet and payment UX hotfix

- [x] Read the Principles section of the poteto-mode skill.
- [x] Phase A: Frame
  - [x] Define the done predicate from the existing B1/B5/B7 controls.
  - [x] Record scope, risk, blockers, and the pre-change baseline.
- [x] Phase B: Design the workflow
  - [x] Trace wallet, auth, assistant, and review flows before editing.
  - [ ] Build or extend the focused regression harness before fixes.
  - [x] Keep one source owner because the wallet and payment UI share state.
  - [x] Keep network selection independent from payment execution capability.
- [ ] Phase C: Run the loop
  - [ ] Verify each focused unit before starting the next.
  - [ ] Implement wallet network details and confirmed wagmi switching.
  - [ ] Correct auth transitions and clear wallet-bound state safely.
  - [ ] Clarify assistant and payment review/status copy.
  - [ ] Capture desktop and mobile wallet-menu screenshots.
- [ ] Phase D: Keep the audit trail
  - [ ] Log decisions and evidence in `.audit/b9-ux-hotfix.tsv`.
- [ ] Phase E: Verify and hand back
  - [ ] Run all requested tests, typecheck, lint, build, and diff checks.
  - [ ] Review the complete diff and confirm mainnet remains gated.
  - [ ] Update project state and local AGENTS rules.
  - [ ] Commit the local checkpoint without pushing or deploying.

## Throughput checkpoint

- Blocking first steps: complete. Read-only flow tracing is documented and the baseline test/type/lint run passes.
- Independent workstreams: wallet network controls, wallet authentication, and assistant/payment review can be audited separately; code changes stay with one owner.
- Shared mutable state: one owner writes the application and tests, so auth/session and review state changes cannot race in the shared checkout.
- Smallest safe decomposition: one local feature slice keeps chain selection, auth, and execution gating aligned and makes regression review coherent.

## Design checkpoint

- Selected shared auth ownership from candidate A and B's registry-backed network menu. Independent cross-judgment is in `.audit/b9-ux-hotfix-design.md`.
- Baseline `npx tsc --noEmit` and `npm run lint` pass. `npm run test:all` is still running. The existing wallet-connected browser session and dev server remain untouched because they may contain live state.
- First regression step is a mockable pure switch/auth harness. No wallet/provider action has been sent.
- Baseline `npm run test:all` passed, including the existing B5/B6 self-checks and 14 contract tests. No source changes were made for this baseline.

## Done predicate

- Wallet UI uses the B1 registry for Celo 42220, BOT Mainnet 677, and BOT Testnet 968, and shows the confirmed active chain, explorer, and native balance.
- Network switching uses the active wagmi connector, handles add/switch failures, and changes displayed state only after chain confirmation.
- Auth and account changes preserve owner boundaries and expose the correct user-facing state.
- Assistant and review/status UI explain the next action without changing B5/B6/B7 execution semantics.
- BOT Mainnet payment execution remains hard-gated, and no transaction is broadcast during verification.
- Requested test, typecheck, lint, build, and diff commands pass. Desktop and mobile wallet-menu evidence is captured.
- No push, deployment, production database write, migration, or paid transaction occurs.
