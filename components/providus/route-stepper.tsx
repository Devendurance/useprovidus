import { cn } from "@/lib/cn";
import { Check } from "lucide-react";

export type RouteStep = {
  id: string;
  label: string;
  href?: string;
};

const DEFAULT_STEPS: RouteStep[] = [
  { id: "inputs", label: "Inputs", href: "/check" },
  { id: "preview", label: "Preview", href: "/check/preview" },
  { id: "verdict", label: "Verdict", href: "/check/verdict" },
  { id: "receipt", label: "Receipt", href: "/receipt" },
];

type RouteStepperProps = {
  current: "inputs" | "preview" | "verdict" | "receipt";
  className?: string;
  steps?: RouteStep[];
};

const ORDER = ["inputs", "preview", "verdict", "receipt"] as const;

export function RouteStepper({
  current,
  className,
  steps = DEFAULT_STEPS,
}: RouteStepperProps) {
  const currentIndex = ORDER.indexOf(current);

  return (
    <nav
      aria-label="Route Check progress"
      className={cn("w-full", className)}
    >
      <ol className="flex flex-wrap items-center gap-2 sm:gap-3">
        {steps.map((step, index) => {
          const done = index < currentIndex;
          const active = index === currentIndex;

          return (
            <li key={step.id} className="flex items-center gap-2 sm:gap-3">
              <div
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold tracking-tight",
                  active &&
                    "border-ledger bg-ledger-stone text-receipt-field shadow-base",
                  done &&
                    "border-provident-green bg-provident-green/10 text-deep-provision",
                  !active &&
                    !done &&
                    "border-ledger-edge bg-clear-paper text-receipt-grey",
                )}
                aria-current={active ? "step" : undefined}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold",
                    active && "bg-receipt-field text-ledger-stone",
                    done && "bg-provident-green text-white",
                    !active && !done && "bg-ledger-edge text-receipt-grey",
                  )}
                  aria-hidden
                >
                  {done ? <Check className="h-3 w-3" /> : index + 1}
                </span>
                {step.label}
              </div>
              {index < steps.length - 1 ? (
                <span
                  className="hidden h-px w-4 bg-ledger-edge sm:block sm:w-6"
                  aria-hidden
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
