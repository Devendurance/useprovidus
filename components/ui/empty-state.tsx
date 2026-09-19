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
          className="flex h-12 w-12 items-center justify-center rounded-[8px] border-[1.5px] border-ink bg-sage text-success"
          aria-hidden
        >
          {icon}
        </div>
      ) : null}
      <div className="space-y-2">
        <h2 className="font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">
          {title}
        </h2>
        <p className="max-w-md leading-relaxed text-ink/70">{description}</p>
      </div>
      {action ? <div className="mt-1 flex flex-wrap gap-3">{action}</div> : null}
    </Card>
  );
}
