'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import type { BroadcastListItem, BroadcastSummary } from '@crm/contracts';
import { STATUS_VIEWS } from '../lib/list-model';
import { ArrowRightIcon } from '@/features/broadcasts/components/icons';

const DOT: Record<(typeof STATUS_VIEWS)[number], string> = {
  all: 'bg-success',
  scheduled: 'bg-warning',
  processing: 'bg-primary',
  completed: 'bg-brand',
  failed: 'bg-danger',
};

/** Left rail of the earlier broadcasts view: the tip, the five status views with their counts, the recent five, and the "create" card. */
export function ListRail({
  status,
  counts,
  recent,
  canCreate,
  onStatus,
}: {
  status: string;
  counts: BroadcastSummary['statusCounts'] | undefined;
  recent: BroadcastListItem[];
  canCreate: boolean;
  onStatus: (status: string) => void;
}) {
  const t = useTranslations('broadcasts.list');
  const kicker =
    'px-3 pb-1.5 pt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground';
  return (
    <aside aria-label={t('railLabel')} className="space-y-3 self-start lg:sticky lg:top-6">
      <div className="rounded-2xl border border-border bg-muted/60 p-3 text-xs leading-relaxed">
        <div className="mb-1 flex items-center gap-1.5 font-semibold">
          <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
          {t('tip')}
        </div>
        {t('tipBody')}
      </div>

      <nav
        aria-label={t('views')}
        className="rounded-xl border border-border bg-background p-2 shadow-sm"
      >
        <div className={kicker}>{t('views')}</div>
        {STATUS_VIEWS.map((key) => {
          const active = status === key;
          return (
            <button
              key={key}
              type="button"
              aria-current={active ? 'true' : undefined}
              onClick={() => onStatus(key)}
              className={cn(
                'flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-medium',
                active ? 'bg-brand text-brand-foreground' : 'hover:bg-muted',
              )}
            >
              <span className="flex items-center gap-2">
                <span className={cn('size-2 rounded-full', DOT[key])} aria-hidden="true" />
                {t(`view.${key}`)}
              </span>
              <span
                className={cn('font-mono text-xs tabular-nums', !active && 'text-muted-foreground')}
              >
                {(counts?.[key] ?? 0).toLocaleString()}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="rounded-xl border border-border bg-background p-2 shadow-sm">
        <div className={kicker}>{t('recent')}</div>
        {recent.length === 0 ? (
          <div className="m-1 rounded-xl border border-dashed border-border px-3 py-5 text-center">
            <div className="text-xl">{t('noData')}</div>
            <p className="mt-1 text-xs text-muted-foreground">{t('recentEmpty')}</p>
            {canCreate && (
              <Link
                href="/campaigns/create"
                className="mt-3 inline-flex h-9 items-center rounded-full bg-brand px-4 text-xs font-semibold text-brand-foreground hover:opacity-90"
              >
                {t('createBroadcast')}
              </Link>
            )}
          </div>
        ) : (
          recent.map((b) => (
            <Link
              key={b.id}
              href={`/campaigns/earlier/${b.id}`}
              className="flex items-center justify-between rounded-xl px-3 py-2 text-sm hover:bg-muted"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-[7px] shrink-0 rounded-full bg-brand" aria-hidden="true" />
                <span className="truncate">{b.name}</span>
              </span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {b.deliveredCount.toLocaleString()}
              </span>
            </Link>
          ))
        )}
      </div>

      {canCreate && (
        <div className="rounded-xl bg-brand p-4 text-brand-foreground shadow-sm">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">
            {t('getStarted')}
          </div>
          <div className="text-2xl leading-tight">{t('createBroadcast')}</div>
          <p className="mt-2 text-xs leading-relaxed opacity-80">{t('getStartedBody')}</p>
          <Link
            href="/campaigns/create"
            className="mt-3 inline-flex items-center gap-2 rounded-full bg-background px-3.5 py-1.5 text-xs font-semibold text-brand"
          >
            {t('newBroadcast')}
            <ArrowRightIcon className="size-3.5" />
          </Link>
        </div>
      )}
    </aside>
  );
}
