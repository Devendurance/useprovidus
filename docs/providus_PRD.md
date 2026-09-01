# Providus Agent PRD

**Product:** Providus  
**Category:** Celo route-intelligence agent  
**Core paid action:** Providus Route Check  
**Hackathon focus:** Celo Agentic Payments & DeFAI Hackathon  
**Product principle:** Show the outcome before the money moves.

## 1. Executive summary

Providus helps mobile-first users in high-fee markets choose a better route from local fiat into Celo assets. A user enters country, amount, payment method and target asset; Providus compares a deliberately limited set of supported routes by **effective received amount**, fee, FX spread, limits, settlement time and reliability.

The user sees a useful locked preview, then pays a small x402 stablecoin fee to unlock the full **Route Verdict**: the recommended route, its assumptions, alternatives and provider handoff.

Providus does not custody funds or make the fiat purchase. It makes the decision legible before money moves.

## 2. Problem

The same local-currency purchase can yield materially different amounts of cUSD, USDC or CELO depending on provider, payment method, FX spread, local liquidity, limits and settlement speed. Wallets typically surface a single partner route; users cannot reliably tell what will arrive until after choosing.

The primary job is:

> When I buy a Celo asset, tell me which supported route leaves me with the most usable value for my exact country, amount and payment method.

## 3. Priority market

### Primary user

Mobile-first Celo or stablecoin users in **one or two verified target markets** with meaningful local on-ramp fee variation.

### Secondary users

- Remittance receivers comparing conversion/settlement options.
- Crypto-curious buyers asking for the cheapest supported route in their country.
- Apps or agents that pay x402 for a validated route quote.

### Non-goal

Do not claim global coverage in the MVP. Narrow coverage with timestamped, explainable routes is more credible than unreliable comparisons everywhere.

## 4. Core experience

### Flow

1. User opens Providus.
2. User selects country, fiat currency, amount, payment method and target asset.
3. Providus fetches and normalises eligible provider/manual quotes.
4. User receives locked preview: likely saving range and number of routes compared.
5. User pays x402 through the Celo facilitator for a Route Check.
6. Providus returns the unlocked Route Verdict.
7. User opens the provider deep link or clear manual execution instructions.
8. Providus records a savings estimate and user-visible receipt.

### Route Verdict requirements

- estimated received amount;
- asset and route/provider;
- payment method;
- explicit fee;
- estimated FX spread;
- network cost where relevant;
- settlement range;
- route reliability / quote confidence;
- eligibility and amount-limit caveats;
- quote capture time and expiry;
- estimated saving versus stated baseline;
- provider handoff;
- alternative eligible routes;
- transparent ranking rationale.

No payment unlock is complete until the result includes an actionable route, not just an abstract score.

## 5. MVP scope

### Must have

- one or two supported countries;
- two to four real or transparently manual/timestamped route sources per market;
- country, amount, payment method and asset input;
- quote normalisation and effective-received calculation;
- locked preview;
- x402-paid Route Check;
- server-side payment verification;
- Route Verdict and provider handoff;
- Celo attribution-tag implementation for technically eligible Track 1 transactions;
- configured payTo / agent wallet for Track 2 settlement attribution;
- savings receipt;
- mobile-first empty, stale and failed states;
- tests for quote calculations and payment verification.

### Should have

- route reliability score;
- quote refresh/expiry;
- public, data-minimised stats for genuine usage;
- paid quote API for apps/agents after consumer Route Check works;
- Askbots-compatible explainability endpoint.

### Defer

- Gmail subscription scanning;
- unsubscribe execution;
- XION/Verona proof layer;
- global route coverage;
- affiliate revenue mechanics;
- success-fee pricing;
- custody, fiat purchase execution, swapping or trading;
- broad dashboard analytics.

## 6. Ranking policy

The recommendation ranks user outcome, never provider placement.

```text
score =
  normalized_received_amount * 0.50 +
  low_fee_score              * 0.20 +
  reliability_score          * 0.15 +
  speed_score                * 0.10 +
  celo_native_bonus          * 0.05
```

Effective received amount includes explicit fee, estimated FX spread, network fee, route limits, payment-method eligibility and stale-quote penalty.

Manual or estimated quotes must be visibly marked with assumption source and capture time. Affiliate/sponsored links, if ever present, must be disclosed and cannot improve ranking.

## 7. x402 and Celo requirements

### Route Check payment

1. `POST /api/quotes/preview` returns preview and 402 payment requirements.
2. User/client pays through `x402.celo.org`.
3. Backend validates amount, token, recipient, network and request/action binding.
4. Backend prevents replay and unlocks the Route Verdict.
5. Payment record stores settlement reference and action ID.

### Attribution discipline

- Register the hackathon project early and obtain the assigned `celo_...` attribution tag.
- Add the tag to every eligible non-x402 project transaction according to the attribution SDK.
- Register the actual payTo/agent wallet for x402 Track 2 counting.
- Do not claim that x402 facilitator settlements themselves carry the attribution tag.
- Never manufacture payment count through non-useful calls; manual review screens for sybil behaviour and expects genuine utility.

## 8. Trust, safety and privacy

- Providus recommends and deep-links; it does not custody or directly move the user’s fiat funds.
- Quote results are estimates, not price guarantees.
- Every result discloses freshness and expiry.
- Validate all request fields with a schema layer and enforce rate limits.
- Store provider keys server-side; never expose secrets or wallet keys in client bundles.
- Bind x402 payments to a specific quote/action ID and verify server-side.
- Store only what is necessary for quote history, payment proof and user receipts.
- If the post-hackathon Monitor module uses Gmail, it must use read-only OAuth, avoid full-message-body retention, provide deletion, and remain optional.

## 9. Success metrics

### Product north star

> **Verified estimated savings produced through completed Celo-routed actions.**

### Hackathon metrics

- genuine x402 Route Check settlements;
- payment conversion from preview to unlock;
- tagged eligible Celo transaction volume;
- route checks completed per target market;
- freshness and coverage of displayed routes;
- user-reported recommendation usefulness;
- failed/stale quote rate.

## 10. Demo script

1. A user wants to buy cUSD in a supported market.
2. They enter local amount and payment method.
3. Providus compares three clear options.
4. The locked preview shows potential saving.
5. The user completes a small x402 Route Check payment on Celo.
6. The Route Verdict reveals: `You receive an estimated 96.42 cUSD`.
7. The user sees fee, FX, settlement time, confidence and route alternatives.
8. They continue to the selected provider.
9. Providus records a clear receipt: `You kept an estimated 3.42 cUSD by choosing this route.`

## 11. Definition of done

The MVP is complete only when:

- a public repository exists;
- the project is registered and attribution/payout wallet setup is recorded;
- at least one real user-facing Route Check can be paid through x402 on Celo;
- the full Route Verdict is generated from actual or explicitly labelled manual quote data;
- the quote calculation and route ranking are tested;
- stale/no-route/low-confidence states are accurate;
- mobile flow is usable;
- no financial outcome is presented as guaranteed when estimated;
- demo and README distinguish shipped behaviour from the deferred Monitor module.
