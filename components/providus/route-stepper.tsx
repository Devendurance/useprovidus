import { cn } from "@/lib/cn";

export type RouteStep = {
  id: string;
  label: string;
  href?: string;
};

const DEFAULT_STEPS: RouteStep[] = [
  { id: "inputs", label: "Details", href: "/check" },
  { id: "preview", label: "Review", href: "/check/preview" },
  { id: "verdict", label: "Approve", href: "/check/verdict" },
  { id: "receipt", label: "Receipt", href: "/receipt" },
];

type RouteStepperProps = {
  current: "inputs" | "preview" | "verdict" | "receipt";
  className?: string;
  steps?: RouteStep[];
};

export function RouteStepper({
  current,
  className,
  steps = DEFAULT_STEPS,
}: RouteStepperProps) {
  return (
    <nav
      aria-label="Cash-out progress"
      className={cn("w-full", className)}
    >
      <ol className="flex flex-wrap items-center gap-2 sm:gap-3">
        {steps.map((step, index) => {
          // This shell has no durable transaction state, so earlier steps
          // must not be rendered as completed merely because the URL changed.
          const active = step.id === current;

          return (
            <li key={step.id} className="flex items-center gap-2 sm:gap-3">
              <div
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold tracking-tight",
                  active &&
                    "border-ledger bg-ledger-stone text-receipt-field shadow-base",
                  !active &&
                    "border-ledger-edge bg-clear-paper text-receipt-grey",
                )}
                aria-current={active ? "step" : undefined}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold",
                    active && "bg-receipt-field text-ledger-stone",
                    !active && "bg-ledger-edge text-receipt-grey",
                  )}
                  aria-hidden
                >
                  {index + 1}
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
