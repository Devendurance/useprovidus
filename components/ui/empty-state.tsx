import { cn } from "@/lib/cn";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

export type EmptyStateProps = {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  variant?: "standard" | "surface" | "flat";
};

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
  variant = "surface",
}: EmptyStateProps) {
  return (
    <Card
      variant={variant}
      className={cn(
        "flex flex-col items-start gap-4 text-left sm:items-center sm:text-center",
        className,
      )}
    >
      {icon ? (
        <div
          className="flex h-12 w-12 items-center justify-center rounded-[10px] border-ledger bg-receipt-field text-provident-green shadow-base"
          aria-hidden
        >
          {icon}
        </div>
      ) : null}
      <div className="space-y-2">
        <h2 className="font-display text-xl font-semibold tracking-tight text-ledger-stone sm:text-2xl">
          {title}
        </h2>
        <p className="max-w-md text-receipt-grey leading-relaxed">{description}</p>
      </div>
      {action ? <div className="mt-1 flex flex-wrap gap-3">{action}</div> : null}
    </Card>
  );
}
