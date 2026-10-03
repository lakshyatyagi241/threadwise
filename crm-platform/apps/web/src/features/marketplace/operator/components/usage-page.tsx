'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { MarketUsageRow } from '@crm/contracts';
import { Badge, EmptyState, Field, Select, StatTile } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { fetchUsage, marketKeys } from '../api';
import { listingHref } from '../lib/paths';
import { USAGE_SORTS, sortUsage, usageFlags, usageTotals, type UsageSort } from '../lib/usage';
import { AppStatusBadge, Failure, KindLabel, LoadingBlock, MarketGate, textLink } from './ui';

const NS = 'marketplace.operator.usage';

/** Operator console: per app, how many installations and how healthy, and how many deliveries arrived or failed. Needs either Marketplace key. */
export function UsagePage() {
  return <MarketGate>{() => <Usage />}</MarketGate>;
}

function Usage() {
  const t = useTranslations(NS);
  const [sort, setSort] = useState<UsageSort>('failed');
  const q = useQuery({
    queryKey: marketKeys.usage,
    queryFn: ({ signal }) => fetchUsage(signal),
    refetchOnWindowFocus: false,
  });
  const rows = useMemo(() => sortUsage(q.data?.data ?? [], sort), [q.data, sort]);
  const totals = useMemo(() => usageTotals(q.data?.data ?? []), [q.data]);

  const header = <PageHeader title={t('title')} description={t('description')} />;
  if (q.isPending) {
    return (
      <div className="space-y-6">
        {header}
        <LoadingBlock />
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="space-y-6">
        {header}
        <Failure error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t('kpi.apps')} value={totals.apps} />
        <StatTile
          label={t('kpi.installs')}
          value={totals.installs}
          hint={t('kpi.activeHint', { count: totals.activeInstalls })}
        />
        <StatTile
          label={t('kpi.needsLook')}
          value={totals.needsLook}
          tone={totals.needsLook > 0 ? 'warning' : 'default'}
        />
        <StatTile label={t('kpi.failed7d')} value={totals.failed7d} />
      </div>

      <div className="max-w-xs">
        <Field label={t('sort.label')} htmlFor="usage-sort">
          <Select
            id="usage-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as UsageSort)}
          >
            {USAGE_SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`sort.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {rows.length === 0 ? (
        <EmptyState title={t('emptyTitle')} message={t('emptyMessage')} />
      ) : (
        <UsageTable rows={rows} />
      )}
      <p className="text-xs text-muted-foreground">{t('runbookNote')}</p>
    </div>
  );
}

export function UsageTable({ rows }: { rows: readonly MarketUsageRow[] }) {
  const t = useTranslations(NS);
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[72rem] text-sm">
        <caption className="sr-only">{t('tableCaption')}</caption>
        <thead className="bg-muted text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.app')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.installs')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.health')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.events24h')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.events7d')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.attention')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <UsageRow key={r.appId} row={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsageRow({ row: r }: { row: MarketUsageRow }) {
  const t = useTranslations(NS);
  const flags = usageFlags(r);
  return (
    <tr data-testid={`usage-${r.slug}`} className={flags.needsLook ? 'bg-warning/5' : undefined}>
      <th scope="row" className="px-3 py-3 text-start align-top font-normal">
        <Link href={listingHref({ slug: r.slug, id: r.appId })} className={textLink}>
          {r.name}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono" dir="ltr">
            {r.slug}
          </span>
          <KindLabel kind={r.kind} />
          <AppStatusBadge status={r.status} />
        </div>
      </th>
      <td className="px-3 py-3 align-top text-xs">
        <div className="text-base font-semibold tabular-nums">{r.installs.total}</div>
        <div className="text-muted-foreground">
          {t('installs.active', { count: r.installs.active })} ·{' '}
          {t('installs.disabled', { count: r.installs.disabled })} ·{' '}
          {t('installs.killed', { count: r.installs.killed })}
        </div>
      </td>
      <td className="px-3 py-3 align-top text-xs">
        <ul className="space-y-0.5">
          <li>{t('health.healthy', { count: r.health.healthy })}</li>
          <li>{t('health.degraded', { count: r.health.degraded })}</li>
          <li className={r.health.error > 0 ? 'font-medium text-danger' : undefined}>
            {t('health.error', { count: r.health.error })}
          </li>
          <li className={r.health.needsReauth > 0 ? 'font-medium text-danger' : undefined}>
            {t('health.needsReauth', { count: r.health.needsReauth })}
          </li>
          <li className="text-muted-foreground">
            {t('health.unknown', { count: r.health.unknown })}
          </li>
        </ul>
      </td>
      <EventCells counts={r.events.last24h} />
      <EventCells counts={r.events.last7d} />
      <td className="px-3 py-3 align-top text-xs">
        {flags.needsLook ? (
          <div className="space-y-1.5">
            <Badge tone="warning">{t('needsLook')}</Badge>
            <ul className="list-disc space-y-0.5 ps-4">
              {flags.reasons.map((reason) => (
                <li key={reason}>{t(`reasons.${reason}`)}</li>
              ))}
            </ul>
            {flags.recipeMayBeBreaking && (
              <p className="text-muted-foreground">{t('recipeHint')}</p>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">{t('fine')}</span>
        )}
      </td>
    </tr>
  );
}

function EventCells({ counts }: { counts: MarketUsageRow['events']['last24h'] }) {
  const t = useTranslations(NS);
  return (
    <td className="px-3 py-3 align-top text-xs">
      <ul className="space-y-0.5">
        <li>{t('events.accepted', { count: counts.accepted })}</li>
        <li>{t('events.duplicate', { count: counts.duplicate })}</li>
        <li>{t('events.rejected', { count: counts.rejected })}</li>
        <li className={counts.failed > 0 ? 'font-medium text-danger' : undefined}>
          {t('events.failed', { count: counts.failed })}
        </li>
      </ul>
    </td>
  );
}
