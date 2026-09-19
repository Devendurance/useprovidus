# Providus Architecture

**Status:** Current architecture + near-term Agents at Work target<br/>
**Network:** Celo mainnet
**Repository:** `https://github.com/Devendurance/useprovidus`

This document distinguishes between:

- **SHIPPED** — code that exists now;
- **GAP** — verified missing behavior;
- **TARGET** — the next implementation architecture.

Do not present TARGET components as already live.

---

## 1. Product architecture in one sentence

Providus is evolving from a working **Celo USDC → Nigerian bank cash-out** app into a **user-approved Nigerian payments agent** that can interpret a payment command, settle value through Paycrest, and fulfil airtime/data/utility actions through local providers.

---

## 2. Current shipped stack

| Layer | Current state |
|---|---|
| Frontend | Next.js App Router + TypeScript |
| Wallet | wagmi + viem |
| Network | Celo mainnet |
| Asset | Canonical Celo USDC |
| Off-ramp | Paycrest |
| Server integration | Next.js route handlers + server-only Paycrest client |
| Bank verification | Paycrest institution/account verification |
| Order payment | Direct ERC-20 USDC transfer to Paycrest per-order receive address |
| Persistence | **None currently** |
| Paycrest post-deposit status | **Not implemented currently** |
| ClubKonnect | **Not implemented currently** |
| AI command layer | **Not implemented currently** |
| ERC-8021 attribution | Implemented with `@celo/attribution-tags` (active tag `celo_8190b99392a2` appended to transfer calldata) |

The existing bank cash-out path must remain isolated and working while the agent-payment flow is added.

---

## 3. Current cash-out lifecycle

```text
User
→ Move Money cash-out UI
→ live Paycrest sell quote
→ select bank + enter account
→ server-side account verification
→ explicit review
→ POST /api/paycrest/orders
→ server-side re-verification
→ Paycrest off-ramp order
→ receiveAddress + fees + expiry
→ user signs Celo USDC ERC-20 transfer
→ Celo receipt confirms
→ UI reports on-chain deposit confirmation
```

### Current finality boundary

The current app proves the **Celo deposit transaction**.

It does not yet persist or programmatically reconcile the Paycrest order to confirmed NGN bank delivery.

That is the most important architecture gap before ClubKonnect fulfilment can safely be triggered.

---

## 4. Existing module map

### UI

- `app/dashboard/page.tsx`
- `app/check/page.tsx`
- `components/move/move-money-panel.tsx`
- `components/move/cash-out-recipient.tsx`
- `components/move/cash-out-review.tsx`
- `components/move/cash-out-payment.tsx`

### Paycrest

- `app/api/paycrest/corridor/route.ts`
- `app/api/paycrest/institutions/route.ts`
- `app/api/paycrest/verify-account/route.ts`
- `app/api/paycrest/orders/route.ts`
- `hooks/use-corridor-quote.ts`
- `hooks/use-cash-out-order.ts`
- `lib/paycrest/server/client.ts`
- `lib/paycrest/offramp-payload.ts`
- `lib/paycrest/order.ts`
- `lib/paycrest/recipient.ts`

### Celo wallet / transfer

- `components/ui/connect-wallet-button.tsx`
- `components/providers/wallet-providers.tsx`
- `hooks/use-providus-wallet.ts`
- `hooks/use-usdc-deposit.ts`
- `lib/wallet/config.ts`
- `lib/wallet/erc20.ts`
- `lib/celo/usdc.ts`

The repository remains the source of truth. Re-audit exact paths before broad changes if the repo has moved since this document was updated.

---

## 5. Current verified gaps

### 5.1 No durable transaction persistence

Current cash-out order/deposit state is held in client memory.

Consequences:

- page refresh can lose payment instructions/state;
- server restart cannot resume an orchestration;
- safe idempotent reconciliation is difficult;
- ClubKonnect fulfilment cannot be safely coordinated without adding durable state.

### 5.2 No Paycrest fiat-finality tracker

Missing today:

- GET order-status route/client integration after deposit;
- durable polling/reconciliation;
- webhook handling;
- bank-delivery finality in the UI.

### 5.3 No ClubKonnect boundary

Missing today:

- server-only ClubKonnect config/client;
- balance/readiness check;
- airtime purchase;
- transaction query/reconciliation;
- safe status mapping;
- idempotent RequestID handling.

### 5.4 No command agent

Missing today:

- payment intent schema;
- deterministic airtime parser;
- command box;
- confirmation card;
- orchestration endpoints.

### 5.5 Attribution not wired

The active Agents at Work attribution tag is:

```text
celo_8190b99392a2
```

The current direct USDC transfer path must be changed so the final transaction calldata carries the ERC-8021 suffix.

---

## 6. Existing defects to fix before orchestration

The audit identified existing problems that the agent flow would inherit:

1. Paycrest returned amount can differ from the user-approved amount and still pass normalization.
2. Unknown/lost create-order response can permit unsafe duplicate retry behavior.
3. Deposit-confirmed callback can fire repeatedly.
4. Create-order lock can remain stuck after a definite failure.
5. Created orders are not persisted.

P0 should repair the first four as far as safely possible without pretending persistence already exists. Durable duplicate recovery belongs in the persistence phase.

---

## 7. Target architecture

```text
                         ┌──────────────────────────┐
                         │  Providus Dashboard UI   │
                         │  Payment Command Box     │
                         └────────────┬─────────────┘
                                      │
                             parse + validate
                                      │
                         ┌────────────▼─────────────┐
                         │ Payment Intent / Preview │
                         │ amount / phone / network │
                         │ quote / fees / expiry    │
                         └────────────┬─────────────┘
                                      │
                              explicit approval
                                      │
                         ┌────────────▼─────────────┐
                         │ Durable Transaction Row  │
                         │ idempotency + state      │
                         └────────────┬─────────────┘
                                      │
                         ┌────────────▼─────────────┐
                         │ Paycrest Off-ramp Order  │
                         └────────────┬─────────────┘
                                      │
                             Celo USDC transfer
                          + ERC-8021 attribution
                                      │
                         ┌────────────▼─────────────┐
                         │ Paycrest Reconciliation  │
                         │ deposit → fiat delivery  │
                         └────────────┬─────────────┘
                                      │ confirmed
                         ┌────────────▼─────────────┐
                         │ ClubKonnect Fulfilment   │
                         │ airtime first            │
                         └────────────┬─────────────┘
                                      │
                              query/reconcile
                                      │
                         ┌────────────▼─────────────┐
                         │ Receipt / History / UI   │
                         └──────────────────────────┘
```

The existing user-bank cash-out route should **not** be secretly repurposed for utility payments. Add a thin orchestration path around reusable primitives.

---

## 8. Payment intent model

First supported executable intent:

```ts
type AirtimeIntent = {
  type: "airtime"
  amountNgn: string
  phone: string
  network?: "mtn" | "airtel" | "glo" | "9mobile"
}
```

Rules:

- parser may suggest a network;
- user must be able to confirm/change it because mobile number portability exists;
- missing/ambiguous payment-critical fields must stop execution;
- an LLM, if later added, may help interpret language but must not independently authorize or alter money movement;
- amount, recipient and network shown on the confirmation card become the approved intent.

Unsupported intents should be recognized but non-executable until their rails are implemented.

---

## 9. Settlement model

### Important operating assumption

Do **not** claim that Paycrest funds ClubKonnect automatically.

Hackathon MVP:

1. Providus maintains a small prepaid NGN float with ClubKonnect.
2. User approves the airtime payment.
3. Paycrest converts the user’s Celo USDC to NGN through the existing off-ramp rail.
4. Providus waits for the selected Paycrest fiat-finality condition.
5. Only then does the backend call ClubKonnect.
6. ClubKonnect fulfilment is reconciled to a real terminal status.
7. The user sees completion only after confirmed delivery.

The bank account receiving the airtime-flow Paycrest NGN proceeds must be explicitly configured before a live airtime payment is attempted.

Do not invent an automatic relationship between that account and the ClubKonnect wallet.

---

## 10. Transaction state machine

### Cash-out Lifecycle (Direct Off-ramp)

```text
pending
  │
  ├── definite pre-payment failure ───────────────► failed
  │
  ▼
settling
  │
  ├── Paycrest terminal failure ─────────────────► failed
  ├── Paycrest refund on Celo ────────────────────► refunded
  │
  ▼
settled (fiat confirmed delivered; terminal business outcome)
```

### Utility Lifecycle (Future Airtime & Bills)

```text
pending
  │
  ├── definite pre-payment failure ───────────────► failed
  │
  ▼
settling
  │
  ├── Paycrest terminal failure ─────────────────► failed
  ├── Paycrest refund on Celo ────────────────────► refunded
  │
  ▼
settled (fiat confirmed in utility rail)
  │
  ▼
processing (utility partner fulfilment)
  │
  ├── partner terminal failure ──────────────────► failed
  │
  ▼
completed (utility confirmed delivered)
```

`refunded` is a separate terminal state and must only be written when a refund has actually occurred.

Do not equate “provider failed” with “user refunded.”

### Lifecycle distinction by transaction type

- **`cash_out`**: `pending` → `settling` → `settled`. `settled` represents confirmed fiat delivery into the recipient's bank account and acts as the effective terminal business outcome. It does not enter `processing` or `completed`.
- **`utility` (e.g. airtime)**: `pending` → `settling` → `settled` → `processing` → `completed`. `settled` represents verified fiat delivery into the utility partner/liquidity rail; the transaction then enters `processing` for third-party fulfilment and `completed` upon delivery verification.
- **Paycrest Off-ramp Statuses**:
  - `validated`: Liquidity provider has confirmed fiat delivery to the recipient's account. This is the safe point to notify an off-ramp recipient or trigger downstream utility processing.
  - `settling`: Paycrest onchain escrow release is broadcast. (Does not regress internal `settled` state).
  - `settled`: Paycrest protocol is fully closed onchain and offchain.

