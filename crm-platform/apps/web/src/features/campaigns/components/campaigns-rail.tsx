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

/** Left rail of `/campaigns`: a tip, the status views and the message types with their counts, and the delivery health card. */
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
  const listT = useTranslations('campaigns.list');
  const kicker =
    'px-3 pb-1.5 pt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground';
  const row = (active: boolean) =>
    cn(
      'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-start text-[12.5px] transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
      active && 'bg-muted font-semibold',
    );
  const health = list?.deliveryHealth;

  return (
    <aside
      aria-label={t('label')}
      className="space-y-3 self-start lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto lg:pb-2"
    >
      <div className="rounded-2xl border border-success/30 bg-success/10 p-3 text-xs leading-relaxed">
        <div className="mb-1 flex items-center gap-1.5 font-semibold">
          <span className="size-2 rounded-full bg-success" aria-hidden="true" />
          {t('tipTitle')}
        </div>
        {t('tip')}
      </div>

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
            : 'border-success/30 bg-success/10',
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
          {health?.status === 'warning' ? t('attentionTitle') : t('healthyTitle')}
        </div>
        {t('healthLine', {
          rate: (health?.avgDeliveryRate ?? 0).toFixed(1),
          count: health?.failingCampaigns ?? 0,
        })}
      </div>

      {canCreate && (
        <Link
          href="/campaigns/create"
          className="block rounded-xl px-3 py-2 text-center text-xs font-semibold text-brand hover:bg-muted"
        >
          {listT('createBroadcast')} →
        </Link>
      )}
    </aside>
  );
}
