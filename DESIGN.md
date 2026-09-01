---
version: alpha
name: Providus
description: "The Value Ledger — a Celo route-intelligence agent that makes the true outcome of moving money visible before a user pays."
colors:
  primary: "#18211F"
  background: "#F5F6F1"
  surface: "#FFFFFF"
  provident-green: "#3F7560"
  deep-provision: "#285542"
  quote-blue: "#4C6A9E"
  rate-amber: "#B77A2B"
  loss-red: "#B54642"
  receipt-grey: "#68716D"
  ledger-edge: "#DDE1DA"
typography:
  display:
    fontFamily: "DM Sans, Inter, Arial, sans-serif"
    fontSize: 4.5rem
    fontWeight: 650
    lineHeight: 0.98
    letterSpacing: "-0.055em"
  h1:
    fontFamily: "DM Sans, Inter, Arial, sans-serif"
    fontSize: 3rem
    fontWeight: 650
    lineHeight: 1.02
    letterSpacing: "-0.04em"
  h2:
    fontFamily: "Inter, Arial, sans-serif"
    fontSize: 1.75rem
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body-md:
    fontFamily: "Inter, Arial, sans-serif"
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.55
  data:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: 0.8125rem
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: "0.01em"
rounded:
  sm: 10px
  md: 14px
  lg: 24px
  arch: 120px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
components:
  button-primary:
    backgroundColor: "{colors.provident-green}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
    padding: 16px
    height: 52px
  button-primary-hover:
    backgroundColor: "{colors.deep-provision}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
    padding: 16px
    height: 52px
  button-secondary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    rounded: "{rounded.sm}"
    padding: 12px
    height: 44px
  card-standard:
    backgroundColor: "{colors.background}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: 24px
  card-route-verdict:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: 24px
---

## Overview

Providus is a Celo route-intelligence agent. It compares local fiat-to-Celo paths by the money that actually arrives—not by the provider’s headline fee—and gives a user a transparent recommendation before they pay.

The supplied LearnStack system contributes useful **component mechanics**: direct layouts, hard offset shadows, 2–3px outlines, obvious press feedback through shadow compression, spacious asymmetric hero construction, and clear responsive behaviour. It does not contribute the brand expression. Providus must feel financially precise and prudent, not mischievous, student-community-made, neubrutalist, or loud.

Its visual territory is **The Value Ledger**.

> **Know what arrives before you pay.**

## Colors

| Token | HEX | Role |
|---|---:|---|
| Ledger Stone | `#18211F` | Primary text, outline, hard shadow, high-focus surface |
| Receipt Field | `#F5F6F1` | Main background and default contained-card field |
| Clear Paper | `#FFFFFF` | Route Verdict and high-clarity receipt surface |
| Provident Green | `#3F7560` | Primary action, recommended route, verified saving |
| Deep Provision | `#285542` | Pressed / selected primary state |
| Quote Blue | `#4C6A9E` | Information, live quote detail and neutral route context |
| Rate Amber | `#B77A2B` | Stale quote, low confidence, limit or timing review |
| Loss Red | `#B54642` | Actual unavailable route, failed payment or destructive action |
| Receipt Grey | `#68716D` | Metadata, expiry, route labels and supporting text |
| Ledger Edge | `#DDE1DA` | Quiet dividers and contained detail areas |

### Colour rules

- Provident Green is the single high-emphasis brand signal. It means **recommended, verified, or saved**.
- Use amber when a user needs to inspect an assumption, never as generic urgency.
- No coral, marigold, signal red, dark-purple, neon, gradients, glow, country-flag wallpaper, or generic crypto-blue shell.
- Keep 70%+ of each view in Receipt Field, Clear Paper and Ledger Stone.
- A route does not become “best” through green alone: it must state estimated received amount, timestamp, assumptions and why it ranked first.

## Typography

| Role | Typeface | Job |
|---|---|---|
| Display / financial outcome | **DM Sans** | Clear major amount, product headline and high-value marketing statement |
| UI / body | **Inter** | Inputs, controls, provider explanations, accessibility and everyday product work |
| Financial proof | **IBM Plex Mono** | Fees, FX spread, timestamps, quote expiry, route IDs, exchange assumptions and API output |

### Type scale

| Role | Desktop | Mobile | Use |
|---|---:|---:|---|
| Display | 72px | 44px | Hero and largest outcome amount |
| H1 | 48px | 32px | Page title / Route Verdict heading |
| H2 | 28px | 24px | Section and card title |
| H3 | 20px | 18px | Module title |
| Body | 16px | 16px | Default UI/readability baseline |
| Proof | 13px | 13px | Financial data; never below 12px |

Do not use LearnStack’s Bricolage Grotesque or italic sticker caption behaviour. The money outcome should feel legible and accountable—not playful.

## Layout

