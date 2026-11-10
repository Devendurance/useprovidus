# Providus story-driven experience plan

## Experience concept

Providus turns a request into a reviewable payment and then into evidence. The interface tells that story through real state changes: Ask, Understand, Confirm, Prove.

Users should see how their request became exact terms, stay in control while approving it, and find the proof afterward. The story belongs in the sequence and status language. It does not need decorative animation, staged illustrations, or extra cards.

Use the current Providus brand: warm sage, cream, ink, Georama for product UI, and Baloo 2 for selected brand headlines. Keep payment screens quieter than the landing page. The updated `DESIGN.md` records the current tokens and interaction rules.

## Target experience sequence

| Stage | User question | Interface response | Evidence or action |
|---|---|---|---|
| Ask | What can I ask for? | Put the composer and supported examples on the first screen. Label Celo and BOT availability separately. | User enters a request or picks an example. |
| Understand | What did Providus hear? | Show a short interpretation and ask for missing payment-critical details. | No wallet approval is available while terms are incomplete. |
| Confirm | What will happen if I approve? | Show recipient, network, token, amount, expiry, fees that the system can verify, and each required wallet action. | The user approves each transaction in their wallet. |
| Prove | Did it actually happen? | Show pending, unknown, failed, or B5-verified state with the evidence that supports it. | A verified payment has a receipt action and explorer link. |
| Return | Where is my earlier work? | Let the owner reopen a conversation and find durable payment records separately. | Session and receipt lists are scoped to the authenticated wallet. |
| Remember | What has Providus saved about me? | Show saved recipients and user-approved memory in an editable owner-only view. | User can correct or delete each remembered fact. |

The first four stages are the payment spine. Returning conversations and explicit memory come later. They do not change the payment authorization flow.

## Target screen architecture

### Public entry

1. Keep the existing Providus identity, promise, and one direct route into the dashboard.
2. Explain Celo service availability and live BOT Chain Mainnet native BOT and Official USDT payments on chain 677 with short availability labels. Keep BOT Testnet out of public marketing and payment setup.
3. Show the transaction path and approval boundaries with real evidence. Mainnet payments are live. BOT-funded utility settlement remains unavailable until independently verified settlement and provider delivery exist.
4. Keep long-form trust explanation on How it works instead of repeating it below the dashboard conversation.

### Dashboard workspace

1. Keep the wallet control in the shell. Show the provider-confirmed network separately from payment capability.
2. Give the conversation the main reading column. Put recent conversations in a responsive navigation panel after persistence ships.
3. Render the assistant response and a compact understanding summary in the conversation.
4. Render one contextual review card when payment terms are ready. Show the next relevant action only.
5. Render the exact USDT allowance step only when required. Keep its wallet approval separate from payment authorization.
6. Replace the review card with pending, unknown, failed, or verified state after submission. Preserve submitted hashes and recovery evidence.
7. Link a verified state to its receipt. Keep detailed contract, gas, block, allowance, and raw transaction fields behind a labeled disclosure.

### Receipts

1. Open the Receipts route to a searchable, owner-scoped history.
2. Show compact previews with date, amount, asset, network, counterparty, and status.
3. Filter by status, token, and chain. Add pagination for long histories.
4. Open a preview in a responsive detail modal. Include a visible close button, Escape and outside-click dismissal, focus trapping, and focus restoration.
5. Show payer, recipient, token, network, amount, gas fee, payment contract, hash, block, confirmation status, and verified timestamp when each source confirms them.
6. Show ERC-20 approval transactions as separate evidence. Never merge approval and payment into one transaction or one authorization.

### Memory and sessions

1. Let the owner create, restore, rename, search, page, and soft-delete conversation sessions.
2. Keep messages in a session store. Keep payment records in their durable ledgers. Keep saved recipients in the existing recipient store.
3. Show a separate memory view for explicitly saved long-term facts. Provide edit and delete actions.
4. Never treat memory as payment authority. Every transfer uses fresh terms and a fresh review.

## Component and interaction-state plan

