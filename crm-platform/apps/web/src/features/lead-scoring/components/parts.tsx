'use client';

import Link from 'next/link';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useCallback, type ReactNode, type SVGProps } from 'react';
import { Alert, Button, cn } from '@crm/ui';
import type { ErrorKey } from '../lib/errors';

/** The bordered surface of a card or a table. */
export const CARD = 'rounded-xl border border-border bg-background';

/** A four-point sparkle: the mark of an AI-written value (always next to text, so it is decoration). */
export function SparkleIcon({ className, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className={cn('size-3 shrink-0', className)}
      {...rest}
    >
      <path d="M8 1c.4 3.1 1.9 4.6 5 5-3.1.4-4.6 1.9-5 5-.4-3.1-1.9-4.6-5-5 3.1-.4 4.6-1.9 5-5zM13 10c.2 1.5.9 2.2 2.4 2.4-1.5.2-2.2.9-2.4 2.4-.2-1.5-.9-2.2-2.4-2.4 1.5-.2 2.2-.9 2.4-2.4z" />
    </svg>
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

export function PageHeader({
  icon,
  title,
  subtitle,
  actions,
}: {
  icon: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h1 className="min-w-0 text-xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SectionCard({
  id,
  title,
  hint,
  aside,
  children,
}: {
  id: string;
  title: ReactNode;
  hint?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={cn(CARD, 'overflow-hidden')}>
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

/** A link that looks like the UI kit's secondary button (a navigation, so an anchor). */
export function LinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
    >
      {children}
    </Link>
  );
}

/** A failed call, said in words, and a retry when there is one. */
export function LoadError({
  errorKey,
  onRetry,
}: {
  errorKey: ErrorKey;
  /** Still passed by callers; the request id is no longer shown (#362). */
  error?: unknown;
  onRetry?: () => void;
}) {
  const t = useTranslations('lead-scoring.common');
  const te = useTranslations('lead-scoring.errors');
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
  const t = useTranslations('lead-scoring.common');
  return (
    <Alert tone="warning">
      <p className="font-medium">{t('noAccessTitle')}</p>
      <p className="mt-1">{t('noAccess', { permission })}</p>
    </Alert>
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="space-y-3 p-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}
