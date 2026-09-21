# Providus Brand Messaging

**Status:** Canonical messaging synchronized to P6.12
**Scope:** Product and brand language. This document does not change product behavior.

## Superseded positioning

The previous version of this document positioned Providus as a **Celo route-intelligence agent** for on-ramp comparison, with **Route Check**, **Route Verdict**, **Savings Receipt**, and x402 as the core product story. That framing is **superseded**.

It described a route-comparison/on-ramp product that is not the current shipped product. Do not blend that audience, mission, terminology, x402 action, or savings language into the current execution-and-verification category. Historical route-intelligence and x402 references may remain in dated planning or integration records, but they are not current Providus messaging.

## Category

> **Providus is a safety-first conversational payment execution layer that turns user-approved requests into verified real-world payments.**

Plain-language explanation: users tell Providus what they want to pay, review the exact action, approve it, and receive evidence of what actually happened.

## One-line description

> **Providus turns approved messages into verified real-world payments.**

## Hero

### Headline

> **Ask. Approve. Prove.**

### Subhead

> Tell Providus what you want to pay. It prepares the exact terms, waits for your approval, executes through Celo and local payment rails, verifies each stage, and gives you a receipt for the outcome.

For the current product, this means Celo USDC bank cash-out and a verified Nigerian airtime flow.

## Product promise

> **You tell Providus what should happen. It prepares the payment, waits for your approval, executes through the right rails, verifies the real-world outcome, and gives you proof.**

The promise is bounded by supported flows and provider availability. Never present an intermediate transaction, provider acknowledgement, or stale quote as delivery proof.

## Narrative tension

> **Conversational payments aren’t the hard part. Proving the real-world outcome is.**

A conversation can express intent, but it does not prove that money moved correctly, NGN was delivered, or airtime reached a phone. Real payments cross asynchronous systems with different failure, timing, and retry rules. Providus makes those boundaries visible and reconciles the path after intent parsing.

## Three product pillars

### Ask naturally

Users describe the intended outcome in ordinary language. Providus turns supported requests into a typed, validated `PaymentIntent` and asks for missing or ambiguous fields.

### Approve explicitly

Users review recipient, network, amount, quote, fees, expiry, and total. No money moves until the user approves the exact action and separately signs the exact Celo wallet transfer.

### Verify the outcome

Providus separates on-chain confirmation, NGN settlement, and last-mile fulfilment. It reconciles uncertain states, avoids blind retries, and issues a receipt for evidence-backed results.

## Core principle

> **LLM owns language. Deterministic code owns money.**

The LLM may interpret language, ask questions, and explain recorded state. It does not create an executable transaction, alter approved payment-critical fields, authorize a provider mutation, sign a wallet transfer, select a success state, or invent a refund. Deterministic code validates the `PaymentIntent`, binds amounts and fees, enforces approval, controls provider calls, persists state, reconciles outcomes, and builds the receipt.

## Primary user stories

### Nigerian stablecoin user

“I hold Celo USDC and want to pay for something useful in Nigeria without coordinating a wallet, off-ramp, settlement status, and utility provider myself.”

### Airtime sender

“I want to say ‘Send ₦1,000 MTN airtime to this number,’ review the exact payment, approve it, and know whether the airtime was actually delivered.”

### Cash-out user

“I want to cash out Celo USDC to a verified Nigerian bank account, see the quote and fees before signing, and distinguish a Celo deposit from Nigerian bank delivery.”

### Judge or integrator

“I need to see that the assistant is not the money authority, that provider boundaries are deterministic, and that the receipt proves the stages that actually completed.”

## Tone and voice rules

| Rule | Use | Avoid |
|---|---|---|
| Plainly practical | “Approve the exact payment, then we verify what happened.” | “Activate your autonomous financial future.” |
| Control-first | “Your connected wallet signs the transfer.” | “Providus handles everything.” |
| Precise about state | “Paycrest confirmed fiat delivery; protocol settlement is tracked separately.” | “The payment is guaranteed.” |
| Evidence-led | “Airtime is complete only after provider status `200`.” | “The provider accepted the request, so it succeeded.” |
| Calm about uncertainty | “This outcome is unknown; Providus will reconcile the original reference.” | “Retry now” after an ambiguous mutation. |
| Conversational, not magical | “Tell Providus what you want to pay.” | “AI knows the best route.” |

Use: **ask, approve, exact, quote, fee, verify, reconcile, delivered, proof, receipt, supported, current, pending, unknown.**

Avoid: **guaranteed, first, best, only, magic, frictionless, autonomous spending, AI controls the payment, seamless wealth, route intelligence, Route Check, Route Verdict, Savings Receipt, x402 payment** as current product language.

## Current shipped truth