Retain the LearnStack base unit, spacing rhythm, 1280px container, asymmetric desktop 55/45 hero, stacked mobile transformation, and generous whitespace. Replace the image-first education narrative with a **Route Verdict-first** product hierarchy.

1. What the user is moving: country, amount, payment method and target asset.
2. What will arrive: estimated received amount.
3. Why: fees, FX, limits, speed and reliability.
4. What to do: pay to unlock, then continue with the provider.
5. What changed: a savings receipt with timestamped proof.

### Core proprietary asset: Value Line

A structured route line:

> **You pay → fees + FX → selected route → you receive**

It appears in the locked preview, Route Verdict, shareable receipt and x402 API output. It must convey real calculation. It is not a decorative graph, orbit line, zigzag, sparkline, or generic AI workflow.

### Responsive behaviour

Keep LearnStack’s desktop-to-mobile collapsing logic:

- Hero stays asymmetric at desktop and stacks below 1024px.
- Navigation collapses below 768px.
- Route cards never become a dense dashboard grid; show one Verdict first, then alternatives.
- Buttons retain auto-width, hard-outline mechanics and ≥44px targets; do not force full-width button styling merely because the view is mobile.

## Elevation & Depth

Preserve LearnStack’s hard, unblurred offset-shadow mechanics because they make actions tactile and visible:

| Level | Treatment | Use |
|---|---|---|
| Flat | No shadow | Navigation, text and dividers |
| Base | `3px 3px 0px #18211F` | Focused input, small control |
| Elevated | `4px 4px 0px #18211F` | Buttons, contained cards and short status label |
| Prominent | `8px 8px 0px #18211F` | Single hero Route Verdict or savings receipt |

Interaction remains **shadow compression**: hover and press reduce offset toward zero. Do not use blur, lift, glow or colour animation as the main feedback mechanism.

## Shapes

Retain LearnStack’s structure:

- 2–3px Ledger Stone outline on interactive and contained elements.
- 10px standard component radius.
- 14px contained-card radius.
- Single 120px corner arch may appear once in a hero-value panel per view.
- No widespread pills. Use rounded pills only for short quote state labels such as `LIVE QUOTE` or `ESTIMATE`.

## Components

### Primary button

Keep the original geometry: 52px height, `16px 28px` padding, 2.5px outline, 4px hard shadow, and shadow-compression feedback. Replace marigold fill with Provident Green and use concise action labels: `Check my route`, `Unlock full route`, `Continue with provider`.

### Secondary button

Keep the original compact solid-ink mechanics: 44px height, `12px 24px`, 2px outline. Use for secondary decisions: `Compare routes`, `Refresh quote`, `View assumptions`.

### Tertiary utility button

Keep the reference’s icon-button mechanics, but replace coral with Quote Blue. Use once per view only, for a non-destructive utility such as copy receipt, share outcome, or open quote methodology.

### Standard card

Keep the reference’s 24px internal padding, 2px outline, 14px radius and 4px hard shadow. Replace cream-on-marigold personality with Receipt Field + Ledger Stone. Cards hold a finite amount of proof; do not trap every paragraph in a card.

### Route Verdict

A single prominent Clear Paper panel contains the recommended route. Required information:

- estimated received amount;
- target asset;
- selected provider and payment method;
- total fee and estimated FX spread;
- settlement range;
- reliability/confidence;
- capture time and expiry;
- savings against baseline;
- paid/unlocked status;
- `Continue with provider` action.

### Quote input

Preserve original input mechanics—48px height, hard outline and hard focus shadow—while using Inter 16px and Ledger Stone. Inputs must never hide the unit, country or asset. Use helper text for quote freshness and supported method constraints.

### Savings receipt

A concise, shareable proof surface:

> **You kept an estimated 3.42 cUSD**
> `via bank transfer → cUSD · captured 14:26 UTC`

It should never reveal wallet balances or provider personal data publicly. The public/share version must be user-approved and data-minimised.

## Do's and Don'ts

### Do

- Preserve LearnStack’s hard-outline, hard-shadow, tactile component system and responsive layout mechanics.
- Make effective received amount the largest, clearest figure in any route result.
- Use the Value Line only to show actual financial logic.
- Show quote timestamp, expiry and confidence wherever a price recommendation appears.
- Keep provider alternatives visible after the recommendation; this is a trust product.
- Pair all status colour with explicit text and icon.

### Don't

- Do not retain LearnStack’s marigold, coral, red, cream/yellow education aesthetic, Bricolage display face or sticker rotations.
- Do not use a hand-stuck/sticker style for financial warnings or price data.
- Do not replace factual route breakdown with an unexplained “AI best choice.”
- Do not use country flags, provider logos or token icons as dominant identity assets.
- Do not make affiliate/sponsored routes indistinguishable from best-value recommendations.
- Do not create a dark DeFi dashboard, generic crypto UI, gradient-heavy fintech page, or full-card grid.
