# Providus Competitive Positioning

**Status:** Canonical P6.11 positioning freeze
**Purpose:** Factual framing for judges, product copy, and future positioning work. This is not a ranking or a claim that Providus is better than any named product.

## Competitive thesis

Many products overlap with part of the job: conversational Celo payments, stablecoin remittances, Nigerian utility purchasing, local spending, settlement, or utility fulfilment. Providus is positioned around the layer after language understanding:

> **The hard part is not turning a message into a payment attempt. The hard part is proving what happened across the wallet, chain, settlement rail, and last-mile provider.**

Providus is the control and evidence layer that turns an approved request into a reconciled real-world outcome. It does not claim to own every rail in that path.

## Competitor categories

| Category | Representative products | Overlapping job |
|---|---|---|
| Conversational Celo payments and Nigerian utility actions | RonPay | Ask for and execute Nigerian airtime/data/bill payments through a conversational Celo experience. |
| Conversational or agentic stablecoin remittance | CeloFlow, Pulse Remit | Express a stablecoin transfer/remittance intent and move value through an agentic or conversational surface. |
| Stablecoin-funded Nigerian utility purchasing | BitGifty | Use stablecoins for Nigerian airtime, data, electricity, or cable services. |
| Stablecoin-to-local spending/off-ramp | Fonbnk, Pretium | Convert or route stablecoin value into local spending or bill-use cases. |
| Settlement infrastructure | Paycrest | Convert/settle crypto value into NGN through an off-ramp rail. |
| Utility fulfilment infrastructure | ClubKonnect | Deliver airtime and other local VTU/utility services through provider APIs. |

The categories describe product layers, not a complete market taxonomy. The overlap descriptions reflect the competitive brief and should be rechecked before making product-specific public claims.

## Factual product-layer framing

| Product | Overlapping job | Different product layer | Providus distinction |
|---|---|---|---|
| **RonPay** | Conversational Celo payments for Nigerian airtime, data, and bills. | Consumer-facing conversational payment and utility experience. | Providus focuses its differentiation on the post-intent control path: explicit approval, deterministic execution, settlement/fulfilment reconciliation, and proof. No superiority claim. |
| **CeloFlow** | Conversational or agentic stablecoin remittances. | Conversational remittance/payment movement. | Providus’s current proof is a staged Nigerian payment outcome, including Paycrest settlement and ClubKonnect fulfilment verification, rather than a generic remittance claim. No superiority claim. |
| **Pulse Remit** | Conversational or agentic stablecoin remittances. | Remittance/payment movement layer. | Providus emphasizes durable state, unknown-outcome recovery, explicit wallet approval, and a receipt that joins multiple stages. No superiority claim. |
| **BitGifty** | Stablecoin-powered Nigerian airtime, data, electricity, and cable use. | Stablecoin utility purchasing/service frontend. | Providus distinguishes its product story by the execution controls and verification chain behind the purchase: typed intent, provider-authoritative fee binding, reconciliation, deterministic RequestID/idempotency, and evidence-backed completion. No superiority claim. |
| **Fonbnk** | Stablecoin value reaching local spending or bill use. | Local spending/off-ramp or access layer. | Providus is not positioned as another local-spending rail; it coordinates a user-approved action across a settlement adapter and fulfilment adapter, then proves the outcome. No superiority claim. |
| **Pretium** | Stablecoin value reaching local spending or bill use. | Local spending/off-ramp or access layer. | Providus owns approval, orchestration, state, recovery, and proof around the current rails; it does not claim to replace local spending infrastructure. No superiority claim. |
| **Paycrest** | Celo/crypto value settling into NGN. | Settlement/off-ramp infrastructure. | Paycrest is Providus’s current settlement adapter. Providus adds the intent, approval boundary, durable orchestration, cross-stage reconciliation, recovery policy, and user-facing receipt. Providus is not a Paycrest replacement. |
| **ClubKonnect** | Airtime and local utility delivery. | Utility/VTU fulfilment infrastructure. | ClubKonnect is Providus’s current fulfilment adapter. Providus calls it only after the required settlement state, uses a deterministic RequestID, reconciles uncertain status, and exposes verified delivery in the receipt. Providus is not a ClubKonnect replacement. |

