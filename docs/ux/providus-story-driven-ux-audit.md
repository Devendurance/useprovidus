# Providus story-driven UX audit

Audit date: 2026-11-10

## Scope and evidence

This audit covers the current web app, the payment and receipt journey, saved payment evidence, and the design files that guide future UI work. It uses the local app, source code, existing screenshots, and the Mainnet transaction details supplied by the product owner.

The live dashboard showed a connected BOT Chain Mainnet wallet and a B5-confirmed 1 USDT payment with 30 confirmations and a verified timestamp. The displayed hash matched the USDT hash supplied for this audit. The native BOT transaction hash was supplied by the product owner. No wallet signature, network switch, payment, or other chain action was requested or performed during the audit.

Evidence levels in this report:

- Live observation means the local dashboard or receipt page was read in the browser.
- Source inspection means the named app or API file was read without changing its runtime behavior.
- Stored screenshot means an existing evidence image was inspected. Files named MOCK are illustrative evidence and do not prove a live transaction.
- Owner supplied means the product owner supplied a transaction hash or product fact. It is not described as independently re-verified unless the live B5 screen or source confirms it.
- Not exercised means the audit deliberately did not trigger a wallet signature, payment, deletion, or production action.

The live screenshots from earlier milestones are useful context, but they do not cover every current payment state. The relevant images are `docs/b8-evidence/b8-dashboard-desktop.png`, `docs/b8-evidence/b8-dashboard-mobile.png`, `docs/b7-evidence/b7-payment-review.png`, `docs/b7-evidence/b7-verified-receipt-MOCK.png`, and the desktop and mobile wallet screenshots in `.audit/b9-ux-hotfix/`.

## Findings by journey

| Journey | Evidence and current behavior | Assessment |
|---|---|---|
| First visit | The dashboard and mobile screenshot show “Ask. Approve. Prove.”, examples, supported Celo services, and verified BOT Testnet transfers. | The first screen explains the product and offers a clear entry point. The long dashboard below it competes with the conversation workspace. |
| Wallet connection | The live dashboard reported the provider-confirmed chain and connected address. The wallet menu distinguishes connection from authentication. | Keep this. Connection does not force a chain, and the displayed chain follows provider state. |
| Network switching | The B9 desktop and mobile screenshots show all supported network options, chain IDs, provider-confirmed current network, balance, explorer, and authentication status. | The network picker is clear. Its Mainnet availability copy was stale at audit start and is corrected in this session. Switching actions were not exercised. |
| SIWE login | The live assistant showed “Sign in to use saved recipients and payments.” The B9 wallet menu uses the same explanation. | The purpose is visible. The next signature screen was not opened, so the exact signing prompt and cancellation recovery still need a browser check. |
| Recipient setup | The B7 review screenshot shows a named recipient, full address, and an explicit confirmation step. Source copy says a saved name does not prove identity. | Preserve the full-address check and explicit save choice. Test long addresses and keyboard flow. |
| Native BOT payment | Source shows stored intent review, network, asset, recipient, amount, expiry, wallet approval, submission, and B5 verification states. Existing screenshots show the review card. | The trust boundaries are sound. Technical fields dominate the card and need progressive disclosure. No new payment was initiated. |
| USDT allowance and payment | The live B5 card showed the supplied verified USDT hash. The allowance component describes a separate exact allowance approval and a separate payment approval. | Keep both authorizations separate. The current verified card still renders a disabled allowance panel with stale B9 copy. Approval state transitions were not triggered. |
| Pending payment | Source shows a submitted hash, confirmations, and “Awaiting independent verification.” | Pending status is distinct from success. The card needs a more compact summary and a clear next action. |
| Unknown or failed transaction | Source preserves an unknown hash, asks the user to recover from wallet activity when broadcast is uncertain, and labels recheck as “never resend.” Failed submissions retain a reason. | Recovery is conservative and preserves B5 evidence. Full browser recovery was not exercised. Do not replace it with an automatic retry. |
| Verified receipt | The live card showed “Verified,” 30 confirmations, and a verified timestamp. It also showed the resume form, disabled token approval panel, explorer link, and “Recheck payment, never resend” button. | B5 success is truthful, but the completion state still looks actionable and technical. There is no Providus receipt action for BOT transfers. |
| Receipt navigation | The live `/receipt` page has one explicit transaction ID lookup and a Celo service outcome view. Its copy describes Celo payment, fiat delivery, and airtime fulfilment. The supplied BOT transaction hash does not map to the Celo transaction route. | The navigation label promises a general receipt destination, while the page lacks BOT transfer history and detail. There is no search history, token or chain filter, or receipt modal. |
| Returning user | The assistant shows a payment ID lookup. The server chat route says it is stateless and receives a bounded client-held history. No conversation or message tables exist in `lib/db/schema.ts`. | Payment recovery exists, but people cannot return to named conversations. A payment ID is hard to recall. |
| New conversation and restoration | The assistant has a Reset button. Its history is held in component state and sent as request context. | Reset is not a session manager. Refreshing does not restore a named conversation, and there is no recent conversation list, rename, search, or delete flow. |

