# Design System Inspired by Global Bank

## 1. Visual Theme & Atmosphere

This system pairs a friendly, bubbly typographic voice with a genuinely distinctive hero device: a hand-illustrated vintage appliance (a toaster) reimagined as a payment terminal, complete with an LCD readout, a rotary dial, indicator lights, and a credit card popping up like toast. It's warm and a little nostalgic rather than sleek/corporate — muted sage green instead of bank-blue, a dusty rose coffee mug, gold coins, and soft flat-vector illustration with confident black outlines throughout. The overall effect is retro-futurist fintech: a bank that wants to feel like a trusted, well-designed household object rather than an app.

**Key Characteristics**
- Muted sage green base with a very subtle sunburst of radiating lines behind the hero illustration
- A hand-illustrated retro appliance (toaster-as-payment-terminal) as the hero's signature visual metaphor, complete with its own internal "product" details (LCD screen, dial, lights)
- Bold black outlines on every illustrated element, with light two-tone cel-shading suggesting volume rather than flat single-color fills
- A bubbly, rounded display typeface for the logo and headline, paired with a plain clean sans for everything functional
- A tightly-scoped monospace/pixel font used only inside the toaster's LCD screen — never elsewhere
- Two distinct button treatments by hierarchy: a flat, simply-bordered secondary button (nav) versus a bold hard-shadow "sticker" primary CTA — the shadow is reserved for the more important action
- Warm, slightly desaturated retro-tech palette (lavender-gray metal, deep teal screen, gold coins, dusty rose) instead of typical fintech blue/purple

## 2. Color Palette & Roles

### Primary
- **Sage Green** (`#CBD2C4`): Page background
- **Ink** (`#1A1A1A`): All text, illustration outlines, borders

### Illustration Palette
- **Toaster Metal Light** (`#C7C3D1`): Front-facing toaster panel
- **Toaster Metal Shadow** (`#9B96A8`): Side panel, providing the illustration's two-tone dimensional shading
- **LCD Screen** (`#1F3D3A`): Toaster display background
- **LCD Text Green** (`#6FCF97`): "PAYMENT SUCCESSFUL" readout text
- **Coin Gold** (`#E8B84B`): The two stacked coins beside the toaster
- **Mug Rose** (`#D68F87`): Coffee mug

### Accent Colors
- **Indicator Blue** (`#4A90D9`), **Indicator Orange** (`#F2A93B`), **Indicator Green** (`#6FCF97`): Small status-light dots at the toaster's base — used as a trio, never individually

### Neutral Scale
- **Ink** (`#1A1A1A`): Text, outlines
- **Sage Green** (`#CBD2C4`): Base background
- **Cream** (`#F5F2EA`): Button fills

### Surface & Borders
- **Button Border** (`#1A1A1A`, ~1.5-2px): Both button types
- **Sunburst Ray** (`#BEC6B7`, low contrast): Subtle radiating lines behind the hero illustration

## 3. Typography Rules

### Font Family
**Primary (Display):** Baloo 2, sans-serif — bold, rounded, bubbly; used for the logo wordmark and hero headline only
Fallback: 'Fredoka', 'Nunito', sans-serif

**Secondary (UI/Body):** Inter, sans-serif — nav, body copy, button text
Fallback: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif

**Screen Readout (scoped):** VT323 or another pixel/LCD-style monospace — used exclusively for text rendered inside the toaster's LCD screen
Fallback: 'Space Mono', monospace

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|------|--------|-------------|-----------------|-------|
| Display 1 | Baloo 2 | 44px | 700 | 46px | 0px | Hero headline, 4 lines |
| Logo Wordmark | Baloo 2 | 18px | 700 | 20px | 0.5px | "GLOBAL BANK," uppercase, with the small spiral icon integrated |
| Body Regular | Inter | 15px | 400 | 24px | 0px | Hero subhead paragraph |
| Nav Label | Inter | 15px | 500 | 20px | 0px | Header nav links |
| Button | Inter | 14px | 600 | 20px | 0px | Both button types |
| Screen Readout | VT323 | 15px | 400 | 18px | 1px | LCD screen text only, uppercase, pixel-style |

