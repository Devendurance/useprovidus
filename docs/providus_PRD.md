# Providus Product Requirements

**Status:** P6.14 synchronized current product requirements
**Category:** Safety-first conversational payment execution layer
**Canonical one-liner:** Providus turns approved messages into verified real-world payments.
**Primary hackathon:** Celo Agents at Work
**Primary track:** Real World Adoption
**Network:** Celo mainnet (`42220`)
**Public trust surface:** [/how-it-works#trust](/how-it-works#trust)

This PRD carries the same P6.14 trust story as [`README.md`](../README.md), [`docs/PROVIDUS_ARCHITECTURE.md`](./PROVIDUS_ARCHITECTURE.md), and [`docs/positioning.md`](./positioning.md); the public-facing copy lives in the [/how-it-works#trust](/how-it-works#trust) section and is linked, not duplicated, here.

> **LLM owns language; deterministic code owns money.**

## 1. Product definition

Providus turns a supported, user-approved request into a reconciled real-world payment. It sits between the conversation surface and the external rails: validating intent, enforcing approval, coordinating Celo and provider adapters, persisting state, recovering unknown outcomes, and presenting evidence of what completed.

Providus is not a wallet, a custodial LLM, a standalone off-ramp, a VTU frontend, Paycrest replacement, or ClubKonnect replacement. Paycrest and ClubKonnect are current adapters. Providus does not claim multi-provider production support today.

## 2. Product promise

A user tells Providus what should happen. Providus prepares the exact payment, waits for explicit approval, executes through the appropriate rails, verifies the real-world outcome, and provides proof.

The promise is bounded by supported flows and provider availability. A Celo deposit, provider acknowledgement, or intermediate state is never presented as final delivery.

## 3. Problem

Celo USDC is usable onchain, while everyday Nigerian spending still depends on local settlement and utility rails. Users should not need to understand off-ramp APIs, rate and fee calculations, bank settlement states, VTU network codes, provider retries, payment references, and multiple dashboards.

The user’s responsibility is to state the desired outcome, review the exact action, and approve the payment. Providus handles the orchestration without hiding the state boundaries or uncertainty.

The core tension is:

> **Conversational payments aren’t the hard part. Proving the real-world outcome is.**

## 4. Goals

- Turn supported natural-language requests into typed, deterministic `PaymentIntent`s.
- Require explicit human approval before order creation and wallet signing.
- Keep language interpretation separate from financial authority.
- Bind provider-authoritative fees and exact payment totals before the transfer.
- Verify Celo deposits against expected sender, receiver, token, and amount.
- Reconcile Paycrest fiat delivery separately from protocol completion.
- Trigger ClubKonnect only after durable fiat-final truth is recorded (set when authoritative fiat delivery `validated` is observed; upstream `settled` also satisfies it).
- Prevent duplicate fulfilment through deterministic RequestIDs and durable claims.
- Recover unknown outcomes through references and reconciliation, never blind retries.
- Persist a truthful transaction lifecycle across refreshes and restarts.
- Give users an evidence-linked receipt for the stages and outcome actually available.
- Preserve the existing bank cash-out flow.

## 5. Non-goals

- Custody of private keys, seed phrases, or user funds.
- Autonomous spending without explicit approval.
- Replacing wallets, Paycrest, ClubKonnect, banks, or utility providers.
- Claiming a Celo deposit proves NGN delivery.
- Claiming provider acknowledgement is final success.
- Automatic Paycrest-to-ClubKonnect fund movement.
- Production support for unshipped channels, providers, utility categories, or rails.
- First/only/best category claims.
- Photon/iMessage integration in this milestone.
- Data bundles, electricity, cable, remittances, or broad multi-country expansion in the current slice.

## 6. Users and user stories

### Primary user

A Nigerian stablecoin user with Celo USDC who wants to complete a local payment without manually coordinating a wallet, off-ramp, settlement status, and utility provider.

### Airtime sender

“I want to say ‘Send ₦1,000 MTN airtime to this number,’ review the recipient, network, amount, fees, and total, approve it, and know whether the airtime was delivered.”

### Cash-out user

“I want to cash out Celo USDC to a verified Nigerian bank account, see the current quote and fees before signing, and distinguish on-chain deposit confirmation from Nigerian delivery.”

### Judge or integrator

“I want to see that conversation is not money authority, that provider mutations are deterministic, and that the receipt reflects real evidence rather than a guessed success flag.”

## 7. Current shipped scope

### Shipped

- Web dashboard conversational assistant.
- Multi-turn clarification and status explanations.
- Deterministic/schema-validated airtime `PaymentIntent`.
- Celo mainnet wallet connection and canonical Circle USDC.
- Explicit approval before Paycrest order creation.
- Explicit browser-wallet signing before the USDC transfer.
- Paycrest live quotes, order creation, authoritative fee binding, and reconciliation.
- Neon PostgreSQL (managed Postgres) + Drizzle durable transaction persistence.
- ClubKonnect server-only airtime adapter, readiness handling, deterministic RequestIDs, one-shot claims, status normalization, and reconciliation.
- Evidence-linked receipt/status surface.
- Owner-scoped receipt evidence: explicit receipt and payment-instruction reads are wallet-checked server-side before any DTO or evidence is returned, while the default status endpoint remains a sanitized public status read.
- Existing Nigerian bank cash-out through Paycrest.
- ERC-8021 attribution tag `celo_8190b99392a2` on eligible transfers.
- One completed human-gated Celo mainnet airtime run documented in `docs/live-airtime-e2e.md`.

The live run demonstrates one complete request → receipt chain. It is not a universal guarantee for every transaction.

### Current limits

- Airtime is the shipped utility category.
- The current production channel is the web dashboard.
- Paycrest and ClubKonnect are the current settlement and fulfilment adapters.
- Additional providers and channels are roadmap-only extension points, not shipped support.

## 8. Core user journey

1. User opens the dashboard and states a supported payment request.
2. Conversation layer asks for missing or ambiguous fields.
3. The model produces a candidate structured intent.
4. Deterministic validation produces a usable `PaymentIntent` or a clear unsupported/error state.
5. Providus shows exact recipient, network, amount, quote, fees, expiry, Celo network, and total.
6. User explicitly approves the exact action.
7. Providus creates and durably binds the Paycrest order and provider-authoritative fees.
8. User explicitly signs the exact Celo USDC transfer in the browser wallet.
9. Server verifies the on-chain deposit.
10. Paycrest status is reconciled until durable fiat-final truth is recorded (set when the authoritative fiat-delivery condition is observed; a later raw `settling` event never clears it).
11. Providus calls ClubKonnect through the fulfilment adapter using the stored transaction and deterministic RequestID, gated on that durable truth.
12. ClubKonnect is reconciled to a documented terminal result.
13. Receipt/status UI presents the approved terms and available execution, settlement, fulfilment, and outcome evidence.

## 9. PaymentIntent model

The first executable intent is airtime:

```ts
type PaymentIntent = {
  type: "airtime" | "data" | "electricity" | "cable" | "unsupported"
  amountNgn?: string
  phone?: string
  network?: "mtn" | "airtel" | "glo" | "9mobile"
  missingFields: string[]
  readyForConfirmation: boolean
}
```

Rules:

- LLM output is a candidate, never an authorization.
- Deterministic schema and domain validation runs after model interpretation.
- Missing or ambiguous payment-critical fields stop execution.
- Network suggestions are editable; phone prefixes are not certainty because of number portability.
- Approved amount, recipient, network, and action cannot be silently changed.
- Unsupported intents return a clear non-executable state.

## 10. Approval boundary

Approval is explicit and staged:

- **Order approval:** user reviews the quote and authorizes Paycrest order creation.
- **Wallet approval:** user separately clicks/signs the exact bound Celo USDC transfer in the connected browser wallet.
- **Fulfilment gate:** deterministic code verifies the Celo deposit and durable fiat-final truth before calling ClubKonnect. Fulfilment depends on that durable monotonic marker, never on a raw equality check against the latest provider status string.

The receipt shows approved payment terms and execution/settlement/fulfilment evidence available for the transaction. It does not claim a standalone approval-event snapshot unless that event is explicitly persisted and rendered.

## 11. Execution pipeline

```text
Web today (future iMessage / WhatsApp / Telegram / MiniPay are roadmap-only)
→ Conversation Layer
→ PaymentIntent Engine
→ Human Approval Boundary
→ Providus Execution Engine
→ two separate provider edges:
     SettlementRail / Paycrest (current)      → Celo USDC → NGN settlement
     FulfilmentProvider / ClubKonnect (current for airtime) → airtime fulfilment
→ Reconciliation + Recovery
→ Verified Outcome
→ Receipt
```

The engine fans out to two provider edges, and they stay separate: neither settlement nor fulfilment can trigger the other, and Paycrest does not fund ClubKonnect.

### Trust ownership

| Owner | Owns | Does not own |
|---|---|---|
| **User** | Approval of the exact bound terms and the browser-wallet USDC signature | No money movement without both |
| **LLM** | Language interpretation, clarification, structured candidate data | Validation authority, payment-critical fields, provider calls, wallet signing, success states, refunds |
| **Deterministic Providus code** | `PaymentIntent` validation, quote/fee binding, execution eligibility, durable state, reconciliation, fulfilment gating, recovery, receipts | No unevidenced success or completion claim |
| **Paycrest** | Celo USDC → NGN settlement | Fulfilment or fulfilment gating |
| **ClubKonnect** | Airtime fulfilment | When it is called, or whether its result ends the Providus lifecycle |
| **Celo** | On-chain payment evidence | NGN delivery or utility fulfilment |
| **Neon PostgreSQL + Drizzle** | Durable transaction state | Provider truth that has not been reconciled |

**Provider acknowledgement is never final success.**

### Providus-owned responsibilities

- intent validation;
- approval boundaries;
- exact fee and amount binding;
- durable state and idempotency;
- orchestration and provider call eligibility;
- Celo verification;
- settlement and fulfilment reconciliation;
- safe recovery from unknown outcomes;
- terminal outcome classification;
- receipt evidence assembly.

### Current adapters

| Adapter role | Current implementation | Status |
|---|---|---|
| SettlementRail | Paycrest | Shipped |
| FulfilmentProvider | ClubKonnect | Shipped for airtime |
| Channel | Web dashboard | Shipped |

### Future adapters

Everything in this subsection is **roadmap-only**: not shipped, not production-supported, and not a current product claim. iMessage/Photon, WhatsApp, Telegram, MiniPay, additional settlement rails, and additional fulfilment providers are future adapters. They must feed the same intent, approval, execution, state, reconciliation, and receipt path rather than introduce independent payment engines. The web dashboard is the only shipped channel.

## 12. Settlement and fulfilment semantics

Paycrest statuses have distinct meanings:

- `initiated` — order created, awaiting deposit.
- `deposited` — Paycrest detected the on-chain deposit.
- `pending` / `fulfilling` — settlement is in progress.
- `validated` — provider confirmed fiat delivery; the authoritative condition that sets the durable fiat-final marker permitting downstream utility fulfilment.
- `settling` — protocol escrow settlement is in progress.
- `settled` — Paycrest protocol completion is recorded; it is tracked separately from the fiat-delivery event.
- `refunded` — deposit returned to the user; must be verified, never inferred.

The current airtime operating model uses a Providus NGN fulfilment float. Paycrest does not automatically fund ClubKonnect.

Fiat finality is durable and monotonic. The authoritative fiat-delivery status is `validated` (upstream `settled` also satisfies the condition because it subsumes that delivery and records protocol completion). When either authoritative status is observed, the transaction records a persisted fiat-final boolean. Fulfilment requires that durable truth rather than a raw equality check against the latest provider string, so a later raw `settling` event — normal protocol escrow-release progression after fiat delivery — never clears the marker and never re-blocks fulfilment.

The three values are distinct and must never be collapsed into one success flag:

- **`validated`** — authoritative fiat delivery; sets the durable monotonic fiat-final marker and is the safe point to trigger downstream utility fulfilment.
- **`settling`** — later protocol progression (escrow release in progress); it never clears fiat delivery, never re-blocks fulfilment, and never proves protocol completion.
- **`settled`** — protocol completion; it also subsumes prior fiat delivery, so it satisfies the fiat-final gate.

The raw Paycrest lifecycle stays recorded distinctly and is never rewritten.

**Provider acknowledgement is never final success.** `initiated`, `deposited`, `pending`, `fulfilling`, and a pre-delivery `settling` read are progress signals, not delivery; a Celo deposit is not NGN settlement.

ClubKonnect status handling is conservative:

- `100` and `300` are non-terminal processing/acknowledgement states.
- `200` is terminal success and permits `completed`.
- `201` and unknown responses require reconciliation and are not success.
- `417` is terminal provider-float failure.

**ClubKonnect acknowledgement is never final success.** A callback, `100`/`300`, or a successful transport response cannot permit `completed`; only numeric `200` does. An unresolved RequestID is a recovery branch — reconciled against the durable reference recorded at claim time — never a retry with a new reference.

## 13. Transaction lifecycle

Internal status is type-aware:

| Status | Meaning |
|---|---|
| `pending` | Order exists; awaiting Celo USDC deposit. |
| `settling` | Deposit verified; Paycrest fiat delivery pending. |
| `settled` | The durable fiat-final milestone or Paycrest protocol completion has been recorded. The fiat-final marker is set when authoritative fiat delivery (`validated`) is observed and is never cleared afterwards; upstream `settled` also records protocol completion. Terminal for direct cash-out; enables utility fulfilment for airtime. |
| `processing` | ClubKonnect fulfilment is claimed or in flight. |
| `completed` | Airtime terminal success is verified. |
| `failed` | Documented terminal failure. |
| `refunded` | Refund actually verified. |

The public labels rendered to users come only from `lib/transactions/status.ts`; the `/how-it-works` trust section renders the same set:

Awaiting payment · Celo deposit confirmed · NGN payout in progress · NGN settlement processing · NGN settlement confirmed · Airtime request submitting · Airtime processing · Provider status unresolved · Airtime delivered · Airtime fulfilment failed · Failed · Refunded · Recovery required · Fiat delivery confirmed (cash-out) · Paycrest protocol settled (cash-out) · Completed (cash-out only) · Fulfilment processing (cash-out only)

- `deposit_confirming` is declared in the stage union but never emitted; it is not a public label and must not be presented as one.
- Exceptional branches are `failed`, `recovery_required`, and `refunded`. The airtime reconciliation-required branch (`Provider status unresolved`) is a recovery branch, not a failure and not a success.
- These labels describe observed stage and recovery needs; they do not weaken the terminal-state rules and never upgrade a provider acknowledgement into success.

## 14. Receipt and evidence requirements

A receipt/status surface may show:

- requested action and approved payment terms;
- transaction identifier;
- Celo transaction and verification state;
- Paycrest order/reference and reconciled status;
- fiat-delivery condition and protocol settlement separately;
- durable fiat-final state, presented monotonically rather than as the latest raw status alone;
- ClubKonnect RequestID/order/status evidence;
- lifecycle timestamps and terminal outcome;
- sanitized failure or recovery explanation.

Receipt access is scoped:

- `GET /api/transactions/[id]` without owner scope remains a sanitized public status read for compatibility and carries no owner-only evidence.
- An explicit owner-scoped receipt request (`scope=receipt`) and the opt-in payment-instruction request must include a valid `walletAddress`. The server checks that address against the stored transaction wallet before reconciliation and before DTO/evidence serialization. Missing or invalid context returns no transaction DTO or evidence; a mismatch returns a generic forbidden response rather than transaction detail.
- The receipt UI requests owner scope with the connected wallet and compares wallets locally, but that client-side check is defence-in-depth, never the authorization boundary.

ERC-8021 attribution is described from the recorded tag and transfer evidence as “Attribution configured” or as the “ERC-8021 attribution tag”. The receipt must not render “Verified” from the static tag alone.

It must not:

- invent success from a provider acknowledgement;
- equate Celo deposit with NGN delivery;
- expose secrets, full bank details, or unnecessary PII;
- claim a standalone approval event that is not persisted/rendered;
- imply verified ERC-8021 attribution from a static tag without supporting transfer evidence.

## 15. Recovery and idempotency

- **No blind retry.** An unknown-outcome mutation is recorded and reconciled through its original reference; it is never repeated.
- **Durable reference.** The Paycrest order reference and the deterministic ClubKonnect RequestID are persisted with the transaction so recovery survives refreshes and restarts.
- Persist state before irreversible multi-provider orchestration.
- Use one idempotency key/order binding per approved transaction.
- Unknown Paycrest order-creation outcomes are recorded and blocked from blind retry; the original reference is routed to safe recovery/reconciliation when available.
- Duplicate callbacks and polls are idempotent.
- ClubKonnect fulfilment has a deterministic RequestID and one-shot mutation claim.
- Unknown ClubKonnect responses query/reconcile the same RequestID; they never create a second purchase.
- Never write `refunded` without evidence of an actual refund.
- Never treat provider callbacks as permission to duplicate fulfilment.
- Never treat a provider acknowledgement as final success.

## 16. Privacy and security

- Provider keys remain server-only.
- No private keys or seed phrases reach Providus.
- Wallet signing remains in the user’s connected browser wallet.
- Bank identifiers and phone numbers are minimized and masked in logs/UI where appropriate.
- Credential-bearing URLs and raw provider payloads are redacted.
- Exact decimal arithmetic is used for payment values.
- No autonomous background spending in the current product.

## 17. Roadmap

Roadmap-only — not shipped, not production-supported, and not a current product claim:

- data bundles;
- electricity payments;
- cable TV subscriptions;
- iMessage/Photon proof or adapter;
- WhatsApp, Telegram, MiniPay, and other channel adapters;
- additional settlement rails;
- additional fulfilment providers;
- recurring/session-key spending;
- broader remittance and multi-country support;
- general-purpose autonomous agent framework.

These items must reuse the canonical execution and proof architecture after their rails, approval boundaries, and reconciliation behavior are implemented and verified.

## 18. Celo and hackathon requirements

```text
ERC-8004 Agent ID: 9851
Active attribution tag: celo_8190b99392a2
```

Eligible Celo transfers use the active ERC-8021 attribution tag. The obsolete tag `celo_91fed90b97fc` must not be used.

Registered tracks:

- `real-world-adoption` — primary;
- `value-moved`;
- `askbots-growth`;
- `judges-favorite`;
- `cpay-feedback`.

## 19. Success criteria

The product north star is:

> **Completed real-world payments from Celo stablecoins with truthful end-to-end proof.**

Evidence includes real user approval, Celo verification, authoritative fiat delivery, terminal utility fulfilment, no duplicate fulfilment, and a truthful receipt. One live run is evidence of one successful run, not a guarantee across all conditions.

## 20. Demo narrative

1. User connects a Celo wallet holding USDC.
2. User requests Nigerian airtime conversationally.
3. Providus validates the `PaymentIntent` and shows the exact terms.
4. User approves order creation and signs the exact wallet transfer.
5. Providus verifies the Celo deposit.
6. Paycrest `validated` is reconciled as fiat delivery and records durable monotonic fiat-final truth; `settled` is tracked separately as protocol completion.
7. ClubKonnect fulfilment is submitted — gated on that durable truth — and reconciled by deterministic RequestID.
8. Status `200` verifies delivery.
9. Receipt shows the approved terms and available execution/settlement/fulfilment evidence.
10. Existing bank cash-out remains a separate supported flow.

## 21. Definition of done for future changes

A future utility or channel is not shipped until:

- its `PaymentIntent` is validated;
- approval is explicit;
- payment-critical values are bound and immutable;
- provider state is reconciled;
- unknown outcomes are recoverable without blind retry;
- fulfilment is idempotent;
- terminal success is independently verified;
- receipts distinguish evidence from inference;
- secrets and PII remain protected;
- the P6.14 trust story stays synchronized across `/how-it-works#trust`, `README.md`, this PRD, `docs/PROVIDUS_ARCHITECTURE.md`, and `docs/positioning.md`;
- current bank cash-out behavior remains intact.

Until then the item stays roadmap-only and must not be described as shipped capability.
