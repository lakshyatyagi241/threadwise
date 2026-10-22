'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { WizardScheduleMode } from '@crm/contracts';
import { Button, EmptyState, cn } from '@crm/ui';
import { statusTone } from '../../wizard/lib/broadcast';
import { Chip, ErrorBlock, Skeleton } from '../../wizard/components/parts';
import { typeTone } from '../lib';

/** The one create entry, the target of every "Create campaign" button. */
export const CREATE_PATH = '/campaigns/create';
/**
 * A history page: a title, optional filters, and a table region that takes the rest of the screen and scrolls on its own, so the page
 * itself does not scroll on a laptop.
 */
export function HistoryFrame({
  title,
  hint,
  filters,
  children,
  footer,
}: {
  title: string;
  hint: string;
  filters?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = useTranslations('campaigns.history');
  return (
    <div className="flex min-h-[28rem] flex-col gap-3 lg:h-[calc(100dvh-7.25rem)]">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={CREATE_PATH}
            className="inline-flex h-10 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground hover:opacity-90"
          >
            {t('create')}
          </Link>
        </div>
      </header>
      {filters}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background">
        {children}
      </div>
      {footer}
    </div>
  );
}

/** The table's scroll box: header row stays while the rows scroll. */
export function TableBox({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full min-w-[56rem] border-collapse text-sm">
        <caption className="sr-only">{label}</caption>
        {children}
      </table>
    </div>
  );
}

export const TH =
  'sticky top-0 z-10 whitespace-nowrap border-b border-border bg-muted px-3 py-2 text-start text-xs font-medium text-muted-foreground';
export const TD = 'px-3 py-2.5 align-middle';
export const NUM = 'tabular-nums text-end';

export function TypeBadge({ type }: { type: WizardScheduleMode }) {
  const t = useTranslations('campaigns.history.type');
  return (
    <Chip tone={typeTone(type)} className="whitespace-nowrap">
      {t(type)}
    </Chip>
  );
}

export function StatusChip({ status }: { status: string }) {
  const t = useTranslations('campaigns.wizard.status.state');
  const known = [
    'draft',
    'queued',
    'scheduled',
    'running',
    'paused',
    'completed',
    'failed',
    'cancelled',
    'active',
    'ended',
  ];
  return <Chip tone={statusTone(status)}>{known.includes(status) ? t(status) : status}</Chip>;
}

export function Pager({
  shown,
  page,
  hasPrev,
  hasNext,
  busy,
  onPrev,
  onNext,
}: {
  /** Rows on this page: the pager always says what is shown, even when there is only one page. */
  shown?: number;
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
  busy: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const t = useTranslations('campaigns.history');
  if (!hasPrev && !hasNext && !shown) return null;
  return (
    <nav
      aria-label={t('pager')}
      className="flex items-center justify-end gap-2 border-t border-border px-3 py-2"
    >
      {shown !== undefined && (
        <span className="me-auto text-xs text-muted-foreground">
          {t('showing', { count: shown })}
        </span>
      )}
      <span className="text-xs text-muted-foreground">{t('page', { page })}</span>
      <Button variant="secondary" size="sm" disabled={!hasPrev || busy} onClick={onPrev}>
        {t('previous')}
      </Button>
      <Button variant="secondary" size="sm" disabled={!hasNext || busy} onClick={onNext}>
        {t('next')}
      </Button>
    </nav>
  );
}

/** Loading, error or empty, or nothing (the table renders). */
export function Body({
  pending,
  error,
  onRetry,
  empty,
  children,
}: {
  pending: boolean;
  error: unknown;
  onRetry: () => void;
  /** Shown instead of the table when there are no rows. */
  empty: ReactNode | null;
  children: ReactNode;
}) {
  const t = useTranslations('campaigns.history');
  if (pending) {
    return (
      <div className="p-4">
        <Skeleton label={t('loading')} lines={6} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-4">
        <ErrorBlock error={error} onRetry={onRetry} />
      </div>
    );
  }
  if (empty) return <div className="p-4">{empty}</div>;
  return <>{children}</>;
}

export function EmptyList({
  filtered,
  none,
  onClear,
}: {
  filtered: boolean;
  none: string;
  onClear?: () => void;
}) {
  const t = useTranslations('campaigns.history');
  return filtered ? (
    <EmptyState
      title={t('noMatchTitle')}
      message={t('noMatch')}
      actions={
        onClear && (
          <Button variant="secondary" onClick={onClear}>
            {t('filters.clear')}
          </Button>
        )
      }
    />
  ) : (
    <EmptyState
      title={none}
      actions={
        <Link
          href={CREATE_PATH}
          className="inline-flex h-10 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground hover:opacity-90"
        >
          {t('create')}
        </Link>
      }
    />
  );
}

export const rowClass = (highlight: boolean) =>
  cn(
    'border-b border-border/60 transition-colors hover:bg-muted/50',
    highlight && 'bg-brand/10 ring-1 ring-inset ring-brand/40',
  );

export function NewChip() {
  const t = useTranslations('campaigns.history');
  return <Chip tone="brand">{t('new')}</Chip>;
}
