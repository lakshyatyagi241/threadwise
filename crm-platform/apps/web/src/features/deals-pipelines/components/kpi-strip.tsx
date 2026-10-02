'use client';

import { useLocale, useTranslations } from 'next-intl';
import { StatTile } from '@crm/ui';
import type { BoardKpis } from '../api/schemas';
import { formatMoney } from '../lib/money';

/** Four tiles over the board. They describe the whole pipeline: the search and owner filters never change them. */
export function KpiStrip({ kpis, currency }: { kpis: BoardKpis | null; currency: string }) {
  const t = useTranslations('deals-pipelines.kpi');
  const locale = useLocale();
  const money = (n: number) => formatMoney(n, currency, locale);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy={kpis === null}>
      <StatTile
        label={t('openPipeline')}
        value={kpis ? money(kpis.openValueMinor) : '—'}
        hint={kpis ? t('openDeals', { count: kpis.openCount }) : undefined}
        className="[&_div:nth-child(2)]:text-2xl"
      />
      <StatTile
        label={t('forecast')}
        value={kpis ? money(kpis.forecastMinor) : '—'}
        hint={t('forecastHint')}
        className="[&_div:nth-child(2)]:text-2xl"
      />
      <StatTile
        label={t('wonThisMonth')}
        value={kpis ? money(kpis.wonThisMonthValueMinor) : '—'}
        hint={kpis ? t('dealsCount', { count: kpis.wonThisMonthCount }) : undefined}
        tone="accent"
        className="[&_div:nth-child(2)]:text-2xl"
      />
      <StatTile
        label={t('winRate')}
        value={kpis ? `${kpis.winRate}%` : '—'}
        hint={t('winRateHint')}
        className="[&_div:nth-child(2)]:text-2xl"
      />
    </div>
  );
}
