import { cn } from "@/lib/cn";
import type { HTMLAttributes, ReactNode } from "react";

type CardVariant = "standard" | "surface" | "verdict" | "flat";

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant;
  children: ReactNode;
};

const variantClasses: Record<CardVariant, string> = {
  standard:
    "bg-receipt-field border-ledger rounded-[14px] p-6 shadow-elevated",
  surface: "bg-clear-paper border-ledger rounded-[14px] p-6 shadow-elevated",
  verdict:
    "bg-clear-paper border-ledger-thick rounded-[14px] p-6 shadow-prominent",
  flat: "bg-clear-paper border border-ledger-edge rounded-[14px] p-6",
};

export function Card({
  variant = "standard",
  className,
  children,
  ...props
}: CardProps) {
  return (
    <div className={cn(variantClasses[variant], className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({
  className,
  children,
  as = "h2",
  ...props
}: HTMLAttributes<HTMLHeadingElement> & { as?: "h2" | "h3" }) {
  const Heading = as;
  return (
    <Heading
      className={cn(
        "font-display text-xl font-semibold tracking-tight text-ledger-stone sm:text-[1.25rem]",
        className,
      )}
      {...props}
    >
      {children}
    </Heading>
  );
}

export function CardDescription({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("mt-2 text-receipt-grey leading-relaxed", className)} {...props}>
      {children}
    </p>
  );
}
