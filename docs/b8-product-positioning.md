# B8 product positioning

## Product promise

Providus is a multichain conversational payment execution platform.

The user asks who to pay or what to purchase. Providus validates the request, shows the exact terms, waits for wallet approval, and reports only the outcome that its evidence supports.

The product line is **Ask. Approve. Prove.**

## Current execution domains

| Domain | Availability | User experience | Boundary |
|---|---|---|---|
| Celo | Live | Nigerian airtime and bank cash-out | Payment, NGN settlement, and service fulfilment remain separate states. |
| BOT Chain | Testnet verified | Named-recipient native BOT transfers | Mainnet payments and BOT-funded utility payments are pending B9 verification. |

The web dashboard is the current conversation surface. A wallet signs every money-moving action. Providus does not request private keys or custody user funds.

## Two user stories

### Pay people on-chain

The user can ask for a named-recipient transfer, confirm the full address, review the network and amount, sign in the wallet, and inspect the B5 submission and verification state.

The B8 public example is `Pay Douglas 2 BOT on BOT Testnet.` The current implementation uses native BOT on chain ID 968. Mainnet USDT execution remains feature-gated until B9.

### Pay for real-world services

The user can request supported Nigerian airtime or use the separate bank cash-out flow on Celo. The live airtime proof distinguishes the Celo payment, NGN settlement, and airtime fulfilment stages.

The product does not present a token transfer as utility delivery. BOT-funded airtime, data, electricity, and cable payments remain planned until a conversion or settlement route and provider delivery are verified.

## Partner acknowledgment

The homepage and footer use the official BOT Chain wordmark sourced from `https://www.botchain.ai/icons/icon_title_logo.png`.

Public links:

- [BOT Chain website](https://www.botchain.ai)
- [BOT Chain mainnet explorer](https://scan.botchain.ai)
- [BOT Chain testnet explorer](https://scan.bohr.life)

Testnet receipts link to `scan.bohr.life`. Mainnet explorer links are informational only until B9 enables mainnet execution.

## Browser evidence

The B8 browser pass checked the homepage, dashboard and trust page at desktop and 390px mobile widths. The mobile checks reported `scrollWidth === innerWidth` for the dashboard and trust page.

Screenshots:

- [`b8-home-desktop.png`](./b8-evidence/b8-home-desktop.png)
- [`b8-home-mobile.png`](./b8-evidence/b8-home-mobile.png)
- [`b8-dashboard-top-desktop.png`](./b8-evidence/b8-dashboard-top-desktop.png)
- [`b8-dashboard-mobile.png`](./b8-evidence/b8-dashboard-mobile.png)
- [`b8-home-footer-desktop.png`](./b8-evidence/b8-home-footer-desktop.png)
- [`b8-how-it-works-mobile.png`](./b8-evidence/b8-how-it-works-mobile.png)

The existing B7 fixture browser scenario also passed after the copy changes. It used a real local SIWE signature and simulated wallet and chain responses. It did not broadcast a funded transaction.

## Availability language

- **Live** means the current Celo flow is shipped and has the recorded proof described in the product documents.
- **Testnet verified** means the BOT Testnet payment path has been exercised through the dashboard and B5 verification boundary. It does not mean mainnet is available.
- **In development** means the path needs integration and verification work before it is a current product claim.
- **Planned** means the category is shown as a future direction, not an available payment.
