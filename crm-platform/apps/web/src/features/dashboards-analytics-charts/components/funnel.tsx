'use client';

import { useTranslations } from 'next-intl';
import type { DashFunnel } from '@crm/contracts';
import { compact } from '../lib/format';
import { funnelStages } from '../lib/funnel-model';
import { FunnelBand } from '@/components/funnel-shape';
import { Trend } from './parts';

/**
 * The Engagement funnel card body (dashboard and analytics): contacts messaged, delivered, replied, goal completed as bars of the share of
 * contacts messaged, the conversation activity under a divider, and the reply-rate change against the previous period.
 * The stage list is data driven (`funnelStages`); "Goal completed" is the contacts whose flow finished.
 */
export function Funnel({ funnel }: { funnel: DashFunnel }) {
  const t = useTranslations('dashboards-analytics-charts.funnel');
  const stages = funnelStages(funnel);
  const { activity, comparison } = funnel;
  return (
    <div className="space-y-4" data-testid="engagement-funnel">
      <ol className="space-y-0.5" aria-label={t('listLabel')}>
        {stages.map((s, i) => (
          <li
            key={s.key}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,11rem)] items-center gap-3"
            title={s.key === 'goalCompleted' ? t('goalCompletedHint') : undefined}
            aria-label={t('stageLabel', { stage: t(`stage.${s.key}`), n: s.count, pct: s.pct })}
          >
            <FunnelBand
              topPct={s.pct}
              bottomPct={stages[i + 1]?.pct ?? s.pct * 0.75}
              strength={1 - i * 0.18}
            />
            <p className="min-w-0 text-sm leading-tight" aria-hidden>
              <span className="flex items-baseline gap-1.5">
                <strong className="tabular-nums">{compact(s.count)}</strong>
                <span className="min-w-0 truncate">{t(`stage.${s.key}`)}</span>
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">{s.pct}%</span>
            </p>
          </li>
        ))}
      </ol>

      <div className="space-y-1 border-t border-border pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('activity.title')}
        </h3>
        <p className="text-sm" data-testid="funnel-activity">
          {t('activity.summary', {
            inbound: activity.inbound,
            contacts: activity.respondingContacts,
            perContact: activity.repliesPerContact ?? '-',
          })}
        </p>
      </div>

      {comparison && (
        <div className="space-y-1" data-testid="funnel-comparison">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('comparison.title')}
          </h3>
          <p className="flex flex-wrap items-center gap-2 text-sm tabular-nums">
            <span className="text-muted-foreground">{t('comparison.replyRate')}</span>
            <strong>{funnel.replyRate}%</strong>
            <Trend delta={comparison.replyRatePp} unit="pp" downTone="warning" />
          </p>
        </div>
      )}
    </div>
  );
}
