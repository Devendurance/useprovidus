# B7 wallet payment experience

B7 connects BOT Testnet payments to the existing dashboard and assistant. Celo airtime, cash-out, Paycrest and ClubKonnect keep their existing services. No schema change, migration, deployment or push is part of this milestone.

## Wallet and payment boundaries

- `hooks/use-wallet-auth.ts` distinguishes connection from SIWE authentication. The wallet signs the existing challenge, the server verifies it and sets the existing HttpOnly session cookie. The owner is checked against the connected account. Authentication supports EOAs.
- `GET /api/auth/session` returns only the authenticated owner. Recipient and transfer requests include an expected-wallet header that can restrict access, but cannot establish ownership. A different cookie owner returns 401.
- AssistantPanel retains B6 structured actions. Recipient confirmation displays the full address and network. New addresses require explicit confirmation and a separate save decision. Saving calls the authenticated B2 recipient API. Saved-recipient edits retain the B2 version checks.
- Chat confirmation can prepare an intent. Only the explicit review-card action starts wallet signing. The review reads the stored B3 intent, not assistant prose or action-card amounts.
- `POST /api/transfers/[id]/execution` accepts only `{}`. It derives ownership from the session, checks stored status/expiry, recipient freshness and prior B5 submissions, then calls B4 `prepareExecutionPlan`. The response includes exact transaction data and expected verification terms.
- Execution is restricted to native BOT on chain 968 and canonical contract `0xbc6298701490ba211733F2Dc28deB7Df9835B7a4`. Mainnet preparation and submission registration remain disabled regardless of a mainnet environment value.
- Immediately before signing, the browser fetches a fresh plan, checks session/account/network, estimates gas and checks balance. An exclusive browser lock prevents concurrent signing in another tab. The server never signs or broadcasts a user's transaction.
- The wallet hash is retained before fallible storage and registration. An uncertain wallet outcome is persisted before sending and blocks another send after refresh. Explicit wallet rejection allows a new attempt. A timeout never automatically resends.
- B5 owns submission and receipt status. A hash alone cannot produce Verified. The receipt requires B5 `confirmed` plus `verifiedAt`, and displays full terms, hash, confirmations, verification time and explorer reference.
- Recovery uses the owner's local hash, the B5 database and an explicit BOT payment-ID lookup. Recheck registers or verifies the known hash. It never sends another payment.
- ERC-20 allowance code passes the exact chain, token, spender and amount to separate approval controls. Approval confirmation is followed by intent revalidation. A rendered mainnet gate keeps these controls disabled until B9. Approval is never rendered as a completed payment.

## Verification

- `npm run test:all` passed, including Celo order/quote/persistence/recovery tests, B1-B6 checks and 14 contract tests.
- `npx tsc --noEmit` passed.
- `npm run lint` passed without warnings.
- `git diff --check` passed at the implementation checkpoint.
- B7 focused checks passed with memory stores and no database connection:
  - `npx tsx lib/transfers/web-execution-self-check.ts`
  - `npx tsx lib/transfers/web-route-self-check.ts`
  - `npx tsx --conditions=react-server lib/assistant/b7-consent-self-check.ts`
  - `npx tsx lib/wallet/b7-token-ui-self-check.tsx`
- Two read-only reviews found recovery, consent, owner-mismatch and Celo-state issues. Those were fixed. The final targeted review returned a qualified PASS.
- The actual isolated Next SIWE HTTP smoke passed, including challenge/signature verification and authenticated cookie recovery.
- The Playwright scenario passed with real SIWE signatures, an injected empty wallet, memory payment services and simulated transaction/receipt confirmation. It exercised wallet and SIWE rejection, first-time recipient confirmation, full-address review, chain switching, no send on chat confirmation, Celo draft preservation, registration failure, refresh recovery, mobile overflow and wallet switching.
- A development hydration warning occurred after the injected wallet reconnected on refresh. Receipt recovery and wallet-switch assertions passed. A real extension confirmation and a live BOT Testnet receipt remain unverified.
- `npm run build` passed with Turbopack, including typechecking and generation of all routes. No live payment proof is claimed.

## Browser test setup

`scripts/b7-e2e-fixture.ts` uses a new empty account, actual SIWE signatures and memory B2-B6 services. It simulates payment hashes and ledger confirmation. Its confirmation switch is test code and never runs in the web application.

