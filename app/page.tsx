import Link from "next/link";
import {
  ArrowRight,
  Coins,
  Eye,
  LineChart,
  MapPinned,
  ShieldCheck,
} from "lucide-react";
import { ValueLine } from "@/components/providus/value-line";
import { RouteCheckCTA } from "@/components/ui/route-check-cta";

const INK = "#1A1A1A";

const PILLARS = [
  {
    title: "See what arrives",
    message:
      "The best route is measured by effective received amount, not advertised fee.",
    proof: "Fee, FX spread, network cost, limits and estimated received.",
    icon: Eye,
  },
  {
    title: "Choose with context",
    message:
      "The right route changes by country, amount and payment method.",
    proof: "Localised inputs, provider eligibility and transparent ranking.",
    icon: MapPinned,
  },
  {
    title: "Pay only for a useful answer",
    message:
      "A small x402 payment unlocks a complete, actionable Route Verdict.",
    proof: "Locked preview, paid full breakdown and provider handoff.",
    icon: Coins,
  },
  {
    title: "Keep control",
    message:
      "Providus explains and recommends; you execute with your chosen provider.",
    proof: "No custody, no automated fiat purchase, clear handoff.",
    icon: ShieldCheck,
  },
  {
    title: "Improve with real use",
    message:
      "Route history and outcome feedback make later recommendations better.",
    proof: "Quote freshness, reliability tracking and savings history.",
    icon: LineChart,
  },
] as const;

const STEPS = [
  {
    n: "01",
    title: "Enter your route",
    body: "Country, fiat amount, payment method and target asset.",
  },
  {
    n: "02",
    title: "See a locked preview",
    body: "A useful range of what may arrive—without inventing a final price.",
  },
  {
    n: "03",
    title: "Unlock the Route Verdict",
    body: "Pay a small Route Check fee for full breakdown and provider handoff.",
  },
  {
    n: "04",
    title: "Continue with the provider",
    body: "You keep control. Providus does not hold or move your funds.",
  },
] as const;

function Sunburst() {
  const rays = Array.from({ length: 24 }, (_, index) => {
    const angle = index * 15;
    return (
      <line
        key={angle}
        x1="380"
        y1="280"
        x2="380"
        y2="-50"
        transform={`rotate(${angle} 380 280)`}
      />
    );
  });

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      preserveAspectRatio="none"
      viewBox="0 0 760 560"
    >
      <g fill="none" stroke="#BEC6B7" strokeWidth="1.2" opacity="0.75">
        {rays}
      </g>
    </svg>
  );
}

/**
 * The landing-page signature: a small household appliance made into a route
 * terminal. It stays inline so the screen copy is real, selectable text and
 * the illustration never depends on an external image request.
 */
