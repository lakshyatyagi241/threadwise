'use client';

import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useCallback, type ReactNode } from 'react';
import { Alert, Button, cn } from '@crm/ui';
import type { ErrorKey } from '../lib/errors';

/** The bordered surface of a card or a table. */
export const CARD = 'rounded-xl border border-border bg-background';

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

/** A number in the viewer's language; a share (0 to 1) as a percentage. */
export function useFormatNumber() {
  const locale = useLocale();
  return {
    count: (n: number) => new Intl.NumberFormat(locale).format(n),
    percent: (share: number) =>
      new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(share),
    decimal: (n: number, digits = 2) =>
      new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n),
  };
}

/** `9 AM` / `21:00` in the viewer's language for an hour of the day (0 to 23). */
export function useFormatHour() {
  const locale = useLocale();
  return useCallback(
    (hour: number) =>
      new Intl.DateTimeFormat(locale, { hour: 'numeric', timeZone: 'UTC' }).format(
        new Date(Date.UTC(2026, 0, 1, hour)),
      ),
    [locale],
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

/** A failed call, said in words, with the request id for support and a retry when there is one. */
export function LoadError({
  errorKey,
  error,
  onRetry,
}: {
  errorKey: ErrorKey;
  error?: unknown;
  onRetry?: () => void;
}) {
  const t = useTranslations('growth.common');
  const te = useTranslations('growth.errors');
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
  const t = useTranslations('growth.common');
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

/** An empty list, said once, in place of a table with no rows. */
export function Nothing({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}
