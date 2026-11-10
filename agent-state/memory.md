## P0.2 receipt and evidence invariants, 2026-11-10
- Receipt API ownership comes from authenticated `requireOwner`; list and detail reads must never accept client-selected owners.
- Existing BOT B5 and Celo ledgers do not persist actual gas. Celo receipt rows omit a full recipient address. Display unavailable for absent fields.
- BOT Verified requires B5 `confirmed` and `verifiedAt`. Celo records retain their own status vocabulary.
- Approval transactions are not payment receipts and there is no durable approval ledger. Do not invent approval rows or apply a migration without explicit review and backup/isolation planning.
- Keep mobile modal dismissal reachable through X, Escape, and outside click, with focus restoration and background scroll lock.
# Providus — Memory (decisions, invariants, lessons)

## P1.1 conversation session invariants, 2026-11-10
- Keep `conversation_sessions` and `conversation_messages` separate. Derive ownership only from verified SIWE claims, and enforce `(session_id, owner_address)` with the composite foreign key.
- Persist plain text and safe retry state only. Do not store payment intents, signatures, approvals, receipt ledgers, or wallet secrets in conversation tables.
- Session-create request IDs and turn IDs are idempotency keys. Attempt leases and compare-and-set completion reject duplicate or stale replies.
- Conversation restore is text-only. Returning to a payment request must create a fresh B3 intent and require fresh review plus wallet authorization.
- `openConversation()` must reset old transient state before creating its new abort controller. Older-message responses must match owner revision, active session, load revision, and abort state.
- Migration `0007` was tested only in disposable local Postgres. Production release needs a reviewed backup, tested restore, rollback plan, and separate authorization.
- P1.1 stores no structured receipt pointer. Receipts remain in their existing owner-scoped ledger and navigation; P1.2 shared memory is unstarted.

## Mainnet activation and payment UX invariants, 2026-11-10
- Native BOT and Official USDT transactions on BOT Chain Mainnet have verified evidence. Their hashes are recorded in `agent-state/project-state.md`.
- Public BOT Chain Mainnet activation is complete at commit `7820480` for native BOT and Official USDT. BOT Testnet is hidden and disabled publicly. Celo remains intact.
- BOT-funded utility payments are not live without independently verified settlement and provider delivery.
- Use `BOT_MAINNET_STATUS` in `lib/product/positioning.ts` for current public availability labels. Do not reintroduce a Mainnet block based on pre-activation B8/B9 notes.
- Mainnet payment approvals and transfers stay separate wallet actions where ERC-20 allowance is required. B5 confirmed plus `verifiedAt` is the only verified payment UI state.
- Compact payment UI derives its state from persisted B3/B5 status and current wallet/review facts. Never let transient local flags override submitted, unknown, failed, or verified B5 evidence.
- Read exact USDT allowance before exposing its approval action. Approval requests the exact amount and never authorizes payment. The payment needs a separate explicit wallet confirmation.
- Do not add chat, message, memory, gas, or approval schema without explicit review, backup and restore planning, and wallet-isolation proof.
- Keep conversation sessions, conversation messages, saved recipients, memory facts, Celo transactions, and BOT transfer submissions as distinct data concepts.

## B9 wallet UX invariants, 2026-11-09
- Keep B1 registry metadata authoritative for 42220, 677, and 968. A recognized/switchable network does not grant payment capability.
- Do not force Celo during connect. Network changes require an explicit user action and provider-confirmed resulting chain.
- Keep SIWE owner checks and the existing chain-binding policy. An expected unauthenticated session probe must not dispatch expiry during a pending signature.
- Account changes clear old-owner drafts and stale results, while submitted or unknown payment recovery remains recoverable. Chain changes invalidate only unsigned plan/gas state.
- BOT Testnet success still requires B5 independent receipt verification. A submitted hash is verifying until verified.
- Pre-change checkpoint: full self-check suite, TypeScript, and lint all passed on the B8 tree.
- The B9 mock-wallet self-check uses provider method responses and asserts no `eth_sendTransaction` occurs during switching.
- Wagmi chain/account watchers bump a review-context revision on real provider changes. Wallet transfer plans and gas must match address, authenticated owner, chain, intent fingerprint, and revision before review or execution.
- Injected connectors may add an unrecognized configured B1 chain after 4902. Retry `switchChainAsync` once only when wagmi reports its exact accepted-add-but-not-selected marker. A user rejection never triggers another prompt.
- Celo cash-out and airtime still require chain 42220. The payment card now offers an explicit Celo switch before a Celo transaction can be submitted.
- `test:all` must include `test:web-execution` so the 677 hard gate stays covered even though unsigned internal plan-builder tests can exercise mainnet metadata.
- Network balance eligibility follows the wagmi provider connection, not the app's Celo-only normalized connection status. Otherwise supported BOT chains can appear connected while their native balance query stays disabled.
- The dashboard renders multiple wallet triggers. Opening one panel must close the other instance, and mobile panel positioning must not inherit desktop anchor coordinates.

