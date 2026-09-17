import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

type ButtonVariant = "primary" | "secondary" | "tertiary" | "ghost";
type ButtonSize = "md" | "sm" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border-[1.5px] border-ink bg-cream text-ink shadow-sticker hover:bg-cream hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[4px_4px_0_var(--ink)] active:translate-x-[7px] active:translate-y-[7px] active:shadow-none disabled:cursor-not-allowed disabled:bg-sage-line disabled:text-ink/60 disabled:shadow-none disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:active:translate-x-0 disabled:active:translate-y-0",
  secondary:
    "border-[1.5px] border-ink bg-cream text-ink shadow-none hover:bg-ink hover:text-cream active:bg-ink active:text-cream disabled:cursor-not-allowed disabled:opacity-50",
  tertiary:
    "border-[1.5px] border-ink bg-success text-white shadow-none hover:bg-deep-provision active:bg-deep-provision disabled:cursor-not-allowed disabled:opacity-50",
  ghost:
    "border-[1.5px] border-ink bg-transparent text-ink shadow-none hover:bg-cream/70 active:bg-cream disabled:cursor-not-allowed disabled:opacity-50",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-11 h-11 px-5 text-sm",
  md: "min-h-11 h-11 px-6 text-sm",
  lg: "min-h-[52px] h-[52px] px-7 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
  type = "button",
  children,
  ref,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[8px] font-semibold tracking-tight transition-[transform,box-shadow,background-color,color] duration-100 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed",
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
