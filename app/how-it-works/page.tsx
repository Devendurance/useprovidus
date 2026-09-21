import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowDown,
  ArrowRight,
  BadgeCheck,
  Banknote,
  Bot,
  Check,
  CircleAlert,
  ClipboardList,
  Database,
  ExternalLink,
  Eye,
  GitBranch,
  Lock,
  Network,
  Receipt,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "How Providus turns approved messages into verified real-world payments through a human-approved execution flow.",
};

const FLOW = [
  {
    title: "Request",
    body: "Tell the web dashboard what you want to pay in ordinary language. The current conversational path supports Nigerian airtime.",
    icon: ClipboardList,
  },
  {
    title: "Validate",
    body: "Providus turns supported requests into a typed, validated PaymentIntent and asks for missing or ambiguous fields before any money action.",
    icon: ScanSearch,
  },
  {
    title: "Review",
    body: "Freeze the recipient, network, amount, quote, fees, expiry and exact total so you can inspect the terms.",
    icon: Eye,
  },
  {
    title: "Approve",
    body: "Approve the exact action, then separately sign the exact Celo USDC transfer in your browser wallet. Providus never signs for you.",
    icon: Lock,
  },
  {
    title: "Execute",
    body: "Deterministic code creates and binds the approved order, then calls the current rails. Paycrest settles NGN; ClubKonnect fulfils current airtime.",
    icon: ExternalLink,
  },
  {
    title: "Reconcile",
    body: "Read chain and provider states separately; reconcile unknown outcomes without blind duplicate mutation. A Celo deposit is not Nigerian delivery.",
    icon: ShieldCheck,
  },
  {
    title: "Prove",
    body: "Show an evidence-linked receipt for verified stages and keep unverified outcomes clearly marked.",
    icon: Receipt,
  },
] as const;

const TRUST_ARCHITECTURE_PRELUDE = [
  {
    title: "Web today",
    body: "The web dashboard is the shipped conversation surface.",
    meta: "Current",
    icon: Network,
  },
  {
    title: "Conversation Layer",
    body: "Language is interpreted and clarified before it becomes a candidate request.",
    meta: null,
    icon: ClipboardList,
  },
  {
    title: "PaymentIntent Engine",
    body: "Deterministic code validates and binds the requested outcome, recipient, quote, fee, expiry and exact total.",
    meta: null,
    icon: ScanSearch,
  },
  {
    title: "Human Approval Boundary",
    body: "The user reviews the frozen terms, approves the action and signs the exact Celo USDC transfer.",
    meta: null,
    icon: Lock,
  },
  {
    title: "Providus Execution Engine",
    body: "Eligibility, durable state, provider calls, fulfilment gating, reconciliation and receipts remain deterministic.",
    meta: null,
    icon: ShieldCheck,
  },
] as const;

const TRUST_ARCHITECTURE_POSTLUDE = [
  {
    title: "Reconciliation + Recovery",
    body: "Chain and provider reads are reconciled; uncertain outcomes are recovered by reference instead of blindly retried.",
    icon: RefreshCw,
  },
  {
    title: "Verified Outcome",
    body: "A stage is final only when its required evidence supports it; Celo, fiat delivery and fulfilment stay separate.",
    icon: BadgeCheck,
  },
  {
    title: "Receipt",
    body: "The approved request and its owner-scoped, evidence-backed lifecycle become the human-readable record.",
    icon: Receipt,
  },
] as const;

const LLM_CAN = [
  "Interpret supported payment language",
  "Ask for missing or ambiguous fields",
  "Return structured candidate data",
  "Explain states already recorded by deterministic code",
] as const;

const LLM_CANNOT = [
  "Move money or create an executable transaction",
  "Change approved payment-critical fields",
  "Authorize a provider mutation",
  "Sign a wallet transfer or choose a success state",
  "Invent a refund or bypass deterministic validation",
] as const;

