# Providus Architecture

**Status:** Current shipped architecture — P6.14 trust architecture freeze
**Network:** Celo mainnet (`42220`)
**Repository:** `https://github.com/Devendurance/useprovidus`
**Public trust surface:** [/how-it-works#trust](/how-it-works#trust)

This document describes the current implementation and is one of the canonical P6.14 trust-story sources, together with [`README.md`](../README.md), [`docs/providus_PRD.md`](./providus_PRD.md), and [`docs/positioning.md`](./positioning.md). It carries the same ownership, state, recovery, and roadmap semantics as the public [/how-it-works#trust](/how-it-works#trust) section; the public copy lives there, and this document links to it instead of duplicating it. Future channels, rails, providers, and utility categories are labelled explicitly as future. Historical pre-P6.10 architecture gaps are retained only as historical context; they are not current-state claims.

## 1. Architecture in one sentence

Providus is a safety-first conversational payment execution layer that turns a user-approved request into a verified real-world payment by coordinating a conversation layer, deterministic intent and approval boundaries, Celo wallet execution, settlement, fulfilment, reconciliation, and receipt evidence.

## 2. Canonical execution model

```text
Web today (future iMessage / WhatsApp / Telegram / MiniPay are roadmap-only)
↓
Conversation Layer
↓
PaymentIntent Engine
↓
Human Approval Boundary
↓
Providus Execution Engine
↓
SettlementRail / Paycrest (current)   FulfilmentProvider / ClubKonnect (current for airtime)
↓
Reconciliation + Recovery
↓
Verified Outcome
↓
Receipt
```

The execution engine fans out to **two separate provider edges**: `SettlementRail` (Paycrest today) converts Celo USDC into NGN, and `FulfilmentProvider` (ClubKonnect today, airtime only) delivers the purchased utility. They are never a single edge: settlement does not fund or trigger fulfilment implicitly, and neither edge owns approval, state, reconciliation, recovery, or proof.

Channels do not own payment engines. The web dashboard is the shipped channel. iMessage/Photon, WhatsApp, Telegram, MiniPay, and other conversational surfaces are **roadmap-only** adapters over the same intent, approval, execution, state, reconciliation, and receipt path; they are not shipped capability.

### Trust ownership

| Owner | Owns | Does not own |
|---|---|---|
| **User** | Approval of the exact bound terms, and the browser-wallet signature that moves USDC | Nothing executed on their behalf without that approval and signature |
| **LLM** | Language interpretation, clarification questions, and structured candidate data | Executable transactions, payment-critical fields, provider authorization, wallet signing, success states, refunds |
| **Deterministic Providus code** | `PaymentIntent` validation, quote/fee binding, execution eligibility, durable state, reconciliation, fulfilment gating, recovery, and receipts | Nothing it cannot evidence from durable state or provider/chain reads |
| **Paycrest** | Celo USDC → NGN settlement | Fulfilment, fulfilment gating, or final success classification |
| **ClubKonnect** | Airtime fulfilment | When it may be called, or whether its result counts as the end of the Providus lifecycle |
| **Celo** | On-chain payment evidence (the USDC transfer) | NGN delivery or utility fulfilment |
| **Neon PostgreSQL + Drizzle** | Durable transaction state across refreshes and restarts | Provider truth it has not yet reconciled |

**Provider acknowledgement is never final success.** No acknowledgement, intermediate status, or callback is recorded as delivery or completion by any owner in this table.

## 3. Current shipped stack

| Layer | Current implementation | Status |
|---|---|---|
| Frontend | Next.js App Router + TypeScript | Shipped |
| Conversation | DeepSeek server-side assistant with multi-turn clarification | Shipped |
| Intent | Structured candidate output plus deterministic validation | Shipped for airtime |
| PaymentIntent | Airtime action, amount, phone, and network fields | Shipped |
| Approval | Explicit order approval plus separate browser-wallet signature | Shipped |
| Wallet | wagmi + viem; MetaMask, Rabby, and OKX surfaces | Shipped |
| Network | Celo mainnet | Shipped |
| Asset | Canonical Circle USDC on Celo | Shipped |
| Persistence | Neon PostgreSQL (managed Postgres) via `postgres-js` + Drizzle ORM; durable transaction rows and migrations | Shipped |
| SettlementRail | Paycrest quotes, order binding, authenticated reconciliation, and webhook boundary | Shipped |
| FulfilmentProvider | Server-only ClubKonnect airtime client, preflight, one-shot claim, and reconciliation | Shipped for airtime |
| Receipt | Owner-scoped receipt and evidence surface; the default status endpoint remains a sanitized public status read | Shipped |
| Attribution | ERC-8021 tag `celo_8190b99392a2` on eligible transfers; tag recorded in the live run's on-chain transfer calldata | Shipped |

## 4. Current module map

### Conversation and intent

- `lib/ai/deepseek.ts`
- `lib/ai/prompts.ts`
- `lib/assistant/resolve.ts`
- `lib/assistant/validation.ts`
- `lib/assistant/confirmation.ts`
- `lib/assistant/preview.ts`
- `lib/assistant/payment-service.ts`
- `app/api/assistant/chat/route.ts`
- `app/api/assistant/preview/route.ts`
- `app/api/assistant/orders/route.ts`

The model produces language interpretation or a candidate intent. Deterministic validation, confirmation, payment service code, and user approval own execution authority.

### Persistence and transaction state

- `lib/db/index.ts`
- `lib/db/schema.ts`
- `lib/transactions/repository.ts`
- `lib/transactions/transitions.ts`
- `lib/transactions/status.ts`
- `lib/transactions/types.ts`
- `drizzle/0000_organic_triton.sql`
- `drizzle/0001_bumpy_inhumans.sql`

Transaction rows persist the approved action, wallet, amounts, provider references, Celo hash, current statuses, fulfilment metadata, failure/recovery information, and audit timestamps. Bank details and credentials are not stored unnecessarily.

Fiat-finality is persisted as a write-once boolean marker (`paycrest_fiat_delivery_confirmed: true`) inside transaction fulfilment metadata. It is set once authoritative fiat delivery is observed (`validated`, or `settled` which subsumes it) and is never cleared afterwards — including when the raw Paycrest status later moves through `settling` to `settled`. Fulfilment and stage derivation consume that durable marker, with safe legacy fallback only where the internal post-delivery state and provider milestone prove the same fact; they never rely on a raw equality check against the latest provider status string.

### Paycrest settlement

- `lib/paycrest/server/client.ts`
- `lib/paycrest/server/reconciliation.ts`
- `lib/paycrest/server/webhook.ts`
- `lib/paycrest/server/operating-account.ts`
- `app/api/paycrest/orders/route.ts`
- `app/api/paycrest/webhook/route.ts`
- `app/api/transactions/[id]/confirm-deposit/route.ts`

### ClubKonnect fulfilment

- `lib/clubkonnect/server/config.ts`
- `lib/clubkonnect/server/client.ts`
- `lib/clubkonnect/server/status.ts`
- `lib/clubkonnect/server/orchestration.ts`
- `lib/clubkonnect/server/reconciliation.ts`
- `app/api/transactions/[id]/fulfil/route.ts`

### Celo and receipts

- `lib/celo/verify-deposit.ts`
- `lib/celo/attribution.ts`
- `lib/wallet/erc20.ts`
- `hooks/use-usdc-deposit.ts`
- `app/receipt/receipt-client.tsx`
- `app/api/transactions/[id]/route.ts`

## 5. Shipped airtime architecture

```text
User request
→ DeepSeek candidate intent
→ deterministic PaymentIntent validation
→ exact preview with expiry
→ explicit order approval
→ Paycrest order + authoritative fee binding
→ durable transaction row
→ browser-wallet Celo USDC signature
→ server-side Celo receipt verification
→ Paycrest status reconciliation
→ durable fiat-final gate (recorded when authoritative fiat delivery `validated` is observed; upstream `settled` also satisfies it)
→ ClubKonnect float/preflight
→ deterministic RequestID + one-shot claim
→ ClubKonnect status reconciliation
→ verified airtime outcome
→ receipt
```

The current operating model has two separate money movements:

1. Paycrest settles the user’s Celo USDC into the configured Providus operating settlement account.
2. ClubKonnect fulfils airtime from its own prepaid provider float.

Paycrest does not automatically fund ClubKonnect. Replenishment of the fulfilment float is an external operating process. No architecture or product copy may imply a direct Paycrest-to-ClubKonnect transfer.

## 6. Current Paycrest status semantics

The reconciliation client documents and maps these upstream statuses:

```text
initiated
 deposited
 pending
 fulfilling
 fulfilled
 validated
 settling
 settled
 cancelled
 refunding
 refunded
 expired
```

Meanings relevant to execution:

- `initiated`: order exists and awaits a deposit.
- `deposited`: Paycrest detected the on-chain deposit.
- `pending` / `fulfilling`: provider settlement is in progress.
- `validated`: the provider confirmed fiat delivery to the configured recipient/operating account. This is the safe point to trigger downstream utility fulfilment, and it sets the durable monotonic fiat-final marker.
- `settling`: Paycrest protocol escrow release is in progress.
- `settled`: Paycrest protocol settlement is complete onchain and offchain. This is tracked separately from the fiat-delivery event.
- `refunding` / `refunded`: refund work or verified return of funds.
- `cancelled` / `expired`: order ended without a valid completed payment.

### `validated` vs `settling` vs `settled`

These three Paycrest values are distinct and must never be collapsed into one success flag:

| Upstream status | Meaning | Effect on Providus |
|---|---|---|
| `validated` | Provider confirmed fiat delivery to the configured recipient/operating account | Authoritative fiat delivery. Sets the durable monotonic fiat-final marker and is the safe point to trigger downstream utility fulfilment. |
| `settling` | Paycrest protocol escrow release is in progress (later protocol progression, after fiat delivery) | Recorded as protocol progression only. It never clears fiat delivery, never re-blocks fulfilment, and never proves protocol completion. |
| `settled` | Paycrest protocol settlement is complete onchain and offchain | Protocol completion. It also subsumes prior fiat delivery, so it satisfies the fiat-final gate. |

Internal `settled` is reached when upstream `validated` confirms fiat delivery, or when upstream `settled` is observed and therefore subsumes that prior delivery condition. For utility transactions it enables fulfilment. For direct cash-out it is the effective business terminal state. Upstream `settled` additionally sets the protocol-complete flag; internal progress states do not prove protocol settlement.

Durable fiat-finality. Reconciliation records a monotonic fiat-final boolean when authoritative fiat delivery is observed: `validated` sets it, and `settled` (which subsumes that delivery and records protocol completion) also satisfies it. Fulfilment eligibility and stage derivation read that durable truth, not the latest raw provider status string, so the normal `validated → settling → settled` protocol progression never clears fiat delivery, never re-blocks fulfilment, and never under-reports it. The raw Paycrest lifecycle values remain recorded distinctly and are never rewritten.

**Provider acknowledgement is never final success.** `initiated`, `deposited`, `pending`, `fulfilling`, and a `settling` read that arrives before fiat delivery are progress signals, not delivery. `settling` is not protocol completion, and a Celo deposit is not an NGN settlement.

## 7. Current ClubKonnect semantics

ClubKonnect is a fulfilment adapter, not Providus’s execution authority. The orchestrator:

1. requires durable fiat-final truth (recorded from authoritative fiat delivery `validated`, or `settled` which subsumes it);
2. checks provider readiness/float conservatively;
3. derives a deterministic bounded RequestID from the Providus transaction;
4. atomically claims the one allowed fulfilment attempt;
5. submits at most one purchase mutation;
6. queries the same RequestID for unknown outcomes;
7. writes `completed` only for numeric provider status `200`.

Status rules:

- `100`: acknowledgement/received, not success;
- `300`: processing, not success;
- `200`: terminal successful delivery;
- `201`: network unresponsive/unknown, reconciliation required;
- `417`: insufficient provider balance, terminal failure;
- unknown status: reconciliation required, never inferred as success.

A timeout or ambiguous response never authorizes a second purchase and never invents a refund.

**ClubKonnect acknowledgement is never final success.** `100`/`300`, a callback, and a successful transport response are progress signals only. Recovery always queries the durable RequestID recorded at claim time — the RequestID is persisted with the transaction so an unresolved outcome stays resolvable after restarts — and an unresolved RequestID is a recovery branch, never a retry with a new reference.

## 8. PaymentIntent and approval boundaries

The first executable intent is:

```ts
type AirtimeIntent = {
  type: "airtime"
  amountNgn: string
  phone: string
  network?: "mtn" | "airtel" | "glo" | "9mobile"
}
```

The model may interpret language and ask questions, but deterministic code validates the candidate. Missing or ambiguous payment-critical fields stop execution. The confirmation surface freezes amount, recipient, network, quote, fee, expiry, and total for approval.

Approval is staged:

- **Gate A:** user approves the exact Paycrest order terms;
- **Gate B:** user signs the exact bound Celo USDC transfer in the browser wallet;
- **Gate C:** deterministic system checks Celo deposit and Paycrest fiat delivery before fulfilment.

Gate C is system verification, not a third human approval.

## 9. Actual transaction lifecycle

The internal lifecycle is type-aware:

```text
pending
  → settling
  → settled
  → processing       (utility only)
  → completed        (utility only)
```

Terminal branches:

```text
pending / settling / processing → failed
pending / settling             → refunded (only after verified refund)
```

| Internal status | Meaning |
|---|---|
| `pending` | Provider order exists; awaiting the Celo USDC deposit. |
| `settling` | Celo deposit is verified; Paycrest fiat delivery is pending. |
| `settled` | The durable fiat-final milestone or Paycrest protocol completion is recorded. The fiat-final marker is set on authoritative delivery (`validated`) and is never cleared afterwards. Terminal for `cash_out`; enables `airtime` fulfilment. |
| `processing` | ClubKonnect fulfilment is claimed or in flight. |
| `completed` | ClubKonnect numeric status `200` verifies airtime delivery. |
| `failed` | Documented terminal failure. |
| `refunded` | Actual refund verified. |

### Public stage labels

Public stage text is emitted only by `lib/transactions/status.ts`; the public `/how-it-works` trust section renders the same set. No other layer may invent a completion label.

| Public label | Derived stage | When it appears |
|---|---|---|
| Awaiting payment | `awaiting_payment` | Order created; Celo USDC deposit not yet observed. |
| Celo deposit confirmed | `deposit_confirmed` | USDC deposit verified on-chain; the Paycrest fiat leg is still pending. |
| NGN payout in progress | `settling` | Paycrest `fulfilling`/`fulfilled`: liquidity provider is disbursing NGN. |
| NGN settlement processing | `settling` | Paycrest `settling`, or an internal `settled` row with no recorded fiat delivery. |
| NGN settlement confirmed | `settled` (airtime) | Durable fiat-final truth is recorded; the airtime request has not been sent yet. |
| Airtime request submitting | `airtime_submitting` | The one allowed fulfilment attempt is claimed or in flight. |
| Airtime processing | `airtime_processing` | ClubKonnect `100`/`300`; received or processing, never success. |
| Provider status unresolved | `airtime_reconciliation_required` | ClubKonnect `201` or unknown status; reconcile by RequestID, never a second purchase. |
| Airtime delivered | `airtime_delivered` | ClubKonnect numeric `200` verified airtime delivery. |
| Airtime fulfilment failed | `failed` | Fiat delivery was confirmed but fulfilment failed; Providus issued no automatic refund. |
| Failed | `failed` | Documented terminal failure. |
| Refunded | `refunded` (rendered on the `failed` stage) | Only after a refund is actually verified. |
| Recovery required | `recovery_required` | Unknown order-creation outcome, or a `completed` row without a verified success code; needs reconciliation by reference. |
| Fiat delivery confirmed | `settled` (cash-out) | Fiat delivered into the recipient bank account; Paycrest protocol settlement not yet recorded. |
| Paycrest protocol settled | `settled` (cash-out) | Paycrest `settled` observed: protocol settlement complete. |
| Completed | `completed` (cash-out only) | Cash-out row recorded complete. |
| Fulfilment processing | `processing` (cash-out only) | Fiat payout verified; downstream fulfilment in progress. |

The stage union additionally declares `deposit_confirming`. That identifier is **declared but never emitted**; it is not a public label, must not be documented as one, and must not be rendered to users.

Exceptional branches are `failed`, `recovery_required`, and `refunded`. The airtime reconciliation-required branch is a recovery branch, not a failure and not a success. These labels describe observed progress or recovery needs; they create no new mutation permission and never upgrade an acknowledgement into terminal success.

## 10. Receipt and evidence boundary

The receipt is built from durable transaction state, and access to it is scoped:

- `GET /api/transactions/[id]` without owner scope stays a sanitized public status read for compatibility; it carries no owner-only evidence.
- An explicit owner-scoped receipt request (`scope=receipt`) and the opt-in payment-instruction request must include a valid `walletAddress`. The server compares that address against the stored transaction wallet before reconciliation and before DTO/evidence serialization. Missing or invalid context returns no transaction DTO or evidence; a mismatch returns a generic forbidden response without transaction detail.
- The receipt UI requests owner scope with the connected wallet and compares wallets locally, but that client check is defence-in-depth, never the authorization boundary. The server check is authoritative.

It can show:

- requested action and approved payment terms;
- Celo transaction and verification state;
- Paycrest order/reference and upstream status;
- durable fiat-final state alongside fiat-delivery and protocol-settlement states;
- ClubKonnect RequestID, provider order, status, and fulfilment time;
- current lifecycle stage, failure, or recovery explanation.

ERC-8021 attribution is labelled from the recorded tag and transfer evidence as “Attribution configured” or as the “ERC-8021 attribution tag”. The receipt does not render “Verified” from the static tag alone.

The receipt does not claim a standalone approval event unless such an event is explicitly persisted and rendered. It never marks a Celo deposit as NGN delivery, provider acknowledgement as final success, or an unverified result as completed.

## 11. Recovery, idempotency, and integrity

- **No blind retry.** A mutation whose outcome is unknown is never repeated: it is recorded and reconciled through its original reference.
- **Durable reference.** The Paycrest order reference and the deterministic ClubKonnect RequestID are persisted with the transaction, so recovery works after a refresh or restart and after the request that created them is gone.
- **One mutation per approved transaction.** ClubKonnect one-shot claims prevent duplicate purchases; duplicate callbacks and polls are idempotent.
- **Provider acknowledgement is never success.** A callback, `100`/`300`, or a successful transport response cannot write `completed`; only numeric `200` does.
- Durable state is written before irreversible provider mutations.
- The approved amount must equal the provider-bound amount.
- Each order and provider mutation uses a unique/idempotent reference.
- Unknown Paycrest order creation is recorded and blocked from blind retry; the original reference is routed to safe recovery/reconciliation when available.
- Unknown ClubKonnect outcomes query the original RequestID.
- Provider callbacks are signals, not permission to duplicate fulfilment.
- Failed fulfilment is not a refund; `refunded` requires a verified refund.
- Exact decimal arithmetic is used for payment values.

## 12. Security and privacy invariants

- Paycrest and ClubKonnect credentials are server-only.
- No private key or seed phrase reaches the server.
- Wallet signing happens in the user’s connected browser wallet.
- Bank identifiers and phone numbers are minimized and masked.
- Credential-bearing URLs, API keys, raw provider payloads, and stack traces are redacted.
- No autonomous background spending is enabled.
- Unsupported intents are rejected rather than silently executed.

## 13. Historical pre-P6.10 audit context

The original P0–P6 build plan identified missing persistence, Paycrest finality tracking, ClubKonnect integration, the command layer, and attribution wiring. Those were historical pre-build gaps. They are not current claims:

- persistence is now shipped through Neon PostgreSQL/Drizzle;
- Paycrest reconciliation and webhook boundaries are shipped;
- ClubKonnect fulfilment and reconciliation are shipped for airtime;
- the assistant and deterministic PaymentIntent validation are shipped;
- ERC-8021 attribution is shipped and present in the live proof.

The historical defect list remains useful as an audit record, but it must not be read as the current architecture.

## 14. Scope boundaries

### Current

```text
Web dashboard
→ conversational airtime PaymentIntent
→ explicit approval
→ Celo USDC
→ Paycrest fiat delivery            (settlement edge)
→ ClubKonnect airtime               (fulfilment edge)
→ reconciliation + recovery
→ receipt
```

The direct bank cash-out flow remains separately supported through Paycrest.

### Future

Everything below is **roadmap-only**: not shipped, not production-supported, and not a current product claim.

- data bundles;
- electricity and cable;
- iMessage/Photon, WhatsApp, Telegram, MiniPay, and other channels;
- additional settlement rails;
- additional fulfilment providers;
- session-key/permissioned recurring spending;
- broader remittance or multi-country support.

Future additions must use the same approval, state, reconciliation, recovery, and receipt boundaries; a new channel or provider is an adapter, never a second payment engine.

## 15. Verification expectations

Before any future live mutation:

- current cash-out and payment regression checks pass;
- amount and fee integrity is verified;
- attribution encoding is verified;
- durable persistence and reconciliation are available;
- provider acknowledgement is distinguished from terminal success;
- duplicate and unknown-outcome paths are safe;
- client bundles contain no provider secrets;
- the exact live amount and recipient receive explicit approval.

## 16. Architecture north star

> **Say what you want to pay. Review exactly what will happen. Approve once. Providus handles the rails and proves the result.**

The implementation remains conservative: deterministic money execution, explicit approval, server-side provider boundaries, durable state, truthful settlement, safe recovery, and no invented success.
