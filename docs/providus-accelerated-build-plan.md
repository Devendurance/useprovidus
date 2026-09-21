# Providus Accelerated Agents at Work Build Plan

**Updated:** September 19, 2026 — conversational assistant architecture correction<br/>
**Submission deadline:** September 21, 2026 at **09:00 UTC / 10:00 WAT**<br/>
**Network:** Celo mainnet (`42220`)<br/>
**Primary track:** Real World Adoption
**Build style:** Small sequential prompts; repo is source of truth; no broad refactors; no live mutation without explicit approval.

> **Historical plan notice:** This dated sprint plan records the pre-P0 baseline and milestone execution order. It is not the current product-state source. P6.10 live evidence, the P6.11 positioning freeze, `README.md`, `docs/providus_PRD.md`, and `docs/PROVIDUS_ARCHITECTURE.md` supersede its baseline gaps for current-state claims. Preserve the historical gap lists and gates as an audit record; do not read them as statements that persistence, reconciliation, ClubKonnect, the assistant, or attribution are currently missing. Persistence terminology has been corrected to the canonical **Neon PostgreSQL + Drizzle** naming; any earlier provider name in this record is superseded.

---

## 1. Shipping decision (historical plan decision)

Providus will submit as a **Celo-native Nigerian payments agent**.

### Already proven

**Move Money — Bank cash-out**

```text
Celo USDC
→ Paycrest
→ Nigerian bank account
```

This has been exercised successfully in real usage.

### New deadline-critical vertical slice

**Conversational Payment Agent — Airtime**

```text
Natural-language conversation
→ structured payment intent
→ clarification of missing/ambiguous fields
→ exact confirmation card
→ explicit user approval
→ Celo USDC
→ Paycrest
→ confirmed NGN settlement
→ ClubKonnect
→ airtime
→ conversational status + receipt
```

The conversational layer is a first-class product surface, not a thin regex command box.

Providus should feel like a normal AI chat assistant that also has safe payment capabilities. Conversational language is model-generated, not hardcoded. A user can say `hey`, ask what Providus can do, ask a general payment question, continue a multi-turn conversation, or begin a payment task naturally.

The assistant operates in two broad modes:

1. **Conversation mode** — ordinary natural conversation, greetings, explanations, help, and payment-related questions. No financial action is implied merely because the assistant is chatting.
2. **Payment-intent mode** — when the user asks Providus to perform a supported payment action, the model produces a structured candidate intent that must pass deterministic validation and explicit confirmation before execution.

The assistant may:

- respond naturally to greetings and ordinary conversation using the configured LLM;
- explain Providus, payments, fees, supported actions and transaction state;
- understand natural-language payment requests;
- remember the current conversation;
- ask follow-up questions for missing fields;
- turn payment language into a typed candidate intent;
- answer status questions from persisted transaction state.

The assistant must **not**:

- invent recipients, amounts, networks or bill identifiers;
- silently change an already-confirmed payment intent;
- authorize or execute a payment;
- decide that a provider succeeded;
- bypass deterministic validation, state transitions or explicit user approval.

Architecture rule:

> **Conversation layer → structured intent → deterministic validation → confirmation → execution.**

### If airtime is stable

Add data bundles.

### Do not expand before the first slice works

- electricity;
- cable;
- IPO payments;
- cNGN pivot;
- remittances;
- broad utility catalogue;
- Kotani;
- custom contracts.

---

## 2. Hackathon registration lock

```text
Hackathon: agents-at-work
Submission status: draft
Repo: https://github.com/Devendurance/useprovidus

Primary: real-world-adoption
Additional:
- value-moved
- askbots-growth
- judges-favorite
- cpay-feedback

ERC-8004 Agent ID: 9851
ERC-8004 URL: https://8004scan.io/agents/celo/9851
Agent wallet: 0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa

Locked attribution tag:
celo_8190b99392a2
```

The previous tag `celo_91fed90b97fc` is obsolete for this hackathon.

---

## 3. Non-negotiable boundaries

