# Providus Accelerated Mainnet Build Plan

**Prepared:** July 30, 2026  
**Submission deadline:** August 3, 2026 at 09:00 UTC / 10:00 WAT  
**Network:** Celo mainnet (`42220`)  
**Primary track:** Most x402 Payments  
**Build style:** Small sequential prompts, real data only, no public mock states  

---

## 1. Shipping decision

Providus will ship as one coherent product with two connected modules:

### Move Money

A real Paycrest-powered on-ramp that lets a Nigerian user deposit NGN and receive USDC in a connected Celo wallet.

### Stop Leaks

An x402-powered recovery agent that inspects connected Gmail evidence for recurring charges, shows likely financial leaks, and sells useful recovery actions.

The product story is:

> Providus helps people recover money lost to forgotten subscriptions and move value into Celo through a transparent local rail.

The working hackathon core is not a multi-provider quote comparison. Paycrest is currently the executable provider. Providus may show Paycrest's current rate and delivery estimate, but must not claim it compared the whole market.

---

## 2. Non-negotiable boundaries

1. No API key, API secret, Gmail client secret, private key, or seed phrase enters Git, frontend bundles, screenshots, coding prompts, or chat.
2. `PAYCREST_API_KEY` and `PAYCREST_API_SECRET` are server-only environment variables. Never prefix them with `NEXT_PUBLIC_`.
3. Paycrest is mainnet-only. No live order is created without explicit builder approval.
4. Begin the real transaction test at Paycrest's minimum order size. Do not create repeated orders to debug ordinary UI or schema problems.
5. Do not simulate quotes, provider bank accounts, Paycrest IDs, order states, Gmail results, x402 receipts, or successful USDC delivery in production.
6. Fixtures are allowed only in automated tests and clearly isolated development stories.
7. The basic on-ramp is not blocked by x402. A first-time on-ramp user may have no USDC yet.
8. Paycrest's `senderFeePercent` is a Paycrest-integrated fee, not an x402 settlement. Keep it at zero for the first end-to-end test unless deliberately configured later.
9. x402 monetizes separate agent work: Leak Scan, Recovery Plan, supported recovery execution, and confirmation checks.
10. Never mark a subscription cancelled or an on-ramp settled without provider or email/onchain evidence.

---

## 3. Product flows

### 3.1 NGN to Celo USDC

```text
Connect Celo wallet
→ Enter NGN amount
→ Enter Nigerian refund-bank details
→ Verify refund account
→ Preview current Paycrest buy rate
→ Confirm destination wallet and order
→ Create Paycrest on-ramp order
→ Show exact provider bank-transfer instructions and expiry
→ User transfers exact NGN amount
→ Webhook or polling updates order
→ Paycrest settles USDC to connected Celo wallet
→ Providus shows receipt and transaction evidence
```

Paycrest v2 request direction:

```text
source.type = fiat
source.currency = NGN
destination.type = crypto
destination.currency = USDC
destination.recipient.network = celo
destination.recipient.address = connected wallet
amountIn = fiat
```

### 3.2 Stop Leaks

```text
Connect wallet
→ Connect Gmail with read-only OAuth
→ Explain scan scope and privacy
→ Request Leak Scan
→ Pay 0.01 USDC through x402
→ Scan only relevant receipt/renewal/trial/cancellation messages
→ Normalize merchants and recurrence evidence
→ Show evidence-backed subscription candidates
→ Select a merchant
→ Pay for a Recovery Plan or supported recovery action
→ Monitor Gmail for cancellation confirmation
```

Classification labels:

- Confirmed recurring charge
- Likely active subscription
- Trial or upcoming renewal
- Needs user verification
- Cancellation confirmed

---

## 4. Architecture lock

Use the existing Next.js App Router repository and UI shell.

| Layer | Decision |
|---|---|
| Frontend | Existing Next.js + TypeScript UI |
| Wallet | Existing wagmi/viem connection, Celo mainnet only |
| Server | Next.js route handlers and server-only services |
| Database | Supabase Postgres with row-level protection |
| On-ramp | Paycrest Sender API v2 |
| Fiat corridor | NGN |
| Destination | USDC on Celo |
| On-ramp status | Webhook first, authenticated polling fallback |
| Agent payments | Celo facilitator at `https://x402.celo.org` |
| x402 asset | Celo mainnet USDC |
| Gmail | Google OAuth + Gmail API, read-only |
| Detection | Deterministic rules and evidence; no paid LLM |
| Deployment | Existing Vercel target |

Do not add Fastify, SvelteKit, Redis, BullMQ, custom escrow contracts, an LLM provider, or another on-ramp aggregator during this sprint.

---

## 5. Environment contract

