# Celo Agents at Work — Providus Registration & Attribution

Private project context for **Providus** on the Celo Builders platform.  
Do not put private keys, seed phrases, OAuth tokens, Celo Builders API keys, Paycrest credentials, ClubKonnect credentials, bank-account details, or other secrets in this file or in git.

---

## 1. Hackathon

| Field | Value |
|---|---|
| **Event** | Celo Agents at Work Hackathon |
| **Slug** | `agents-at-work` |
| **Platform** | `https://celobuilders.xyz` |
| **Network** | Celo mainnet (`celo-mainnet`, chain ID `42220`) |
| **Final submission deadline** | **2026-09-21T09:00:00Z** / **10:00 WAT** |
| **Project** | Providus |
| **Repository** | `https://github.com/Devendurance/useprovidus` |
| **Registration status** | `draft` — registered, not final-published |

Registration and final publication are separate. Do not call the final publish action until the project, evidence, track fields, and public links have been reviewed.

---

## 2. Current registration record

| Field | Value |
|---|---|
| **Project name** | Providus |
| **Participant** | Endurance Udoh |
| **Team** | Providus |
| **X / Twitter** | `@devendyy` |
| **Telegram** | `@devendurance` |
| **Submission ID** | `8e342cb6-c0bd-4059-8f8e-0a90d5567ba9` |
| **Participant ID** | `036f52a5-f461-499a-96cd-1890dd0e8ce6` |
| **Hackathon ID** | `9c9c1bff-8e24-4193-bd57-a91d0c963368` |
| **ERC-8004 Agent ID** | `9851` |
| **ERC-8004 URL** | `https://8004scan.io/agents/celo/9851` |
| **Agent wallet** | `0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa` |
| **buy / cPay beta opt-in** | `true` |

### Registered tracks

| Track slug | Role | Intent |
|---|---|---|
| `real-world-adoption` | **Primary** | Real Nigerian payment utility on Celo |
| `value-moved` | Additional | Genuine tagged Celo mainnet stablecoin value through Providus |
| `askbots-growth` | Additional | Baseline review → implementation improvements → second review |
| `judges-favorite` | Additional | Polished AI-native real-world payment experience |
| `cpay-feedback` | Additional | Closed-beta testing and useful product/integration feedback |

### Additional-track rationale saved at registration

> Value Moved: Real mainnet stablecoin volume via USDC-to-NGN rails. AskBots: Baseline review + iterative improvement cycle. Judges Favorite: AI payment command box on Celo. buy Feedback: Closed-beta testing of agent compute payments.

The registration API accepted all five track IDs.

---

## 3. Locked attribution tag

```text
celo_8190b99392a2
```

This is the active **Agents at Work** attribution tag for `Devendurance/useprovidus`.

Treat it as immutable for this hackathon registration.

### Important migration note

An older local configuration used:

```text
celo_91fed90b97fc
```

That tag belongs to the previous hackathon registration and must **not** be used for Agents at Work transaction attribution.

Before the next hackathon-intended Celo mainnet transaction:

1. update the active local/deployment attribution configuration to `celo_8190b99392a2`;
2. implement ERC-8021 attribution in transaction calldata;
3. test encoding without sending a live transaction;
4. send a live transaction only after explicit approval;
5. verify the resulting transaction contains the expected tag.

Changing the environment variable alone is not sufficient if the wallet execution path does not append the ERC-8021 suffix.

---

## 4. ERC-8004 identity

Providus is registered as an ERC-8004 agent on Celo:

```text
Agent ID: 9851
URL: https://8004scan.io/agents/celo/9851
Owner/creator wallet: 0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa
```

Current metadata intentionally stays conservative:

- Celo network;
- no fake MCP/A2A endpoint;
- no unsupported trust mechanism;
- x402 support not claimed merely because the hackathon includes x402-related work;
- agent can be marked active later when the actual command/orchestration layer is deployed.

---

## 5. Current product framing

### One-line description

> **Providus turns approved messages into verified real-world payments through a safety-first conversational payment execution layer.**

### Current shipped proof

- Web conversational assistant with deterministic airtime `PaymentIntent` validation.
- Celo mainnet USDC wallet flow with explicit human approval.
- Paycrest quotes, order creation, authoritative fee binding, and fiat-delivery reconciliation.
- Neon PostgreSQL + Drizzle durable transaction state.
- ClubKonnect airtime fulfilment with deterministic RequestID, one-shot claim protection, and terminal-status reconciliation.
- Evidence-linked receipt/status surface.
- Separate Celo USDC → Nigerian bank cash-out flow through Paycrest.
- One completed human-gated live airtime run documented in `docs/live-airtime-e2e.md`.