const LIFECYCLE_STEPS = [
  {
    label: "Awaiting payment",
    body: "Order created; the Celo USDC deposit is not yet observed.",
  },
  {
    label: "Celo deposit confirmed",
    body: "The USDC transfer is verified on-chain; NGN delivery is still separate.",
  },
  {
    label: "NGN payout in progress",
    body: "Paycrest’s liquidity provider is disbursing NGN to the configured fiat recipient.",
  },
  {
    label: "NGN settlement processing",
    body: "Paycrest settlement is still progressing; this is not protocol completion.",
  },
  {
    label: "NGN settlement confirmed",
    body: "Paycrest fiat delivery is confirmed as durable fiat-final truth; an airtime request has not been sent yet.",
  },
  {
    label: "Airtime request submitting",
    body: "The one allowed fulfilment attempt is claimed or in flight.",
  },
  {
    label: "Airtime processing",
    body: "ClubKonnect has received the request; acknowledgement is not delivery.",
  },
  {
    label: "Airtime delivered",
    body: "ClubKonnect’s documented terminal success status verifies delivery.",
  },
] as const;

const CASH_OUT_STAGES = [
  {
    label: "Fiat delivery confirmed",
    qualifier: "cash-out",
    body: "NGN is confirmed delivered into the recipient bank account.",
  },
  {
    label: "Paycrest protocol settled",
    qualifier: "cash-out",
    body: "Paycrest protocol settlement is complete; this is tracked separately from fiat delivery.",
  },
  {
    label: "Fulfilment processing (cash-out only)",
    qualifier: null,
    body: "Fiat payout is verified while downstream utility fulfilment is in progress.",
  },
  {
    label: "Completed (cash-out only)",
    qualifier: null,
    body: "The cash-out row is recorded complete; cash-out settled is the effective terminal.",
  },
] as const;

const EXCEPTIONAL_STAGES = [
  {
    label: "Provider status unresolved",
    body: "Airtime status is unclear. Reconcile the existing RequestID; do not submit another purchase.",
  },
  {
    label: "Recovery required",
    body: "An order or completion outcome is unknown and needs durable-reference reconciliation before any new action.",
  },
  {
    label: "Airtime fulfilment failed",
    body: "Fiat delivery was confirmed but airtime delivery failed; Providus did not issue an automatic refund.",
  },
  {
    label: "Failed",
    body: "A documented terminal transaction or payment failure.",
  },
  {
    label: "Refunded",
    body: "A refund is shown only after the return of funds is verified.",
  },
] as const;

const VERDICT_FIELDS = [
  "Requested outcome and validated PaymentIntent",
  "Recipient, network and verified account or phone",
  "Amount, quote, fee, expiry and exact total",
  "Celo mainnet and canonical USDC",
  "Order approval and browser-wallet signing boundary",
  "Celo deposit status",
  "NGN delivery status",
  "Airtime fulfilment status when supported",
  "Evidence-linked receipt",
] as const;

