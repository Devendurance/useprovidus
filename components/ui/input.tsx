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
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...props
}: InputProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [ariaDescribedBy, hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");
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
            "min-h-12 w-full rounded-[8px] border-[1.5px] border-ink bg-cream px-4 py-3 text-base text-ink placeholder:text-ink/45 transition-[border-color,box-shadow,background-color] duration-150 focus:outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/30 disabled:cursor-not-allowed disabled:bg-sage-line/40 disabled:opacity-70",
            suffix && "pr-16",
            error && "border-error bg-error-surface/30 focus-visible:border-error focus-visible:ring-error/30",
            className,
          )}
          aria-describedby={describedBy || undefined}
          aria-invalid={error ? true : ariaInvalid}
          {...props}
        />
        {suffix ? (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-proof text-ink/65">
            {suffix}
          </span>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} className="text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
      {hint ? <p id={hintId} className="text-sm text-ink/65">{hint}</p> : null}
    </div>
  );
}
