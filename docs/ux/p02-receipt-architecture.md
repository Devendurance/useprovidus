# P0.2 Receipt Architecture

## Decision

Expose one owner-authenticated receipt surface over the existing payment ledgers. Keep the Celo transaction reader and BOT B5 submission reader private behind the receipt service, then map both into a discriminated receipt DTO. Do not add a denormalized receipt table or run a migration.

## Data sources and truth rules

- BOT receipts come only from existing wallet-owned transfer intents joined to their submissions. Include BOT Mainnet and historical BOT Testnet evidence when a submission exists.
- A BOT payment is `Verified` only when B5 reports the submission as confirmed and supplies `verifiedAt`. Submitted hashes remain pending, unknown, or failed according to persisted state.
- Celo history comes from the existing owner-linked `agent_transactions` records. Preserve Celo's existing status vocabulary and do not relabel it as B5 verified.
- Existing Celo records do not contain a verified full recipient address, and neither ledger has actual gas-fee evidence. The detail view must identify those fields as unavailable.
- Approval transactions are not payment receipts. Current durable data cannot support approval history.

## API and ownership

- `GET /api/receipts` derives the wallet owner from `requireOwner`; query parameters are limited to real search, network, token, status, and pagination fields supported by stored data.
- `GET /api/receipts/[id]` uses a source-prefixed identifier and verifies ownership against that source before returning detail evidence.
- Separate private source readers keep schema assumptions local. The service merges source rows with a deterministic timestamp plus stable identifier ordering, so equal timestamps do not skip or duplicate rows across pages.
- No caller-provided wallet address establishes ownership. Do not expose either ledger through the existing untrusted wallet-address receipt lookup.

## UI behavior

- Conversation cards stay compact and link to full receipt detail.
- Receipt history uses compact rows, explicit filters, truthful empty states, and a modal backed by the receipt detail API.
- Prefer a native `<dialog>` opened with `showModal()` for focus containment and background inertness. Add a named close button, Escape and outside-click close behavior, explicit focus restoration, and mobile-safe scrolling.
- The mobile navigation uses an opaque sticky header with safe-area spacing. A native dialog/menu pattern must close after navigation, Escape, or outside click, preserve focus, and prevent background scrolling while open.
- Full token, contract, hash, block, confirmation, timestamp, and explorer evidence is progressive disclosure in the modal.

## Migration boundary

No migration is needed for current receipt previews, filters, search over stored fields, pagination, or detail evidence. Durable approval history would need a separate reviewed additive schema for owner, intent, chain, token, spender, exact amount, approval hash, status, and verification evidence. Do not implement or migrate it in P0.2.

## Verification focus

Cover owner isolation, BOT B5 verification semantics, Celo status preservation, stable cross-source pagination, actual-gas unavailable state, filters/search, modal keyboard/focus behavior, mobile menu dismissal, and no horizontal overflow. Test with local fixtures or existing records only. Never broadcast a transaction.
