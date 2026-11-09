# B9 wallet and payment UX design

## Selected shape

- Keep `useProvidusWallet` as the wallet boundary and add a registry-derived network view beside its existing Celo-only readiness state.
- Configure all three B1 chain objects in wagmi. Initial connect stays on the wallet's current chain. Only a network-row click requests `switchChainAsync`.
- Read the displayed chain from wagmi/provider confirmation. Do not keep an optimistic selected chain. Keep native balance queries scoped to the observed account and chain. Keep USDC Celo-only.
- Share one auth controller below `WalletProviders` so the header, wallet menu, and assistant show the same server-verified session and in-flight signature state. Session-probe 401s are expected unauthenticated results; protected 401s still expire the session. Network changes alone do not reauthenticate under current server policy.
- On wallet account changes, clear prior-owner recipient/chat drafts and invalidate pending work. Preserve submitted payment and recovery evidence.
- Keep the existing review card and execution route. A chain or owner change invalidates the plan and gas, never the B5 hash/unknown state. BOT Mainnet 677 stays connectable and switchable while the existing execution hard gate remains active.
- Keep the existing desktop popover and mobile sheet. Make active status, unsupported/manual state, errors, and unavailable balances explicit without changing the design system.

## Cross-judgment findings

- Chosen from candidate A: a shared auth controller, bounded account/request revisions, normalized wallet ownership, and a stable hydrated trigger.
- Chosen from candidate B: registry-based wallet menu, chain-specific balance/explorer, clear unavailable state, and the 0.01 BOT Testnet starter.
- Grafted: do not pass Celo as the connect target; injected connectors already handle the ordinary 4902 add-chain flow; do not auto-prompt a second time after an ambiguous add result; bound slow wallet feedback without pretending the chain changed; preserve owner-keyed payment recovery.
- Rejected: a second bespoke add-chain prompt on the normal 4902 path, optimistic network state, chain-keyed remounting of the review card, and chain-switch-triggered logout.

## Done predicate

- Celo 42220, BOT Mainnet 677, BOT Testnet 968, and unsupported-chain display have regression coverage.
- Switch attempts are explicit, singular, and verified against the wallet's resulting chain. The menu shows the current chain's explorer and native balance only.
- Auth, assistant, review, and recovery preserve server ownership and B5/B6 behavior.
- Mainnet execution remains rejected. No transaction, migration, production write, push, or deployment is used for verification.
- Requested tests and quality checks pass. Desktop/mobile evidence comes from a fake wallet in an isolated server with `DATABASE_URL` empty.