export default function HowItWorksPage() {
  return (
    <div className="container-providus py-10 sm:py-14">
      <div className="max-w-3xl">
        <p className="font-proof text-receipt-grey">Seven-stage execution</p>
        <h1 className="mt-2 font-display text-3xl font-semibold leading-tight tracking-tight text-ledger-stone sm:text-4xl lg:text-5xl">
          Request → Validate → Review → Approve → Execute → Reconcile → Prove
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-receipt-grey">
          Providus turns approved messages into verified real-world payments. You
          can ask naturally, inspect the exact action, approve it yourself, and
          follow the evidence across each handoff.
        </p>
      </div>

      <section className="mt-10 rounded-[14px] border-ledger bg-clear-paper p-6 shadow-elevated sm:p-8">
        <p className="font-proof text-receipt-grey">Human approval boundary</p>
        <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ledger-stone sm:text-3xl">
          LLM owns language. Deterministic code owns money.
        </h2>
        <p className="mt-3 max-w-3xl leading-relaxed text-receipt-grey">
          A language model may interpret a request, ask a question or explain a
          recorded state. It does not create an executable transaction, change
          approved payment fields, authorize a provider mutation, sign a wallet
          transfer or choose a success state.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Card variant="surface">
            <CardTitle as="h3">Language layer</CardTitle>
            <CardDescription>
              Conversational input becomes a structured request without giving
              the model financial authority.
            </CardDescription>
            <ul className="mt-4 space-y-2 text-sm text-receipt-grey">
              <li>Interpret supported payment requests</li>
              <li>Ask for missing or ambiguous fields</li>
              <li>Explain states that deterministic code has recorded</li>
            </ul>
          </Card>
          <Card variant="verdict">
            <CardTitle as="h3">Money layer</CardTitle>
            <CardDescription>
              Deterministic Providus code validates, binds, executes,
              reconciles and builds the evidence-backed receipt.
            </CardDescription>
            <ul className="mt-4 space-y-2 text-sm text-receipt-grey">
              <li>Validate the PaymentIntent and payment-critical fields</li>
              <li>Enforce approval and browser-wallet signing boundaries</li>
              <li>Control provider calls, durable state and reconciliation</li>
            </ul>
          </Card>
        </div>
      </section>

      <h2 className="sr-only">Providus payment execution stages</h2>
      <ol
        className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3"
        aria-label="Providus payment execution stages"
      >
        {FLOW.map((step, i) => {
          const Icon = step.icon;
          return (
            <li key={step.title}>
              <Card variant="surface" className="h-full">
                <div className="mb-3 flex items-center gap-3">
                  <span className="font-proof text-provident-green">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="flex h-9 w-9 items-center justify-center rounded-[10px] border-ledger bg-receipt-field text-provident-green shadow-base">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                </div>
                <CardTitle as="h3">{step.title}</CardTitle>
                <CardDescription>{step.body}</CardDescription>
              </Card>
            </li>
          );
        })}
      </ol>
      <section
        id="trust"
        aria-labelledby="trust-heading"
        className="mt-14 scroll-mt-24 space-y-8"
      >
        <div className="max-w-3xl">
          <p className="font-proof text-receipt-grey">P6.14 · Trust architecture</p>
          <h2
            id="trust-heading"
            className="mt-2 font-display text-2xl font-semibold tracking-tight text-ledger-stone sm:text-3xl"
          >
            One approval, two provider edges, one verified receipt.
          </h2>
          <p className="mt-3 leading-relaxed text-receipt-grey">
            The web path stays legible from language to evidence. Providus owns
            the deterministic handoffs; providers own only their named edge.
          </p>
        </div>

        <Card variant="verdict" className="overflow-hidden">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle as="h3">Canonical architecture</CardTitle>
              <CardDescription>
                A single trust path fans out to separate settlement and
                fulfilment edges, then joins again only at reconciliation.
              </CardDescription>
            </div>
            <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border border-provident-green/40 bg-provident-green/10 px-2.5 py-1 font-proof text-[11px] font-semibold uppercase tracking-[0.08em] text-provident-green">
              Current web path
            </span>
          </div>

          <ol
            className="relative mt-6 ml-2 space-y-3 border-l-2 border-ledger-edge pl-5"
            aria-label="Providus architecture before provider edges"
          >
            {TRUST_ARCHITECTURE_PRELUDE.map((step, index) => {
              const Icon = step.icon;
              return (
                <li key={step.title} className="relative flex gap-3">
                  <span className="absolute -left-[2.05rem] flex h-6 w-6 items-center justify-center rounded-full border-[1.5px] border-ink bg-receipt-field font-proof text-[10px] font-semibold text-ledger-stone">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border-ledger bg-receipt-field text-provident-green">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm text-ledger-stone">{step.title}</strong>
                      {step.meta ? (
                        <span className="rounded-full border border-provident-green/40 bg-provident-green/10 px-2 py-0.5 font-proof text-[10px] font-semibold uppercase tracking-[0.08em] text-provident-green">
                          {step.meta}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm leading-6 text-receipt-grey">{step.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="flex justify-center py-2 text-provident-green" aria-hidden>
            <ArrowDown className="h-5 w-5" />
          </div>

          <div className="rounded-[8px] border-[1.5px] border-ink bg-receipt-field/70 p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-provident-green" aria-hidden />
              <p className="font-proof text-xs font-semibold uppercase tracking-[0.12em] text-receipt-grey">
                06 · Two separate provider edges
              </p>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-[8px] border-ledger bg-clear-paper p-4">
                <div className="flex items-start gap-3">
                  <Banknote className="mt-0.5 h-5 w-5 shrink-0 text-provident-green" aria-hidden />
                  <div>
                    <h4 className="font-display text-base font-semibold tracking-tight text-ledger-stone">
                      SettlementRail / Paycrest
                    </h4>
                    <span className="mt-1 inline-flex rounded-full border border-provident-green/40 bg-provident-green/10 px-2 py-0.5 font-proof text-[10px] font-semibold uppercase tracking-[0.08em] text-provident-green">
                      Current settlement edge
                    </span>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-receipt-grey">
                  Paycrest owns Celo USDC → NGN settlement, not airtime fulfilment.
                </p>
              </div>
              <div className="rounded-[8px] border-ledger bg-clear-paper p-4">
                <div className="flex items-start gap-3">
                  <WalletCards className="mt-0.5 h-5 w-5 shrink-0 text-provident-green" aria-hidden />
                  <div>
                    <h4 className="font-display text-base font-semibold tracking-tight text-ledger-stone">
                      FulfilmentProvider / ClubKonnect
                    </h4>
                    <span className="mt-1 inline-flex rounded-full border border-provident-green/40 bg-provident-green/10 px-2 py-0.5 font-proof text-[10px] font-semibold uppercase tracking-[0.08em] text-provident-green">
                      Current for airtime
                    </span>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-receipt-grey">
                  ClubKonnect owns airtime fulfilment after Providus’s durable
                  fiat-final gate.
                </p>
              </div>
            </div>
            <p className="mt-4 border-t border-ledger-edge pt-3 text-sm leading-6 text-receipt-grey">
              These edges stay separate: Paycrest does not fund ClubKonnect.
              Providus gates fulfilment, reads each provider independently and
              reconciles before reporting an outcome.
            </p>
          </div>

          <div className="flex justify-center py-2 text-provident-green" aria-hidden>
            <ArrowDown className="h-5 w-5" />
          </div>

          <ol
            start={7}
            className="relative space-y-3 border-l-2 border-ledger-edge pl-5"
            aria-label="Providus architecture after provider edges"
          >
            {TRUST_ARCHITECTURE_POSTLUDE.map((step, index) => {
              const Icon = step.icon;
              return (
                <li key={step.title} className="relative flex gap-3">
                  <span className="absolute -left-[2.05rem] flex h-6 w-6 items-center justify-center rounded-full border-[1.5px] border-ink bg-receipt-field font-proof text-[10px] font-semibold text-ledger-stone">
                    {String(index + 7).padStart(2, "0")}
                  </span>
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border-ledger bg-receipt-field text-provident-green">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <strong className="text-sm text-ledger-stone">{step.title}</strong>
                    <p className="mt-1 text-sm leading-6 text-receipt-grey">{step.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-ledger-edge pt-4" aria-label="Channel roadmap">
            <span className="font-proof text-[11px] font-semibold uppercase tracking-[0.1em] text-receipt-grey">
              Future adapters · roadmap only
            </span>
            {["iMessage", "WhatsApp", "Telegram", "MiniPay"].map((channel) => (
              <span
                key={channel}
                className="rounded-full border border-ink/30 bg-clear-paper px-2.5 py-1 text-xs font-semibold text-ledger-stone"
              >
                {channel}
              </span>
            ))}
          </div>
        </Card>

        <section aria-labelledby="llm-heading" className="space-y-4">
          <div className="max-w-3xl">
            <p className="font-proof text-receipt-grey">Trust ownership</p>
            <h3
              id="llm-heading"
              className="mt-2 font-display text-2xl font-semibold tracking-tight text-ledger-stone"
            >
              What the LLM can and cannot do
            </h3>
            <p className="mt-3 leading-relaxed text-receipt-grey">
              Language is useful at the front of the path. Money authority
              begins only after deterministic validation and your approval.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card variant="surface">
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-provident-green" aria-hidden />
                <CardTitle as="h3">The LLM can</CardTitle>
              </div>
              <CardDescription>
                Interpret language without receiving financial authority.
              </CardDescription>
              <ul className="mt-4 space-y-2 text-sm leading-6 text-receipt-grey">
                {LLM_CAN.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Check className="mt-1 h-4 w-4 shrink-0 text-provident-green" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card variant="verdict">
              <div className="flex items-center gap-2">
                <X className="h-5 w-5 text-loss-red" aria-hidden />
                <CardTitle as="h3">The LLM cannot</CardTitle>
              </div>
              <CardDescription>
                It never becomes an execution, signing or success authority.
              </CardDescription>
              <ul className="mt-4 space-y-2 text-sm leading-6 text-receipt-grey">
                {LLM_CANNOT.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <X className="mt-1 h-4 w-4 shrink-0 text-loss-red" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <Card variant="verdict">
            <div className="flex items-start gap-3">
              <Lock className="mt-1 h-5 w-5 shrink-0 text-provident-green" aria-hidden />
              <div>
                <CardTitle as="h3">The money movement gate</CardTitle>
                <CardDescription>
                  You own approval and browser-wallet signing. The system does
                  not move money until both boundaries are explicit.
                </CardDescription>
              </div>
            </div>
            <ol className="mt-5 grid gap-3 md:grid-cols-3" aria-label="Money movement approval steps">
              <li className="rounded-[8px] border-ledger bg-receipt-field p-4">
                <span className="font-proof text-xs font-semibold text-provident-green">01</span>
                <p className="mt-2 text-sm leading-6 text-ledger-stone">
                  <strong>Review</strong> the frozen recipient, amount, quote,
                  fee, expiry and exact total.
                </p>
              </li>
              <li className="rounded-[8px] border-ledger bg-receipt-field p-4">
                <span className="font-proof text-xs font-semibold text-provident-green">02</span>
                <p className="mt-2 text-sm leading-6 text-ledger-stone">
                  <strong>Approve</strong> the exact action in the conversation
                  or dashboard.
                </p>
              </li>
              <li className="rounded-[8px] border-ledger bg-receipt-field p-4">
                <span className="font-proof text-xs font-semibold text-provident-green">03</span>
                <p className="mt-2 text-sm leading-6 text-ledger-stone">
                  <strong>Sign</strong> after the server binds the authoritative
                  order; then sign the exact Celo USDC transfer in your browser wallet.
                </p>
              </li>
            </ol>
            <p className="mt-4 border-t border-ledger-edge pt-3 text-sm leading-6 text-receipt-grey">
              Only then can deterministic Providus code execute and reconcile
              the provider edges. Providus never signs for you.
            </p>
          </Card>
        </section>

        <section aria-labelledby="lifecycle-heading" className="space-y-4">
          <div className="max-w-3xl">
            <p className="font-proof text-receipt-grey">Observed states</p>
            <h3
              id="lifecycle-heading"
              className="mt-2 font-display text-2xl font-semibold tracking-tight text-ledger-stone"
            >
              Actual transaction lifecycle
            </h3>
            <p className="mt-3 leading-relaxed text-receipt-grey">
              These public labels describe recorded evidence, not optimistic
              provider acknowledgements.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
            <Card variant="surface">
              <CardTitle as="h3">Normal airtime path</CardTitle>
              <CardDescription>
                Each stage is monotonic in durable transaction state.
              </CardDescription>
              <ol className="mt-5 space-y-3" aria-label="Normal airtime transaction lifecycle">
                {LIFECYCLE_STEPS.map((stage, index) => (
                  <li key={stage.label} className="flex gap-3">
                    <span className="mt-0.5 font-proof text-xs font-semibold text-provident-green">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-ledger-stone">{stage.label}</p>
                      <p className="mt-1 text-sm leading-6 text-receipt-grey">{stage.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-5 border-t border-ledger-edge pt-4 text-sm leading-6 text-receipt-grey">
                Internal lifecycle: <code className="font-proof text-ledger-stone">pending</code>{" "}
                → <code className="font-proof text-ledger-stone">settling</code> →{" "}
                <code className="font-proof text-ledger-stone">settled</code> →{" "}
                <code className="font-proof text-ledger-stone">processing</code> (airtime) →{" "}
                <code className="font-proof text-ledger-stone">completed</code>. Cash-out{" "}
                <code className="font-proof text-ledger-stone">settled</code> is the effective terminal.
              </p>
            </Card>

            <div className="space-y-4">
              <Card variant="standard">
                <CardTitle as="h3">Cash-out labels</CardTitle>
                <CardDescription>
                  Bank cash-out stays a separate, intact path.
                </CardDescription>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-receipt-grey">
                  {CASH_OUT_STAGES.map((stage) => (
                    <li key={stage.label}>
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-ledger-stone">{stage.label}</strong>
                        {stage.qualifier ? (
                          <span className="rounded-full border border-ink/30 px-2 py-0.5 font-proof text-[10px] font-semibold uppercase tracking-[0.08em] text-receipt-grey">
                            {stage.qualifier}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1">{stage.body}</p>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card variant="verdict">
                <div className="flex items-center gap-2">
                  <CircleAlert className="h-5 w-5 text-rate-amber" aria-hidden />
                  <CardTitle as="h3">Exceptional branches stay explicit</CardTitle>
                </div>
                <CardDescription>
                  Acknowledgement is never final success; recovery is a real
                  state, not a hidden retry.
                </CardDescription>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-receipt-grey">
                  {EXCEPTIONAL_STAGES.map((stage) => (
                    <li key={stage.label}>
                      <strong className="text-ledger-stone">{stage.label}</strong>
                      <p className="mt-1">{stage.body}</p>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
          <p className="max-w-4xl text-sm leading-6 text-receipt-grey">
            The durable <code className="font-proof text-ledger-stone">validated</code> fact is
            authoritative fiat delivery and never gets cleared.{" "}
            <code className="font-proof text-ledger-stone">settling</code> is later protocol
            progression; <code className="font-proof text-ledger-stone">settled</code> is protocol
            completion and also subsumes fiat delivery.
          </p>
        </section>

        <section aria-labelledby="evidence-heading" className="space-y-4">
          <div className="max-w-3xl">
            <p className="font-proof text-receipt-grey">Proof chain</p>
            <h3
              id="evidence-heading"
              className="mt-2 font-display text-2xl font-semibold tracking-tight text-ledger-stone"
            >
              Evidence follows every handoff.
            </h3>
            <p className="mt-3 leading-relaxed text-receipt-grey">
              A receipt joins human approval, chain evidence, settlement
              milestones and fulfilment evidence without collapsing them. Approval
              is the flow boundary; the persisted receipt covers the resulting
              payment and provider facts.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <Card variant="surface">
              <CardTitle as="h3">Evidence chain</CardTitle>
              <CardDescription>
                The current web path leaves a durable, reviewable record.
              </CardDescription>
              <ol className="mt-5 space-y-4" aria-label="Evidence chain">
                <li className="flex gap-3">
                  <WalletCards className="mt-0.5 h-5 w-5 shrink-0 text-provident-green" aria-hidden />
                  <p className="text-sm leading-6 text-receipt-grey">
                    <strong className="text-ledger-stone">Human approval:</strong> the user approved
                    exact terms and signed in a browser wallet.
                  </p>
                </li>
                <li className="flex gap-3">
                  <ScanSearch className="mt-0.5 h-5 w-5 shrink-0 text-provident-green" aria-hidden />
                  <p className="text-sm leading-6 text-receipt-grey">
                    <strong className="text-ledger-stone">Celo evidence:</strong> the on-chain USDC
                    transfer is linked from the receipt.
                  </p>
                </li>
                <li className="flex gap-3">
                  <Banknote className="mt-0.5 h-5 w-5 shrink-0 text-provident-green" aria-hidden />
                  <p className="text-sm leading-6 text-receipt-grey">
                    <strong className="text-ledger-stone">Settlement evidence:</strong> Paycrest
                    delivery is recorded as validated, then protocol settlement as settled.
                  </p>
                </li>
                <li className="flex gap-3">
                  <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-provident-green" aria-hidden />
                  <p className="text-sm leading-6 text-receipt-grey">
                    <strong className="text-ledger-stone">Fulfilment evidence:</strong> ClubKonnect
                    status 200, RequestID and order reference support delivery.
                  </p>
                </li>
                <li className="flex gap-3">
                  <Receipt className="mt-0.5 h-5 w-5 shrink-0 text-provident-green" aria-hidden />
                  <p className="text-sm leading-6 text-receipt-grey">
                    <strong className="text-ledger-stone">Receipt:</strong> the verified outcome
                    keeps each stage and its evidence visible.
                  </p>
                </li>
              </ol>
            </Card>
            <Card variant="standard">
              <CardTitle as="h3">One masked live example</CardTitle>
              <CardDescription>
                One human-gated run, not a guarantee of future delivery.
              </CardDescription>
              <dl className="mt-5 space-y-3 text-sm leading-6">
                <div className="border-b border-ledger-edge pb-3">
                  <dt className="font-proof text-[11px] font-semibold uppercase tracking-[0.1em] text-receipt-grey">
                    Request
                  </dt>
                  <dd className="mt-1 font-semibold text-ledger-stone">₦1,000 MTN airtime</dd>
                </div>
                <div className="border-b border-ledger-edge pb-3">
                  <dt className="font-proof text-[11px] font-semibold uppercase tracking-[0.1em] text-receipt-grey">
                    Recipient
                  </dt>
                  <dd className="mt-1 font-proof text-ledger-stone">*******6560</dd>
                </div>
                <div className="border-b border-ledger-edge pb-3">
                  <dt className="font-proof text-[11px] font-semibold uppercase tracking-[0.1em] text-receipt-grey">
                    Celo transaction
                  </dt>
                  <dd className="mt-1">
                    <a
                      href="https://celoscan.io/tx/0xfb952e0f2670c64cc6829d6419d736cc0ff152e8bec7fd30cbbdf837496e0ce9"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 font-proof font-semibold text-quote-blue underline decoration-quote-blue/40 underline-offset-4 hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      0xfb95…e0ce
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      <span className="sr-only">Open CeloScan proof</span>
                    </a>
                  </dd>
                </div>
                <div className="border-b border-ledger-edge pb-3">
                  <dt className="font-proof text-[11px] font-semibold uppercase tracking-[0.1em] text-receipt-grey">
                    Settlement
                  </dt>
                  <dd className="mt-1 text-ledger-stone">Paycrest validated, then settled</dd>
                </div>
                <div>
                  <dt className="font-proof text-[11px] font-semibold uppercase tracking-[0.1em] text-receipt-grey">
                    Fulfilment
                  </dt>
                  <dd className="mt-1 text-ledger-stone">
                    ClubKonnect status 200 · RequestID <code className="font-proof">cktx48b9…</code>{" "}
                    · order <code className="font-proof">6720476887</code>
                  </dd>
                </div>
              </dl>
            </Card>
          </div>
        </section>

        <section aria-labelledby="recovery-heading" className="space-y-4">
          <div className="max-w-3xl">
            <p className="font-proof text-receipt-grey">Durable safety</p>
            <h3
              id="recovery-heading"
              className="mt-2 font-display text-2xl font-semibold tracking-tight text-ledger-stone"
            >
              Recovery and idempotency
            </h3>
            <p className="mt-3 leading-relaxed text-receipt-grey">
              Unknown is a state to reconcile, not permission to repeat a
              money-moving request.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card variant="surface">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-provident-green" aria-hidden />
                <CardTitle as="h3">Recover by durable reference</CardTitle>
              </div>
              <CardDescription>
                Neon PostgreSQL + Drizzle stores the transaction facts needed
                across refreshes and restarts.
              </CardDescription>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-receipt-grey">
                <li className="flex gap-2">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-provident-green" aria-hidden />
                  <span>Persist the approved terms, provider references, Celo hash and stage.</span>
                </li>
                <li className="flex gap-2">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-provident-green" aria-hidden />
                  <span>Query the same deterministic RequestID when a provider outcome is unknown.</span>
                </li>
                <li className="flex gap-2">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-provident-green" aria-hidden />
                  <span>Keep recovery-required work visible until evidence resolves it.</span>
                </li>
              </ul>
            </Card>
            <Card variant="verdict">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-provident-green" aria-hidden />
                <CardTitle as="h3">One-shot mutation, verified outcome</CardTitle>
              </div>
              <CardDescription>
                Idempotency protects the real-world side effect; reconciliation
                decides what can be called final.
              </CardDescription>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-receipt-grey">
                <li className="flex gap-2">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-provident-green" aria-hidden />
                  <span>Claim at most one fulfilment attempt before a purchase mutation.</span>
                </li>
                <li className="flex gap-2">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-provident-green" aria-hidden />
                  <span>Read provider status separately; acknowledgement is never final success.</span>
                </li>
                <li className="flex gap-2">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-provident-green" aria-hidden />
                  <span>Only verified evidence can advance the receipt to a final outcome.</span>
                </li>
              </ul>
            </Card>
          </div>
        </section>
      </section>

      <section className="mt-14 grid gap-8 lg:grid-cols-[1fr_1fr]">
        <div>
          <p className="font-proof text-receipt-grey">Review before money moves</p>
          <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight">
            What a safe review includes
          </h2>
          <p className="mt-3 leading-relaxed text-receipt-grey">
            Approval is only safe when the action and its limits are visible,
            not hidden behind provider or protocol language.
          </p>
          <ul className="mt-6 space-y-2">
            {VERDICT_FIELDS.map((field) => (
              <li
                key={field}
                className="flex items-start gap-2 text-sm text-ledger-stone"
              >
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-provident-green"
                  aria-hidden
                />
                {field}
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-4">
          <Card variant="standard">
            <CardTitle as="h3">Current shipped paths</CardTitle>
            <CardDescription>
              Provider names sit at the execution edge; Providus owns the
              approval, orchestration, reconciliation and proof layer.
            </CardDescription>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-receipt-grey">
              <li>
                <strong className="text-ledger-stone">
                  Conversational airtime:
                </strong>{" "}
                web dashboard → Celo USDC → Paycrest NGN settlement; independently,
                ClubKonnect airtime fulfilment follows verified fiat delivery.
              </li>
              <li>
                <strong className="text-ledger-stone">
                  Separate bank cash-out:
                </strong>{" "}
                Celo USDC → Paycrest → verified Nigerian bank account.
              </li>
            </ul>
          </Card>
          <Card variant="surface">
            <CardTitle as="h3">Quote policy and state boundaries</CardTitle>
            <CardDescription>
              A Paycrest quote is an estimate with a capture time, expiry and
              disclosed fee inputs. Refresh it when stale; do not treat an old
              quote as a final payout amount.
            </CardDescription>
            <ul className="mt-4 space-y-2 text-sm text-receipt-grey">
              <li>No custody of user funds</li>
              <li>Celo deposit is not Nigerian bank delivery</li>
              <li>NGN delivery and airtime fulfilment remain separate states</li>
              <li>No completion label before verified finality</li>
            </ul>
          </Card>
        </div>
      </section>

      <section className="mt-14 rounded-[14px] border-ledger bg-receipt-field p-6 sm:p-8">
        <p className="font-proof text-receipt-grey">Current channel and boundary</p>
        <div className="mt-2 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-tight">
              Web is current. Future surfaces are roadmap.
            </h2>
            <p className="mt-3 max-w-2xl leading-relaxed text-receipt-grey">
              The web dashboard is the shipped conversation surface. iMessage/Photon,
              WhatsApp, Telegram, MiniPay, data bundles, electricity and cable are
              future adapters or categories, not current availability.
            </p>
            <div className="mt-5 flex flex-wrap gap-2" aria-label="Channel availability">
              <span className="rounded-full border border-provident-green/40 bg-provident-green/10 px-2.5 py-1 font-proof text-[10px] font-semibold uppercase tracking-[0.08em] text-provident-green">
                Current · web dashboard
              </span>
              <span className="rounded-full border border-ink/30 bg-clear-paper px-2.5 py-1 font-proof text-[10px] font-semibold uppercase tracking-[0.08em] text-ledger-stone">
                Roadmap only · iMessage
              </span>
              <span className="rounded-full border border-ink/30 bg-clear-paper px-2.5 py-1 font-proof text-[10px] font-semibold uppercase tracking-[0.08em] text-ledger-stone">
                Roadmap only · WhatsApp
              </span>
              <span className="rounded-full border border-ink/30 bg-clear-paper px-2.5 py-1 font-proof text-[10px] font-semibold uppercase tracking-[0.08em] text-ledger-stone">
                Roadmap only · Telegram
              </span>
              <span className="rounded-full border border-ink/30 bg-clear-paper px-2.5 py-1 font-proof text-[10px] font-semibold uppercase tracking-[0.08em] text-ledger-stone">
                Roadmap only · MiniPay
              </span>
            </div>
          </div>
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[2px] border-[1.5px] border-ink bg-ink px-5 py-2 text-sm font-semibold text-cream transition-colors hover:bg-cream hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
          >
            Try Providus <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </section>

      <div className="mt-14 flex flex-col items-start gap-4 rounded-[14px] border-ledger-thick bg-clear-paper p-6 shadow-prominent sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <p className="font-display text-xl font-semibold tracking-tight">
            Prefer a separate bank cash-out?
          </p>
          <p className="mt-1 text-sm text-receipt-grey">
            Open the dedicated flow to verify a recipient, review a live quote
            and approve the exact Celo USDC transfer.
          </p>
        </div>
        <Link
          href="/check"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[2px] border-[1.5px] border-ink bg-ink px-5 py-2 text-sm font-semibold text-cream transition-colors hover:bg-cream hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
        >
          Open bank cash-out <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
