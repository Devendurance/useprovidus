# Providus PRD

**Product:** Providus<br/>
**Category:** Celo-native Nigerian payments agent<br/>
**Primary hackathon:** Celo Agents at Work<br/>
**Primary track:** Real World Adoption
**Product principle:** **Say the payment. Review it. Approve it. Prove the result.**

---

## 1. Executive summary

Providus turns Celo stablecoins into useful Nigerian financial actions.

Today, the product already supports a real **Celo USDC → Nigerian bank cash-out** path through Paycrest.

The next hackathon experience adds a command-first payment layer so a user can type requests such as:

- “Send ₦500 airtime to this number.”
- “Buy 1GB MTN data for me.”
- “Pay my electricity bill.”
- “Renew my GOtv subscription.”

Providus interprets the request, shows the exact recipient/service/amount and estimated USDC cost, requires explicit approval, then coordinates the underlying payment rails.

For the deadline, the first complete new vertical slice is:

> **Celo USDC → Paycrest → confirmed NGN settlement → ClubKonnect → airtime.**

Data is next only if airtime is stable. Electricity and cable remain later because they need stronger verification and reconciliation.

---

## 2. Problem

Celo stablecoins are useful onchain, but everyday Nigerian spending still happens through local bank and utility rails.

A user who holds USDC should not need to understand:

- off-ramp APIs;
- exchange-rate endpoints;
- bank settlement state;
- VTU network codes;
- provider retries;
- payment references;
- multiple dashboards.

The user’s job should be to express the desired outcome and approve the exact payment.

Providus handles the rail complexity without hiding what is happening.

---

## 3. Current shipped product

### Live

- Celo mainnet wallet connection.
- Celo USDC balance/payment flow.
- Paycrest live sell quote.
- Nigerian institution/account verification.
- Paycrest off-ramp order creation.
- Direct USDC transfer to the Paycrest per-order receive address.
- Real USDC → NGN bank cash-out has been successfully exercised.

### Known current limitation

The app currently treats the Celo transaction receipt as its last programmatic checkpoint.

It does not yet durably track Paycrest through final NGN delivery.

That gap must be fixed before automatic utility fulfilment is allowed.

### On-ramp

Naira → Celo USDC architecture exists conceptually/partially, but provider support is not ready enough to make it the current hackathon focus.

---

## 4. Target user

### Primary

A Nigerian stablecoin user who has Celo USDC and wants to turn it into an everyday local payment without manually navigating multiple providers.

### Secondary

- freelancers/remote workers receiving stablecoins;
- family members paying airtime/data for someone else;
- crypto-native users who want simple NGN utility payments;
- agents/apps that may later invoke a safe Providus payment action.

---

## 5. Core experience

### Command flow

1. User opens the Providus dashboard.
2. User enters a natural command.
3. Providus parses the payment intent.
4. Providus asks for any missing critical field.
5. Providus fetches the current Paycrest quote/fee information.
6. Providus shows a confirmation card.
7. User explicitly approves.
8. Providus creates a durable transaction record and Paycrest order.
9. User signs the Celo USDC transfer.
10. Providus tracks Paycrest until the documented fiat-delivery condition.
11. Providus triggers ClubKonnect airtime fulfilment.
12. Providus reconciles ClubKonnect to a final result.
13. User receives a truthful receipt.

---

## 6. Airtime confirmation card

Must show:

- action: airtime;
- recipient phone number;
- mobile network;
- NGN face value;
- estimated/quoted USDC amount;
- provider/payment fees separately where available;
- total USDC to be sent;
- quote freshness / expiry;
- Celo mainnet;
- explicit confirmation CTA.

The user must be able to correct the network before payment.

A phone prefix may be used only as a suggestion because mobile number portability can make prefix-based detection wrong.

---

## 7. MVP scope

### Must have before a real airtime demo

- existing bank cash-out remains working;
- financial amount-integrity bug fixed;
- active ERC-8021 hackathon attribution tag wired correctly;
- durable transaction persistence;
- Paycrest post-deposit reconciliation;
- deterministic airtime intent parser;
- command box + confirmation card;
- server-only ClubKonnect client;
- provider readiness/balance check where available;
- unique ClubKonnect RequestID;
- ClubKonnect final-state reconciliation;
- receipt/history state;
- explicit approval before money movement;
- no blind payment retries;
- mobile-usable flow;
- test coverage for duplicate and partial-failure paths.

### Should have if time remains

- data bundle purchase;
- richer natural-language aliases;
- transaction history on dashboard;
- polished progress timeline;
- shareable payment receipt.

### Defer

- electricity;
- cable TV;
- every VTU category;
- IPO payments;
- cNGN redesign solely to chase a bounty;
- remittance expansion;
- broad multi-country support;
- autonomous payment without confirmation;
- Kotani integration;
- custody;
- broad LLM agent framework;
- custom smart contracts.

---

## 8. Intent model

Executable MVP intent:

```ts
type AirtimeIntent = {
  type: "airtime"
  amountNgn: string
  phone: string
  network?: "mtn" | "airtel" | "glo" | "9mobile"
}
```

The parser can be deterministic for reliability.

If an LLM is later added:

- it may interpret language;
- it may not silently invent recipients;
- it may not change amount/network after confirmation;
- it may not authorize a transaction;
- payment-critical fields must be schema validated.

Unsupported commands should return a clear “not available yet” state rather than pretending to execute.

---

## 9. Settlement model

### Provider roles

**Paycrest**
- crypto → NGN off-ramp;
- quote/order/settlement rail.

**ClubKonnect**
- local VTU/utility fulfilment;
- first target: airtime.

### Critical assumption

