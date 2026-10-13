'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Card } from '@crm/ui';
import type { LscCostTotals, LscPlatformOverview } from '@crm/contracts';
import { totalTokens } from './logic';
import { useUsd } from './use-usd';

const NS = 'lead-scoring-admin.cost';

function Window({ title, totals }: { title: string; totals: LscCostTotals }) {
  const t = useTranslations(NS);
  const tc = useTranslations('lead-scoring-admin.common');
  const format = useFormatter();
  const usd = useUsd();
  const n = (v: number) => format.number(v);

  const rows: Array<[string, string]> = [
    [t('scores'), n(totals.scores)],
    [t('failed'), n(totals.failed)],
    [t('tokens'), n(totalTokens(totals))],
    [t('tokensSplit'), `${n(totals.promptTokens)} / ${n(totals.completionTokens)}`],
    [t('total'), usd(totals.costUsd)],
    [
      t('average'),
      totals.avgCostPerScoreUsd === null ? tc('dash') : usd(totals.avgCostPerScoreUsd),
    ],
    [t('platform'), usd(totals.platformCostUsd)],
  ];
  return (
    <section aria-label={title} className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-w-0 flex-col-reverse">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="truncate text-lg font-semibold tabular-nums" dir="ltr" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** What scoring cost in the last 24 hours and the last 30 days, and how much of it the platform's own key paid. */
export function CostCard({ overview }: { overview: LscPlatformOverview }) {
  const t = useTranslations(NS);
  return (
    <Card className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
      <div className="grid gap-6 md:grid-cols-2 md:divide-x md:rtl:divide-x-reverse">
        <Window title={t('last24h')} totals={overview.last24h} />
        <div className="md:ps-6">
          <Window title={t('last30d')} totals={overview.last30d} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('footnote')}</p>
    </Card>
  );
}