- Web dashboard conversational assistant.
- Validated airtime `PaymentIntent` flow.
- Celo mainnet USDC.
- Paycrest settlement adapter.
- Neon PostgreSQL (managed Postgres) + Drizzle durable transaction state.
- Paycrest reconciliation, durable monotonic fiat-finality, and distinct fiat-delivery/protocol-settlement states.
- ClubKonnect airtime fulfilment adapter with deterministic RequestID and reconciliation.
- Evidence-linked receipt surface.
- Owner-scoped receipt evidence: receipt and payment-instruction reads are wallet-checked server-side before any DTO or evidence is returned, while the default status endpoint stays a sanitized public status read.
- Separate Nigerian bank cash-out flow through Paycrest.
- One completed live human-gated airtime run demonstrating the complete request → receipt chain.

The live run proves one end-to-end execution. It is not a universal guarantee for every payment, provider state, recipient, or future channel.

## Safe claims

- Providus turns user-approved messages into verified real-world payments for supported flows.
- Providus has completed a human-gated Celo mainnet USDC → NGN settlement → Nigerian airtime run.
- Providus separates language interpretation from deterministic money execution.
- Explicit human approval precedes order creation and browser-wallet signing.
- Paycrest authoritatively binds the provider fee and total before the wallet transfer.
- Celo deposit verification is distinct from Paycrest fiat-delivery reconciliation.
- ClubKonnect fulfilment completes only on its documented terminal success state.
- Durable state, deterministic RequestIDs, idempotency, and recovery protect the current airtime orchestration.
- The receipt shows approved payment terms and execution, settlement, fulfilment, and outcome evidence available for the transaction.
- Owner-scoped receipt evidence is server wallet-checked; the generic status read remains sanitized and public.

## Qualified roadmap claims

Use **“designed to,” “architecture supports,” “future adapter,” “roadmap,”** or **“not shipped”** for:

- data bundles, electricity, cable, or a broader utility catalogue;
- iMessage/Photon, WhatsApp, Telegram, MiniPay, or other channels;
- additional settlement rails or fulfilment providers;
- multi-provider production support;
- autonomous or recurring spending with permissions/session keys;
- broader remittances, multi-country support, or agent-to-agent payment surfaces.

Photon/iMessage is a future adapter/proof opportunity, not the core payment engine.

## Claims never to use

- “First AI payment agent on Celo.”
- “First Nigerian stablecoin bill-pay product.”
- “Only,” “best,” or “most reliable” without independently verifiable evidence.
- “Every payment is guaranteed.”
- “Celo confirmation means NGN delivery.”
- “Paycrest settled” as shorthand for fiat delivery. Use `validated` for the authoritative fiat-delivery condition and describe `settled` as separately tracked protocol completion.
- “Paycrest automatically funds ClubKonnect.”
- Autonomous spending without explicit human approval.
- Production support for channels, providers, or utility categories not shipped.
- Wording that gives the LLM custody, signing authority, or success authority.
- “Verified” ERC-8021 attribution from the static tag alone. Say attribution configured or applied, or refer to the ERC-8021 attribution tag.
- A refund claim unless a refund was actually verified.

## Demo narrative

1. User requests Nigerian airtime in natural language.
2. Providus validates the structured `PaymentIntent`.
3. The user reviews the recipient, network, amount, quote, fees, expiry, and exact total.
4. Paycrest binds authoritative fees; the user approves order creation.
5. The browser wallet signs the exact Celo USDC transfer.
6. Providus verifies the on-chain deposit.
7. Providus reconciles Paycrest until durable fiat-final truth is recorded — set when `validated` confirms fiat delivery, with `settled` also satisfying it as later protocol completion. A later raw `settling` event never clears it.
8. Only then does the ClubKonnect adapter submit/reconcile fulfilment using its deterministic RequestID.
9. ClubKonnect status `200` verifies airtime delivery.
10. The receipt presents the approved terms and available execution, settlement, fulfilment, and outcome evidence.

The current operating model uses a Providus fulfilment float. The demo does not imply automatic Paycrest-to-ClubKonnect funding.

## Channel thesis

Channels are presentation and conversation adapters, not independent payment engines:

```text
Channel
→ Conversation Layer
→ PaymentIntent Engine
→ Human Approval Boundary
→ Providus Execution Engine
→ SettlementRail + FulfilmentProvider adapters
→ Reconciliation
→ Verified Outcome
→ Receipt
```

Web is the current channel. iMessage/Photon, WhatsApp, Telegram, MiniPay, and other surfaces are future adapters over the same execution and proof layers.

## Provider-agnostic thesis

Current adapters:

- **SettlementRail:** Paycrest
- **FulfilmentProvider:** ClubKonnect

Providus owns intent validation, approval, orchestration, durable state, fee binding, reconciliation, recovery, idempotency, verified outcome classification, and the receipt. Future rails/providers can implement adapter contracts without becoming independent payment engines.

This is an architectural principle, not a claim of multi-provider production support today. Paycrest and ClubKonnect remain infrastructure that Providus coordinates and verifies; Providus does not replace either provider.

## Canonical source hierarchy

For current category, promises, claims, and differentiation, use:

1. `docs/positioning.md`
2. `docs/competitive-positioning.md`
3. `docs/live-airtime-e2e.md` for the single live proof
4. this document for brand and messaging application

Older route-intelligence/on-ramp/x402 material is superseded and must not be used as current product copy.
