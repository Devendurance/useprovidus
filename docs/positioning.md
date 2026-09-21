# Providus Positioning

**Status:** Canonical P6.14 positioning freeze
**Scope:** Strategy and documentation only. This document does not change product behavior.
**Public trust surface:** [/how-it-works#trust](/how-it-works#trust) — synchronized with [`README.md`](../README.md), [`docs/providus_PRD.md`](./providus_PRD.md), and [`docs/PROVIDUS_ARCHITECTURE.md`](./PROVIDUS_ARCHITECTURE.md).

## Category

**Providus is a safety-first conversational payment execution layer that turns user-approved requests into verified real-world payments.**

In plain language: users say what they want to pay, review the exact action, approve it, and receive proof of what actually happened.

## Positioning statement

For people who hold Celo USDC and need a Nigerian payment they can trust, Providus turns an approved message into a real-world outcome through explicit human approval, deterministic execution, settlement reconciliation, fulfilment verification, and an evidence-linked receipt. Providus is not the wallet, settlement rail, or utility provider; it is the control and proof layer across them.

## Product promise

> **You tell Providus what should happen. It prepares the payment, waits for your approval, executes through the right rails, verifies the real-world outcome, and gives you proof.**

The promise is bounded by supported flows and provider availability. Providus never treats a submitted transaction, provider acknowledgement, or intermediate status as delivery proof.

## Trust architecture

The public trust story is one section on [/how-it-works#trust](/how-it-works#trust); this is the same story in positioning terms.

**Canonical sequence**

```text
Web today (future iMessage / WhatsApp / Telegram / MiniPay are roadmap-only)
→ Conversation Layer
→ PaymentIntent Engine
→ Human Approval Boundary
→ Providus Execution Engine
→ two separate provider edges:
     SettlementRail / Paycrest (current)                     → Celo USDC → NGN settlement
     FulfilmentProvider / ClubKonnect (current for airtime)  → airtime fulfilment
→ Reconciliation + Recovery
→ Verified Outcome
→ Receipt
```

**Who owns what**

| Owner | Owns | Does not own |
|---|---|---|
| **User** | Approval and browser-wallet signing | Nothing moves without both |
| **LLM** | Language interpretation, clarification, structured candidate data | Payment-critical fields, provider calls, signing, success states, refunds |
| **Deterministic Providus code** | PaymentIntent validation, quote/fee binding, execution eligibility, durable state, reconciliation, fulfilment gating, recovery, receipts | No success claim it cannot evidence |
| **Paycrest** | Celo USDC → NGN settlement | Fulfilment or fulfilment gating |
| **ClubKonnect** | Airtime fulfilment | When it is called, or whether its result ends the lifecycle |
| **Celo** | On-chain payment evidence | NGN delivery or utility fulfilment |
| **Neon PostgreSQL + Drizzle** | Durable transaction state | Provider truth that has not been reconciled |

**State semantics.** `validated` is authoritative fiat delivery: it sets the durable monotonic fiat-final marker and is the point at which fulfilment becomes eligible. `settling` is later protocol progression and never clears fiat delivery or re-blocks fulfilment. `settled` is protocol completion and also subsumes prior fiat delivery. Public stage labels come only from `lib/transactions/status.ts`; `deposit_confirming` is declared but never emitted and is never shown. Exceptional branches are `failed`, `recovery_required`, and `refunded`; the unresolved provider-status branch is a recovery branch, not a failure and not a success.

**Recovery.** Provider acknowledgement is never final success. Unknown outcomes are reconciled against the durable Paycrest order reference or the deterministic ClubKonnect RequestID recorded at claim time, and are never blindly retried with a new reference.

**Roadmap only.** iMessage/Photon, WhatsApp, Telegram, MiniPay, additional settlement rails, and additional fulfilment providers are roadmap-only: they are not shipped, not production-supported, and not current product claims.

## Current shipped truth

- Web dashboard conversation can produce a validated airtime `PaymentIntent`.
- Supported airtime flow: Celo USDC → Paycrest NGN settlement → ClubKonnect airtime.
- Direct Nigerian bank cash-out through Paycrest remains a separate supported flow.
- Human approval precedes Paycrest order creation and the browser-wallet transfer.
- Paycrest binds the authoritative fee and total before the wallet payment.
- Providus verifies the Celo transfer, reconciles Paycrest settlement, reconciles ClubKonnect fulfilment, and records durable transaction state in Neon PostgreSQL (managed Postgres) through Drizzle. Fiat-finality is persisted monotonically once the authoritative fiat-delivery status is observed.
- The completed live proof is a human-gated ₦1,000 MTN airtime payment on Celo mainnet with a verified receipt.
- The shipped utility slice is airtime. Data bundles, electricity, cable, and other utility categories are roadmap-only: not shipped in this freeze.
- Web is the current channel. iMessage/Photon, WhatsApp, Telegram, MiniPay, and other channels are roadmap-only adapters, not shipped payment engines.
- Paycrest and ClubKonnect are the current providers, at two separate edges. Multi-provider production support is an architectural direction, not a current product claim.
- Receipt evidence is owner-scoped: an explicit receipt or payment-instruction read is checked server-side against the stored transaction wallet before any DTO or evidence is returned, while generic status reads remain a sanitized public status response.
- The current airtime operating model does not claim automatic Paycrest-to-ClubKonnect funding: Paycrest settlement and ClubKonnect fulfilment are separate adapter stages coordinated by Providus.

## Target users and use cases

### Primary user

A Nigerian stablecoin user with Celo USDC who wants a local payment without manually coordinating a wallet, off-ramp, settlement status, and utility provider.

### Useful current actions

- Request Nigerian airtime conversationally, review the exact recipient/network/amount, approve, and receive verified delivery proof.
- Cash out Celo USDC to a verified Nigerian bank account through the existing Paycrest flow.
- Inspect the evidence and lifecycle of a payment instead of relying on a single success label.

### Future use cases

Additional utility categories and conversational channels may use the same execution model after their rails and reconciliation are implemented. They are not promises of current availability.

## Messaging hierarchy

### A. One-line product description

**Providus turns approved messages into verified real-world payments.**

### B. Hero headline

**Ask. Approve. Prove.**

### C. Hero subhead

**Tell Providus what you want to pay. It prepares the exact terms, waits for your approval, executes through Celo and local payment rails, verifies each stage, and gives you a receipt for the outcome.**

For the current product, this means Celo USDC bank cash-out and a verified Nigerian airtime flow.

### D. Core narrative

Conversational payment UX is useful, but conversation alone does not make a payment safe. A language model can understand a request; it should not decide what money moves, sign a transaction, or declare that a provider delivered.

Real payments cross asynchronous systems. A user approval, a provider order, an on-chain transfer, an NGN settlement, and a utility fulfilment call are different events with different failure and retry rules. A Celo deposit is not automatically Nigerian delivery, and a provider acknowledgement is not automatically airtime success.

Providus makes those boundaries explicit. It converts language into a typed `PaymentIntent`, freezes the terms for review, binds provider-authoritative fees, and pauses at the human approval boundary before execution.

After approval, deterministic orchestration carries the transaction through Celo, settlement, and fulfilment. Providus reconciles uncertain states instead of blindly retrying, records durable progress, and shows completion only when the real-world outcome is verified. The receipt is the product’s final answer: the requested action, the recorded lifecycle stages, and the evidence that proves the result.

### E. Three product pillars

1. **Ask naturally** — Describe the intended outcome in ordinary language. Providus turns supported requests into a structured, validated `PaymentIntent` and asks for missing or ambiguous fields.
2. **Approve explicitly** — Review the recipient, amount, network, quote, fees, expiry, and total. No money moves until the user approves the exact action and signs the exact wallet transfer.
3. **Verify the outcome** — Separate on-chain confirmation, NGN settlement, and last-mile fulfilment. Reconcile each stage, recover unknown outcomes safely, and issue a receipt only for evidence-backed results.

### F. Technical principle

> **LLM owns language; deterministic code owns money.**

The LLM may interpret a message, ask a conversational question, or explain a recorded state. It does not create an executable transaction, alter approved payment-critical fields, authorize a provider mutation, sign a wallet transfer, choose a success state, or invent a refund. Deterministic code validates the `PaymentIntent`, binds amounts and fees, enforces approval, controls provider calls, persists state, reconciles outcomes, and builds the receipt.

### G. Demo narrative

1. **Request:** The user says, “Send ₦1,000 MTN airtime to this number.”
2. **Intent:** Providus produces a deterministic airtime `PaymentIntent` and confirms the recipient, network, and amount.
3. **Review:** A time-bound quote is shown; Paycrest authoritatively binds the provider fee and exact USDC total when the order is prepared.
4. **Approval:** The user approves order creation, then explicitly signs the exact Celo USDC transfer in a browser wallet. The server never takes custody.
5. **Celo:** Providus verifies the on-chain deposit to the bound Paycrest address.
6. **NGN:** Providus reconciles Paycrest until the documented fiat-delivery condition is authoritative. This is not claimed from the chain transaction alone.
7. **Utility:** Only after durable fiat-final truth is recorded does Providus call ClubKonnect through the fulfilment adapter. That truth is set when Paycrest reports the authoritative fiat-delivery status `validated`; upstream `settled` also satisfies it because it subsumes fiat delivery and records protocol completion, and a later raw `settling` event never clears it. A deterministic RequestID and one-shot mutation guard protect the fulfilment call.
8. **Receipt:** Providus reconciles the provider result and shows a verified receipt linking the request, Celo proof, settlement state, fulfilment evidence, and final outcome.

The current live demonstration is this airtime sequence. It does not imply automatic Paycrest-to-ClubKonnect fund movement; the current operating model uses a Providus fulfilment float and explicit state boundaries.

## What Providus is not

- **Not another wallet:** Providus does not custody user funds or replace the user’s browser wallet.
- **Not an LLM with custody:** language interpretation is not financial authority; the model cannot sign, authorize, or declare success.
- **Not just an off-ramp:** Paycrest is one settlement adapter inside a broader approval, orchestration, reconciliation, and proof flow.
- **Not just a VTU or bill-payment frontend:** Providus owns the stateful path from intent through approval to verified outcome, rather than only forwarding a purchase request.
- **Not a Paycrest replacement:** Paycrest currently supplies the settlement rail; Providus binds it into the user-approved flow and reconciles its result.
- **Not a ClubKonnect replacement:** ClubKonnect currently supplies airtime fulfilment; Providus decides when the adapter may be called and verifies what it returned.
- **Not an autonomous spender:** every current money-moving flow has an explicit human approval and wallet-signing boundary.

## Channel thesis

Channels are presentation and conversation adapters, not independent payment engines.

```text
Web today (future iMessage / WhatsApp / Telegram / MiniPay are roadmap-only)
→ Conversation Layer
→ PaymentIntent Engine
→ Human Approval Boundary
→ Providus Execution Engine
→ SettlementRail (Paycrest) + FulfilmentProvider (ClubKonnect) — two separate provider edges
→ Reconciliation + Recovery
→ Verified Outcome
→ Receipt
```

The web dashboard is the current channel. iMessage/Photon, WhatsApp, Telegram, MiniPay, and other conversational surfaces may become additional adapters over the same intent, approval, execution, state, and proof layers. **Photon/iMessage is a future adapter/proof, not the core payment engine.** They are roadmap-only: no future channel is shipped or production-supported by this document.

## Provider-agnostic thesis

The current implementation uses:

- **Settlement rail:** Paycrest
- **Fulfilment provider:** ClubKonnect

These are adapters at the edge of the system:

```text
SettlementRail
├── Paycrest (current)
└── future rails (roadmap-only)

FulfilmentProvider
├── ClubKonnect (current)
└── future providers (roadmap-only)
```

Providus owns the layer that makes a payment safe and legible:

- intent interpretation and deterministic validation;
- human approval boundaries;
- orchestration and durable transaction state;
- provider-authoritative amount/fee binding;
- on-chain and off-chain reconciliation;
- unknown-outcome recovery and idempotency;
- verified outcome classification;
- the unified receipt.

This is an architecture principle. It is not a claim that multiple settlement rails or fulfilment providers are supported in production today.

## Terminology glossary

| Term | Canonical meaning |
|---|---|
| **PaymentIntent** | A typed, validated description of the requested payment action and its payment-critical fields. |
| **Approval boundary** | The explicit point where the user reviews and authorizes the exact action before money moves; wallet signing is a separate explicit action. |
| **Execution engine** | Deterministic Providus code that creates/binds orders, coordinates rails, persists state, and enforces invariants. |
| **Settlement rail** | Infrastructure that converts or settles Celo USDC into the local-value leg; Paycrest is current. |
| **Fulfilment provider** | Infrastructure that delivers the purchased local utility; ClubKonnect is current for airtime. |
| **Fiat-delivery condition** | The authoritative Paycrest fiat-delivery status — `validated`, or `settled` which subsumes it — recorded durably as a monotonic fiat-final marker that permits downstream fulfilment; a Celo deposit alone is not this condition. |
| **`validated`** | Authoritative fiat delivery: the provider confirmed fiat reached the configured recipient/operating account. It sets the durable fiat-final marker and is the safe point to trigger downstream utility fulfilment. |
| **`settling`** | Later protocol progression — Paycrest escrow release in progress. It never clears fiat delivery, never re-blocks fulfilment, and never proves protocol completion. |
| **`settled`** | Paycrest protocol completion, onchain and offchain. It is tracked separately from the fiat-delivery event and also subsumes prior fiat delivery, so it satisfies the fiat-final gate. |
| **Provider acknowledgement** | A received/callback/`100`/`300`/transport-success signal from a provider. It is progress evidence only and is never final success or delivery. |
| **Durable reference** | The persisted Paycrest order reference or deterministic ClubKonnect RequestID recorded at claim time; recovery reconciles against it instead of re-issuing a mutation. |
| **Blind retry** | Re-issuing a mutation whose outcome is unknown. Prohibited: unknown outcomes are recorded and reconciled through the durable reference. |
| **Roadmap-only** | Not shipped, not production-supported, and not a current product claim — the status of every future channel, rail, provider, and utility category. |
| **Reconciliation** | Read-only/status work that resolves provider and chain state without blind duplicate mutation. |
| **Unknown outcome** | A mutation whose final provider result is not known; it requires recovery/query, not an immediate retry. |
| **Verified outcome** | A terminal real-world result supported by the relevant chain, settlement, and/or fulfilment evidence. |
| **Receipt** | The owner-scoped user-facing evidence surface that joins the requested action, lifecycle stages, identifiers, and verified result; owner-scoped reads are wallet-checked server-side. |
| **Non-custodial** | User funds are signed from the user’s connected wallet; Providus never receives private keys or signs for the user. |
| **RequestID** | A deterministic fulfilment reference used to prevent duplicate provider purchases and to reconcile an uncertain result. |

## Claims policy

### Safe claims

These are directly supported by the current implementation and live airtime proof:

- Providus turns user-approved messages into verified real-world payments for supported flows.
- Providus has completed a human-gated Celo mainnet USDC → NGN settlement → Nigerian airtime flow.
- Providus requires explicit approval before order creation and explicit browser-wallet signing before the Celo transfer.
- Providus separates language interpretation from deterministic money execution.
- Paycrest fees and the final USDC total are bound by the provider order before payment.
- Providus verifies the Celo deposit separately from NGN settlement.
- Providus triggers airtime fulfilment only after durable fiat-final truth is recorded from the documented Paycrest fiat-delivery condition.
- ClubKonnect fulfilment uses deterministic RequestIDs, one-shot mutation protection, and reconciliation for uncertain outcomes.
- Providus never blindly retries a mutation with an unknown outcome: it reconciles against the durable Paycrest order reference or the deterministic ClubKonnect RequestID recorded at claim time.
- Providus treats provider acknowledgement, provider callbacks, and intermediate statuses as progress signals, never as final success.
- Providus maintains durable transaction state and issues evidence-linked receipts for verified results.
- Paycrest and ClubKonnect are current adapters, not components Providus claims to replace.

### Qualified claims

Use wording such as **“designed to,” “the architecture supports,” “for supported flows,” “current implementation uses,”** or **“roadmap-only”** for:

- additional settlement rails or fulfilment providers;
- WhatsApp, Telegram, MiniPay, iMessage/Photon, or other channels;
- data bundles, electricity, cable, or a broader bill catalogue;
- channel-independent execution across all future surfaces;
- provider-agnostic orchestration beyond the current Paycrest/ClubKonnect path;
- recovery behavior outside the provider states currently implemented and documented;
- autonomous or recurring spending with session keys/permissions;
- broader remittance or multi-country support.

### Do not claim

- “First AI payment agent on Celo.”
- “First Nigerian stablecoin bill-pay product.”
- That Providus is the first, only, best, or most reliable product in this category without independently verifiable evidence.
- Production support for channels, providers, utility categories, or rails not shipped and tested.
- Autonomous spending without explicit human approval.
- Guaranteed Paycrest settlement, bank delivery, or utility fulfilment.
- That a Celo deposit proves NGN delivery.
- That a provider acknowledgement proves final success.
- That an unresolved provider outcome can be retried blindly or with a new reference.
- That `settling` is fiat delivery, protocol completion, or a reason to re-block fulfilment.
- That `deposit_confirming` is a public stage label; it is declared but never emitted.
- That Paycrest automatically funds ClubKonnect.
- That Providus replaces Paycrest, ClubKonnect, wallets, or local banking/utility infrastructure.
- “AI controls the payment,” “the model signs,” or any wording that gives the LLM money authority.
- That ERC-8021 attribution is “Verified” from the static tag alone. Describe it as attribution configured/applied, or as the ERC-8021 attribution tag.
- A refund unless a refund was actually verified.
