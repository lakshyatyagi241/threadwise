'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState, Input, StatTile } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { GATEWAYS_KEY, fetchGateways } from '../api';
import {
  REGION_TABS,
  currencyChoices,
  filterGateways,
  tabCounts,
  type RegionTab,
} from '../lib/gateway-filter';
import { GatewayCard } from './gateway-card';

const NS = 'platform-payment-gateways.admin';

/** Operator console: every gateway as a collapsible card with a filter, KPIs and the credential form. */
export function GatewaysPage() {
  const q = useQuery({
    queryKey: GATEWAYS_KEY,
    queryFn: ({ signal }) => fetchGateways(signal),
    refetchOnWindowFocus: false,
  });
  const t = useTranslations(NS);
  const tr = useTranslations(`${NS}.regions`);
  const qc = useQueryClient();
  const { operator } = useOperator();
  const [tab, setTab] = useState<RegionTab>('all');
  const [search, setSearch] = useState('');

  const items = useMemo(() => q.data?.data ?? [], [q.data]);
  const counts = useMemo(() => tabCounts(items), [items]);
  const shown = useMemo(() => filterGateways(items, tab, search), [items, tab, search]);
  const currencies = useMemo(() => currencyChoices(items), [items]);

  if (q.isPending) {
    return (
      <LoadingBlock className="flex min-h-64 items-center justify-center text-muted-foreground" />
    );
  }
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;

  const summary = q.data.summary;
  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description', { count: summary.total })} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t('kpi.total')} value={summary.total} />
        <StatTile label={t('kpi.active')} value={summary.active} tone="accent" />
        <StatTile label={t('kpi.india')} value={summary.india} />
        <StatTile label={t('kpi.crypto')} value={summary.crypto} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('tabsLabel')}>
          {REGION_TABS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={tab === r}
              onClick={() => setTab(r)}
              className={`rounded-full border px-3 py-1 text-sm ${tab === r ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}
            >
              {r === 'all' ? t('all') : tr(r)} <span className="tabular-nums">{counts[r]}</span>
            </button>
          ))}
        </div>
        <Input
          type="search"
          className="max-w-xs"
          aria-label={t('search')}
          placeholder={t('search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {shown.length === 0 ? (
        <EmptyState title={t('emptyTitle')} message={t('emptyMessage')} />
      ) : (
        <div className="space-y-3">
          {shown.map((g) => (
            <GatewayCard
              key={`${g.id}:${g.rowVersion}`}
              gateway={g}
              currencyChoices={currencies}
              canEdit={operator.role === 'super_admin'}
              onChanged={() => void qc.invalidateQueries({ queryKey: GATEWAYS_KEY })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