1. Repository is the source of truth.
2. Preserve the existing Paycrest bank cash-out.
3. No live Paycrest order without explicit builder approval.
4. No Celo mainnet transaction without explicit builder approval.
5. No ClubKonnect purchase without explicit builder approval.
6. Never print API keys, bank details, full credential-bearing URLs or private keys.
7. Do not blindly retry provider mutations.
8. Do not mark ClubKonnect acknowledgement as completion.
9. Do not mark Paycrest Celo deposit as fiat delivery.
10. Persist before irreversible multi-provider orchestration.
11. Keep prompts small and scoped.
12. Bring every milestone report back before starting the next.
13. No broad refactor during the deadline sprint.
14. No fake provider success or public mock states.
15. The conversational AI is never the authority over money movement: it can interpret and explain, but deterministic code validates and the user explicitly approves execution.

---

## 4. Historical pre-P0 repository baseline

### Stack at the time of this plan (historical)

- Next.js App Router + TypeScript;
- wagmi + viem;
- Celo mainnet;
- canonical Celo USDC;
- Paycrest server integration;
- live quote;
- institution/account verification;
- Paycrest off-ramp order creation;
- direct ERC-20 transfer to per-order receive address.

Historical gaps at the time of this plan — superseded by later shipped work; see the notice at the top of this document. Airtime was the first utility category delivered; data bundles and other non-airtime categories remain future work:

- no database/persistence;
- no Paycrest post-deposit status tracking;
- no webhook/reconciliation layer;
- no ClubKonnect integration;
- no airtime/data/utility code;
- no conversational payment assistant / structured AI intent layer;
- attribution tag was not appended to transaction calldata at that time.

Historical audit findings from before P0:

1. upstream amount mismatch can pass validation;
2. unknown create-order outcome can lead to duplicate retry risk;
3. deposit-confirmed callback can repeat;
4. definite create-order failure can leave UI locked;
5. page refresh loses order state.

---

## 5. Pre-build requirement — AskBots baseline (historical)

This requirement was completed before P0; it is retained as an audit record of the plan's ordering.

Before P0 code changes:

- register/use the current Providus repo in AskBots according to the live track instructions;
- complete the required baseline review round;
- preserve project URL, review IDs, scores, findings and screenshots/evidence;
- do **not** fix issues before baseline capture.

Only after the baseline is safely recorded should P0 implementation begin.

---

## 6. Milestones

> **Historical milestone record (superseded).** P0–P8 below are the original sprint plan, gates, and target states as written before implementation. They are an audit record, not a description of current capability; every gap, blocker, and gate they name is historical. Current shipped state is documented in `README.md`, `docs/providus_PRD.md`, and `docs/PROVIDUS_ARCHITECTURE.md`. Where these milestones describe the airtime fulfilment gate as a raw Paycrest status check, the canonical rule is now durable monotonic fiat-finality (see `docs/PROVIDUS_ARCHITECTURE.md` §6).

### P0 — Financial integrity + Celo attribution hardening

**Purpose:** Make the existing cash-out foundation safe enough to extend.

Work:

- resolve `.env` tracking/history safely without printing values;
- fix Paycrest returned-amount equality invariant;
- distinguish definite create-order failure from unknown outcome;
- prevent blind retry after unknown create-order outcome;
- ensure deposit-confirmed side effect fires once per tx;
- clear create-order lock after definite failure;
- install/use `@celo/attribution-tags`;
- update active attribution configuration to `celo_8190b99392a2`;
- append ERC-8021 suffix to final USDC transfer calldata;
- verify encoded calldata preserves transfer recipient + amount;
- no live transaction.

Gate:

- existing five self-check suites pass;
- new financial-integrity tests pass;
- attribution encoding tests pass;
- typecheck/lint/build/diff checks pass;
- no mainnet transaction sent.

---

### P1 — Durable persistence + Paycrest finality

**Purpose:** Make transaction state survive refresh/restart and prove fiat delivery.

Preferred target:

- Neon PostgreSQL (managed Postgres);
- Drizzle ORM if current repo rules still require it.

Work:

- introduce minimal `agent_transactions`/payment orchestration persistence;
- unique idempotency key;
- persist Paycrest order/reference and Celo tx hash;
- add Paycrest authenticated get-order/status boundary;
- add idempotent reconciliation;
- signed webhook only if current docs + deployment setup support it safely;
- polling remains recovery/fallback;
- expose truthful status endpoint;
- do not touch existing cash-out API contract unless strictly additive.

Target states:

```text
pending
settling
settled
processing
completed
failed
refunded
```

Gate:

- transaction survives refresh/server restart;
- duplicate reconciliation signals are safe;
- Paycrest fiat-delivery state can be distinguished from on-chain deposit;
- no ClubKonnect call yet.

---

### P2 — ClubKonnect server boundary

**Purpose:** Integrate provider reads and state handling without charging anyone.

Work:

- verify current environment variable names without printing values;
- add server-only config;
- add strict redaction;
- implement safe wallet/readiness query;
- implement typed airtime request builder;
- implement query/reconciliation method;
- map documented statuses conservatively;
- generate unique RequestID;
- no live purchase yet.

Important:

- audit previously found no `CLUBKONNECT_*` environment entries; re-check current local state because this may have changed since the audit;
- if IP whitelisting blocks Vercel/serverless egress, report it immediately;
- do not invent a static-IP solution silently.

Gate:

- mocked provider tests pass;
- secrets absent from client build/logs;
- safe read confirms credentials/readiness only if explicitly permitted.

---

### P3 — Conversational Payment Assistant + Intent Engine

**Purpose:** Make Providus feel like an actual payments agent while keeping financial authority deterministic.

This milestone creates the conversation layer only. It does **not** move money.

Work:

- add a conversational payment assistant surface to the dashboard;
- maintain short-lived conversation state for the current payment task;
- support multi-turn clarification;
- define a strict structured `PaymentIntent` schema;
- first executable intent: `airtime`;
- recognize future intents (`data`, `electricity`, `cable`) as unsupported/not-yet-executable rather than pretending they work;
- extract/maintain action, NGN amount, phone number and mobile network;
- expose `missingFields`;
- expose `readyForConfirmation`;
- make network suggestions editable and never treat prefix detection as certainty;
- answer simple status/explanation questions using known transaction state where available;
- keep the AI/model server-side;
- use schema-constrained structured output;
- validate all model output again with deterministic code;
- no provider mutation;
- no wallet submission.

Target interaction:

```text
User: Buy ₦500 airtime for my brother.
Providus: Sure — what phone number should I send it to?
User: 0803...
Providus: That looks like it may be MTN, but numbers can be ported. Is MTN correct?
User: Yes.
Providus: Got it. I’ll prepare ₦500 MTN airtime for 0803... and show you the exact USDC cost before anything moves.
```

Suggested structured result:

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

AI safety invariant:

> The model may interpret language and ask questions, but it cannot authorize, mutate provider state, or decide payment success.

Gate:

- multi-turn airtime conversation works;
- missing fields trigger clarification;
- ambiguous network requires confirmation;
- unsupported requests fail honestly;
- model output cannot bypass schema validation;
- zero Paycrest/ClubKonnect/blockchain mutation;
- conversation tests pass.

---

### P4 — Airtime Preview + Confirmation UX

**Purpose:** Convert a complete conversational intent into a deterministic, reviewable payment proposal.

Work:

- take only a validated `PaymentIntent`;
- fetch current Paycrest quote;
- calculate user-facing USDC amount/fees with exact decimals;
- quote TTL / stale state;
- render confirmation card inline in the conversation;
- show action, recipient, confirmed network, NGN face value, quoted USDC amount, fees, total, network and expiry;
- allow user to edit payment-critical fields;
- any edit invalidates the previous confirmation/quote where necessary;
- explicit approval gate;
- no Paycrest order creation yet.

Gate:

- zero provider mutation before approval;
- stale quote cannot be approved silently;
- amount/phone/network shown in card exactly match validated intent;
- user can correct fields;
- mobile UI usable;
- money/preview tests pass.

---

### P5 — Airtime Payment Orchestration

**Purpose:** Connect an explicitly approved intent to the existing Paycrest payment primitive.

Work:

- create durable internal transaction first;
- bind it to the approved intent snapshot;
- use unique idempotency;
- create dedicated Paycrest off-ramp order for the utility flow;
- keep existing user-bank cash-out isolated;
- use configured Providus NGN settlement destination;
- return payment instructions to client;
- user signs Celo USDC transfer with active attribution tag;
- persist tx hash;
- transition to `settling`;
- conversational UI may explain current state but must read it from persisted deterministic state.

Blocker that must be resolved before a live run:

> Which verified Nigerian bank account receives the Paycrest fiat proceeds for the airtime operating flow?

Do not hardcode sensitive bank values into source or docs.