## Providus differentiation

These are the evidence-backed properties that should anchor positioning. They are product behaviors, not novelty claims:

1. **Explicit human approval before money moves** — the user reviews the payment-critical fields and separately signs the wallet transfer.
2. **Language/execution separation** — the LLM interprets and explains; deterministic code validates, authorizes boundaries, executes, and decides state transitions.
3. **Deterministic `PaymentIntent`** — conversational input becomes a typed, validated action rather than an opaque model decision.
4. **Provider-authoritative fee binding** — the exact provider fees and total are bound at order creation; the wallet is prompted for the bound amount.
5. **Non-custodial wallet signing** — the user’s browser wallet signs the Celo USDC transfer; Providus never receives private keys.
6. **On-chain Celo verification** — the deposit is checked against the expected sender, receiver, token, and amount.
7. **Off-chain settlement reconciliation** — Celo confirmation is kept distinct from Paycrest’s authoritative NGN-delivery state.
8. **Last-mile fulfilment verification** — ClubKonnect acknowledgement is not treated as delivery; only the documented terminal success is completed.
9. **Deterministic provider RequestIDs/idempotency** — repeated signals query the same fulfilment reference instead of creating a duplicate purchase.
10. **Unknown-outcome recovery** — a timeout or ambiguous mutation records the original reference and routes to safe reconciliation/recovery; it is never blindly retried. ClubKonnect unknown fulfilment outcomes query the same RequestID.
11. **Durable transaction state** — the orchestration survives refresh/restart and records the lifecycle across asynchronous systems.
12. **Unified evidence-linked receipt** — the user can see the request, Celo proof, settlement evidence, fulfilment evidence, and verified outcome in one surface.
13. **Channel-independent architecture** — future conversational surfaces can adapt into the same intent, approval, execution, reconciliation, and receipt path instead of owning payment logic.

The current product evidence is strongest for the web-based Celo USDC → Paycrest → ClubKonnect airtime flow and the separate bank cash-out flow. Do not imply that every listed property is available through every future channel or provider.

## Claims to avoid

Never use:

- “first AI payment agent on Celo”;
- “first Nigerian stablecoin bill-pay product”;
- “only” or “best” without independently verifiable evidence;
- “autonomous spending” for current flows;
- production support for Photon/iMessage, WhatsApp, Telegram, MiniPay, additional providers, or unshipped utility categories;
- “guaranteed settlement,” “guaranteed delivery,” or equivalent language;
- “Paycrest automatically funds ClubKonnect”;
- “Celo transaction confirmed” as shorthand for Nigerian delivery;
- provider acknowledgement as final success;
- “Providus replaces Paycrest/ClubKonnect”;
- wording that gives the LLM custody, signing authority, or success authority.

## Positioning implications

### Lead with verified outcomes, not AI novelty

The conversational interface is the entry point, not the moat claim. The message should move quickly from “ask” to what happens after approval: exact terms, execution boundaries, reconciliation, and proof.

### Treat Celo as an execution rail, not the entire category

Celo matters because it supplies the user-approved on-chain payment leg and verifiable transaction evidence. The product category is broader: safe execution across on-chain and off-chain systems.

### Make the receipt the narrative payoff

A successful demo should not end at wallet confirmation. It should end at a verified Nigerian outcome and a receipt that explains the stages. This is the clearest way to show what Providus owns.

### Keep infrastructure roles honest

Paycrest and ClubKonnect are valuable current adapters. Naming them accurately increases credibility: Providus coordinates and verifies the path; it does not claim to be either underlying provider.

### Keep future channels and providers separate from current proof

Photon/iMessage and other surfaces are adapter opportunities. Additional settlement rails and fulfilment providers are architectural extension points. Neither should be presented as shipped capability until implemented and verified.

### Explain safety in ordinary language

For judges and nontechnical users, say: **“You approve the exact payment, Providus checks each stage, and you get proof of what happened.”** Introduce `PaymentIntent`, RequestIDs, reconciliation, and idempotency as the mechanisms behind that promise—not as the headline.

## Canonical comparison sentence

**Where other products may own the conversation, remittance, settlement, or utility purchase, Providus is positioned around the verified execution path that connects an approved request to a proven real-world result.**