### Principles
- Baloo 2 is reserved for the logo and hero headline only — it should never appear in body copy, nav, or buttons
- The pixel/LCD font is scoped exclusively to the toaster's screen readout — using it anywhere else would break the "this is a real device's display" illusion
- Keep nav and body copy in plain, unbubbly Inter — the friendliness of this system lives in the display type and the illustration, not in every piece of text

## 4. Component Stylings

### Buttons

**Secondary Button (Create an Account — nav)**
- **Background:** `#F5F2EA`
- **Text Color:** `#1A1A1A`
- **Padding:** `10px 20px`
- **Border Radius:** `8px`
- **Border:** `1.5px solid #1A1A1A`
- **Font:** Inter, 14px, 600
- **Height:** `40px`
- **Box Shadow:** none — this button stays flat, deliberately lower-emphasis than the primary CTA

**Primary Button (Learn More)**
- **Background:** `#F5F2EA`
- **Text Color:** `#1A1A1A`
- **Padding:** `12px 28px`
- **Border Radius:** `8px`
- **Border:** `1.5px solid #1A1A1A`
- **Font:** Inter, 14px, 600
- **Height:** `44px`
- **Signature Shadow:** A solid black rectangle offset `6-8px` down-right behind the button, no blur — reads as a "sticker" or layered card rather than a soft shadow
- **Hover State:** Button shifts toward its offset shadow, landing flush on press

### Cards & Containers

**Hero Appliance Illustration** (signature component)
- **Style:** Flat vector illustration with consistent `2-2.5px` black outlines and light two-tone cel-shading (one base color, one darker shadow-side tone per object)
- **Core Object:** A retro toaster reimagined as a payment terminal — credit card emerging from the toast slot, LCD screen reading "PAYMENT SUCCESSFUL," a rotary dial on one side, three colored indicator dots along the base
- **Supporting Objects:** A coffee mug and two stacked gold coins beside the toaster, each with their own soft grounding shadow beneath
- **Background Treatment:** A subtle sunburst of radiating lines centered behind the illustration, low contrast against the sage base
- **Extension Rule:** If this illustration system extends to other pages/sections, new illustrations should keep the same "everyday object reimagined as a fintech device" metaphor and the same outline/cel-shading treatment — not switch to a different illustration style

### Inputs & Forms (extrapolated — not directly visible in the source, styled consistently with the button system)

**Text Input**
- **Background:** `#F5F2EA`
- **Border:** `1.5px solid #1A1A1A`
- **Border Radius:** `8px`
- **Height:** `44px`
- **Padding:** `0px 16px`
- **Placeholder Color:** `rgba(26,26,26,0.45)`

### Navigation

**Primary Navigation**
- **Background:** transparent, sits directly on the sage background
- **Text Color:** `#1A1A1A`
- **Layout:** Logo left, centered nav links, "Log in" (plain text) + "Create an account" (secondary button) right
- **Padding:** `24px 40px`
- **Font:** Inter, 15px, 500

## 5. Layout Principles

### Spacing System
**Base Unit:** `4px`

**Spacing Scale:**
- `4px` – Icon/indicator-dot spacing
- `8px` – Button padding
- `16px` – Standard component gutters
- `24px` – Nav padding, headline line spacing
- `32px` – Headline-to-body spacing
- `48px` – Body-to-button spacing
- `64-96px` – Hero side margins, vertical hero padding

### Grid & Container
**Max Width:** `1200px`, centered
**Column Strategy:** Two-column hero split — text content left (~45%), illustration right (~55%)
**Section Patterns:** Nav spans full width; hero splits into text/illustration columns, both vertically centered

### Whitespace Philosophy
The left column stays sparse — headline, one paragraph, one button — so the illustration has room to be the visual centerpiece without competing with dense text. The sunburst background gives the illustration a sense of radiating importance without needing extra framing or a card container around it.

### Border Radius Scale
- `8px` – Buttons, inputs
- Illustration elements follow their own object-appropriate rounding (toaster corners, mug handle) rather than a systematic token

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat | No shadow | Nav, secondary button, body text |
| Signature Sticker | Hard offset black rectangle, no blur | Primary CTA button only |
| Grounding Shadow | Soft, blurred, dark | Beneath the toaster, mug, and coins in the illustration |