## Severity scale

- P0 means a payment can be authorized or reported with the wrong terms or success state. No new P0 execution defect was observed. The B5-confirmed state and wallet approval boundary remain in place.
- P1 means the issue blocks a core payment or proof task, or makes a financial status materially unclear.
- P2 means the issue adds substantial effort or reduces consistency, accessibility, or confidence.
- P3 means polish or a check that did not reproduce as a current product defect.

## Severity-ranked issue register

### UX-01. Mainnet availability copy contradicts verified transaction evidence

- Location: Dashboard, assistant starter copy, wallet network menu, wallet transfer card, footer, homepage, How it works, and README.
- Evidence: Live dashboard and wallet screenshots said “coming soon” or “pending B9.” The owner supplied verified native BOT and Official USDT Mainnet transaction hashes. The live B5 card confirmed the supplied USDT hash.
- Severity: P1.
- Heuristics: Visibility of system status, match between the system and the real world, consistency and standards.
- User impact: Users cannot tell that Mainnet transaction evidence exists while production payments remain gated. The copy understates what has been verified and can make the current gate look like missing infrastructure.
- Proposed fix: Use one shared status model that separates Mainnet transaction evidence from production payment availability and utility availability.
- Acceptance criteria: The app says native BOT and Official USDT Mainnet transaction evidence is verified. It also says production payment availability remains gated pending separate launch authorization. The production execution gate, B1 network metadata, B3 intent semantics, and B5 verification do not change.
- Status: Fixed in this session by `BOT_MAINNET_STATUS` and updated product copy. Production execution was not changed.

### UX-02. The verified state keeps obsolete payment actions visible

- Location: `components/assistant/wallet-transfer-card.tsx` and `components/assistant/token-approval-card.tsx`.
- Evidence: Live B5-confirmed state still rendered the resume form, disabled token allowance panel, and recheck button. The B7 mock screenshot shows the same dense outcome state.
- Severity: P1.
- Heuristics: Visibility of system status, error prevention, user control and freedom, aesthetic and minimalist design.
- User impact: A successful payment still looks open. The user must decide whether to act again, even though the hash is already verified.
- Proposed fix: Render a compact success card only when the B5 submission is confirmed and has `verifiedAt`. Hide stale approval and pending lookup controls. Keep the original hash, verification time, block and receipt link in the proof details.
- Acceptance criteria: A verified B5 submission shows one success state and a real receipt action. It shows no approval, send, resume, or retry action. Submitted, unknown, and failed submissions keep their existing recovery evidence. A hash alone never renders success.

### UX-03. BOT payment evidence is missing from the Receipts destination

- Location: `app/receipt/receipt-client.tsx`, the dashboard payment history, and `app/api/transactions/[id]/route.ts`.
- Evidence: The receipt page looks up Celo transaction records by explicit ID. No list route exists for BOT transfer receipts. B5 transfer status is available through an owner-scoped status route, but the receipt page does not use it. The dashboard showed no history while a B5-confirmed BOT payment card was present.
- Severity: P1.
- Heuristics: Recognition rather than recall, match between the system and the real world, help users recognize and recover from errors.
- User impact: A user cannot find a verified BOT receipt after leaving the conversation. The app asks the user to remember a payment ID instead of listing durable proof.
- Proposed fix: Add owner-scoped receipt history across the existing Celo and BOT payment stores. Keep each store separate and map both into a read-only receipt view model. Link each verified payment to its receipt.
- Acceptance criteria: A wallet owner can search and page through only their Celo and BOT records. A connected but unauthenticated or mismatched wallet sees no private record. A BOT hash is never passed to the Celo transaction store.

