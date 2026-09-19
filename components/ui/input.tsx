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
          className="text-sm font-semibold tracking-tight text-ledger-stone"
        >
          {label}
        </label>
      ) : null}
      <div className="relative">
        <input
          id={id}
          className={cn(
            "min-h-12 w-full rounded-[10px] border-ledger bg-clear-paper px-4 py-3 text-base text-ledger-stone placeholder:text-receipt-grey/80 shadow-base transition-[box-shadow,transform] duration-100 focus:outline-none focus:shadow-elevated focus:translate-x-px focus:translate-y-px disabled:cursor-not-allowed disabled:bg-ledger-edge/40 disabled:opacity-70",
            suffix && "pr-16",
            error && "border-loss-red",
            className,
          )}
          aria-describedby={describedBy || undefined}
          aria-invalid={error ? true : ariaInvalid}
          {...props}
        />
        {suffix ? (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-proof text-receipt-grey">
            {suffix}
          </span>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} className="text-sm text-loss-red" role="alert">
          {error}
        </p>
      ) : null}
      {hint ? <p id={hintId} className="text-sm text-receipt-grey">{hint}</p> : null}
    </div>
  );
}
