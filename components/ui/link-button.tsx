import Link from "next/link";
import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

type LinkButtonVariant = "primary" | "secondary" | "ghost";
type LinkButtonSize = "md" | "sm" | "lg";

type LinkButtonProps = {
  href: string;
  children: ReactNode;
  variant?: LinkButtonVariant;
  size?: LinkButtonSize;
  fullWidth?: boolean;
  className?: string;
};

const variantClasses: Record<LinkButtonVariant, string> = {
  primary:
    "border-[1.5px] border-ink bg-cream text-ink shadow-sticker hover:bg-cream hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[4px_4px_0_var(--ink)] active:translate-x-[7px] active:translate-y-[7px] active:shadow-none",
  secondary:
    "border-[1.5px] border-ink bg-cream text-ink shadow-none hover:bg-ink hover:text-cream active:bg-ink active:text-cream",
  ghost:
    "border-[1.5px] border-ink bg-transparent text-ink shadow-none hover:bg-cream/70 active:bg-cream",
};

const sizeClasses: Record<LinkButtonSize, string> = {
  sm: "min-h-11 h-11 px-5 text-sm",
  md: "min-h-11 h-11 px-6 text-sm",
  lg: "min-h-[52px] h-[52px] px-7 text-base",
};

export function LinkButton({
  href,
  children,
  variant = "primary",
  size = "lg",
  fullWidth = false,
  className,
}: LinkButtonProps) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[8px] border font-semibold tracking-tight transition-[transform,box-shadow,background-color,color] duration-100 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && "w-full",
        className,
      )}
    >
      {children}
    </Link>
  );
}
