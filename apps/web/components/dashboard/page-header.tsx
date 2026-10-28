import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Every document-style page opens the same way: an optional eyebrow naming
 * the section, the title, one line of context, and the page's primary action
 * on the trailing side. Consistency here is what makes eleven pages read as
 * one product.
 */
export function PageHeader({
  title,
  description,
  action,
  eyebrow,
  icon: Icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Small label above the title, e.g. the nav group the page belongs to. */
  eyebrow?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 items-start gap-3.5">
        {Icon && (
          <span className="mt-0.5 hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15 sm:flex">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
          <h1 className="text-[26px] font-bold leading-tight tracking-tight">{title}</h1>
          {description && (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}