```env
# Server only
PAYCREST_API_KEY=
PAYCREST_API_SECRET=
PAYCREST_BASE_URL=https://api.paycrest.io/v2
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_CLIENT_SECRET=

# Public only where appropriate
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_GOOGLE_CLIENT_ID=
NEXT_PUBLIC_CELO_CHAIN_ID=42220
NEXT_PUBLIC_CELO_USDC_ADDRESS=0xcEBA9300f2b948710d2653dD7B07f33A8B32118C
NEXT_PUBLIC_CELO_ATTRIBUTION_TAG=celo_91fed90b97fc

# Server payment configuration
CELO_X402_FACILITATOR_URL=https://x402.celo.org
CELO_X402_PAY_TO=0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
GMAIL_TOKEN_ENCRYPTION_KEY=
```

The final names should follow existing repository conventions if equivalent variables already exist. Do not create duplicate sources of truth.

---

## 6. Delivery milestones and coding prompts

Each prompt ends with:

- scope of files changed;
- verification commands run;
- exact pass/fail results;
- unresolved blockers;
- no broad cleanup or unrelated refactors.

Do not begin the next prompt until the current gate passes.

### P0 — Repository and credential-safe feasibility audit

**Purpose:** Discover the actual repository state and prove the Paycrest corridor without mutations.

Work:

- inspect current routes, wallet stack, Supabase setup, environment validation, test commands, and existing API handlers;
- identify existing on-ramp UI screens and their state boundaries;
- call only safe Paycrest reads;
- confirm API credential authentication without printing credentials;
- confirm `NGN`, `celo`, and Celo `USDC` support from live endpoints;
- confirm a buy-side rate can be returned;
- report exact response shapes with personal/provider-sensitive values redacted;
- make no application changes unless a tiny non-secret diagnostic script is explicitly approved.

**Gate:** A written audit proves the repository baseline and Paycrest support. No order is created.

### P1 — Configuration and Paycrest server adapter

**Purpose:** Add a secure, typed integration boundary.

Work:

- central environment validation;
- server-only Paycrest client;
- timeouts, error normalization, and redacted logging;
- typed methods for tokens, rate, institutions, verify-account, create-order, get-order;
- no frontend imports from secret-bearing modules;
- unit tests using fixtures only.

**Gate:** Tests prove request/response normalization, secret isolation, and failure handling.

### P2 — Wallet identity and database foundation

**Purpose:** Give real orders and payments durable ownership.

Work:

- preserve the existing wallet connector;
- require Celo mainnet;
- validate and normalize wallet addresses;
- create wallet challenge/signature session if no secure wallet session exists;
- add database tables for users, on-ramp orders, order events, x402 payments, Gmail connections, scan jobs, subscription candidates, and recovery actions;
- add uniqueness/idempotency constraints;
- add Supabase row-level policies or keep privileged access server-only.

**Gate:** One wallet can access only its own order, scan, and payment records.

### P3 — Live quote and refund-account verification

**Purpose:** Replace any on-ramp shell data with Paycrest responses.

Work:

- live Paycrest buy-rate endpoint for NGN/USDC/Celo;
- rate freshness and unavailable states;
- Nigerian institutions from Paycrest;
- refund-bank input;
- account verification and canonical account name;
- connected wallet as immutable default destination, with explicit confirmation;
- no order creation yet.

**Gate:** The UI renders a real current rate and verified refund account with no mock fallback.

### P4 — Paycrest order creation

**Purpose:** Create a durable real on-ramp order safely.

Work:

- server-side validated `POST /v2/sender/orders`;
- client-supplied idempotency key mapped to one Providus reference;
- revalidate wallet session, amount, account and destination;
- ignore client-supplied provider instructions or status;
- persist sanitized request and response data;
- show exact `providerAccount` bank details, `amountToTransfer`, currency and `validUntil`;
- prevent duplicate submission on refresh or double click.

**Gate:** Automated tests pass. One explicitly approved minimum-size mainnet order returns real transfer instructions.

### P5 — Status tracking, webhook and receipt

**Purpose:** Turn a created order into an end-to-end product.

Work:

- raw-body Paycrest webhook handler;
- `X-Paycrest-Signature` HMAC-SHA256 verification using timing-safe comparison;
- idempotent event storage;
- legal state transitions;
- authenticated polling fallback;
- expiry countdown;
- receipt states for initiated, pending, fulfilling, settling, settled, expired, refunding and refunded;
- show onchain transaction hash only when returned by Paycrest;
- settled is the success condition for on-ramp.

**Gate:** A minimum-size real order reaches its truthful terminal state and survives page refresh.

### P6 — x402 payment primitive

**Purpose:** Establish the track-counting payment path once and reuse it.

Work:

- one reusable server protection layer for paid resources;
- Celo mainnet `eip155:42220`;
- USDC `0xcEBA...118C`, 6 decimals, EIP-712 name `USDC`, version `2`;
- amount `10000` base units = `0.01 USDC`;
- pay-to wallet from server configuration;
- facilitator `https://x402.celo.org`;
- connected wallet signs the authorization;
- server verifies and settles before returning the paid resource;
- record payer, resource type, amount, settlement status and transaction hash;
- make payment retries idempotent and restore already-paid resources.

**Gate:** At least one genuine `0.01 USDC` mainnet payment reaches the pay-to wallet and the protected resource is returned once.

### P7 — Gmail OAuth and privacy boundary

