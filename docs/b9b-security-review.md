# B9B — ProvidusPay focused security review (testnet-verified code, mainnet lens)

Status: review only. **No independent professional audit has occurred.** Slither
could not be installed in this environment (ckzg wheel build failure on
Python 3.15); substituted with solc 0.8.24 diagnostics (clean), 14 targeted
Hardhat security tests, exact on-chain behavior proof on testnet, and the
line-by-line review below. Do not describe this as an audit.

## Scope

`contracts/ProvidusPay.sol` (69 lines, OZ 5.6.1: ReentrancyGuard, Ownable,
SafeERC20), deployed testnet `0xbc629870…5B7a4`, plus `scripts/` deploy
tooling. No other contracts exist in the product.

## Findings

1. **Reentrancy — PASS.** Both entry points `nonReentrant`; `usedIntents`
   set before any external call; native forward is the last state-changing
   step. Malicious receiver + malicious ERC-20 re-entry covered by tests.
2. **Native forwarding — PASS with noted behavior.** `call{value}` to an
   arbitrary recipient; a hostile receiver fallback can burn gas and revert
   (sender's tx fails, funds stay put — no loss). No pull pattern possible
   for native without custody; accepted.
3. **ERC-20 pull — PASS.** `safeTransferFrom(msg.sender → recipient)`;
   handles non-standard return values; zero-amount and zero-recipient
   rejected; non-payable function rejects stray native value at EVM level.
4. **Owner privileges — ACCEPTABLE WITH TRUST NOTE.** Only `setTokenAllowed`;
   no withdraw, no pause, no upgrade. Residual risk: owner can allowlist a
   malicious token (affects only future opt-in use, never existing funds).
   Recommendation before mainnet: transfer ownership to a multisig or add
   a timelock; never keep a hot EOA as permanent owner.
5. **Replay — PASS.** `usedIntents[payer][intentId]`, single namespace across
   both functions; verified on-chain (`usedIntents(...) == true` post-payment).
6. **Deadline — PASS.** `deadline >= block.timestamp`; unbounded upper end is
   standard; intent expiry is enforced off-chain at plan time and re-checked
   by the B5 verifier against stored terms.
7. **Fee-on-transfer tokens — FAIL-CLOSED BY DESIGN.** A fee token would emit
   a short `Transfer`; the B5 verifier demands exact units and rejects.
   Documented; do not allowlist fee tokens.
8. **Forced native deposits — ACCEPTED RESIDUAL.** `selfdestruct`-forced BOT
   would be stuck (no rescue). No product flow sends to the contract except
   as `msg.value` inside a verified payment. Dust risk only.
9. **Deployer/admin keys — PROCESS RISK.** Testnet key lives in gitignored
   local `.env` (never committed). Mainnet MUST use a separate dedicated
   account; never reuse testnet/escrow/x402 keys. No key material in repo,
   logs, or artifacts (verified by scan).
10. **Gas/failure behavior — PASS.** Deployment ~1.25M gas; payNative ~66k
    measured; OOG/revert reverts atomically with no partial state (single
    external call per function).

## Testnet evidence backing this review

- 14/14 Hardhat security tests (replay per payer, cross-payer same intent,
  expired, invalid, unsupported token, failing token, malicious receiver,
  malicious token, no retained balance, owner-only allowlist).
- Live 0.01 BOT payment verified field-by-field by the B5 verifier
  (`confirmed / VERIFIED_ONCHAIN`, 2603+ confirmations).

## Pre-mainnet must-dos

1. Multisig (or timelock) ownership plan; no permanent hot-EOA owner.
2. Slither (or equivalent) static-analysis pass in an environment where it
   installs; record output here.
3. Commit or archive the solc build-info for reproducible verification.
4. Resolve scan.botchain.ai source verification (testnet Blockscout +
   Sourcify both blocked: generic reject / chain unsupported).
5. First mainnet movements: tiny native test, then tiny USDT test, each
   B5-verified before any larger amount.
