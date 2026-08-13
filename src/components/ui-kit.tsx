import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "success" | "warning" | "destructive" | "primary";
  icon?: ReactNode;
}) {
  const toneClass = {
    default: "text-foreground",
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
  }[tone];

  return (
    <div className="surface-card min-w-0 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
      </div>
      <p className={cn("mt-2 truncate text-xl font-semibold tabular-nums sm:text-2xl", toneClass)}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}


export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("surface-card min-w-0 p-4 sm:p-5", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}


export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
