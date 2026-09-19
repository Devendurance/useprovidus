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
    "bg-provident-green text-white border-ledger-thick shadow-elevated hover:bg-deep-provision hover:translate-x-px hover:translate-y-px hover:shadow-[2px_2px_0_#18211F] active:translate-x-[3px] active:translate-y-[3px] active:shadow-press disabled:bg-receipt-grey disabled:text-white disabled:opacity-70 disabled:hover:translate-none disabled:hover:shadow-elevated disabled:active:translate-none",
  secondary:
    "bg-ledger-stone text-receipt-field border-ledger shadow-elevated hover:translate-x-px hover:translate-y-px hover:shadow-[2px_2px_0_#18211F] active:translate-x-[3px] active:translate-y-[3px] active:shadow-press disabled:opacity-50 disabled:hover:translate-none disabled:hover:shadow-elevated",
  tertiary:
    "bg-quote-blue text-white border-ledger shadow-elevated hover:translate-x-px hover:translate-y-px hover:shadow-[2px_2px_0_#18211F] active:translate-x-[3px] active:translate-y-[3px] active:shadow-press disabled:opacity-50",
  ghost:
    "bg-transparent text-ledger-stone border-ledger shadow-none hover:bg-ledger-edge/40 active:bg-ledger-edge/60 disabled:opacity-50",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-11 h-11 px-5 text-sm",
  md: "min-h-11 h-11 px-6 text-sm",
  lg: "min-h-[52px] h-[52px] px-7 text-base",
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
  const resolvedSize = variant === "primary" && size === "md" ? "lg" : size;

  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold tracking-tight transition-[transform,box-shadow,background-color] duration-100 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-provident-green disabled:cursor-not-allowed",
        variantClasses[variant],
        sizeClasses[resolvedSize],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