## B8 invariants, 2026-11-08
- Public positioning uses one shared registry. Celo is live for existing supported services. BOT Chain is verified on Testnet for native BOT recipient transfers on chain 968. BOT mainnet remains pending B9.
- BOT-funded airtime, data, electricity, cable, and other utilities are roadmap items until an independently verified settlement route and provider fulfilment path exist.
- Official partner links are `https://www.botchain.ai`, `https://scan.botchain.ai`, and `https://scan.bohr.life`. The local logo is sourced from the official BOT Chain site.
- B8 changes are content, navigation, metadata, and partner acknowledgement only. Payment execution, Celo settlement, Paycrest, ClubKonnect, schema, and production state remain unchanged.
- Browser evidence covers desktop/mobile public surfaces and preserves the B7 signing-boundary fixture limitation. It does not claim a funded live BOT transaction or a live mainnet receipt.

## B7 invariants, 2026-11-07
- User's B7 scope overrides automatic push. No deploy, production writes or migrations through 0006.
- Wallet connection and SIWE authentication are separate. Only the verified session establishes transfer ownership. Client owner context may narrow access, never establish it.
- Full wallet addresses must be displayed during recipient confirmation and payment review. This overrides historical address truncation guidance for these owner-only views.
- Native BOT payments use chain 968 and canonical ProvidusPay `0xbc6298701490ba211733F2Dc28deB7Df9835B7a4`. Mainnet plan/submission remains blocked until B9.
- Fresh stored-intent execution plan immediately precedes explicit review-card signing. Assistant actions and chat acknowledgements never authorize a transaction.
- Wallet hash is retained before fallible local persistence/registration. Uncertain broadcast survives refresh and blocks resend. B5 confirmed plus verifiedAt is required for success.
- Save consent uses narrow affirmative phrases. Broad matching for the word save incorrectly accepted 'do not save', reproduced and fixed by B7 regression.
- Browser proof uses an empty ephemeral SIWE account and isolated memory payment fixtures. A simulated verified receipt must never be described as live chain proof.
- Store generated Playwright CLI output outside the checkout to avoid development refresh loops. Prewarm local auth routes before a memory-backed SIWE test so recompilation does not invalidate its nonce.
- The existing B1-B6 baseline was already dirty/untracked before B7. The local B7 checkpoint includes a base64 recovery patch for B7 edits inside those files, without absorbing the full baseline.

## Non-negotiable invariants
- LLM owns language; deterministic code owns money. Model never authorizes, mutates provider state, or decides success.
- Paycrest `validated`/`settled` = fiat delivered. `fulfilled`/`fulfilling`/`pending` alone are NEVER fiat delivery.
- Only numeric ClubKonnect `200` completes airtime. 100/300 = processing, 201/unknown/timeout = reconciliation-required, 417 = failed (`PROVIDER_FLOAT_EXHAUSTED`). Never invent refunds.
- Preview freezes NGN + base USDC only. Paycrest order authoritatively binds `senderFee`/`transactionFee`/`totalUsdcToSend`. Never hardcode fee percentages.
- One Paycrest order per preview; one ClubKonnect purchase per transaction (`fulfilment_attempts` 0→1, one-shot claim). Unknown outcome ⇒ query same RequestID, never re-purchase.
- Deterministic RequestID: `ck` + sanitized prefix + 12-hex sha256, ≤32 chars. Missing/mismatched response RequestID ⇒ unknown/reconcile, never complete.
- Preview: 5-min TTL, single-use, wallet-bound, fingerprint-bound, atomically consumed.
- Non-custodial: no private-key/server signing ever. Browser wallet only, explicit click only.
- Never expose secrets, full bank details, credential URLs, or full PII. Mask phones (`*******6560`), truncate addresses/hashes.

