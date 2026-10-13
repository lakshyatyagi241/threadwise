'use client';

import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, cn } from '@crm/ui';
import { pageRange, pageWindow } from '../../lib/billing-format';

const NS = 'platform-payment-gateways.billing.common';

/** Admin > page, the small trail above every billing screen (Reference's top bar). */
export function Crumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  const t = useTranslations(NS);
  return (
    <nav
      aria-label={t('breadcrumb')}
      className="flex items-center gap-2 font-mono text-xs text-muted-foreground"
    >
      <Link href="/admin" className="uppercase tracking-[0.16em] hover:text-foreground">
        {t('admin')}
      </Link>
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-2">
          <span aria-hidden>›</span>
          {i.href ? (
            <Link href={i.href} className="hover:text-foreground">
              {i.label}
            </Link>
          ) : (
            <span className="text-foreground" aria-current="page">
              {i.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** "Order <em>history</em>": Reference's two-tone page title. */
export function TwoToneTitle({ first, second }: { first: string; second: string }) {
  return (
    <>
      {first} <em className="font-semibold italic text-primary">{second}</em>
    </>
  );
}

type Tone = 'default' | 'accent' | 'warning' | 'danger';
const TILE_BORDER: Record<Tone, string> = {
  default: 'border-border',
  accent: 'border-primary/40',
  warning: 'border-warning/40',
  danger: 'border-danger/40',
};
const HINT_TONE: Record<Tone | 'positive' | 'negative' | 'muted', string> = {
  default: 'text-muted-foreground',
  muted: 'text-muted-foreground',
  accent: 'text-primary',
  warning: 'text-warning',
  danger: 'text-danger',
  positive: 'text-success',
  negative: 'text-danger',
};

/** One KPI card: label, big number, one coloured line (Reference's five-card strip). */
export function Kpi({
  label,
  value,
  hint,
  hintTone = 'muted',
  tone = 'default',
  valueTone,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  hintTone?: keyof typeof HINT_TONE;
  tone?: Tone;
  valueTone?: 'danger';
}) {
  return (
    <div className={cn('rounded-lg border bg-background p-4', TILE_BORDER[tone])}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-1 text-3xl font-semibold leading-none tabular-nums',
          valueTone === 'danger' && 'text-danger',
        )}
      >
        {value}
      </div>
      {hint !== undefined && <div className={cn('mt-2 text-xs', HINT_TONE[hintTone])}>{hint}</div>}
    </div>
  );
}

export function KpiStrip({ children, columns = 5 }: { children: ReactNode; columns?: 5 | 6 }) {
  return (
    <section
      className={cn(
        'grid grid-cols-2 gap-3 sm:grid-cols-3',
        columns === 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-6',
      )}
    >
      {children}
    </section>
  );
}

/** A delta chip (+12.3%) in the success or danger colour. */
export function DeltaChip({ pct }: { pct: number }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px]',
        pct >= 0 ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger',
      )}
    >
      {pct >= 0 ? '+' : ''}
      {pct}%
    </span>
  );
}

const isDay = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const MAX_CUSTOM_DAYS = 365 * 5;

/** True when `custom` has two real days, from not after to, within five years: the same rule the API enforces. */
export function customRangeValid(from: string, to: string): boolean {
  if (!isDay(from) || !isDay(to) || from > to) return false;
  return (
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 <=
    MAX_CUSTOM_DAYS
  );
}

/** The URL patch for picking a window: `custom` starts on the last 30 days, anything else clears the two days. */
export function windowPatch(value: string): { window: string; from: string; to: string } {
  if (value !== 'custom') return { window: value, from: '', to: '' };
  const day = (back: number) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
  return { window: value, from: day(29), to: day(0) };
}

/** The two day pickers shown beside the window select while `custom` is chosen. */
export function CustomRange({
  from,
  to,
  onChange,
  fromLabel,
  toLabel,
  invalidLabel,
}: {
  from: string;
  to: string;
  onChange: (patch: { from?: string; to?: string }) => void;
  fromLabel: string;
  toLabel: string;
  invalidLabel: string;
}) {
  const bad = !customRangeValid(from, to);
  const cls =
    'h-9 rounded-full border bg-background px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary';
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid="custom-range">
      <input
        type="date"
        aria-label={fromLabel}
        value={from}
        max={to || undefined}
        onChange={(e) => onChange({ from: e.target.value })}
        className={`${cls} ${bad ? 'border-danger' : 'border-border'}`}
      />
      <span aria-hidden className="text-xs text-muted-foreground">
        {'–'}
      </span>
      <input
        type="date"
        aria-label={toLabel}
        value={to}
        min={from || undefined}
        onChange={(e) => onChange({ to: e.target.value })}
        className={`${cls} ${bad ? 'border-danger' : 'border-border'}`}
      />
      {bad && (
        <span role="alert" className="text-xs text-danger">
          {invalidLabel}
        </span>
      )}
    </span>
  );
}

