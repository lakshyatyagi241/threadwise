'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import type { CampaignListResponse, CampaignTypeFilter } from '@crm/contracts';
import { STATUS_VIEWS, type StatusView } from '../lib/list-model';

const DOT: Record<StatusView, string> = {
  all: 'bg-success',
  recently_created: 'bg-brand',
  recently_updated: 'bg-brand',
  scheduled: 'bg-[#13478A]',
  running: 'bg-success',
  completed: 'bg-foreground',
  failed: 'bg-danger',
};
const COUNT_KEY: Record<StatusView, keyof CampaignListResponse['statusCounts']> = {
  all: 'all',
  recently_created: 'recentlyCreated',
  recently_updated: 'recentlyUpdated',
  scheduled: 'scheduled',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
};
const TYPES: CampaignTypeFilter[] = ['all', 'text', 'template', 'flow'];

/** Left rail of `/campaigns`: the status views and the message types with their counts, the delivery and queue health cards. */
export function CampaignsRail({
  list,
  status,
  type,
  canCreate,
  onStatus,
  onType,
}: {
  list: CampaignListResponse | undefined;
  status: StatusView;
  type: CampaignTypeFilter;
  canCreate: boolean;
  onStatus: (s: StatusView) => void;
  onType: (t: CampaignTypeFilter) => void;
}) {
  const t = useTranslations('campaigns.list.rail');
  const kicker =
    'px-3 pb-1.5 pt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground';
  const row = (active: boolean) =>
    cn(
      'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-start text-[12.5px] transition hover:bg-muted',
      active && 'bg-muted font-semibold',
    );
  const health = list?.deliveryHealth;
  const queue = list?.queueHealth;

  return (
    <aside className="space-y-3 self-start lg:sticky lg:top-6">
      <nav
        aria-label={t('status')}
        className="rounded-xl border border-border bg-background p-2 shadow-sm"
      >
        <div className={kicker}>{t('status')}</div>
        {STATUS_VIEWS.map((key) => (
          <button
            key={key}
            type="button"
            className={row(status === key)}
            onClick={() => onStatus(key)}
          >
            <span className="flex items-center gap-2">
              <span className={cn('size-2 rounded-full', DOT[key])} aria-hidden="true" />
              {t(`views.${key}`)}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {list ? list.statusCounts[COUNT_KEY[key]].toLocaleString() : '—'}
            </span>
          </button>
        ))}
      </nav>

      <nav
        aria-label={t('types')}
        className="rounded-xl border border-border bg-background p-2 shadow-sm"
      >
        <div className={kicker}>{t('types')}</div>
        {TYPES.map((key) => (
          <button key={key} type="button" className={row(type === key)} onClick={() => onType(key)}>
            <span>{t(`typeNames.${key}`)}</span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {list
                ? (key === 'all' ? list.statusCounts.all : list.messageTypes[key]).toLocaleString()
                : '—'}
            </span>
          </button>
        ))}
      </nav>

      <div
        className={cn(
          'rounded-2xl border p-3 text-xs leading-relaxed',
          health?.status === 'warning'
            ? 'border-warning/40 bg-warning/10'
            : 'border-border bg-muted/60',
        )}
      >
        <div className="mb-1 flex items-center gap-1.5 font-semibold">
          <span
            className={cn(
              'size-2 rounded-full',
              health?.status === 'warning' ? 'bg-warning' : 'bg-success',
            )}
            aria-hidden="true"
          />
          {t('health')}
        </div>
        {health?.status === 'warning'
          ? t('healthWarning', { count: health.failingCampaigns })
          : t('healthy', { rate: health?.avgDeliveryRate ?? 0 })}
      </div>

      <div className="rounded-xl border border-border bg-background p-3 text-xs shadow-sm">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {t('queue')}
        </div>
        <dl className="space-y-1.5">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t('templates')}</dt>
            <dd className="font-mono">
              {queue?.templateApprovalRate == null ? '—' : `${queue.templateApprovalRate}%`}
              {queue && queue.templateTotal > 0
                ? ` (${queue.templateApproved}/${queue.templateTotal})`
                : ''}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t('devices')}</dt>
            <dd className="font-mono">{queue?.devicesReady ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t('retry')}</dt>
            <dd className="font-mono">{(queue?.retryBacklog ?? 0).toLocaleString()}</dd>
          </div>
        </dl>
      </div>

      {canCreate && (
        <Link
          href="/campaigns/create"
          className="block rounded-2xl border border-dashed border-border bg-background p-4 text-center text-xs hover:bg-muted"
        >
          <div className="text-sm font-semibold">{t('createTitle')}</div>
          <div className="mt-1 text-muted-foreground">{t('createBody')}</div>
        </Link>
      )}
    </aside>
  );
}