**Shadow Philosophy:** UI chrome mostly stays flat, with exactly one exception — the primary CTA, which gets a hard "sticker" shadow to visually outrank the secondary nav button. The illustration uses a completely different shadow language (soft, blurred, grounding) appropriate to depicting physical objects sitting on a surface. Don't cross the two: UI shadows stay hard-edged, illustration shadows stay soft.

## 7. Do's and Don'ts

### Do
- Reserve the hard offset "sticker" shadow for the single primary CTA on a given screen — it's a hierarchy signal, not a default button style
- Keep Baloo 2 to the logo and headline only
- Keep the LCD/pixel font scoped to actual "screen" surfaces within illustrations
- Extend the illustration system with the same "everyday object as fintech device" metaphor if new hero art is needed
- Use soft, blurred, grounding shadows for illustrated objects; hard offset shadows for UI components — never swap the two

### Don't
- Don't apply the hard offset shadow to secondary buttons — that would flatten the deliberate hierarchy between primary and secondary actions
- Don't set body copy or nav text in Baloo 2 — it's reserved for the two biggest, most attention-grabbing text elements on the page
- Don't introduce a second illustration style (e.g., photography, 3D render) alongside the flat-vector retro-appliance illustrations
- Don't extend the indicator-light trio (blue/orange/green) into a general accent-color palette — they're a specific detail of the toaster illustration, not brand colors
- Don't lose the subtle sunburst background texture when adapting this hero to other pages; it's a quiet but consistent brand signature

## 8. Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|------|-------|--------------|
| Mobile | 375px–599px | Hero stacks to single column (illustration below text), nav collapses to hamburger, headline drops to ~28px |
| Tablet | 600px–1023px | Two-column split narrows but holds, headline ~36px |
| Desktop | 1024px–1439px | Full layout as designed, 44px headline |
| Wide | 1440px+ | Max-width 1200px container, centered |

**Typography Adjustments by Breakpoint:**
- **Mobile:** Display 1 `28px`, Body Regular `14px`
- **Tablet:** Display 1 `36px`, Body Regular `15px`
- **Desktop:** Display 1 `44px`, Body Regular `15px`

### Touch Targets
- **Minimum Size:** `44px × 44px`

### Collapsing Strategy
- **Hero:** Illustration moves below the text column on narrow viewports, scaling down but keeping its full detail (screen, dial, coins, mug) rather than simplifying
- **Nav:** Collapses to a hamburger below ~768px; logo and "Create an account" button remain visible
- **Buttons:** Both button types stay at their designed sizes rather than shrinking below the minimum touch target

## 9. Agent Prompt Guide

### Quick Color Reference
- **Base:** Sage Green (`#CBD2C4`) | **Text/Outlines:** Ink (`#1A1A1A`) | **Button Fill:** Cream (`#F5F2EA`)
- **Illustration:** Toaster Metal Light (`#C7C3D1`) / Shadow (`#9B96A8`), LCD Screen (`#1F3D3A`) / Text (`#6FCF97`), Coin Gold (`#E8B84B`), Mug Rose (`#D68F87`)

### Iteration Guide
1. **Only the primary CTA gets the hard offset "sticker" shadow** — the secondary nav button stays flat. This hierarchy distinction should hold everywhere the two button types appear together.
2. **Baloo 2 is reserved for the logo and hero headline** — every other piece of text uses plain Inter.
3. **The pixel/LCD font never leaves the illustration's screen surface** — don't use it for real UI text anywhere else.
4. **Illustrations use hard black outlines with two-tone cel-shading**, not flat single-color fills or photorealistic rendering.
5. **UI shadows are hard-edged (the sticker effect); illustration shadows are soft and blurred (grounding objects on a surface)** — never mix the two shadow languages.
6. **The indicator-light trio (blue/orange/green) is a toaster-specific detail**, not a reusable brand accent set — don't repurpose those colors elsewhere.
7. **Keep the sunburst background subtle** — it should read as atmosphere, not as a bold graphic element competing with the illustration.
8. **If new hero illustrations are needed, keep the "everyday object reimagined as a fintech device" metaphor** consistent with the toaster-as-payment-terminal concept.
9. **Body copy and nav text stay plain and functional (Inter)** — the personality of this brand lives in the illustration and the display headline, not in every text element.
10. **Two-column hero split (text left, illustration right)** is the system's core arrangement — don't center or symmetrize it.