function PaymentTerminalIllustration() {
  return (
    <div className="relative mx-auto aspect-[760/560] w-full max-w-[700px] lg:mx-0 lg:w-[min(900px,56vw)] lg:max-w-[900px]">
      <svg
        aria-label="Retro payment terminal with a card, coffee mug and coins"
        className="h-full w-full overflow-visible"
        role="img"
        viewBox="0 0 760 560"
      >
        <title>Retro Providus route terminal</title>
        <defs>
          <filter id="terminal-grounding-shadow" x="-30%" y="-30%" width="160%" height="180%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
          <linearGradient id="terminal-metal" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#D8D5DF" />
            <stop offset="1" stopColor="#C7C3D1" />
          </linearGradient>
          <linearGradient id="terminal-side" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#B2ADBC" />
            <stop offset="1" stopColor="#9B96A8" />
          </linearGradient>
          <linearGradient id="mug-rose" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#E0A09A" />
            <stop offset="1" stopColor="#D68F87" />
          </linearGradient>
        </defs>

        {/* Grounding shadows belong to the illustration, not to the UI chrome. */}
        <ellipse
          cx="408"
          cy="472"
          fill="#1A1A1A"
          opacity="0.24"
          filter="url(#terminal-grounding-shadow)"
          rx="250"
          ry="31"
        />
        <ellipse
          cx="650"
          cy="470"
          fill="#1A1A1A"
          opacity="0.28"
          filter="url(#terminal-grounding-shadow)"
          rx="85"
          ry="15"
        />

        {/* Card, with a blank face so all meaningful copy remains HTML/SVG text. */}
        <g transform="rotate(-4 402 101)">
          <rect
            x="296"
            y="42"
            width="226"
            height="118"
            rx="18"
            fill="#C7C3D1"
            stroke={INK}
            strokeWidth="5"
          />
          <rect
            x="315"
            y="61"
            width="186"
            height="16"
            rx="4"
            fill="#9B96A8"
            opacity="0.78"
          />
          <rect
            x="333"
            y="99"
            width="47"
            height="29"
            rx="5"
            fill="#E7D59B"
            stroke={INK}
            strokeWidth="3"
          />
          <path d="M342 105h29M342 112h29M342 119h20" fill="none" stroke="#95814E" strokeWidth="2" />
        </g>

        {/* The rising card is tucked behind the toast slot. */}
        <path d="M369 158V137h92v23" fill="none" stroke={INK} strokeWidth="7" strokeLinecap="round" />

        {/* Toaster terminal body and shaded side panel. */}
        <path
          d="M169 224c0-17 14-31 31-31h343c18 0 33 13 36 31l21 192c3 24-16 43-40 43H208c-23 0-42-19-40-42l1-193Z"
          fill="url(#terminal-metal)"
          stroke={INK}
          strokeLinejoin="round"
          strokeWidth="6"
        />
        <path
          d="m543 193 46 10c17 4 28 17 30 34l21 178c3 24-15 43-39 43h-42c24 0 43-19 40-43l-21-192c-3-17-16-29-35-30Z"
          fill="url(#terminal-side)"
          stroke={INK}
          strokeLinejoin="round"
          strokeWidth="6"
        />
        <path d="M201 193h341c18 0 33 13 36 31l2 18H169v-18c0-17 14-31 32-31Z" fill="#D8D5DF" stroke={INK} strokeWidth="6" />

        {/* Slot and its dark interior. */}
        <path d="M239 198h269l24 37H218l21-37Z" fill="#9B96A8" stroke={INK} strokeLinejoin="round" strokeWidth="5" />
        <path d="M253 204h238l10 17H243l10-17Z" fill="#1A1A1A" />
        <path d="M278 207h188" stroke="#625F6A" strokeWidth="5" strokeLinecap="round" />

        {/* Real screen text is rendered as SVG text, never baked into a raster. */}
        <rect x="223" y="275" width="246" height="75" rx="9" fill="#1F3D3A" stroke={INK} strokeWidth="5" />
        <path d="M237 291h218M237 336h218" stroke="#315956" strokeWidth="2" opacity="0.8" />
        <text
          x="346"
          y="320"
          fill="#6FCF97"
          fontFamily="VT323, monospace"
          fontSize="28"
          letterSpacing="3"
          textAnchor="middle"
        >
          ROUTE READY
        </text>

        {/* Terminal detail lines and rotary dial. */}
        <path d="M221 373h251" fill="none" stroke="#9B96A8" strokeWidth="4" />
        <circle cx="541" cy="333" r="34" fill="#C7C3D1" stroke={INK} strokeWidth="5" />
        <circle cx="541" cy="333" r="22" fill="#9B96A8" stroke={INK} strokeWidth="4" />
        <path d="m541 333 13-14" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" />
        <path d="M549 380h-17" stroke={INK} strokeWidth="5" strokeLinecap="round" />

        {/* Indicator trio: illustration-only detail, never a UI status palette. */}
        <g stroke={INK} strokeWidth="3">
          <circle cx="309" cy="408" r="8" fill="#4A90D9" />
          <circle cx="335" cy="408" r="8" fill="#F2A93B" />
          <circle cx="361" cy="408" r="8" fill="#6FCF97" />
        </g>

        {/* Mug and coins. */}
        <path d="M615 315c0-11 11-19 24-19h68c13 0 23 8 23 19v105c0 31-20 48-58 48-37 0-57-17-57-48V315Z" fill="url(#mug-rose)" stroke={INK} strokeLinejoin="round" strokeWidth="6" />
        <ellipse cx="673" cy="315" rx="58" ry="15" fill="#D68F87" stroke={INK} strokeWidth="6" />
        <ellipse cx="673" cy="315" rx="40" ry="8" fill="#7D5556" stroke={INK} strokeWidth="3" />
        <path d="M730 340c42-4 48 23 43 45-6 24-25 31-48 19" fill="none" stroke={INK} strokeWidth="6" />
        <path d="M738 351c21-3 24 10 21 23-3 11-11 16-25 13" fill="none" stroke="#B76D6E" strokeWidth="8" />

        <g transform="rotate(-10 539 429)">
          <ellipse cx="539" cy="437" rx="43" ry="13" fill="#C28E2C" stroke={INK} strokeWidth="5" />
          <ellipse cx="539" cy="429" rx="43" ry="13" fill="#E8B84B" stroke={INK} strokeWidth="5" />
          <path d="M514 429h49" stroke="#B9862D" strokeWidth="3" />
        </g>
        <g transform="rotate(8 584 442)">
          <ellipse cx="584" cy="450" rx="41" ry="12" fill="#C28E2C" stroke={INK} strokeWidth="5" />
          <ellipse cx="584" cy="443" rx="41" ry="12" fill="#E8B84B" stroke={INK} strokeWidth="5" />
          <path d="M560 443h48" stroke="#B9862D" strokeWidth="3" />
        </g>
      </svg>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <section className="relative isolate overflow-hidden bg-[#CBD2C4]">
        <div className="landing-hero-frame mx-auto grid min-h-[calc(100svh-81px)] grid-cols-1 items-start gap-5 px-4 py-12 min-[600px]:px-6 min-[600px]:py-16 md:min-h-[650px] md:px-8 lg:min-h-[calc(100svh-81px)] lg:grid-cols-[40%_60%] lg:items-center lg:gap-0 lg:px-8 lg:py-0">
          <div className="relative z-10 max-w-[520px]">
            <p className="mb-4 inline-flex items-center border-b border-[#1A1A1A] pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1A1A1A]/75 lg:text-[12px]">
              Providus · Route Check
            </p>
            <h1 className="max-w-[520px] font-hero text-[28px] font-bold leading-[1.05] tracking-[-0.03em] text-[#1A1A1A] min-[600px]:text-[36px] lg:text-[clamp(52px,4.5vw,72px)] lg:leading-none">
              Know what arrives before you pay.
            </h1>
            <p className="mt-5 max-w-[360px] text-[14px] leading-[22px] text-[#1A1A1A]/75 min-[600px]:text-[15px] min-[600px]:leading-6 lg:mt-7 lg:max-w-[440px] lg:text-[18px] lg:leading-7">
              Providus compares local routes into Celo by what you actually
              receive after fees, FX, limits and settlement time.
            </p>
            <div className="mt-6 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6 lg:mt-7 lg:gap-7">
              <RouteCheckCTA />
              <Link
                href="/how-it-works"
                className="inline-flex min-h-11 items-center border-b-[1.5px] border-[#1A1A1A] px-1 text-[13px] font-semibold text-[#1A1A1A]/80 transition-opacity hover:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1A1A1A] lg:text-[15px]"
              >
                How it works
              </Link>
            </div>
            <p className="mt-6 max-w-[360px] text-[11px] leading-[18px] text-[#1A1A1A]/60 lg:mt-7 lg:max-w-[440px] lg:text-[13px] lg:leading-5">
              Estimates with disclosed assumptions—not guarantees. You choose
              the provider and stay in control.
            </p>
          </div>

          <div className="relative mt-4 min-h-[360px] min-[600px]:min-h-[430px] md:min-h-[470px] lg:-ml-[clamp(56px,7.5vw,120px)] lg:mt-0 lg:h-full lg:min-h-[calc(100svh-81px)] lg:mr-0">
            <Sunburst />
            <div className="relative z-10 flex h-full min-h-[360px] items-start justify-center min-[600px]:min-h-[430px] md:min-h-[470px] lg:min-h-full lg:items-center lg:justify-start">
              <PaymentTerminalIllustration />
            </div>
          </div>
        </div>
      </section>

      <section className="viewport-section border-y border-[#1A1A1A]/20 bg-[#F5F2EA] py-8 sm:py-10">
        <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6 md:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1A1A1A]/60">
                The Value Line
              </p>
              <p className="mt-1 text-sm text-[#1A1A1A]/75">
                See the money outcome before the route is accepted.
              </p>
            </div>
            <p className="max-w-[420px] text-xs leading-5 text-[#1A1A1A]/60 sm:text-right">
              Structure only—no live quote on this page. A Route Check fills
              the line with fees, FX, selected route and estimated receive.
            </p>
          </div>
          <div className="mt-6">
            <ValueLine compact />
          </div>
        </div>
      </section>

      <section className="viewport-section bg-[#CBD2C4] py-16 sm:py-20">
        <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6 md:px-8">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1A1A1A]/60">
              The Providus point of view
            </p>
            <h2 className="mt-3 font-sans text-2xl font-semibold tracking-[-0.02em] text-[#1A1A1A] sm:text-3xl">
              Prudence in motion.
            </h2>
            <p className="mt-3 leading-7 text-[#1A1A1A]/70">
              Show the outcome before the money moves. Five principles guide
              every Route Check.
            </p>
          </div>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map((pillar, index) => {
              const Icon = pillar.icon;
              return (
                <li key={pillar.title}>
                  <article className="h-full rounded-[8px] border-[1.5px] border-[#1A1A1A] bg-[#F5F2EA] p-5 transition-colors duration-150 hover:bg-white">
                    <div className="mb-7 flex items-center justify-between">
                      <span className="text-xs font-semibold tracking-[0.12em] text-[#1A1A1A]/50">
                        0{index + 1}
                      </span>
                      <span className="flex h-10 w-10 items-center justify-center rounded-[8px] border-[1.5px] border-[#1A1A1A] bg-[#CBD2C4] text-[#1A1A1A]">
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                    </div>
                    <h3 className="font-sans text-lg font-semibold tracking-[-0.015em] text-[#1A1A1A]">
                      {pillar.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-[#1A1A1A]/70">
                      {pillar.message}
                    </p>
                    <p className="mt-5 border-t border-[#1A1A1A]/20 pt-4 text-xs leading-5 text-[#1A1A1A]/60">
                      {pillar.proof}
                    </p>
                  </article>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="viewport-section border-t border-[#1A1A1A]/20 bg-[#F5F2EA] py-16 sm:py-20">
        <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6 md:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1A1A1A]/55">
                A clear handoff
              </p>
              <h2 className="mt-3 font-sans text-2xl font-semibold tracking-[-0.02em] text-[#1A1A1A] sm:text-3xl">
                How a Route Check works
              </h2>
              <p className="mt-3 leading-7 text-[#1A1A1A]/70">
                From inputs to handoff—transparent at every step. No custody.
                No hidden ranking for affiliates.
              </p>
            </div>
            <Link
              href="/how-it-works"
              className="inline-flex items-center gap-2 self-start border-b-[1.5px] border-[#1A1A1A] pb-1 text-sm font-semibold text-[#1A1A1A] transition-opacity hover:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1A1A1A] sm:self-auto"
            >
              Full explanation
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step) => (
              <li key={step.n} className="rounded-[8px] border-[1.5px] border-[#1A1A1A] bg-[#CBD2C4] p-5">
                <span className="text-xs font-semibold tracking-[0.14em] text-[#1A1A1A]/55">
                  {step.n}
                </span>
                <h3 className="mt-8 font-sans text-lg font-semibold tracking-[-0.015em] text-[#1A1A1A]">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-[#1A1A1A]/70">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="viewport-section border-t-[1.5px] border-[#1A1A1A] bg-[#1A1A1A] py-16 text-[#F5F2EA] sm:py-20">
        <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6 md:px-8">
          <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#CBD2C4]/65">
                Clear boundaries
              </p>
              <h2 className="mt-3 font-sans text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
                Product boundaries
              </h2>
              <ul className="mt-6 space-y-3 text-sm leading-6 text-[#F5F2EA]/75">
                <li>Providus does not custody user funds.</li>
                <li>Providus does not execute fiat purchases in the MVP.</li>
                <li>
                  Quotes are estimates with freshness and assumptions—not final
                  prices.
                </li>
                <li>
                  Affiliate placement is never a ranking signal. You keep
                  control.
                </li>
              </ul>
            </div>
            <div className="rounded-[8px] border-[1.5px] border-[#F5F2EA] bg-[#CBD2C4] p-6 text-[#1A1A1A] sm:p-8">
              <p className="font-sans text-xl font-semibold tracking-[-0.02em] sm:text-2xl">
                Ready to compare a route?
              </p>
              <p className="mt-3 text-sm leading-6 text-[#1A1A1A]/70">
                Start a Route Check. Preview structure is ready; live quotes
                and x402 unlock connect next.
              </p>
              <div className="mt-6">
                <RouteCheckCTA emphasis="flat" />
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
