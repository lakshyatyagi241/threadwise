'use client';

import { useTranslations } from 'next-intl';
import { Spinner, StatTile } from '@crm/ui';
import type { CampaignStatistics } from '@crm/contracts';
import { useCampaignStatistics } from '../api/campaigns';
import { HBars } from './charts';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : null);
const rate = (v: number) => `${v.toFixed(1)}%`;

/** `2026-10-14 09:30 (Asia/Kolkata)`: the date a campaign was set for, in its own zone. */
const setFor = (s: NonNullable<CampaignStatistics['lifecycle']['scheduledFor']>) =>
  [s.date, s.time?.slice(0, 5), s.timezone ? `(${s.timezone})` : null].filter(Boolean).join(' ');

/**
 * The Statistics tab: where every recipient is right now (each counted once, so the rows add up to the audience), the funnel's rates,
 * and the campaign's own timeline. It follows the campaign while it is in flight, like the live stats on the page header.
 */
export function StatisticsTab({ id }: { id: string }) {
  const t = useTranslations('campaigns.detail.statistics');
  const ts = useTranslations('campaigns.detail.recipients.statuses');
  const q = useCampaignStatistics(id);
  if (q.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{t('loadFailed')}</p>;
  }
  const s = q.data;
  const l = s.lifecycle;
  const rows: Array<[string, string | null]> = [
    [t('timeline.created'), when(l.createdAt)],
    [t('timeline.scheduled'), l.scheduledFor ? setFor(l.scheduledFor) : null],
    [t('timeline.firstSent'), when(l.firstSentAt)],
    [t('timeline.lastRun'), when(l.lastRunAt)],
    [t('timeline.finished'), when(l.completedAt)],
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label={t('rates.delivered')}
          value={rate(s.rates.delivered)}
          hint={t('rates.deliveredHint')}
        />
        <StatTile label={t('rates.read')} value={rate(s.rates.read)} hint={t('rates.readHint')} />
        <StatTile label={t('rates.replies')} value={rate(s.rates.replies)} />
        <StatTile label={t('rates.clicks')} value={rate(s.rates.clicks)} />
        <StatTile
          label={t('rates.failed')}
          value={rate(s.rates.failed)}
          tone={s.counts.failed > 0 ? 'warning' : 'default'}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-background p-5 shadow-sm">
          <h3 className="text-lg">{t('breakdown.title')}</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            {t('breakdown.hint', { total: s.total.toLocaleString() })}
          </p>
          {s.total === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t('breakdown.empty')}</p>
          ) : (
            <HBars
              label={t('breakdown.title')}
              color="var(--brand)"
              rows={s.breakdown
                .filter((b) => b.count > 0)
                .map((b) => ({ label: `${ts(b.key)} · ${rate(b.pct)}`, value: b.count }))}
            />
          )}
        </section>

        <section className="rounded-2xl border border-border bg-background p-5 shadow-sm">
          <h3 className="mb-3 text-lg">{t('timeline.title')}</h3>
          <ol className="relative ms-3 space-y-4 border-s border-border">
            {rows.map(([label, value]) => (
              <li key={label} className="ms-5">
                <span className="absolute -start-1.5 mt-1.5 size-3 rounded-full border-2 border-background bg-brand" />
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {label}
                </div>
                <div className="text-sm">{value ?? t('timeline.notYet')}</div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <p className="text-xs text-muted-foreground" role="status">
        {s.inFlight ? t('live') : t('atRest')} ·{' '}
        {t('updated', { time: new Date(s.fetchedAt).toLocaleTimeString() })}
      </p>
    </div>
  );
}
