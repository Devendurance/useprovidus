# Celo Hackathon Registration & Attribution

Private project context for **Providus** on the Celo Builders platform.  
Do not put private keys, seed phrases, or connection API keys in this file or in git.

---

## 1. Hackathon

| Field | Value |
|---|---|
| **Event** | Agentic Payments and DeFAI Hackathon |
| **Slug** | `agentic-payments-defai` |
| **Platform** | [celobuilders.xyz](https://celobuilders.xyz) |
| **Network** | **Celo mainnet only** (`celo-mainnet`) |
| **Starts** | 2026-07-07 (kickoff window from 2026-07-01 for volume counting) |
| **Submission deadline** | **2026-08-03T09:00:00.000Z** |
| **Winners announced** | 2026-08-07 |
| **Leaderboard** | [Dune — Agentic Payments DeFAI](https://dune.com/celo/agentic-payments-defai-hackathon) |
| **Skill / agent API** | `https://celobuilders.xyz` · re-fetch skill at `https://celobuilders.xyz/skill.md` if APIs fail with `skillHint` |

### Tracks (entered / relevant)

| Track slug | Title | Notes |
|---|---|---|
| `most-x402-payments` | Most x402 Payments | **Registered track** — raw count of successful x402 settlements via Celo facilitator |
| `most-revenue-generated` | Most Revenue Generated | On-chain volume with assigned attribution tag |
| `askbots` | Askbots | Optional partner track |
| `track-4-tba` | Best Feedback for Aigora | Optional; needs Aigora profile + feedback issue |

### Related bounties (x402 track)

| Bounty slug | Prize |
|---|---|
| `most-x402-payments-1st` | $700 in CELO |
| `most-x402-payments-2nd` | $300 in CELO |

Revenue track: `most-revenue-generated-1st` ($2,000) / `most-revenue-generated-2nd` ($1,000).

---

## 2. Project registration (current status)

| Field | Value |
|---|---|
| **Status** | `draft` (not published) |
| **Project name** | Providus |
| **Team name** | Providus |
| **GitHub** | https://github.com/Devendurance/Providus |
| **Builder** | Endurance Udoh |
| **Email** | devendurance@gmail.com |
| **X / Twitter** | @devendyy |
| **Telegram** | @devendurance |
| **Agent name** | Opencode and Grok Build |
| **Track IDs** | `most-x402-payments` |
| **Agent wallet (payTo)** | `0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa` |
| **Submission ID** | `a82e5f11-f841-4f5f-9a88-6031b7a52208` |
| **Participant ID** | `d5d8c791-0624-481e-bb09-0c21e282e240` |
| **Registered at** | 2026-07-28T00:07:30.81Z |

### Attribution tag (locked)

```text
celo_91fed90b97fc
```

- Format: `celo_` + 12 hex characters.
- Derived from the **first saved** GitHub `owner/repo` slug (`Devendurance/Providus`).
- **Locked at first registration save** — later GitHub URL edits do **not** change the tag.
- Leaderboards credit **only this assigned tag**, not a self-derived or third-party code alone.

### Product one-liner (for submissions / README)

> Providus is a Celo route-intelligence agent that compares local fiat-to-Celo paths by **effective received amount** and unlocks a full Route Verdict via a small **x402** payment.  
> Roof message: **Know what arrives before you pay.**

See also:

- Brand / copy: `docs/providus-brand-messaging.md`
- Product requirements: `docs/providus_PRD.md`
- Architecture: `docs/PROVIDUS_ARCHITECTURE.md`
- Visual system: `DESIGN.md` (repo root)

---

## 3. Fields still needed before **publish**

Required at **submission** stage (not yet complete on the draft):

| Key / field | Type | Notes |
|---|---|---|
| `tagline` | text | One-line product pitch |
| `description` | text | Short project description |
| `socialLink` | url | Public X/Twitter post about the submission (`x.com` / `twitter.com`) |
| `erc8004Url` | url | Agent ERC-8004 identity (`8004scan.io` or Celoscan NFT) |
| `agentWalletAddress` | address | Already set (mainnet payTo for x402 tracking) |
| `celoNetwork` | select | Must be `celo-mainnet` only |
| `agentContributionNotes` | text | How the agent helped build the project |
| Demo / video | optional | `demoUrl`, `videoUrl` if available |
| `appDomain` | optional | Public app URL |
| Aigora fields | optional | Only if entering Track 4 |

Publish only after explicit builder approval and before the deadline:

```http
POST https://celobuilders.xyz/submissions/me/publish
Authorization: Bearer <connection>
{ "confirm": true }
```

---

## 4. How to use the attribution tag in code

### Install

```bash
npm install @celo/attribution-tags
```

### Append the tag to transaction `data`

Every **eligible project-originated** Celo transaction that should count for revenue / volume attribution must include the assigned tag in the ERC-8021 data suffix:

```ts
import { toDataSuffix } from '@celo/attribution-tags'

const ATTRIBUTION_TAG = process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_TAG
  ?? 'celo_91fed90b97fc'

// Single tag
await walletClient.sendTransaction({
  to,
  value,
  data: toDataSuffix(ATTRIBUTION_TAG),
})
```

### Multiple codes (keep yours + assigned tag)

Leaderboards only credit the **assigned** tag. If you already suffix another app code, pass an array — both ride in the same suffix:

```ts
import { toDataSuffix } from '@celo/attribution-tags'

const tag = toDataSuffix([
  'your_existing_code',   // optional
  'celo_91fed90b97fc',    // required for this hackathon
])

await walletClient.sendTransaction({ to, value, data: tag })
```

Do **not** add platform codes like `minipay` yourself — platforms add those.

### Verify a tagged transaction

After the first live tagged tx:

```ts
import { verifyTx } from '@celo/attribution-tags'

const result = await verifyTx(txHash /* + provider/rpc as SDK requires */)
// Confirm result codes include: celo_91fed90b97fc
// Cross-check against GET https://celobuilders.xyz/submissions/me → attributionTag
```

### Environment variables (recommended)

```env
# Public — safe to expose in client if you only use the tag string
NEXT_PUBLIC_CELO_ATTRIBUTION_TAG=celo_91fed90b97fc

# Server-only — agent / payTo wallet for x402 settlement tracking (never commit private keys)
CELO_AGENT_WALLET_ADDRESS=0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa

# Network
CELO_CHAIN_ID=42220
```

Store private keys only in a secure secret manager or local `.env` that is gitignored.

---

## 5. Where to apply the tag in Providus

Map tag usage to product surfaces. **x402 facilitator settlements are tracked via the registered agent wallet (payTo), not by stuffing the attribution tag into facilitator settlement txs** (per product PRD). Use the tag on **your own** eligible Celo txs.

| Location in product | When | What to do |
|---|---|---|
| **Env / config** | Always | Single source of truth for `celo_91fed90b97fc` |
| **Agent / backend wallet module** | Any server-side `sendTransaction` from the project agent wallet | `data: toDataSuffix(ATTRIBUTION_TAG)` (or multi-code array) |
| **User wallet txs initiated by Providus** | If the app later constructs txs the user signs (transfers, approvals you control) | Append suffix to `data` before `sendTransaction` / `writeContract` encoding |
| **x402 Route Check payment path** | User pays small fee for Route Verdict | Configure **payTo** = agent wallet `0x21E5…bcDa`; route payments through **Celo x402 facilitator** so Track 2 (most x402 payments) can count |
| **Celo attribution service** | Architecture: `celo-attribution.service.ts` | Central helper: `buildTaggedData(existingData?)` / `sendTaggedTransaction(...)` so no call site forgets the tag |
| **Quote unlock / payment records DB** | After payment | Store `attribution_tag`, `tx_hash`, `payment_type` for audit and demos |
| **README / demo script** | Docs | Document tag + verifyTx loop for judges |

### Suggested helper (backend or shared package)

```ts
// e.g. lib/celo/attribution.ts or agent/src/services/celo-attribution.service.ts
import { toDataSuffix } from '@celo/attribution-tags'
import { concat, type Hex } from 'viem' // if you need to append to existing calldata

export const CELO_ATTRIBUTION_TAG =
  process.env.CELO_ATTRIBUTION_TAG ??
  process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_TAG ??
  'celo_91fed90b97fc'

/** Data field for a simple value transfer (tag only). */
export function taggedData(): Hex {
  return toDataSuffix(CELO_ATTRIBUTION_TAG) as Hex
}

/** Append attribution suffix to existing contract calldata. */
export function withAttribution(calldata: Hex): Hex {
  // Prefer SDK multi-code / suffix helpers if available for your encode path.
  // Pattern: original calldata + ERC-8021 suffix carrying celo_91fed90b97fc
  return concat([calldata, toDataSuffix(CELO_ATTRIBUTION_TAG) as Hex])
}
```

Wire **every** project `sendTransaction` through this helper so new features cannot ship untagged volume.

### Do / don’t

| Do | Don’t |
|---|---|
| Use the **exact** assigned tag `celo_91fed90b97fc` | Invent `codeFromHostname` and expect credit alone |
| Tag **every** eligible volume-generating project tx | Tag only “sometimes” or only demos |
| Keep agent wallet on file for x402 | Leave `agentWalletAddress` empty until after volume happens |
| Verify first tx with `verifyTx` | Assume the suffix is correct without decoding |
| Count only real Route Check utility | Sybil / spam empty x402 calls |

Volume counting window (hackathon metadata): **Celo mainnet, roughly Jul 1 – Aug 3 09:00 GMT**. Confirm live rules on the hackathon page if organizers update them.

---

## 6. Agent wallet & x402 (Track: most-x402-payments)

| Item | Value |
|---|---|
| **Agent / payTo address** | `0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa` |
| **Role** | Wallet the agent (or x402 payTo) receives settlements from; used for on-chain tracking of x402 payments and revenue volume |
| **Network** | Celo mainnet |

Flow (product):

1. `POST /api/quotes/preview` → locked preview + payment requirements (HTTP 402).
2. Client pays via Celo x402 facilitator (`x402.celo.org` ecosystem).
3. Backend verifies amount, token, recipient (= agent wallet), network, and binds payment to quote/action ID.
4. Unlock Route Verdict; store settlement reference.

Attribution tag is separate from “who received the x402 fee,” but both must be configured correctly for dual-track ambition (x402 count + tagged volume).

---

## 7. Connection credential (operational note)

Registration used Google OAuth via Celo Builders (`/auth/google/start` → claim code → `apiKey`).

- The connection **API key is a secret**. Do **not** commit it to this repo or this markdown file.
- Store it only in a local secret store or password manager if you need to update/publish the submission later.
- If lost, reconnect through the Celo Builders agent skill / auth flow.

---

## 8. Publish checklist (before deadline)

- [ ] Tagline + description finalized (brand messaging)
- [ ] Public X post → `socialLink`
- [ ] ERC-8004 agent URL → `erc8004Url`
- [ ] `celoNetwork`: `celo-mainnet`
- [ ] Agent contribution notes
- [ ] Demo URL if live
- [ ] Confirm GitHub repo is **public**
- [ ] Attribution helper live on eligible txs; first tx verified with `verifyTx`
- [ ] Agent wallet funded / receiving x402 correctly
- [ ] Explicit builder approval → `POST /submissions/me/publish`

---

## 9. Quick reference card

```text
Project:     Providus
Hackathon:   agentic-payments-defai
Track:       most-x402-payments
Tag:         celo_91fed90b97fc
Agent:       0x21E5Fc03E4305CC8CFb874253c6d66A8bdB0bcDa
Repo:        https://github.com/Devendurance/Providus
Deadline:    2026-08-03 09:00 UTC
Status:      draft (registered)
```

```ts
import { toDataSuffix } from '@celo/attribution-tags'
data: toDataSuffix('celo_91fed90b97fc')
```
