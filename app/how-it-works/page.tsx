import type { Metadata } from "next";
import {
  ClipboardList,
  ExternalLink,
  Lock,
  Receipt,
  ScanSearch,
  Unlock,
} from "lucide-react";
import { ValueLine } from "@/components/providus/value-line";
import { RouteCheckCTA } from "@/components/ui/route-check-cta";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "How Providus Route Check compares local fiat-to-Celo routes by effective received amount—before you pay.",
};

const FLOW = [
  {
    title: "Describe the money move",
    body: "Select country, fiat amount, payment method and target Celo asset. These inputs decide which routes are eligible.",
    icon: ClipboardList,
  },
  {
    title: "Compare eligible routes",
    body: "Providus normalises supported paths by effective received amount, fees, FX spread, limits, settlement time and reliability—not by who appears first.",
    icon: ScanSearch,
  },
  {
    title: "Review a locked preview",
    body: "You see a useful preview of the comparison. Full provider detail, assumptions and handoff stay locked until a Route Check payment.",
    icon: Lock,
  },
  {
    title: "Unlock the Route Verdict",
    body: "A small x402 stablecoin payment unlocks the complete recommendation: what arrives, why it ranked first, alternatives and how to continue.",
    icon: Unlock,
  },
  {
    title: "Continue with the provider",
    body: "Open the provider deep link or follow clear manual instructions. Providus does not custody funds or execute the fiat purchase.",
    icon: ExternalLink,
  },
  {
    title: "Keep a savings receipt",
    body: "A timestamped receipt records the estimate and choice. It explains the outcome without exposing wallet balances or personal provider data.",
    icon: Receipt,
  },
] as const;

const VERDICT_FIELDS = [
  "Estimated received amount",
  "Target asset and route / provider",
  "Payment method",
  "Explicit fee and estimated FX spread",
  "Network cost where relevant",
  "Settlement range",
  "Reliability / quote confidence",
  "Eligibility and amount-limit caveats",
  "Quote capture time and expiry",
  "Estimated saving versus baseline",
  "Provider handoff",
  "Alternative eligible routes",
  "Transparent ranking rationale",
] as const;