| Component | Main states | Interaction rule |
|---|---|---|
| Wallet status and network menu | disconnected, connected, unsupported network, switch pending, switch confirmed, switch failed, authenticated, authentication required | Connect does not force a chain. A displayed network changes only after provider confirmation. Network metadata comes from the B1 registry. |
| Conversation navigation | no sessions, loading, recent list, search results, empty search, load error, new session, delete confirmation | Keep session operations owner-scoped. A new chat does not delete old sessions. Deletion uses a recoverable path and clear copy. |
| Ask composer | empty, text entered, sending, response pending, request error | Keep the user draft after an error. Support keyboard submission and newline behavior with a visible label. |
| Understanding summary | complete interpretation, missing details, unsupported request, expired terms | Make the interpreted amount, token, recipient, and network readable before review. Do not expose approval while details are missing. |
| Payment review card | ready to review, network switch required, expired, stale recipient, review error, wallet authorization pending | Show recipient, network, asset, amount, and expiry. Put implementation details in a disclosure. The primary action names the next wallet action. |
| Token approval step | allowance checking, allowance sufficient, exact approval required, approval wallet prompt, approval confirmed, approval unknown, approval failed | Show allowance and payment as separate transactions. Never request unlimited approval. Do not continue to payment until the exact approval state is confirmed. |
| Verification status | submitted, verifying, unknown, failed, verified | Read B5 as the payment status authority. Unknown preserves the hash and offers recheck without resending. A failure never mutates the original intent. |
| Verified payment card | verified summary, proof details open | Show one compact success state and one View receipt action. Hide send, approval, resume, and retry controls. Keep the original hash and all available B5 evidence. |
| Receipt history | loading, first-use empty, filtered empty, results, partial results, error | Search and filters explain their scope. Keep a retry only when the read can be retried safely. |
| Receipt preview | verified, submitted, unknown, failed, approval transaction | Only B5-verified transfers receive a Verified label. Approval previews remain separate from payment previews. |
| Receipt detail modal | opening, open, copy confirmation, explorer opened, closing | Keep keyboard focus in the dialog while open. Restore focus to the preview after close. Support Escape and outside click. |
| Memory manager | empty, populated, edit, save, delete confirmation, error | Label the source as explicitly saved. Show only the authenticated owner's facts. Do not infer permanent memory from chat text. |

The payment UI should derive from one discriminated presentation model rather than new independent booleans. A suitable UI model distinguishes `understanding`, `review`, `switch_required`, `allowance_required`, `approval_pending`, `payment_pending`, `unknown`, `failed`, `expired`, and `verified`. These are views over current B3 intent and B5 submission facts. They do not replace or alter the execution engine state.

## Data reuse and migration impact

| Product data | Existing source | Reuse decision | Schema impact |
|---|---|---|---|
| Celo airtime and cash-out payment | `agent_transactions` and existing Celo transaction APIs | Keep as the Celo ledger and retain its current owner checks. | None for the audit. |
| BOT transfer terms | `wallet_transfer_intents` | Keep immutable owner-scoped intents as the source for approved terms. | None for the audit. |
| BOT transaction and verification | `transfer_submissions` | Keep B5 as the source for submitted, unknown, failed, and confirmed payment facts. | None for the audit. |
| Saved recipients | `saved_recipients` and recipient address audit logic | Reuse the current explicit save, owner check, and address verification wording. Do not copy recipients into chat history. | None for the audit. |
| Authentication | Existing owner session and `requireOwner` route pattern | Reuse this boundary for sessions, memory, receipt lists, and detail reads. The owner comes from authentication, never a client-supplied wallet value. | None for the audit. |
| Conversation sessions and messages | No session or message tables. `/api/assistant/chat` is stateless and accepts bounded client-held history. | Add a separate session and message model after migration review. | Additive migration required. |
| Shared user memory | No general memory table. Saved recipients are the only current explicit user memory-like record. | Keep recipient facts in `saved_recipients`. Add a separate store for other user-approved facts. Never use a memory fact as payment authorization. | Additive migration required for new facts. |
| BOT gas fee | B5 stores transaction, block, confirmation, status, and verification time. It does not store gas used or effective gas price. | Show a gas fee only when the current authoritative record contains actual fee data. Existing BOT B5 and Celo records do not persist actual gas, so show unavailable without guessing or implying an estimate is actual. | Migration required only if the fee is stored durably. |
| Token approval transaction | No approval transaction table exists. The current allowance component keeps its display state in React. | Record approval hash and verification separately from the payment ledger before adding approval history. | Additive migration or a reviewed chain-discovery design required. |

