# B9B — Manual browser testnet E2E (chain 968)

No browser-wallet automation exists in this repo, so this gate is manual.
Mocked wallets or simulated receipts do NOT count. Complete every step with
a real wallet (e.g. MetaMask/Rabby on a desktop browser) holding test BOT.

## Prerequisites

- Testnet BOT in the wallet (faucet / coordinator-provided), ~0.05 for gas.
- App running (`npm run dev`) or the Vercel preview deployment.
- Recipient: a second controlled address (docs/b7-wallet-payment-experience.md
  shows the review/confirm/receipt cards to expect).

## Steps

1. Connect the testnet wallet (chain 968 — reject any mainnet prompt).
2. Complete real SIWE login in the app.
3. In the assistant, ask: "Pay Douglas 0.01 BOT on BOT Testnet."
4. Resolve or paste the recipient; confirm the FULL address shown.
5. Optionally save it (explicit "yes" only).
6. Review the B3 intent (id, address, chain 968, asset, exact base units).
7. Fetch a fresh execution plan (review card → plan endpoint).
8. Confirm the exact transaction in the wallet (to = `0xbc629870…5B7a4`,
   value = 0.01 BOT, data = payNative selector).
9. Broadcast once. If ambiguous, do NOT resend — copy the hash.
10. Register the hash via POST /api/transfers/[id]/submission.
11. Wait for B5 confirmation (GET …/status or recheck).
12. Verify: success receipt, PaymentExecuted with exact intent/recipient/
    amount, replay flag set, no second broadcast.

## Evidence to record

- Payment tx hash + scan.bohr.life URL, block number.
- Screenshot of the confirmed receipt card (no keys visible).
- B5 status response showing `confirmed`.

## Completed evidence (testnet, chain 968)

- Payment tx: 0xc78894111101480f801477404f7968127ddcf2a06dc080d9ffb7e9df4c157e25
- Explorer: https://scan.bohr.life/tx/0xc78894111101480f801477404f7968127ddcf2a06dc080d9ffb7e9df4c157e25
- From testnet deployer wallet, to canonical testnet ProvidusPay
  0xbc6298701490ba211733F2Dc28deB7Df9835B7a4
- payNative selector 0x1a56282b, value exactly 0.01 test BOT (10^16 wei)
- Receipt: success, block 29829450
- Exactly one PaymentExecuted from our contract: intentId recorded,
  token = 0x0 (native), amount = 10^16 wei, recipient 0xD691…0c0d03
- No second broadcast associated with the intent.

## Status

COMPLETED via real browser wallet (user-executed, independently verified
on-chain 2026-11-09). No mocked wallets, no simulated receipts.