## 11. Durable data model

A single orchestration table is enough for the first vertical slice.

Suggested fields:

| Field | Purpose |
|---|---|
| `id` | Providus transaction ID |
| `idempotency_key` | duplicate protection |
| `type` | `airtime` initially |
| `status` | internal lifecycle |
| `wallet_address` | payer |
| `amount_ngn` | face value |
| `amount_usdc` | approved/sent amount |
| `recipient_phone` | minimum necessary fulfilment data |
| `mobile_network` | confirmed network |
| `celo_tx_hash` | Celo payment proof |
| `paycrest_order_id` | upstream order |
| `paycrest_reference` | Providus reference |
| `paycrest_status` | last reconciled provider state |
| `clubkonnect_request_id` | unique fulfilment request ID |
| `clubkonnect_order_id` | provider order ID |
| `clubkonnect_status_code` | reconciled provider status |
| `failure_code` | machine-readable failure |
| `failure_reason` | sanitized message |
| `created_at` / `updated_at` | audit timeline |

Do not store unnecessary bank details, API keys or full provider payloads.

For deployed/serverless use, prefer the existing available **Supabase Postgres** direction with Drizzle rather than local SQLite.

---

## 12. Paycrest finality boundary

The airtime orchestrator must not trigger merely because the Celo transaction is confirmed.

Use Paycrest’s authenticated order status and/or signed webhook behavior according to the current provider docs and actual response shape.

Design:

- signed webhook can wake/update state;
- authenticated polling/reconciliation remains the recovery path;
- duplicated signals must be idempotent;
- unknown network outcome must not create a second order blindly;
- transition to the ClubKonnect phase only after the chosen, documented fiat-delivery condition is met.

---

## 13. ClubKonnect boundary

Target server-only modules:

```text
lib/clubkonnect/
├── types.ts
└── server/
    ├── config.ts
    └── client.ts
```

Client responsibilities:

- validate server-only environment;
- query wallet/readiness;
- purchase airtime;
- query/reconcile a RequestID/order;
- redact credentials/PII from errors/logs;
- never expose full credential-bearing provider URLs to the browser.

Status handling must be based on current ClubKonnect documentation.

At minimum:

- initial receipt/processing states are **not success**;
- only a verified terminal success becomes `completed`;
- timeout/unknown results are reconciled, not blindly retried.

---

## 14. Celo attribution architecture

Active hackathon tag:

```text
celo_8190b99392a2
```

Add one shared attribution helper so transaction construction does not scatter tag logic across components.

Requirements:

- use `@celo/attribution-tags`;
- append ERC-8021 suffix to final contract calldata;
- preserve original ERC-20 call semantics;
- fail before wallet submission if active tag is missing/invalid;
- do not silently fall back to the old tag;
- verify encoding in tests before a live transaction.

Existing bank cash-out transactions should use the same helper after P0 so future eligible usage is consistently tagged.

---

## 15. Security invariants

- Provider credentials are server-only.
- Never log raw API keys, bank account numbers or credential-bearing URLs.
- Explicit user approval before wallet submission.
- No automatic retry of payment/order creation after unknown outcomes.
- Exact decimal arithmetic only.
- User-approved amount must equal the upstream order amount.
- Persist before crossing irreversible external boundaries.
- Every provider mutation gets a unique idempotent reference.
- Provider callbacks are signals, not permission to duplicate fulfilment.
- A provider acknowledgement is not the same thing as final delivery.

---

## 16. Scope boundaries

### First vertical slice

```text
Celo USDC
→ Paycrest
→ confirmed NGN settlement
→ ClubKonnect
→ airtime
```

### Add only if the first slice is stable

- data bundles.

### Later

- electricity;
- cable TV;
- broader bill catalogue;
- Naira → Celo USDC once provider support is ready;
- richer AI interpretation;
- x402 agent-to-agent surfaces if they become a real product capability.

Do not add Kotani to this architecture.

---

## 17. Verification gates

Before any live airtime test:

- existing cash-out regression tests pass;
- amount-integrity bug is fixed;
- attribution encoding tests pass;
- durable persistence exists;
- Paycrest status reconciliation works against documented states;
- ClubKonnect client tests distinguish acknowledgement/processing/success/failure;
- insufficient provider float is caught before charging where possible;
- duplicate-click and duplicate-signal tests pass;
- client bundle contains no provider secrets;
- typecheck, lint and production build pass;
- builder explicitly approves the exact live amount and recipient.

---

## 18. Architecture north star

Providus should feel simple to the user:

> **Say what you want to pay. Review exactly what will happen. Approve once. Providus handles the rails and proves the result.**

The implementation underneath should remain conservative: durable state, explicit approval, server-side provider boundaries, truthful settlement and no invented success.