Gate:

- mocked E2E through Celo submission boundary;
- duplicate click does not create duplicate order;
- approved intent cannot be mutated after payment starts;
- no live transaction until exact amount/recipient/expected outcome are reviewed.

---

### P6 — Paycrest → ClubKonnect Settlement Bridge

**Purpose:** Complete the actual real-world airtime payment.

Work:

- reconcile Paycrest to documented fiat-delivery milestone;
- only after that, acquire an idempotent fulfilment right;
- check ClubKonnect readiness/float where possible;
- call airtime purchase once;
- persist RequestID/order ID;
- treat received/processing states as `processing`;
- query until verified terminal result;
- only terminal success → `completed`;
- terminal provider failure → `failed` / reconciliation-required;
- do not invent a refund;
- conversational assistant reports status from the persisted state machine, never from model inference.

Example status responses:

```text
"Your Celo payment is confirmed. Paycrest is still settling the NGN leg, so I have not sent the airtime request yet."

"The airtime request was received and is still processing. I will not create another purchase while this request is unresolved."
```

Gate:

- mock all partial-failure paths;
- server restart can resume;
- duplicate poll/callback cannot buy airtime twice;
- assistant status text matches deterministic state;
- first live test requires explicit approval and minimum safe amount.

---

### P7 — Data Bundles (only if P6 is stable)

**Purpose:** Reuse the same conversational + orchestration architecture with a second fulfilment type.

Work:

- extend the intent schema for `data`;
- conversationally resolve phone/network/plan;
- product/catalog lookup;
- explicit data-plan confirmation;
- same persistence/idempotency/finality rules;
- no electricity/cable in this phase.

Cut immediately if it threatens demo stability.

---

### P8 — Evidence, AskBots Round 2, submission polish

**Purpose:** Turn shipped work into judge-verifiable evidence.

Work:

- run AskBots second review according to current track timing/rules;
- preserve before/after score and review evidence;
- complete buy/cPay beta feedback workstream separately;
- verify first tagged transaction after attribution implementation;
- add real receipt/history evidence;
- production smoke test;
- mobile conversational demo rehearsal;
- README/architecture/PRD update;
- record walkthrough;
- prepare X submission post;
- fill final Celo Builders submission fields;
- final publish only after explicit review.

Gate:

- no misleading claims;
- public repo/deployment/video/social links work;
- all selected track evidence is present;
- conversational assistant behavior shown truthfully;
- final API schema re-fetched immediately before publish.

---

## 7. Conversational assistant architecture lock

The conversational assistant is a **presentation + interpretation layer** over deterministic payment infrastructure.

```text
User message
→ conversational model
→ structured PaymentIntent
→ schema validation
→ deterministic business validation
→ clarification OR confirmation card
→ explicit user approval
→ payment orchestrator
→ persisted state machine
→ provider reconciliation
→ conversational status/receipt
```

### Model responsibilities

Allowed:

- generate normal conversational replies (for example greetings, help and explanations);
- answer ordinary in-scope questions without forcing every message into a payment intent;
- interpret natural language;
- preserve current task context;
- ask clarifying questions;
- explain fees and states;
- transform a genuine payment request into a typed candidate intent;
- summarize persisted transaction status.

Forbidden:

- authorizing money movement;
- inventing missing payment-critical values;
- bypassing confirmation;
- deciding provider success/failure independently;
- changing an approved intent during execution;
- directly calling Paycrest, ClubKonnect or wallet mutation code.

### Implementation rule

The assistant should use a pluggable server-side model provider (a low-cost model such as DeepSeek can be the default) so conversational responses are generated dynamically rather than hardcoded.

A useful assistant response contract can distinguish normal chat from financial intent, for example:

```ts
type AssistantTurn =
  | {
      mode: "chat"
      message: string
      intent: null
    }
  | {
      mode: "payment_intent"
      message: string
      intent: PaymentIntent
    }
```

Only the `payment_intent` branch can enter deterministic payment validation. Even then, the model does not execute anything.

The assistant must return structured data validated by a schema. Payment execution code consumes only validated deterministic state, never raw assistant prose.

If the model is unavailable, Providus should fail gracefully or fall back to structured/manual field entry. Model availability must never determine whether a previously approved payment is safe to reconcile.

---

## 8. Test matrix (historical plan)


