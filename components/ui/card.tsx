import { cn } from "@/lib/cn";
import type { HTMLAttributes, ReactNode } from "react";

type CardVariant = "standard" | "surface" | "verdict" | "flat";

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant;
  children: ReactNode;
};

const variantClasses: Record<CardVariant, string> = {
  standard:
    "rounded-[8px] border-[1.5px] border-ink bg-cream p-6 shadow-none",
  surface: "rounded-[8px] border-[1.5px] border-ink bg-cream p-6 shadow-none",
  verdict:
    "rounded-[8px] border-2 border-ink bg-cream p-6 shadow-none",
  flat: "rounded-[8px] border-[1.5px] border-ink bg-cream p-6 shadow-none",
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
        "font-display text-xl font-semibold tracking-tight text-ink sm:text-[1.25rem]",
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
    <p className={cn("mt-2 leading-relaxed text-ink/70", className)} {...props}>
      {children}
    </p>
  );
}
