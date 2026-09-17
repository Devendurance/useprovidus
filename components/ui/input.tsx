import { cn } from "@/lib/cn";
import type { InputHTMLAttributes, ReactNode } from "react";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
  suffix?: ReactNode;
  id: string;
};

export function Input({
  label,
  hint,
  error,
  suffix,
  id,
  className,
  ...props
}: InputProps) {
  return (
    <div className="flex w-full flex-col gap-1.5">
      {label ? (
        <label
          htmlFor={id}
          className="text-sm font-semibold tracking-tight text-ink"
        >
          {label}
        </label>
      ) : null}
      <div className="relative">
        <input
          id={id}
          className={cn(
            "h-11 w-full rounded-[8px] border-[1.5px] border-ink bg-cream px-4 text-base text-ink placeholder:text-ink/45 transition-[border-color,background-color] duration-100 focus:outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/30 disabled:cursor-not-allowed disabled:bg-sage-line/40 disabled:opacity-70",
            suffix && "pr-16",
            error && "border-error bg-error-surface/30 focus-visible:border-error focus-visible:ring-error/30",
            className,
          )}
          {...props}
        />
        {suffix ? (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-proof text-ink/65">
            {suffix}
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-ink/65">{hint}</p>
      ) : null}
    </div>
  );
}
