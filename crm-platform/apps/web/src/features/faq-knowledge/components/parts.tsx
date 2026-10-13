'use client';

import Link from 'next/link';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, cn } from '@crm/ui';
import type { ErrorKey } from '../lib/errors';
import { ArrowLeftIcon } from './icons';

/** The bordered surface of a toolbar or a table. */
export const CARD = 'rounded-xl border border-border bg-background';

/**
 * After a row (or a selection) is deleted, dismissed or taught, its button is gone, so focus would fall back to the page. Put it on
 * `preferred` (a search box or an input that is still there), else on the page title, once the dialog has finished closing.
 */
export function focusAfterRemoval(preferred = 'faq-search') {
  requestAnimationFrame(() =>
    setTimeout(() => {
      const target = document.getElementById(preferred) ?? document.getElementById('faq-title');
      target?.focus();
    }, 0),
  );
}

/** A value that follows `value` after it has stood still for `ms` (a request per keystroke would be wasteful). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function PageHeader({
  icon,
  title,
  subtitle,
  back,
  status,
  actions,
}: {
  icon: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  back?: { href: string; label: string };
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="flex min-w-0 items-center gap-3">
        {back && (
          <Link
            href={back.href}
            aria-label={back.label}
            title={back.label}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ArrowLeftIcon className="size-4 rtl:rotate-180" />
          </Link>
        )}
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1
              id="faq-title"
              tabIndex={-1}
              className="min-w-0 truncate text-xl font-bold tracking-tight outline-none"
            >
              {title}
            </h1>
            {status}
          </div>
          {subtitle && <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A link that looks like the UI kit's buttons (a navigation, so an anchor). */
export function LinkButton({
  href,
  variant = 'secondary',
  children,
  className,
}: {
  href: string;
  variant?: 'secondary' | 'brand';
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium outline-none transition',
        'focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        variant === 'brand'
          ? 'bg-brand text-brand-foreground hover:opacity-90'
          : 'border border-border bg-background text-foreground hover:bg-muted',
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function SectionCard({
  title,
  hint,
  aside,
  children,
  id,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  id: string;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn(CARD, 'overflow-hidden', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border bg-muted/40 px-4 py-3">
        <div className="min-w-0">
          <h2 id={id} className="text-sm font-semibold">
            {title}
          </h2>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {aside}
      </div>
      <div className="space-y-4 p-4">{children}</div>
    </section>
  );
}

/** `12 Mar 2026, 3:04 PM` in the viewer's language and the workspace time zone. */
export function useFormatDate() {
  const locale = useLocale();
  const timeZone = useTimeZone();
  return useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
        new Date(iso),
      ),
    [locale, timeZone],
  );
}

const STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 days ago" in the viewer's language; seconds read as "now". Pure so it is testable. */
export function relativeTime(iso: string, now: number, locale: string): string {
  const diff = Math.round((new Date(iso).getTime() - now) / 1000);
  const fmt = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, secs] of STEPS) {
    if (Math.abs(diff) >= secs) return fmt.format(Math.trunc(diff / secs), unit);
  }
  return fmt.format(0, 'second');
}

export function RelativeTime({ iso }: { iso: string }) {
  const locale = useLocale();
  const fmt = useFormatDate();
  const [now] = useState(() => Date.now());
  return (
    <time dateTime={iso} title={fmt(iso)} className="cursor-default whitespace-nowrap">
      {relativeTime(iso, now, locale)}
    </time>
  );
}

/** A failed load with the reason, the request id for support and a retry. */
export function LoadError({
  errorKey,
  error,
  onRetry,
}: {
  errorKey: ErrorKey;
  error?: unknown;
  onRetry?: () => void;
}) {
  const t = useTranslations('faq.common');
  const te = useTranslations('faq.errors');
  return (
    <Alert tone="danger" className="flex flex-wrap items-center justify-between gap-3">
      <span>{te(errorKey)}</span>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </Alert>
  );
}

/** Shown in place of a screen the person's role cannot open. */
export function NoAccess({ permission }: { permission: string }) {
  const t = useTranslations('faq.common');
  return (
    <Alert tone="warning">
      <p className="font-medium">{t('noAccessTitle')}</p>
      <p className="mt-1">{t('noAccess', { permission })}</p>
    </Alert>
  );
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn('space-y-3 p-4', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}

/**
 * The score track: a fill for the score and a marker for the bar it has to reach. The numbers are printed beside it, so the
 * position is never the only signal.
 */
export function ScoreBar({
  fillPct,
  markerPct,
  reached,
  label,
}: {
  fillPct: number;
  markerPct: number;
  reached: boolean;
  label: string;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className="relative h-3 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn(
          'absolute inset-y-0 start-0 rounded-full',
          reached ? 'bg-success' : 'bg-warning',
        )}
        style={{ width: `${fillPct}%` }}
      />
      <div
        className="absolute inset-y-0 w-0.5 bg-foreground"
        style={{ insetInlineStart: `${markerPct}%` }}
      />
    </div>
  );
}
