# Wallet Integration (P2 / P2.1 / P3)

## Scope

Celo **mainnet** wallet foundation + USDC balance for Move Money quotes.

No transfers, approvals, Paycrest orders, or x402 signatures.

## Supported wallets (strict)

1. MetaMask  
2. Rabby Wallet  
3. OKX Wallet  

No Phantom, no generic injected, no WalletConnect in the product surface.

## Canonical USDC

Balance reads use **canonical Circle USDC** from `lib/celo/usdc.ts`:

`0xcebA9300f2b948710d2653dD7B07f33A8B32118C` (6 decimals, chain 42220).

`NEXT_PUBLIC_CELO_USDC_ADDRESS` is **not required**.

## Identity

Connected address is provisional Providus identity (future Paycrest destination/source and x402 signer).

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `PAYCREST_API_KEY` | Server quotes | Paycrest auth |
| `PAYCREST_BASE_URL` | Optional | Defaults to `https://api.paycrest.io/v2` |

## Pure helper checks

```bash
npm run test:wallet-helpers
npm run test:money-helpers
```