`scripts/b7-browser.pw` drives Playwright through Celo draft preservation, wallet connection, rejected and accepted SIWE signing, first-time recipient confirmation, exact review, chain switching, rejected payment signing, registration failure, refresh recovery and a simulated verified receipt. It checks mobile overflow and wallet switching. Run the CLI from outside the repository so generated logs cannot trigger development refresh loops.

The local Next server must start with `DATABASE_URL` empty, `APP_ORIGINS=http://localhost:3000` and a fresh throwaway `SESSION_SECRET`. This prevents browser tests from touching the production database. The fixture server listens on `127.0.0.1:3999`.

Captured proof is in `docs/b7-evidence/`. Receipt images include `MOCK` in their filenames because the hash and chain confirmation are simulated.

| State | Screenshot |
| --- | --- |
| Connected wallet, before SIWE | [Connected wallet](b7-evidence/b7-connected-wallet.png) |
| Full recipient confirmation | [Recipient](b7-evidence/b7-recipient-confirmation.png) |
| Stored payment review | [Review](b7-evidence/b7-payment-review.png) |
| Hash retained after registration failure | [Transaction state](b7-evidence/b7-transaction-state.png) |
| Simulated verified receipt | [Mock receipt](b7-evidence/b7-verified-receipt-MOCK.png) |
| Mobile simulated receipt | [Mobile mock receipt](b7-evidence/b7-mobile-receipt-MOCK.png) |

## Environment and later milestones

`node scripts/check-b7-env.mjs` reports presence and boolean configuration checks without printing values. All four required local values are present, the canonical testnet contract matches, and the mainnet contract value is absent. The local origin is allowed. The production origin is absent from the local allowlist. Actual Vercel production configuration was not inspected or changed.

B8 can use the existing assistant and payment cards without repositioning the homepage in B7. B9 still needs the mainnet contract deployment, token/contract validation, an explicit execution-gate change and a funded controlled wallet run. A real funded BOT Testnet browser payment remains unverified until an authorized wallet extension and test funds are available.

The working tree contained uncommitted B1-B6 code and unrelated work before B7. Local checkpoints must stage explicit B7 paths and preserve that existing work.

The checkpoint stores B7 changes inside those existing backend files as `.audit/b7-existing-backend-edits.patch.b64`, without absorbing their full uncommitted B1-B6 contents. Decode the base64 file to recover the unified patch. `.audit/capture-b7-backend-edits.mjs` regenerates it from the current working tree. The raw patch was checked in reverse against the implemented files. The existing backend files remain in the working tree.

Independent source reviews completed. A separate Grok audit was unavailable because the host rejected that model for this account. No cross-model audit verdict is claimed.

## Files changed by B7

| Area | Files |
| --- | --- |
| Existing assistant and wallet UI | `components/assistant/assistant-panel.tsx`, `components/ui/connect-wallet-button.tsx`, `hooks/use-assistant.ts`, `lib/wallet/config.ts` |
| New payment and authentication UI | `components/assistant/wallet-transfer-card.tsx`, `components/assistant/token-approval-card.tsx`, `hooks/use-wallet-auth.ts`, `lib/wallet/transfer-execution.ts` |
| New HTTP and execution boundary | `app/api/auth/session/route.ts`, `app/api/transfers/[id]/execution/route.ts`, `lib/transfers/web-execution.ts` |
| Small edits inside the existing backend | `app/api/assistant/chat/route.ts`, `app/api/transfers/[id]/submission/route.ts`, `lib/recipients/routes.ts`, `lib/assistant/types.ts`, `lib/assistant/wallet-transfer.ts` |
| B7 security and UI checks | `lib/transfers/web-execution-self-check.ts`, `lib/transfers/web-route-self-check.ts`, `lib/assistant/b7-consent-self-check.ts`, `lib/wallet/b7-token-ui-self-check.tsx` |
| Browser and environment tools | `scripts/b7-browser.pw`, `scripts/b7-e2e-fixture.ts`, `scripts/b7-auth-http-smoke.ts`, `scripts/check-b7-env.mjs`, `next.config.ts` |
| Evidence and continuity | This report, `docs/b7-evidence/`, `AGENTS.md`, `agent-state/`, `.audit/b7.todo.md`, `.audit/b7.tsv`, `.audit/capture-b7-backend-edits.mjs`, `.audit/b7-existing-backend-edits.patch.b64` |
