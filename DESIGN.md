# Providus UI design system

## Experience goal

Users should see how their request becomes an exact payment, stay in control while approving it, and find independent proof afterward.

The product story is Ask, Understand, Confirm, Prove. Each screen answers the next question the user has. Payment interfaces stay quiet and factual. Do not add animation or illustration unless it explains a real product step.

## Brand to preserve

Providus uses a warm, approachable retro-tech style. The current interface pairs sage, cream, and ink with friendly display type, plain functional text, clear borders, and one raised primary action where it helps establish hierarchy.

Use the existing Providus wordmark and supplied ecosystem marks as provided. Do not use the old Global Bank toaster direction. That concept does not match the current product or the shipped interface.

## Color roles

| Role | Value | Use |
|---|---|---|
| Sage | #CBD2C4 | Main page ground |
| Cream | #F5F2EA | Reading and input surfaces |
| Ink | #1A1A1A | Main text, outlines, and focus structure |
| Sage line | #A9B3A6 | Quiet borders |
| Success | #276645 | Verified and confirmed states |
| Warning | #825500 | Pending or attention states |
| Error | #A33A35 | Failed and blocked states |
| Focus | #245D78 | Visible keyboard focus |
| Receipt gray | #4D5752 | Secondary text |

Contrast ratios measured from the current CSS values are 11.23:1 for ink on sage, 15.56:1 for ink on cream, 4.84:1 for receipt gray on sage, 6.70:1 for receipt gray on cream, 6.83:1 for white on success, and 4.65:1 for focus on sage. These combinations pass WCAG AA contrast thresholds. Opacity variants and other color combinations still need separate measurement.

## Typography

- Georama is the functional UI and body typeface.
- Baloo 2 is reserved for the Providus wordmark and selected hero headlines.
- VT323 is reserved for an actual illustrated screen readout. Do not use it for payment terms or status labels.
- Use tabular figures for amounts, balances, and counts.
- Keep wallet addresses and hashes readable, selectable, and available in full.

The font files and variables are defined in app/layout.tsx and app/globals.css.

## Layout and components

- Use an 8px corner radius for the shared interface.
- Keep borders clear and shadows rare. Reserve the sticker shadow for the strongest primary action.
- Avoid nested cards. Group related payment facts in one compact review surface.
- Use one primary action for the current payment state.
- Show recipient, network, token, amount, and expiry before approval.
- Put gas estimates, contract addresses, allowances, and raw transaction data behind a labeled details disclosure.
- Reflow content for narrow screens instead of shrinking desktop layouts.
- Keep touch controls at least 44px where space allows. Inputs use at least 16px text on mobile.
- Do not place fixed controls over payment details, receipts, or navigation.

## Payment states

Native BOT follows Review, Wallet confirmation, Verification.

USDT follows Review, Exact token approval if needed, Separate payment wallet confirmation, Verification. The token approval and payment are distinct transactions. The interface must show each authorization and result separately.

Only a B5-confirmed submission with verifiedAt may appear as Verified. A submitted hash is evidence for recovery, not success. Unknown submissions keep their original hash and recovery path. Do not create a second payment during recovery.

BOT Chain Mainnet payments are live for native BOT and Official USDT. Keep network selection and payment capability separate.

## Accessibility

- Use semantic landmarks and one level-one heading per page.
- Give every control a visible or programmatic name.
- Keep every action reachable with a keyboard and show a high-contrast focus indicator.
- Announce payment state changes through polite live regions without moving focus.
- Use text and labels as well as color to identify states.
- Support 200 percent zoom and reflow at 320 CSS pixels without loss of content or function.
- Respect reduced-motion settings. Never require users to wait for or watch an animation.
- Use WCAG 2.2 AA contrast thresholds for text and meaningful UI graphics.

## Copy and trust

- Say what the system understood before asking for approval.
- Say what happens next and what needs wallet authorization.
- Label Celo and BOT Chain Mainnet according to their actual payment availability. Keep BOT Testnet wording on historical receipts only.
- BOT Chain Mainnet native BOT and Official USDT payments are live. Historical Testnet evidence stays labeled as Testnet.
- BOT-funded utility payments are not live without an independently verified settlement and provider-delivery route.
- Separate submitted, pending, unknown, failed, and B5-verified states.
- Never imply that a saved recipient proves the recipient identity.
- Never claim that a payment succeeded because a transaction hash exists.
