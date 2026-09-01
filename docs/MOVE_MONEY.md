# Move Money (P3) — Quote experience

## Scope

Live **quote-only** Move Money for Celo USDC · NGN via Paycrest read APIs.

- No order creation (`POST /v2/sender/orders` not used)
- No token transfer, approval, or x402
- No bank details collected

## Canonical USDC

Circle-issued USDC on Celo mainnet (single module: `lib/celo/usdc.ts`):

| Field | Value |
|---|---|
| Network | Celo |
| Chain ID | 42220 |
| Symbol | USDC |
| Decimals | 6 |
| Contract | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` (checksummed via viem) |

`NEXT_PUBLIC_CELO_USDC_ADDRESS` is **not required**. Runtime compatibility is checked with Paycrest `GET /tokens` → `contractMatchesCanonical`.

## Directions

| UI label | Meaning | Paycrest `side` |
|---|---|---|
| Buy USDC | NGN → USDC on Celo | `buy` |
| Cash out | USDC on Celo → NGN | `sell` |

Amount input is always **USDC crypto notional** (server corridor path). Estimated NGN = `amount × rate` with exact decimal-string math.

## Availability

Buy and sell liquidity are **live and dynamic**. Never hardcode. When Paycrest returns `available: false` / `NO_PROVIDER`, show an honest unavailable state (especially Buy USDC on Celo).

## Wallet

Uses `useProvidusWallet()` and readiness guards. Supported wallets remain MetaMask → Rabby → OKX (P2.1). Cash out compares amount to on-chain USDC balance in base units without inventing zeros.

## Routes

- UI: `/check` (Move Money)
- API: `/api/paycrest/corridor`, `/api/paycrest/support`, `/api/paycrest/institutions`
- API: `POST /api/paycrest/verify-account` (P4A — no order creation)

## Cash-out recipient (P4A)

1. Load live NGN banks from Paycrest (filtered for bank payout types).
2. User selects bank + enters 10-digit account (string; leading zeroes kept).
3. User clicks **Verify account** → server `POST /v2/verify-account`.
4. Show exact Paycrest account name + masked account number.
5. Verification is bound to institution + account; any change clears it.
6. Review readiness requires wallet on Celo, live sell quote, balance, verification.
7. P4B: deliberate **Create cash-out order** → `POST /api/paycrest/orders` → Paycrest `POST /v2/sender/orders`.
8. P4B: deliberate **Pay order** → direct ERC-20 `transfer` of amount+fees to `receiveAddress` (no approve).
9. On-chain deposit confirmation only — NGN payout is **not** claimed paid.

Bank details are never persisted or logged.

## P4B order notes

- Server re-verifies recipient before create; browser `accountName` is not authoritative.
- Total USDC = amount + senderFee + transactionFee (exact decimal strings).
- Timeout after create → `ORDER_CREATION_OUTCOME_UNKNOWN` (do not auto-retry).
- Payment blocked within 60s of `validUntil` (Providus safety margin).
