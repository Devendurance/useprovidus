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
      aria-label="Payment progress"
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
                  "inline-flex min-h-11 items-center gap-2 rounded-[8px] border-[1.5px] px-3 py-1.5 text-xs font-semibold tracking-tight",
                  active &&
                    "border-ink bg-ink text-cream shadow-none",
                  !active &&
                    "border-ink bg-cream text-ink/70",
                )}
                aria-current={active ? "step" : undefined}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold",
                    active && "bg-cream text-ink",
                    !active && "bg-sage-line text-ink/70",
                  )}
                  aria-hidden
                >
                  {index + 1}
                </span>
                {step.label}
              </div>
              {index < steps.length - 1 ? (
                <span
                  className="hidden h-px w-4 bg-ink/25 sm:block sm:w-6"
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
