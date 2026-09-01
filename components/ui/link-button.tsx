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
    "bg-provident-green text-white border-ledger-thick shadow-elevated hover:bg-deep-provision hover:translate-x-px hover:translate-y-px hover:shadow-[2px_2px_0_#18211F] active:translate-x-[3px] active:translate-y-[3px] active:shadow-press",
  secondary:
    "bg-ledger-stone text-receipt-field border-ledger shadow-elevated hover:translate-x-px hover:translate-y-px hover:shadow-[2px_2px_0_#18211F]",
  ghost:
    "bg-clear-paper text-ledger-stone border-ledger shadow-base hover:bg-ledger-edge/40",
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
        "inline-flex items-center justify-center gap-2 rounded-[10px] border font-semibold tracking-tight transition-[transform,box-shadow,background-color] duration-100 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green",
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
