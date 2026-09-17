# Project State

Last updated: 2026-09-17

## Product

- Providus is a Celo route-intelligence agent that compares local fiat-to-Celo routes by effective received amount before money moves.
- The primary Route Check flow collects country, amount, payment method, and target asset, then presents a preview and an actionable route verdict.
- Providus recommends and hands off to providers; it does not custody user funds or execute the fiat purchase in the MVP.
- Authoritative product requirements: [Providus PRD](../docs/providus_PRD.md).

## Current status

- The repository contains a Next.js App Router implementation with Providus landing, route-check, preview, verdict, dashboard, receipt, and how-it-works screens.
- Wallet connectivity and Paycrest-related route/order helpers are present in the current source tree.
- The working tree contains pre-existing uncommitted application and design changes. Inspect `git status --short` before modifying files and preserve those changes.

## Stack

- Next.js 16.2.12 with the App Router.
- React 19.2.4 and TypeScript 5.
- Tailwind CSS 4 through the existing PostCSS configuration.
- `wagmi` 3.7.5 and `viem` 2.55.10 for wallet and Celo integration.
- GSAP and Lenis for the existing motion and scrolling implementation.

## Architecture

- `app/` owns pages, layouts, loading and not-found states, and Paycrest route handlers under `app/api/paycrest/`.
- `components/` contains reusable layout, provider, route-check, move-money, Providus, and UI components.
- `lib/wallet/` contains wallet configuration, connectors, supported tokens, provider identity, guards, formatting, and self-check logic.
- `lib/paycrest/` contains Paycrest types, client/server helpers, amount and recipient handling, order construction, and self-check logic.
- `lib/money/` contains decimal and USDC amount helpers plus self-check logic.
- The recommended future architecture in `docs/PROVIDUS_ARCHITECTURE.md` mentions SvelteKit, Fastify, Supabase, and Redis; the actual implementation in this repository is the Next.js application described above.

## Key paths

- `app/`: application routes and API handlers.
- `components/`: reusable UI and feature components.
- `lib/`: wallet, money, and Paycrest domain logic.
- `docs/providus_PRD.md`: product requirements and MVP boundaries.
- `docs/PROVIDUS_ARCHITECTURE.md`: broader target architecture and data model.
- `docs/PAYCREST_INTEGRATION.md`: Paycrest integration notes.
- `docs/WALLET_INTEGRATION.md`: wallet integration notes.
- `DESIGN.md`: repository visual design system.
- `package.json`: scripts and dependency versions.

## Integrations

- Celo wallet flows use the existing `wagmi` and `viem` configuration under `lib/wallet/` and `components/providers/`.
- Paycrest integration is exposed through the existing handlers under `app/api/paycrest/` and helpers under `lib/paycrest/`.
- Environment configuration is documented by `env.example`; secrets remain server-side and are never recorded in agent state.

## Verification

- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm run test:wallet-helpers`
- `npm run test:money-helpers`
- `npm run test:recipient-helpers`
- `npm run test:order-helpers`
- `npm run test:order-route`
