'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { WabaNumberThroughput } from '@crm/contracts';
import { Alert, Badge, Card, EmptyState, Input, StatTile } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { WAT_POLL_MS, fetchOverview, watKeys } from '../api';
import { loadOf, needsAttention, sourceTone, tierTone } from '../lib/format';
import { SettingsForm } from './settings-form';
import { Failure, LoadingBlock, Meter } from './ui';

const NS = 'whatsapp-throughput';

/** Operator console: every connected WhatsApp number with its paced rate, daily messaging tier and live counters. Super admin only. */
export function ThroughputPage() {
  const t = useTranslations(NS);
  const f = useFormatter();
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: watKeys.overview(search),
    queryFn: ({ signal }) => fetchOverview(search, signal),
    refetchInterval: WAT_POLL_MS,
    // A failed poll keeps the last good numbers on screen instead of replacing them with an error.
    placeholderData: (prev) => prev,
  });

  const header = (
    <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
  );
  if (q.isPending) {
    return (
      <div className="space-y-6">
        {header}
        <LoadingBlock />
      </div>
    );
  }
  if (q.isError && !q.data) {
    return (
      <div className="space-y-6">
        {header}
        <Failure error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }

  const data = q.data!;
  const attention = data.numbers.filter(needsAttention).length;

  return (
    <div className="space-y-6">
      {header}

      <p className="text-xs text-muted-foreground" aria-live="off">
        {q.isError
          ? t('stale')
          : t('updated', { time: f.dateTime(new Date(data.generatedAt), { timeStyle: 'medium' }) })}
      </p>

      {!data.liveAvailable && <Alert tone="warning">{t('liveUnavailable')}</Alert>}
      {!data.settings.enabled && <Alert tone="warning">{t('limiterOff')}</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label={t('kpi.now')}
          value={data.totals.mpsNow}
          hint={t('kpi.nowHint')}
          tone="accent"
        />
        <StatTile
          label={t('kpi.sent')}
          value={f.number(data.totals.sent5m)}
          hint={t('kpi.last5')}
        />
        <StatTile label={t('kpi.numbers')} value={data.totals.numbers} />
        <StatTile
          label={t('kpi.attention')}
          value={attention}
          hint={t('kpi.attentionHint', { paused: data.totals.paused, tier: data.totals.tierWarn })}
          tone={attention > 0 ? 'warning' : 'default'}
        />
        <StatTile
          label={t('kpi.heldBack')}
          value={f.number(data.totals.deferred5m)}
          hint={t('kpi.heldBackHint', { meta: data.totals.metaThrottled5m })}
          tone={data.totals.deferred5m + data.totals.metaThrottled5m > 0 ? 'warning' : 'default'}
        />
      </div>

      <Card className="space-y-4">
        <details>
          <summary className="cursor-pointer text-base font-semibold focus-visible:ring-2 focus-visible:ring-primary">
            {t('settings.title')}
          </summary>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            {t('settings.description')}
          </p>
          <div className="mt-4">
            <SettingsForm key={data.settings.rowVersion} settings={data.settings} />
          </div>
        </details>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{t('numbers.title')}</h2>
        <Input
          type="search"
          className="max-w-xs"
          aria-label={t('numbers.search')}
          placeholder={t('numbers.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {data.numbers.length === 0 ? (
        <EmptyState title={t('numbers.emptyTitle')} message={t('numbers.emptyBody')} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-muted/50 text-start text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('cols.number')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('cols.rate')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('cols.live')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('cols.last5')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('cols.tier')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('cols.state')}
                </th>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">{t('cols.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.numbers.map((n) => (
                <NumberRow key={n.id} n={n} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="max-w-3xl text-xs text-muted-foreground">{t('footnote')}</p>
    </div>
  );
}

function NumberRow({ n }: { n: WabaNumberThroughput }) {
  const t = useTranslations(NS);
  const f = useFormatter();
  const load = loadOf(n);
  return (
    <tr className="align-top">
      <td className="px-3 py-3">
        <div className="font-medium">{n.displayPhoneNumber ?? n.label ?? n.phoneNumberId}</div>
        <div className="text-xs text-muted-foreground">{n.workspace}</div>
        <div className="font-mono text-[11px] text-muted-foreground">{n.phoneNumberId}</div>
      </td>
      <td className="space-y-1 px-3 py-3">
        <div className="tabular-nums">
          <span className="font-medium">{n.effectiveMps}</span> {t('perSecond')}
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge tone={sourceTone(n.source)}>{t(`source.${n.source}`)}</Badge>
          {n.metaLevel && <Badge>{n.metaLevel}</Badge>}
          {n.qualityRating && <Badge>{n.qualityRating}</Badge>}
        </div>
      </td>
      <td className="w-40 space-y-1.5 px-3 py-3">
        <div className="tabular-nums">
          {n.live.mpsNow} <span className="text-xs text-muted-foreground">{t('perSecond')}</span>
        </div>
        <Meter
          value={load}
          max={1}
          tone={load >= 1 ? 'danger' : load >= 0.8 ? 'warning' : 'success'}
          label={t('cols.live')}
        />
        <div className="text-xs text-muted-foreground">{t('peak', { n: n.live.peak1m })}</div>
      </td>
      <td className="px-3 py-3 text-xs tabular-nums">
        <div>{t('sentCount', { n: f.number(n.live.sent5m) })}</div>
        <div className={n.live.deferred5m > 0 ? 'text-warning' : 'text-muted-foreground'}>
          {t('deferredCount', { n: n.live.deferred5m })}
        </div>
        <div className={n.live.metaThrottled5m > 0 ? 'text-danger' : 'text-muted-foreground'}>
          {t('throttledCount', { n: n.live.metaThrottled5m })}
        </div>
      </td>
      <td className="w-44 space-y-1.5 px-3 py-3">
        {n.tier.state === 'unlimited' || n.tier.state === 'unknown' ? (
          <Badge>{t(`tier.${n.tier.state}`)}</Badge>
        ) : (
          <>
            <div className="text-xs tabular-nums">
              {t('tierUsed', { used: f.number(n.tier.used24h), cap: f.number(n.tier.cap ?? 0) })}
            </div>
            <Meter
              value={n.tier.used24h}
              max={n.tier.cap ?? 1}
              tone={tierTone(n.tier.state)}
              label={t('cols.tier')}
            />
          </>
        )}
      </td>
      <td className="space-y-1 px-3 py-3">
        <div className="flex flex-wrap gap-1">
          {n.control.paused && <Badge tone="danger">{t('state.paused')}</Badge>}
          {n.live.speedFactor < 1 && (
            <Badge tone="warning">
              {t('state.slowed', { pct: Math.round(n.live.speedFactor * 100) })}
            </Badge>
          )}
          {n.tier.state === 'warn' && <Badge tone="warning">{t('state.tierWarn')}</Badge>}
          {n.tier.state === 'full' && <Badge tone="danger">{t('state.tierFull')}</Badge>}
          {n.syncError && <Badge tone="warning">{t('state.syncFailed')}</Badge>}
          {!needsAttention(n) && <Badge tone="success">{t('state.ok')}</Badge>}
        </div>
      </td>
      <td className="px-3 py-3 text-end">
        <Link
          href={`/admin/whatsapp-throughput/${n.id}`}
          className="text-sm font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('details')}
        </Link>
      </td>
    </tr>
  );
}