### Historical baseline note

The limitations listed in the original registration snapshot described the pre-P0/P6 implementation baseline. They are superseded as current-state claims by the live P6.10 evidence and current architecture. This registration record is retained for submission history; it does not claim data bundles, electricity, cable, additional providers, or future conversational channels are shipped.

---

## 6. Track evidence plan

### `real-world-adoption` — primary

Demonstrate genuine Nigerian payment utility, not a mock:

- real Celo mainnet wallet interaction;
- real Paycrest settlement path;
- real bank cash-out and/or completed airtime payment;
- explicit user approval;
- truthful state transitions and receipts;
- tagged eligible Celo transactions after attribution is implemented.

### `value-moved`

Use genuine economic activity only.

Evidence should include:

- eligible Celo mainnet transactions carrying `celo_8190b99392a2`;
- independent real usage where possible;
- transaction hashes and purpose;
- any project-controlled wallets/contracts declared where the submission schema requires it;
- no self-transfer inflation or meaningless volume.

The two earlier Providus cash-outs remain product proof, but transactions created before this tag was wired should not be presented as tagged Agents at Work volume.

### `askbots-growth`

Preserve a real before/after improvement story:

1. run and save the current baseline review before P0 changes;
2. preserve scores, review IDs, findings and project URL;
3. implement substantive improvements;
4. run the required second review;
5. submit evidence of measurable improvement.

### `judges-favorite`

Focus on product coherence rather than adding unrelated features:

- command-first payment UX;
- explicit approval before money movement;
- Celo mainnet;
- ERC-8004 identity;
- ERC-8021 attribution;
- real Paycrest settlement;
- real Nigerian fulfilment through ClubKonnect;
- polished mobile demo and recovery/error states.

### `cpay-feedback`

Keep this track separate from the critical Providus payment path.

Required work should be performed according to the current Celo Builders / buy beta instructions, with any resulting feedback issue/report linked at final submission. Do not falsely mark Providus itself as x402-capable unless that capability is actually implemented.

---

## 7. Final-submission fields to prepare

The registration is saved, but the project is not published.

Before final publication, re-fetch the live Celo Builders submission schema and complete all currently required fields. Expected submission-stage evidence includes:

- tagline;
- project description;
- public social post;
- `celoNetwork = celo-mainnet`;
- ERC-8004 URL;
- agent contribution notes;
- public deployment/demo URL;
- walkthrough video if required/available;
- AskBots project/review evidence;
- buy feedback evidence;
- track-specific wallet/contract declarations where required;
- repository must remain public.

Never rely on an old cached schema if the API reports changed requirements.

---

## 8. Attribution implementation contract

Target package:

```bash
npm install @celo/attribution-tags
```

Target source of truth:

```env
NEXT_PUBLIC_CELO_ATTRIBUTION_TAG=celo_8190b99392a2
```

Do not hardcode the old tag.

For the current direct ERC-20 transfer flow, the implementation must preserve the exact:

- token contract;
- recipient;
- amount;
- wallet;
- Celo chain;

while appending the official ERC-8021 suffix to the final transaction calldata.

The implementation must be verified against the installed wagmi/viem versions. Do not assume a plain `writeContract()` call automatically appends custom suffix data.

### Required pre-live tests

- encoded call still decodes to the intended ERC-20 `transfer(recipient, amount)`;
- attribution suffix contains `celo_8190b99392a2`;
- missing/malformed tag fails before wallet submission;
- no wallet/provider secret enters the client bundle;
- no live mainnet transaction is sent without explicit approval.

---

## 9. Submission safety

- Registration is currently `draft`.
- Do not final-publish silently.
- Do not generate artificial mainnet activity for leaderboard metrics.
- Do not send provider orders or Celo transactions merely to test UI.
- Keep public claims aligned with what is actually shipped.
- Preserve transaction evidence for real usage.

---

## 10. Quick reference

```text
Project:            Providus
Hackathon:          agents-at-work
Primary track:      real-world-adoption
Additional tracks:  value-moved, askbots-growth, judges-favorite, cpay-feedback
Status:             draft / registered, not published

Repo:               https://github.com/Devendurance/useprovidus

ERC-8004 Agent ID:  9851
ERC-8004 URL:       https://8004scan.io/agents/celo/9851
Agent wallet:       0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa

Attribution tag:    celo_8190b99392a2
Deadline:           2026-09-21 09:00 UTC / 10:00 WAT
```
