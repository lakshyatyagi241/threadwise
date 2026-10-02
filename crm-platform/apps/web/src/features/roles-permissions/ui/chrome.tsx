import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@crm/ui';
import { ChevronSmallIcon } from './icons';

export interface Crumb {
  label: string;
  href?: string;
}

/** Reference's header breadcrumb: `ADMIN > Roles > New`. The last crumb is the current page. */
export function Breadcrumb({ items, label }: { items: readonly Crumb[]; label: string }) {
  return (
    <nav aria-label={label}>
      <ol className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}-${item.label}`} className="flex min-w-0 items-center gap-2">
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className={cn(
                    'rounded hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary',
                    i === 0 && 'uppercase tracking-[0.16em]',
                  )}
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? 'page' : undefined}
                  className={cn(
                    'truncate',
                    last ? 'text-foreground' : i === 0 && 'uppercase tracking-[0.16em]',
                  )}
                >
                  {item.label}
                </span>
              )}
              {!last && <ChevronSmallIcon className="size-2.5 rtl:rotate-180" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Breadcrumb, mono eyebrow, a title with one accent word, a line of explanation, and the page's actions. */
export function RbacHeader({
  crumbs,
  crumbsLabel,
  eyebrow,
  lead,
  accent,
  description,
  actions,
  headingId,
}: {
  crumbs: readonly Crumb[];
  crumbsLabel: string;
  eyebrow: string;
  /** Plain part of the title; omit for a title that is only the accent (the role name). */
  lead?: string;
  accent: string;
  description?: ReactNode;
  actions?: ReactNode;
  headingId?: string;
}) {
  return (
    <div className="space-y-4">
      <Breadcrumb items={crumbs} label={crumbsLabel} />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-3xl space-y-1.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
          </p>
          <h1
            id={headingId}
            className="break-words text-2xl font-semibold tracking-tight sm:text-3xl lg:text-4xl"
          >
            {lead && `${lead} `}
            <span className="italic text-primary">{accent}</span>
          </h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 pb-1">{actions}</div>
        )}
      </header>
    </div>
  );
}

/** One KPI card: label, large number, one line of context. `warning` is Reference's amber card. */
export function Kpi({
  label,
  value,
  hint,
  tone = 'default',
  large = true,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'warning';
  /** The "Last added" card shows a name, so its number is smaller. */
  large?: boolean;
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-2xl border bg-background p-4 shadow-sm',
        tone === 'warning' ? 'border-warning/40' : 'border-border',
      )}
    >
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div
        data-testid="kpi-value"
        className={cn(
          'mt-1 truncate font-semibold leading-none tabular-nums',
          large ? 'text-3xl' : 'mt-2 text-xl',
          tone === 'warning' && 'text-warning',
        )}
      >
        {value}
      </div>
      <div className="mt-2 min-h-4 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

/** A numbered card heading ("01  Role details") of the editors. */
export function SectionBadge({ n, tone = 'default' }: { n: string; tone?: 'default' | 'danger' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-semibold',
        tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-muted text-primary',
      )}
    >
      {n}
    </span>
  );
}

const LINK_BUTTON = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'border border-border bg-background text-foreground hover:bg-muted',
} as const;

/** Class names that make a Next `<Link>` look like Reference's pill buttons in the page header. */
export const pillLink = (variant: keyof typeof LINK_BUTTON = 'secondary') =>
  cn(
    'inline-flex h-9 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    LINK_BUTTON[variant],
  );