## Architecture lessons (earned)
- `resolveAssistantTurn`: status query first, then deterministic confirmation fast-path (closed affirmative vocabulary), then LLM. Simple "yes" must never cost an LLM round-trip.
- `instructionsFromBoundTransaction` is the single "is this row payable?" authority — reused by POST prepare/replay and GET rehydration. No duplicated fee logic.
- Rehydration (`GET /api/transactions/[id]?paymentInstructions=true&walletAddress=`): explicit-null contract (`null` on refusal, `PAYMENT_ORDER_EXPIRED` only with full ownership proof). Opted-in reads skip all reconciliation (`fetchCalls===0`).
- Wallet mismatch semantics: malformed/missing wallet → `WALLET_CONTEXT_INVALID`; valid foreign wallet → `PREVIEW_NOT_USABLE` (privacy, no existence oracle).
- `useTransactionStatus` polling: halt on terminal (`airtime_delivered`/`failed`/`recovery_required`/`completed`/`failed`/`refunded`). Stabilize hook deps — never depend on fresh inline `options` objects (identity-loop reconcile storm).
- `PaymentInstructionsCard`: derive `isSettling`/terminal from fetched durable stage, never from local `depositStatus` alone.
- Receipt: explicit `?tx=` lookup only, revalidate on wallet change, never enumerate another wallet's rows.
- `sanitizeFailureReason` must redact `UserID=`/`token=`/key-value credential pairs, not just Bearer tokens.
- `isFiatDelivered`/`isFiatFinal` derive ONLY from Paycrest `validated`/`settled` — never from internal status fallbacks.
- Conversation sessions and messages are separate from saved-recipient memory and payment ledgers. Derive owners from verified SIWE claims, use a composite owner foreign key, and persist no actionable payment payloads.

## Sprint discipline (from AGENTS.md)
- Repo is implementation source of truth; build plan is sprint authority. Inspect files before planning/editing.
- One milestone at a time; never jump ahead because the next step looks obvious.
- Current sprint: airtime vertical slice before data bundles; P7 data starts only if airtime is stable; electricity/cable/general utilities out of scope unless re-approved.
- Preserve working bank cash-out flow; protect the stable vertical slice over feature breadth.
- Database: Drizzle/Neon workflow, inspect generated migrations, NEVER `drizzle push`, no destructive/prod mutation without explicit user approval.

## Safety boundaries (human approval required)
- Live Paycrest order creation, Celo mainnet tx, ClubKonnect purchase, destructive prod DB ops, final publish/deploy.
- Agents may autonomously inspect, research, build, mock, test, validate, construct requests, implement reconciliation — up to the pre-mutation gate.
- Never: print secrets/bank details/credential URLs, fake provider success, blindly retry unknown mutations, treat ClubKonnect ack as final success, treat Paycrest deposit as fiat delivery, invent refunds, weaken validation to pass tests.
- Persist state before irreversible multi-provider orchestration.

## Verification discipline
- Always run: `test:assistant`, `test:all`, `tsc --noEmit`, `lint`, `build`, `git diff --check` before closing a milestone.
- Self-check suites are the test framework (`*-self-check.ts` + `tests/`). New behavior needs a failing-first regression case.
- Independent `verifier` agent before PASS on consequential work. Max 2 repair loops, then stop and report.
- Receipt/UI edits are high-risk for JSX corruption via line-patch tools — verify with `tsc` immediately after each edit.

## Live-run rules
- Three separate human gates (A: order, B: wallet sign, C: fulfilment). Never combine or infer approval.
- Old failed/unbound orders stay abandoned and expire. Never reuse previews, transactions, or receive addresses.
- Webhook is 503 without `PAYCREST_API_SECRET` — polling/reconciliation is the fallback path.
- ClubKonnect float and IP-whitelist must be operator-verified before live runs.

## Session-continuity operating procedure (this setup)
- `agent-state/` holds `project-state.md` (built/architecture/tasks/files/commands), `memory.md` (this file: invariants/lessons/discipline), `left-off.md` (resume point/dirty tree/first actions/risks).
- Update all three at milestone gates and before `/new` or compaction — never let them go stale (stale state caused confusion on 2026-09-20 when P6.10–P6.14 committed but files still said "uncommitted P6.10").
- After `/new` or compaction, first read all three files plus `git status --short` and `git log --oneline -5` before acting.
- A fresh model is not "confused" — it is contextless. Point it at these files; do not blame it for missing unrecorded state.
