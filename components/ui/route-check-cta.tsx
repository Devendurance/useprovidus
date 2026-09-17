import Link from "next/link";
import { cn } from "@/lib/cn";

export type RouteCheckCTAEmphasis = "sticker" | "flat";

type RouteCheckCTAProps = {
  emphasis?: RouteCheckCTAEmphasis;
  className?: string;
};

/**
 * The shared Route Check action. Its destination and label stay fixed so the
 * action reads consistently wherever a user is invited to start a check.
 */
export function RouteCheckCTA({
  emphasis = "sticker",
  className,
}: RouteCheckCTAProps) {
  return (
    <Link
      href="/check"
      className={cn(
        "inline-flex h-11 min-h-11 items-center justify-center rounded-[2px] border-[1.5px] border-ink bg-cream px-4 text-[13px] font-semibold leading-none text-ink transition-[transform,box-shadow,background-color] duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus lg:h-[52px] lg:min-h-[52px] lg:px-6 lg:text-[15px] motion-reduce:transform-none motion-reduce:transition-none",
        emphasis === "sticker"
          ? "shadow-[8px_8px_0_var(--ink)] hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[5px_5px_0_var(--ink)] active:translate-x-[8px] active:translate-y-[8px] active:shadow-none"
          : "shadow-none hover:bg-cream/80 active:bg-cream",
        className,
      )}
    >
      Check my route
    </Link>
  );
}