### UX-04. The review card exposes too much technical data at once

- Location: `components/assistant/wallet-transfer-card.tsx`.
- Evidence: The current card shows payer address, full recipient address, network, asset contract, estimated gas, payment contract, expiry, status, and payment reference before the user reaches the next action. The B7 screenshot confirms the dense layout.
- Severity: P1.
- Heuristics: Aesthetic and minimalist design, recognition rather than recall, cognitive load, Norman's mapping and affordances.
- User impact: The amount and recipient compete with implementation details, especially on mobile. The wallet approval action is harder to scan.
- Proposed fix: Keep recipient name and address, network, asset, amount, expiry, and the next approval action in the compact review. Move gas, contract, intent ID, allowance, and raw transaction evidence behind labeled disclosures.
- Acceptance criteria: Before approval, the user can verify recipient, network, token, amount, and expiry without opening a disclosure. All contract and transaction values remain available before signing. Layout has no horizontal overflow at 320px.

### UX-05. Session restoration does not exist

- Location: `components/assistant/assistant-panel.tsx`, `app/api/assistant/chat/route.ts`, and `lib/db/schema.ts`.
- Evidence: The chat route is stateless. It accepts bounded client-held history. No session or message table is defined. The Reset control clears the current transcript.
- Severity: P1 for returning users.
- Heuristics: User control and freedom, recognition rather than recall, consistency across sessions.
- User impact: A refresh or new device loses the conversation context. The payment ID lookup recovers a payment, not the discussion that led to it.
- Proposed fix: Add owner-scoped sessions and messages in a reviewed additive migration. Keep message history separate from payment and recipient records.
- Acceptance criteria: An authenticated owner can create, restore, rename, search, page, and delete their own sessions. Account changes hide prior-owner drafts and ignore stale responses. No message or session is returned for another wallet.

### UX-06. Receipt search and inspection are too narrow

- Location: `app/receipt/receipt-client.tsx` and the Receipts navigation.
- Evidence: The page exposes one transaction ID field and a large Celo-only outcome layout. It has no receipt list, filters, or modal. There is no BOT approval-history view.
- Severity: P1.
- Heuristics: Flexibility and efficiency of use, recognition rather than recall, user control and freedom.
- User impact: Users cannot browse previous proof, narrow a large history, or inspect an ERC-20 approval separately from its payment.
- Proposed fix: Add searchable receipt previews, status/token/chain filters, pagination, a focused detail modal, and a separate approval-transaction record.
- Acceptance criteria: Preview activation opens a complete detail modal. Escape and outside click close it. Focus is trapped while open and restored to the preview after close. Mobile presentation fits narrow screens. Copy hash and explorer links work.

### UX-07. Sign-in intent is not explicit enough

- Location: Assistant header and wallet menu.
- Evidence: “Sign in” and “Sign in to use saved recipients and payments” are visible after wallet connection. The exact SIWE signing prompt was not opened during this audit.
- Severity: P2.
- Heuristics: Match between the system and the real world, visibility of system status, error prevention.
- User impact: A user may not know that sign-in proves wallet ownership and does not authorize a payment.
- Proposed fix: Explain that the wallet will sign a login message, that no payment is submitted, and that payment approval happens later in a separate review.
- Acceptance criteria: The sign-in prompt names the wallet, purpose, and non-payment effect before the signature request. Cancel returns to the connected, unsigned state without losing the draft.

### UX-08. The design system file describes a different product

