'use client';

import { useTranslations } from 'next-intl';
import { StatTile } from '@crm/ui';
import type { BroadcastSummary } from '@crm/contracts';
import { pct1 } from '../lib/list-model';

const n = (v: number | undefined) => (v === undefined ? '—' : v.toLocaleString());

/** The six tiles above the list (WD-BCAST-002): sent, delivered, read, failed, processing and queued, workspace-wide. */
export function KpiStrip({ stats }: { stats: BroadcastSummary['stats'] | undefined }) {
  const t = useTranslations('broadcasts.list.tile');
  return (
    <div className="mb-3 grid grid-cols-3 gap-3 lg:grid-cols-6">
      <StatTile
        label={t('sent')}
        value={n(stats?.sent)}
        hint={t('broadcasts', { count: n(stats?.total) })}
        tone="accent"
      />
      <StatTile
        label={t('delivered')}
        value={n(stats?.delivered)}
        hint={t('delivery', { pct: pct1(stats?.deliveryPct ?? 0) })}
        tone="accent"
      />
      <StatTile
        label={t('read')}
        value={n(stats?.read)}
        hint={t('readRate', { pct: pct1(stats?.readPct ?? 0) })}
      />
      <StatTile
        label={t('failed')}
        value={n(stats?.failed)}
        hint={t('failedPct', { pct: pct1(stats?.failedPct ?? 0) })}
      />
      <StatTile
        label={t('processing')}
        value={n(stats?.processing)}
        hint={t('inFlight')}
        tone="warning"
      />
      <StatTile label={t('queued')} value={n(stats?.queued)} hint={t('awaiting')} />
    </div>
  );
}