No database schema changed during this session. Do not run `db:generate` or `db:migrate` until a concrete migration proposal has explicit review, a backup and restore plan, and verified wallet-isolation tests. Do not run `drizzle push`.

## Prioritized Fast-Build slices

### Slice 0. Correct Mainnet availability language

Status: Complete in this session.

- Show that native BOT and Official USDT payments are live on BOT Chain Mainnet, chain 677.
- Keep the BOT Testnet 968 production execution block and utility settlement limitations accurate. Mainnet payment availability is live.
- Keep the B1 network registry, local test mode, and production execution gate unchanged.
- Verify the shared positioning and the existing Mainnet execution hard gate.

### Slice 1. Simplify payment review and completion

Priority: First implementation slice.

- Keep the B3 and B5 engine unchanged.
- Compact the review card around recipient, network, token, amount, and expiry.
- Put gas, contracts, allowances, and raw transaction facts in labeled details.
- Keep unknown and failed recovery paths intact.
- On B5 verification, hide obsolete approval, resume, and retry controls and show a real View receipt action.
- Cover native BOT, USDT allowance-required, allowance-sufficient, submitted, unknown, failed, expired, and verified states with mocked wallet and B5 fixtures.

### Slice 2. Add searchable owner-scoped receipts

Status: Complete locally in P0.2.

Priority: Second implementation slice, before session and memory work.

- Read Celo records from their existing ledger and BOT records from B5.
- Add searchable previews, status/token/chain filters, pagination, and the responsive detail modal.
- No durable approval ledger exists. Keep approval transactions out of payment receipt history. A future approval history requires an additive schema or reviewed chain-discovery design.
- Show actual gas only when stored authoritative evidence provides it. Existing records lack it, so show unavailable. Do not fabricate full Celo recipient addresses when the ledger does not store them.
- Gate any required schema migration on explicit review, backup planning, and owner isolation proof.

### Slice 3. Add persistent conversation sessions

Priority: After payment simplicity and receipts.

- Propose `conversation_sessions` and `conversation_messages` as distinct from payment, recipient, and memory data.
- Add new chat, recent conversations, automatic titles, rename, search, pagination, restoration, and recoverable deletion.
- Enforce the authenticated owner at each read and write boundary.
- Do not create or run the migration until it has explicit review, backup and restore steps, and cross-wallet isolation tests.

### Slice 4. Add explicit shared user memory

Priority: After sessions.

- Reuse saved-recipient behavior and storage.
- Add a separate owner-scoped record for other explicitly saved preferences or long-term context.
- Add inspect, correct, and delete controls.
- Keep memory advisory. Every payment still requires fresh review and explicit wallet approval.
- Require a separate migration review and backup plan before schema changes.

### Slice 5. Complete browser and accessibility QA

Status: P0.2 local Chromium checks passed at 320, 375, 390, 768, and desktop widths. iOS Safari and Android browser chrome remain unverified.

Run as a gate for each preceding slice and as a final regression sweep.

- Exercise desktop, 768px tablet, 390px mobile, 320px reflow, and 200-percent zoom.
- Cover keyboard navigation, accessible names, focus order, modal focus trap and restoration, contrast, and horizontal overflow.
- Cover wallet account changes, network changes, expired intents, unknown recovery, and restored sessions.
- Regress Celo and BOT Testnet flows. Confirm the production Mainnet gate remains active.
- Use mocked providers and fixtures. Do not automate a paid payment or Mainnet transaction.

## Completion criteria

- A first-time user can state what Providus understood and what will happen next.
- Every payment action states the exact wallet approval required.
- Native and USDT transactions remain separately authorized where the ERC-20 flow requires it.
- Only B5-confirmed payments display Verified.
- Every verified payment has a usable receipt path that preserves the original evidence.
- Receipt and session data stay within the authenticated wallet owner.
- Saved memory is explicit, editable, removable, and never a payment authorization.
- The existing Celo service flows remain intact. Historical BOT Testnet receipts stay inspectable with TESTNET labeling, while public Testnet payment setup and production execution remain disabled.
- BOT Chain Mainnet native BOT and Official USDT payments are live. BOT Testnet 968 remains blocked from public production execution. Utility settlement remains unavailable pending verified settlement and provider delivery.