- Location: `DESIGN.md`.
- Evidence: It calls the product “Global Bank” and specifies a toaster hero. The current interface, README, and `app/globals.css` define the Providus warm sage, cream, and ink system.
- Severity: P2.
- Heuristics: Consistency and standards, recognition, error prevention for future design work.
- User impact: A future contributor could replace the recognizable Providus interface with an unrelated concept.
- Proposed fix: Replace the stale spec with the current Providus tokens, typography, interaction rules, and the transaction evidence story.
- Acceptance criteria: `DESIGN.md` matches the shipped brand tokens and payment rules. It does not describe Global Bank or a toaster as Providus assets.
- Status: Corrected in this session.

### UX-09. The dashboard combines workspace and long-form product explanation

- Location: `app/dashboard/page.tsx`.
- Evidence: The dashboard stacks the assistant, a three-card “Conversation to payment to receipt” explanation, and payment-history guidance. The mobile screenshot confirms that the page needs substantial scrolling.
- Severity: P2.
- Heuristics: Aesthetic and minimalist design, cognitive load, mapping.
- User impact: The conversation is harder to revisit on a phone. Explanatory content remains after the user already reached the assistant.
- Proposed fix: Make the conversation the dominant workspace. Move long product explanation to How it works. Keep a compact status cue and real payment history in the dashboard.
- Acceptance criteria: The first screen shows assistant entry, current wallet/network state, and the next meaningful action. Conversation and payment evidence remain reachable without unrelated marketing sections between them.

### UX-10. Keyboard, focus, and narrow reflow coverage remains incomplete

- Location: Wallet menu, assistant, payment cards, receipt page, and future receipt dialog.
- Evidence: The AX tree shows named navigation, form labels, headings, and status announcements. Current CSS tokens pass the measured text and focus combinations listed in `DESIGN.md`. The current Reset control is 36px tall, below the preferred 44px touch target. No complete keyboard-only or 320px payment walkthrough was run.
- Severity: P2 verification gap, not a confirmed WCAG failure.
- Heuristics: Nielsen error prevention and consistency, WCAG 2.2 AA keyboard, target size, focus visibility, and reflow criteria.
- User impact: Keyboard users, zoom users, and people on narrow phones may encounter focus or layout problems that screenshots do not reveal.
- Proposed fix: Add keyboard and 320px/200-percent zoom checks to each interaction slice. Keep focus visible, status announcements polite, and touch targets at least 44px when practical.
- Acceptance criteria: Every payment and receipt task works with keyboard only. No focus trap exists outside a modal. The modal traps and restores focus. At 320px and 200-percent zoom, all actions and evidence remain available without horizontal page overflow.

### UX-11. The BOT Chain logo produced a reproducible Next.js image warning

- Location: BOT Chain logo on the homepage and footer.
- Evidence: Playwright CLI reload of `/` reproduced a warning that one image dimension changed without the other. Browser measurements showed the PNG is 256×50, while the declared image dimensions used heights 32 and 28 for widths 170 and 150.
- Severity: P3, development-only visual warning.
- Heuristics: Visibility of system status, consistency and standards.
- User impact: The warning distracts during review and can indicate a distorted or unstable logo layout.
- Proposed fix: Match the declared heights to the source image aspect ratio. Keep both dimensions responsive.
- Acceptance criteria: A clean reload shows no Next.js image warning and the logos retain their source aspect ratio. The separate transient “1 Issue” badge seen on `/receipt` remains unconfirmed and must not be hidden by disabling diagnostics.
- Status: Fixed by updating the image heights to 33 and 29. Playwright reload now reports zero warnings and zero errors.

## Accessibility measurements and limits

The CSS token pairs listed in `DESIGN.md` pass the WCAG AA contrast ratio for normal text where applicable. The audit did not measure opacity-modified text, every border and control combination, or all responsive computed styles. The live AX snapshot exposed meaningful navigation, headings, text fields, and status messages. It did not establish keyboard completeness, screen-reader announcement quality, target spacing, zoom, modal behavior, or full mobile reflow. Those remain explicit acceptance checks in the next UI slices.

## Release boundaries

The audit changed no database schema, payment execution behavior, contract, production data, or wallet transaction. Mainnet status copy now distinguishes verified transaction evidence from gated product availability. No deploy or GitHub push was performed.
