import { cn } from "@/lib/cn";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "tertiary" | "ghost";
type ButtonSize = "md" | "sm" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  children: ReactNode;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border-[1.5px] border-ink bg-cream text-ink shadow-sticker hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-[5px_5px_0_var(--ink)] active:translate-x-[8px] active:translate-y-[8px] active:shadow-none disabled:bg-sage-line disabled:text-ink/60 disabled:shadow-none disabled:hover:translate-none disabled:active:translate-none",
  secondary:
    "border-[1.5px] border-ink bg-ink text-cream shadow-none hover:bg-ink/85 active:bg-ink disabled:opacity-50 disabled:hover:translate-none",
  tertiary:
    "border-[1.5px] border-ink bg-success text-white shadow-none hover:bg-deep-provision active:bg-deep-provision disabled:opacity-50",
  ghost:
    "border-[1.5px] border-ink bg-transparent text-ink shadow-none hover:bg-cream/70 active:bg-cream disabled:opacity-50",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-11 px-5 py-2 text-sm",
  md: "min-h-11 px-6 py-2 text-sm",
  lg: "min-h-[52px] px-7 py-3 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    fullWidth = false,
    className,
    type = "button",
    children,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[8px] font-semibold tracking-tight transition-[transform,box-shadow,background-color,color] duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transform-none motion-reduce:transition-none disabled:cursor-not-allowed",
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
});