**Purpose:** Connect a real mailbox without over-collecting data.

Work:

- Google OAuth in testing mode;
- Gmail read-only scope;
- state and PKCE protections where supported;
- encrypted refresh-token storage;
- disconnect and token-revocation path;
- privacy disclosure before connection;
- query only relevant receipt, invoice, renewal, trial, payment and cancellation messages;
- do not persist complete email bodies or attachments.

**Gate:** The builder connects Gmail, reconnects after refresh, and can revoke access.

### P8 — Real Leak Scan

**Purpose:** Produce useful evidence-backed subscription candidates.

Work:

- protect scan execution with the shared x402 primitive;
- deterministic Gmail search windows;
- parse merchant, sender domain, amount, currency, billing date, renewal language, cancellation evidence and candidate management links;
- group repeated evidence into a merchant candidate;
- compute monthly equivalents only where interval evidence exists;
- attach confidence reason codes;
- allow ignore/not-a-subscription feedback;
- no LLM-generated claims.

**Gate:** A paid scan finds real messages in the connected mailbox and every candidate links to redacted evidence.

### P9 — Recovery actions

**Purpose:** Create repeated legitimate paid agent work.

Work:

- per-merchant x402-paid Recovery Plan;
- show verified management/cancellation link where extracted;
- support one-click unsubscribe only when a standards-compliant unsubscribe action exists;
- otherwise prepare exact manual steps or a cancellation email draft;
- never log into third-party accounts on the user's behalf;
- monitor later Gmail messages for cancellation confirmation;
- sell a confirmation check only when it performs a new mailbox check.

**Gate:** One real candidate receives an evidence-backed recovery plan and a later confirmation status.

### P10 — Dashboard and product coherence

**Purpose:** Join both modules without inventing financial claims.

Work:

- real wallet USDC balance;
- real Paycrest order history;
- real x402 receipt history;
- real subscription candidates and recovery states;
- distinguish estimated recoverable value from confirmed savings;
- home navigation presents `Move Money` and `Stop Leaks` under one Providus promise;
- remove obsolete multi-provider comparison and cUSD copy.

**Gate:** Every visible number has a live source or is explicitly labelled as a deterministic estimate.

### P11 — Mainnet hardening and submission

**Purpose:** Protect the demo from ordinary failure.

Work:

- mobile and MiniPay checks;
- loading, empty, expiry, 401, 402, 429, 500 and provider-unavailable states;
- rate limiting and abuse controls;
- sensitive-log audit;
- build, typecheck, lint and targeted tests;
- production environment validation;
- Vercel webhook URL check;
- one full screen-recorded rehearsal;
- README, architecture, setup, privacy and demo documentation;
- submission links and ERC-8004 requirement check.

**Gate:** Production deployment passes the full mainnet demo checklist.

---

## 7. Four-day execution schedule

### July 30 — Prove and wire Paycrest

- P0 audit
- P1 Paycrest adapter
- P2 wallet/database foundation
- P3 live rate and account verification

End-of-day proof: live Paycrest data reaches the existing UI with secrets confined to the server.

### July 31 — Complete the on-ramp

- P4 order creation
- explicitly approved minimum-size live order
- P5 webhook/polling, receipt and dashboard history

End-of-day proof: NGN instructions are real and USDC delivery status is traceable.

### August 1 — Establish x402 and Gmail

- P6 x402 primitive
- one real settlement
- P7 Gmail OAuth
- P8 first paid Leak Scan

End-of-day proof: a wallet pays for a scan and receives real mailbox-derived candidates.

### August 2 — Recovery, hardening and demo

- P9 recovery actions
- P10 coherent dashboard/copy
- P11 production hardening
- demo video, README and submission assets
- code freeze by 18:00 WAT

### August 3 — Submission buffer

- smoke test production;
- verify public links and transaction evidence;
- publish before 10:00 WAT;
- make no broad feature changes.

---

## 8. Cut line

If the schedule slips, preserve this order:

### Must ship

1. Real Paycrest NGN → USDC/Celo order and truthful status.
2. Real Celo x402 settlement.
3. Real Gmail connection and evidence-backed paid scan.
4. Mobile production deployment and receipt evidence.

### Ship if stable

1. Per-merchant Recovery Plan.
2. Cancellation-confirmation monitoring.
3. Unified dashboard.

### Cut first

1. Multiple fiat corridors.
2. Off-ramp.
3. Multiple stablecoins.
4. Automated third-party account cancellation.
5. Advanced analytics.
6. Multi-provider ranking.
7. Custom smart contracts.

---

## 9. Working method with the coding agent

1. Feed only one prompt at a time.
2. Bring the agent's complete report back before requesting the next prompt.
3. If a prompt fails, use a small recovery prompt; do not restart the milestone.
4. The coding agent must inspect before editing and preserve the existing visual system.
5. Any mainnet mutation requires explicit approval and an exact amount/target.
6. Never let the agent silently substitute mock data when an external service fails.
7. Keep commits scoped by prompt ID where practical.

The immediate next action is **P0**, not UI implementation and not a live order.