export default function HowItWorksPage() {
  return (
    <div className="relative isolate overflow-hidden bg-[#CBD2C4]">
      <div className="pointer-events-none absolute right-[-180px] top-[-120px] -z-10 h-[560px] w-[560px] rounded-full border border-[#BEC6B7]/70 opacity-70 before:absolute before:inset-10 before:rounded-full before:border before:border-[#BEC6B7]/50 after:absolute after:inset-24 after:rounded-full after:border after:border-[#BEC6B7]/35" aria-hidden />

      <div className="mx-auto w-full max-w-[1200px] px-4 py-12 sm:px-6 sm:py-16 md:px-8 lg:py-20">
        <div className="max-w-[720px]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#1A1A1A]/60">
            Route Check · The flow
          </p>
          <h1 className="mt-4 font-sans text-3xl font-semibold leading-[1.08] tracking-[-0.04em] text-[#1A1A1A] sm:text-4xl lg:text-5xl">
            Show the outcome before the money moves.
          </h1>
          <p className="mt-5 max-w-[650px] text-[15px] leading-7 text-[#1A1A1A]/72 sm:text-base">
            Providus is a route-intelligence agent—not an on-ramp or wallet. It
            compares local routes into Celo by what you actually receive after
            fees, FX, limits and settlement time.
          </p>
        </div>

        <section className="mt-12 border-[1.5px] border-[#1A1A1A] bg-[#F5F2EA] p-5 sm:p-8" aria-labelledby="value-line-heading">
          <div className="flex flex-col gap-2 border-b border-[#1A1A1A]/20 pb-5 sm:flex-row sm:items-baseline sm:justify-between">
            <h2 id="value-line-heading" className="font-sans text-xl font-semibold tracking-[-0.02em] text-[#1A1A1A] sm:text-2xl">
              The Value Line
            </h2>
            <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[#1A1A1A]/50">
              Outcome first
            </span>
          </div>
          <div className="mt-6">
            <ValueLine />
          </div>
          <p className="mt-5 max-w-[680px] text-sm leading-6 text-[#1A1A1A]/65">
            Every preview, Route Verdict and savings receipt follows this
            structure. It is calculation logic—not decoration.
          </p>
        </section>

        <section className="mt-16 sm:mt-20" aria-labelledby="flow-heading">
          <div className="flex flex-col gap-3 border-b-[1.5px] border-[#1A1A1A] pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1A1A1A]/55">
                Six clear moments
              </p>
              <h2 id="flow-heading" className="mt-2 font-sans text-2xl font-semibold tracking-[-0.025em] text-[#1A1A1A] sm:text-3xl">
                From question to handoff.
              </h2>
            </div>
            <p className="max-w-[310px] text-sm leading-6 text-[#1A1A1A]/65 sm:text-right">
              Each step explains what changes, what stays yours and what the
              next decision unlocks.
            </p>
          </div>

          <ol className="mt-8 grid gap-x-5 gap-y-5 md:grid-cols-2 lg:grid-cols-3">
            {FLOW.map((step, i) => {
              const Icon = step.icon;
              return (
                <li key={step.title} className="relative">
                  <article className="h-full rounded-[8px] border-[1.5px] border-[#1A1A1A] bg-[#F5F2EA] p-5 transition-colors duration-150 hover:bg-white sm:p-6">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold tracking-[0.16em] text-[#1A1A1A]/50">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="flex h-10 w-10 items-center justify-center rounded-[8px] border-[1.5px] border-[#1A1A1A] bg-[#CBD2C4] text-[#1A1A1A]">
                        <Icon className="h-[18px] w-[18px]" aria-hidden />
                      </span>
                    </div>
                    <h3 className="mt-9 font-sans text-lg font-semibold leading-6 tracking-[-0.015em] text-[#1A1A1A]">
                      {step.title}
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-[#1A1A1A]/70">
                      {step.body}
                    </p>
                    {i < FLOW.length - 1 ? (
                      <span className="absolute -bottom-[13px] left-1/2 hidden h-[24px] w-px bg-[#1A1A1A]/25 lg:block" aria-hidden />
                    ) : null}
                  </article>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="mt-16 grid gap-6 border-t-[1.5px] border-[#1A1A1A] pt-10 sm:mt-20 sm:pt-12 lg:grid-cols-[1fr_0.9fr] lg:gap-12" aria-labelledby="verdict-heading">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1A1A1A]/55">
              The unlocked answer
            </p>
            <h2 id="verdict-heading" className="mt-3 font-sans text-2xl font-semibold tracking-[-0.025em] text-[#1A1A1A] sm:text-3xl">
              What a full Route Verdict includes
            </h2>
            <p className="mt-3 max-w-[560px] leading-7 text-[#1A1A1A]/70">
              No payment unlock is complete until the result includes an
              actionable route—not just an abstract score.
            </p>
            <ul className="mt-7 grid gap-x-5 gap-y-3 sm:grid-cols-2">
              {VERDICT_FIELDS.map((field) => (
                <li key={field} className="flex min-w-0 items-start gap-3 text-sm leading-5 text-[#1A1A1A]">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#1A1A1A]" aria-hidden />
                  <span>{field}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-4">
            <article className="rounded-[8px] border-[1.5px] border-[#1A1A1A] bg-[#F5F2EA] p-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[#1A1A1A]/50">
                Policy 01
              </p>
              <h3 className="mt-3 font-sans text-xl font-semibold tracking-[-0.02em] text-[#1A1A1A]">
                Ranking policy
              </h3>
              <p className="mt-3 text-sm leading-6 text-[#1A1A1A]/70">
                Recommendations rank user outcome, never provider placement.
                Effective received amount carries the most weight, followed by
                fees, reliability, speed and a small Celo-native bonus.
              </p>
              <p className="mt-5 border-t border-[#1A1A1A]/20 pt-4 text-xs leading-5 text-[#1A1A1A]/60">
                Manual or estimated quotes are marked with source and capture
                time. Sponsored links cannot improve rank.
              </p>
            </article>
            <article className="rounded-[8px] border-[1.5px] border-[#1A1A1A] bg-[#1A1A1A] p-6 text-[#F5F2EA]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[#CBD2C4]/65">
                Policy 02
              </p>
              <h3 className="mt-3 font-sans text-xl font-semibold tracking-[-0.02em]">
                Boundaries
              </h3>
              <ul className="mt-4 space-y-2 text-sm leading-6 text-[#F5F2EA]/75">
                <li>No custody of user funds</li>
                <li>No fiat purchase execution in MVP</li>
                <li>No claim of global coverage</li>
                <li>No stale quote presented as a final price</li>
              </ul>
            </article>
          </div>
        </section>

        <section className="mt-16 flex flex-col gap-5 border-[1.5px] border-[#1A1A1A] bg-[#F5F2EA] p-6 sm:mt-20 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[#1A1A1A]/50">
              Start with your numbers
            </p>
            <h2 className="mt-2 font-sans text-xl font-semibold tracking-[-0.02em] text-[#1A1A1A] sm:text-2xl">
              Check a route
            </h2>
            <p className="mt-1 text-sm leading-6 text-[#1A1A1A]/65">
              Start with inputs. Live quotes and x402 unlock connect next.
            </p>
          </div>
          <RouteCheckCTA className="shrink-0" />
        </section>
      </div>
    </div>
  );
}