Paycrest does **not** automatically fund ClubKonnect.

Hackathon operating model:

1. Providus maintains a small prepaid NGN ClubKonnect float.
2. User payment settles through Paycrest.
3. Providus confirms the Paycrest fiat-delivery condition.
4. Providus spends from the prepaid ClubKonnect balance to fulfil airtime.
5. Paycrest NGN proceeds economically replenish the operating float through an external process unless a direct integration is later proven.

Do not claim an automatic Paycrest → ClubKonnect transfer unless it is actually implemented and verified.

A designated Providus NGN payout destination must exist before a live airtime order is attempted.

---

## 10. Transaction states

Internal state must be more truthful than a single “success” flag.

Recommended:

```text
pending
settling
settled
processing
completed
failed
refunded
```

Interpretation:

- `pending` — intent/order exists; payment not yet confirmed;
- `settling` — Celo payment sent/confirmed, Paycrest fiat delivery pending;
- `settled` — required Paycrest fiat-delivery milestone reached (`validated` fiat delivery confirmed); for `cash_out` this is the effective terminal business outcome, while for utility transactions it enables downstream fulfilment;
- `processing` — ClubKonnect fulfilment submitted/reconciling;
- `completed` — airtime final success verified;
- `failed` — terminal failure requiring user-facing explanation/review;
- `refunded` — refund actually occurred.

Never write `refunded` merely because fulfilment failed.

---

## 11. Reliability rules

- Initial provider acknowledgement is not final success.
- Unknown request outcome is not permission to create another order.
- Duplicate callbacks/polls must not trigger duplicate airtime.
- Quote expiry forces a fresh confirmation when economics change materially.
- Persist an orchestration before crossing irreversible provider boundaries.
- Upstream amount returned by Paycrest must exactly match the approved amount.
- Every provider mutation gets a unique/idempotent reference.
- No full account numbers/API keys in logs.
- Payment and provider calls stay server-side except the user’s wallet signature.

---

## 12. Celo / hackathon requirements

Current Agents at Work identity:

```text
ERC-8004: https://8004scan.io/agents/celo/9851
Agent ID: 9851
```

Current locked attribution tag:

```text
celo_8190b99392a2
```

Registered tracks:

- `real-world-adoption` — primary;
- `value-moved`;
- `askbots-growth`;
- `judges-favorite`;
- `cpay-feedback`.

All eligible new Celo transactions intended for hackathon attribution must use the active tag once ERC-8021 support is correctly implemented.

Do not use the old hackathon tag `celo_91fed90b97fc`.

---

## 13. Track strategy

### Real World Adoption

The product itself should prove the track:

- stablecoin holder;
- real Nigerian need;
- user approval;
- real local payout/fulfilment;
- truthful receipt.

### Value Moved

Use real economic activity only.

Prefer transactions involving genuine usage/independent participants rather than self-generated volume.

### AskBots Growth

Baseline review must happen before the P0 hardening changes. Preserve findings and scores, implement improvements, then complete the second review.

### Judges’ Favorite

Win attention through one coherent end-to-end experience, not feature count:

> command → confirm → Celo → local rail → proof.

### buy feedback

Treat beta testing/feedback as a separate track workstream. Do not distort the core Providus architecture merely to satisfy it.

---

## 14. Security & privacy

- Paycrest and ClubKonnect keys are server-only.
- `.env` must stay out of git.
- If a secret is found in git history, rotate it.
- Never print credential values in diagnostics.
- Bank account details should be minimized and masked in logs.
- Phone numbers should be minimized in logs.
- Use exact decimal arithmetic.
- Validate all provider payloads.
- Never blindly retry a payment.
- User approval is required before wallet submission.
- No autonomous background spending in this MVP.

---

## 15. Success metrics

### Product north star

> **Completed real-world payments from Celo stablecoins with truthful end-to-end proof.**

### Hackathon evidence

- successful tagged Celo mainnet payment activity after attribution implementation;
- real Paycrest settlement;
- completed airtime fulfilment;
- number of genuine users/signers;
- repeat usage if achieved organically;
- zero duplicate fulfilment incidents;
- AskBots baseline-to-round-2 improvement;
- public demo quality;
- useful buy feedback submission.

Do not optimize metrics through spam or meaningless transactions.

---

## 16. Demo script

Ideal submission demo:

1. User connects a Celo wallet holding USDC.
2. User types: `Send ₦500 airtime to 080...`
3. Providus parses the command.
4. Confirmation card shows phone, network, NGN amount, USDC total and fee.
5. User corrects/accepts the network and approves.
6. Wallet signs the tagged Celo USDC transaction.
7. Providus shows `Settling with Paycrest`.
8. Paycrest fiat delivery is reconciled.
9. Providus moves to `Delivering airtime`.
10. ClubKonnect final success is reconciled.
11. Receipt shows completed airtime and transaction evidence.
12. Existing bank cash-out remains available as a separate proven flow.

If final provider settlement cannot be demonstrated safely before the deadline, do not fake a completed state.

---

## 17. Definition of done

The airtime MVP is done only when:

- existing cash-out regressions pass;
- repo secrets are not exposed;
- active attribution tag is correctly encoded;
- transaction survives page refresh/server restart;
- user intent is validated;
- approval is explicit;
- Paycrest order amount integrity is enforced;
- Paycrest settlement is programmatically reconciled;
- ClubKonnect fulfilment is idempotent;
- provider acknowledgement is not treated as final success;
- a terminal completed/failed state is truthful;
- one explicitly approved mainnet demo can run end to end;
- README/docs distinguish shipped functionality from future categories;
- project remains ready for final Celo Builders submission.
