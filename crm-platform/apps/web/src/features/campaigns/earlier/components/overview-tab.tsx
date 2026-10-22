'use client';

import { useTranslations } from 'next-intl';
import type { BroadcastDetail } from '@crm/contracts';
import { DirectorSummary } from '@/features/campaigns/components/director-summary';
import { barWidth, funnel } from '../lib/detail-model';
import { AreaChart, Donut } from '@/features/broadcasts/components/charts';
import { TemplatePreview } from '@/features/broadcasts/components/template-preview';

const KICKER = 'font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground';
const CARD = 'rounded-2xl border border-border bg-background p-5 shadow-sm';

const BAR: Record<string, string> = {
  audience: 'bg-foreground',
  sent: 'bg-brand',
  delivered: 'bg-primary',
  read: 'bg-warning',
  failed: 'bg-danger',
};

/** Overview tab (TW-BCAST-031): the delivery curve, the status mix, the funnel and the template preview. */
export function OverviewTab({ detail }: { detail: BroadcastDetail }) {
  const t = useTranslations('broadcasts.detail.overview');
  const { deliveryCurve: c, donut } = detail;
  const colors = ['var(--brand)', 'var(--primary)', 'var(--warning)', '#9CA8A4', 'var(--danger)'];
  return (
    <div className="space-y-5">
      <DirectorSummary kind="broadcast" id={detail.broadcast.id} />
      <div className="grid grid-cols-12 gap-5">
        <div className={`${CARD} col-span-12 xl:col-span-8`}>
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <div className={KICKER}>{t('curveKicker')}</div>
              <h2 className="mt-1 text-2xl leading-tight">{t('curveTitle')}</h2>
            </div>
            <ul className="flex items-center gap-3 text-[11px] text-muted-foreground">
              {(
                [
                  ['sent', 'var(--brand)'],
                  ['delivered', 'var(--primary)'],
                  ['read', 'var(--warning)'],
                ] as const
              ).map(([k, color]) => (
                <li key={k} className="flex items-center gap-1.5">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: color }}
                    aria-hidden="true"
                  />
                  {t(k)}
                </li>
              ))}
            </ul>
          </div>
          {c.labels.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <AreaChart
              label={t('curveTitle')}
              labels={c.labels}
              series={[
                { name: t('sent'), color: 'var(--brand)', data: c.sent },
                { name: t('delivered'), color: 'var(--primary)', data: c.delivered },
                { name: t('read'), color: 'var(--warning)', data: c.read },
              ]}
            />
          )}
        </div>
        <div className={`${CARD} col-span-12 xl:col-span-4`}>
          <div className={KICKER}>{t('mixKicker')}</div>
          <h2 className="mt-1 text-2xl leading-tight">{t('mixTitle')}</h2>
          <div className="mt-2">
            <Donut
              label={t('mixTitle')}
              centre={`${donut.successPct}%`}
              caption={t('success')}
              slices={donut.labels.map((l, i) => ({
                label: l,
                value: donut.series[i] ?? 0,
                color: colors[i] ?? '#9CA8A4',
              }))}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className={`${CARD} xl:col-span-8`}>
          <div className={KICKER}>{t('funnelKicker')}</div>
          <h2 className="mb-5 mt-1 text-2xl leading-tight">{t('funnelTitle')}</h2>
          <div className="space-y-3">
            {funnel(detail).map((f) => (
              <div key={f.key}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span>{t(f.key)}</span>
                  <span className="font-mono">
                    {f.count.toLocaleString()} / {f.pct}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full ${BAR[f.key]}`}
                    style={{ width: `${barWidth(f.pct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
        {detail.template && (
          <aside className={`${CARD} xl:col-span-4`}>
            <TemplatePreview template={detail.template} />
          </aside>
        )}
      </div>
    </div>
  );
}
