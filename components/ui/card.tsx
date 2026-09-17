import { cn } from "@/lib/cn";
import type { HTMLAttributes, ReactNode } from "react";

type CardVariant = "standard" | "surface" | "verdict" | "flat";

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant;
  children: ReactNode;
};

const variantClasses: Record<CardVariant, string> = {
  standard:
    "bg-cream border-[1.5px] border-ink rounded-[8px] p-6 shadow-none",
  surface: "bg-cream border-[1.5px] border-ink rounded-[8px] p-6 shadow-none",
  verdict:
    "bg-cream border-2 border-ink rounded-[8px] p-6 shadow-none",
  flat: "bg-cream border-[1.5px] border-ink rounded-[8px] p-6 shadow-none",
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
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "font-ui text-xl font-semibold tracking-tight text-ink sm:text-[1.25rem]",
        className,
      )}
      {...props}
    >
      {children}
    </h3>
  );
}

export function CardDescription({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("mt-2 text-ink/70 leading-relaxed", className)} {...props}>
      {children}
    </p>
  );
}
