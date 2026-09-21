import { cn } from "@/lib/cn";
import { ArrowRight } from "lucide-react";

export type ValueLineStep = {
  label: string;
  detail?: string;
  emphasis?: boolean;
};

const DEFAULT_STEPS: ValueLineStep[] = [
  { label: "You pay", detail: "Local amount" },
  { label: "Fees + FX", detail: "Costs applied" },
  { label: "Payment path", detail: "Celo → NGN" },
  { label: "You receive", detail: "Effective amount", emphasis: true },
];

type ValueLineProps = {
  steps?: ValueLineStep[];
  className?: string;
  compact?: boolean;
  caption?: string;
};

export function ValueLine({
  steps = DEFAULT_STEPS,
  className,
  compact = false,
  caption,
}: ValueLineProps) {
  return (
    <div className={cn("w-full", className)}>
      {caption ? (
        <p className="mb-3 font-sans text-receipt-grey">{caption}</p>
      ) : null}
      <ol
        className={cn(
          "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-stretch sm:gap-2",
          compact && "sm:gap-1.5",
        )}
        aria-label="Payment path: amount, fees and FX, payment path, outcome"
      >
        {steps.map((step, index) => (
          <li
            key={step.label}
            className={cn(
              "flex min-w-0 flex-1 items-stretch gap-2 sm:items-center",
            )}
          >
            <div
              className={cn(
                "flex min-h-[72px] w-full flex-col justify-center rounded-[8px] border-2 border-ink px-3 py-3  sm:min-h-0",
                compact && "min-h-0 px-2.5 py-2",
                step.emphasis
                  ? "bg-success text-white"
                  : "bg-cream text-ink",
              )}
            >
              <span
                className={cn(
                  "text-sm font-semibold tracking-tight",
                  step.emphasis ? "text-white" : "text-ink",
                )}
              >
                {step.label}
              </span>
              {step.detail ? (
                <span
                  className={cn(
                    "mt-0.5 font-sans text-[12px]",
                    step.emphasis ? "text-white/85" : "text-receipt-grey",
                  )}
                >
                  {step.detail}
                </span>
              ) : null}
            </div>
            {index < steps.length - 1 ? (
              <span
                className="hidden shrink-0 self-center text-receipt-grey sm:inline-flex"
                aria-hidden
              >
                <ArrowRight className="h-4 w-4" />
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