### Existing cash-out regression

Run and keep passing:

- `test:wallet-helpers`
- `test:money-helpers`
- `test:recipient-helpers`
- `test:order-helpers`
- `test:order-route`

### P0 tests

- exact Paycrest amount accepted;
- valid but larger/smaller amount rejected;
- malformed/negative/excess precision rejected;
- definite failure unlocks retry;
- unknown create outcome blocks unsafe retry;
- confirmation callback once per tx;
- ERC-8021 suffix appended;
- transfer calldata still decodes to intended recipient/amount;
- missing tag fails before wallet.

### Persistence/finality

- idempotency;
- refresh recovery;
- duplicate provider event;
- out-of-order event;
- server restart;
- Paycrest deposit vs fiat-delivery distinction.

### ClubKonnect

- acknowledgement ≠ success;
- processing remains processing;
- only terminal documented success completes;
- insufficient float;
- timeout/unknown;
- duplicate query/callback;
- Paycrest succeeds + ClubKonnect fails;
- no fake refund.

### Conversational assistant

- multi-turn context retains current intent without leaking across sessions;
- missing amount/phone/network produces clarification, not execution;
- unsupported intent remains non-executable;
- malformed model output is rejected by schema validation;
- user correction replaces the proposed field before confirmation;
- confirmation snapshot cannot be silently changed after approval;
- assistant status text is derived from persisted state;
- prompt/model failure cannot trigger provider or wallet mutation.

### Security

- provider secrets absent from client bundle;
- logs redact PII/secrets;
- `.env` ignored;
- no raw bank/phone/provider URLs in logs.

---

## 9. Deadline schedule

### September 19

- capture AskBots baseline;
- P0;
- start P1 immediately if P0 gate passes.

### September 20

- finish P1;
- P2 ClubKonnect boundary;
- P3 conversational assistant + intent engine;
- P4 confirmation UX;
- P5/P6 mocked payment + fulfilment integration;
- one explicitly approved minimum live run if gates pass;
- AskBots Round 2 when allowed by current track rules;
- buy feedback workstream in parallel.

### September 21 — buffer only

Before **09:00 UTC / 10:00 WAT**:

- production smoke test;
- verify tagged transaction evidence;
- verify Airtime receipt / cash-out evidence;
- finalize demo/video;
- finalize X post;
- re-fetch submission schema;
- populate all track fields;
- publish only after explicit approval.

No broad new feature work on submission morning.

---

## 10. Cut line

If time slips:

### Must ship

1. P0 financial integrity + active Celo attribution.
2. Durable Paycrest finality.
3. One coherent multi-turn conversational payment assistant with deterministic confirmation UX.
4. One safe airtime vertical slice or, if a provider blocker prevents live fulfilment, a truthful demo that clearly distinguishes the blocked external step.
5. Existing bank cash-out still works.
6. AskBots before/after evidence.
7. Submission evidence and production stability.

### Nice to have

- data bundles;
- richer history;
- shareable receipts;
- advanced command phrasing.

### Cut first

- electricity;
- cable;
- cNGN detour;
- remittances;
- multiple providers;
- autonomous spending;
- custom contracts;
- general-purpose autonomous agent framework.

---

## 11. Working method with the coding agent

Every implementation prompt must:

1. stay narrowly scoped;
2. inspect relevant current files first;
3. preserve unrelated work;
4. state allowed files/areas;
5. prohibit live provider/blockchain mutations unless explicitly approved;
6. require tests before commit;
7. report exact files changed;
8. report exact commands/results;
9. report unresolved assumptions;
10. stop at the milestone gate.

Do not allow the coding agent to jump ahead because it “already knows the next step.”

---

## 12. Historical immediate-next-action sequence

> **Superseded sequence.** This P0→P8 order is the original planning sequence, preserved as an audit record. It is not the current working order, and the milestones it names are no longer pending work.

Order at the time of this plan:

```text
AskBots baseline
→ P0 financial integrity + attribution
→ P1 persistence + Paycrest finality
→ P2 ClubKonnect boundary
→ P3 conversational assistant + intent engine
→ P4 airtime preview + confirmation UX
→ P5 airtime payment orchestration
→ P6 fulfilment/reconciliation
→ P8 evidence + submission
```

P7 data is optional and only starts if the first airtime slice is stable.
