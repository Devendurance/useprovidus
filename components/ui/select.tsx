import { cn } from "@/lib/cn";
import type { SelectHTMLAttributes } from "react";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  hint?: string;
  error?: string;
  options: SelectOption[];
  id: string;
  placeholder?: string;
};

export function Select({
  label,
  hint,
  error,
  options,
  id,
  placeholder,
  className,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...props
}: SelectProps) {
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
        <select
          id={id}
          className={cn(
            "min-h-12 w-full appearance-none rounded-[8px] border-[1.5px] border-ink bg-cream px-4 py-3 pr-10 text-base text-ink transition-[border-color,box-shadow,background-color] duration-150 focus:outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/30 disabled:cursor-not-allowed disabled:bg-sage-line/40 disabled:opacity-70",
            error && "border-error bg-error-surface/30 focus-visible:border-error focus-visible:ring-error/30",
            className,
          )}
          aria-describedby={describedBy || undefined}
          aria-invalid={error ? true : ariaInvalid}
          {...props}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-ink/65"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
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
