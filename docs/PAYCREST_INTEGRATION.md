# Paycrest Integration (P1 + P3)

## Scope

Server-side **read** foundation + Move Money **quotes**. No order creation.

## Rules

- **Server-only secrets:** `PAYCREST_API_KEY` and `PAYCREST_BASE_URL` stay server env. Never `NEXT_PUBLIC_*` for these.
- **Fixed corridor:** network `celo`, token `USDC`, fiat `NGN`. Never silently substitute Base.
- **Canonical USDC:** Circle contract in `lib/celo/usdc.ts` — compared at runtime via Paycrest `/tokens` (`contractMatchesCanonical`).
- **Buy / sell availability:** dynamic from live rates. No hardcoded NO_PROVIDER / available.
- **No fallback rates.** Fabricated success is forbidden.
- **No orders:** do not call `POST /v2/sender/orders`.

## Support response fields

| Field | Meaning |
|---|---|
| `contractMatchesCanonical` | Paycrest USDC contract equals Circle canonical |
| `decimalsMatchCanonical` | Paycrest decimals === 6 |
| `tokenCompatible` / `quoteReadiness` | Both match — quotes allowed in UI |
| `buy` / `sell` | Live corridor quotes at amount `1` (probe) |

## Modules

| Path | Role |
|---|---|
| `lib/celo/usdc.ts` | Canonical Circle USDC |
| `lib/paycrest/server/*` | Server client |
| `app/api/paycrest/corridor` | Live buy/sell quote |
| `app/api/paycrest/support` | Token + availability probe |
| `hooks/use-corridor-quote.ts` | Debounced client quote hook |
| `components/move/*` | Move Money UI |