/** The round select in the page header (window, auto-submitting). */
export function WindowSelect({
  value,
  options,
  label,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  label: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-full border border-border bg-background px-4 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** The rounded filter row: pills on the left, extras and the search on the right. */
export function FilterBar({
  pills,
  active,
  onPick,
  label,
  children,
  search,
}: {
  pills: Array<{ id: string; label: string; count?: number }>;
  active: string;
  onPick: (id: string) => void;
  label: string;
  children?: ReactNode;
  search: { value: string; placeholder: string; onSubmit: (v: string) => void };
}) {
  const [draft, setDraft] = useState(search.value);
  const [seen, setSeen] = useState(search.value);
  // Follow the address when the filter is changed from outside (back button, a link).
  if (seen !== search.value) {
    setSeen(search.value);
    setDraft(search.value);
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    search.onSubmit(draft.trim());
  };
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-background p-2">
      <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
        {pills.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={active === p.id}
            onClick={() => onPick(p.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm transition',
              active === p.id
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {p.label}
            {p.count !== undefined && (
              <span className="font-mono text-[11px] opacity-80">({p.count})</span>
            )}
          </button>
        ))}
      </div>
      <div className="flex-1" />
      {children}
      <form onSubmit={submit} role="search">
        <Input
          type="search"
          aria-label={search.placeholder}
          placeholder={search.placeholder}
          value={draft}
          maxLength={120}
          onChange={(e) => setDraft(e.target.value)}
          className="h-8 w-72 max-w-full rounded-full text-xs"
        />
      </form>
    </div>
  );
}

/** The table card with its footer: "Showing 1-12 of 30 orders" and the pager. */
export function TableCard({
  children,
  footer,
  minWidth = 1000,
}: {
  children: ReactNode;
  footer: ReactNode;
  minWidth?: number;
}) {
  return (
    <div className="rounded-xl border border-border bg-background">
      <div className="thin-scrollbar overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth }}>
          {children}
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t border-border bg-muted/40 px-4 py-3">
        {footer}
      </div>
    </div>
  );
}

export const Th = ({
  children,
  align = 'left',
  className,
}: {
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) => (
  <th
    scope="col"
    className={cn(
      'px-3 py-2.5 text-xs font-medium text-muted-foreground first:ps-4',
      align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
      className,
    )}
  >
    {children}
  </th>
);

/** "Showing 1-12 of 30 orders" plus the pager. */
export function PagerFooter({
  page,
  pageSize,
  total,
  noun,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  noun: string;
  onPage: (p: number) => void;
}) {
  const t = useTranslations(NS);
  const { from, to } = pageRange(page, pageSize, total);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <>
      <div className="font-mono text-[11px] text-muted-foreground">
        {t('showing', { from, to, total: new Intl.NumberFormat().format(total), noun })}
      </div>
      {pages > 1 && (
        <nav aria-label={t('pager')} className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            {t('previous')}
          </Button>
          {pageWindow(page, pages).map((p, i) =>
            p === 'gap' ? (
              <span key={`gap${i}`} className="px-1 text-muted-foreground" aria-hidden>
                …
              </span>
            ) : (
              <Button
                key={p}
                size="sm"
                variant={p === page ? 'primary' : 'secondary'}
                aria-current={p === page ? 'page' : undefined}
                onClick={() => onPage(p)}
              >
                {p}
              </Button>
            ),
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= pages}
            onClick={() => onPage(page + 1)}
          >
            {t('next')}
          </Button>
        </nav>
      )}
    </>
  );
}

/** A coloured dot and the status word (Reference's status pill). */
export function StatusPill({
  status,
  label,
}: {
  status: 'paid' | 'pending' | 'awaiting_approval' | 'failed' | 'cancelled' | 'refunded';
  label: string;
}) {
  const tone =
    status === 'paid'
      ? 'border-success/40 bg-success/15 text-success'
      : status === 'failed' || status === 'cancelled'
        ? 'border-danger/40 bg-danger/10 text-danger'
        : status === 'refunded'
          ? 'border-border bg-muted text-muted-foreground'
          : 'border-warning/40 bg-warning/10 text-warning';
  const dot =
    status === 'paid'
      ? 'bg-success'
      : status === 'failed' || status === 'cancelled'
        ? 'bg-danger'
        : status === 'refunded'
          ? 'bg-muted-foreground'
          : 'bg-warning';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px]',
        tone,
      )}
    >
      <span className={cn('size-1.5 rounded-full', dot)} aria-hidden />
      {label}
    </span>
  );
}

/** Row tint for failed and refunded rows. */
export const rowTone = (status: string): string =>
  status === 'failed' || status === 'cancelled'
    ? 'bg-warning/5'
    : status === 'refunded'
      ? 'bg-muted/40'
      : '';

/** The workspace link icon (opens the workspace's plan screen). */
export function WorkspaceLink({ slug, label }: { slug: string; label: string }) {
  return (
    <Link
      href={`/admin/workspaces?q=${encodeURIComponent(slug)}`}
      title={label}
      aria-label={label}
      className="inline-flex size-7 items-center justify-center rounded-full border border-border text-primary hover:border-primary hover:bg-primary/10"
    >
      <svg
        viewBox="0 0 16 16"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      >
        <path d="M6 3H3v10h10v-3M9 3h4v4M13 3L7 9" />
      </svg>
    </Link>
  );
}

export function ExportButton({
  busy,
  onClick,
  children,
}: {
  busy: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="secondary"
      size="sm"
      className="rounded-full"
      onClick={onClick}
      disabled={busy}
    >
      <svg
        viewBox="0 0 16 16"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M8 2v8M5 7l3 3 3-3M3 12v2h10v-2" />
      </svg>
      {children}
    </Button>
  );
}

export function LinkPill({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-background px-4 text-xs font-medium hover:bg-muted"
    >
      {children}
    </Link>
  );
}

export const TrendIcon = () => (
  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M2 12h12M4 10l2.2-3 3 2 3.2-5" />
  </svg>
);

/** Reference's page head: eyebrow, two-tone title and a line of explanation on the left, the page actions on the right of the same row. */
export function BillingHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: ReactNode;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-2xl space-y-1.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 pb-1">{actions}</div>}
    </header>
  );
}
