'use client';

import { useTranslations } from 'next-intl';
import type { DashFunnel } from '@crm/contracts';
import { compact } from '../lib/format';
import { funnelStages } from '../lib/funnel-model';
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
      <ol className="space-y-2.5" aria-label={t('listLabel')}>
        {stages.map((s, i) => (
          <li
            key={s.key}
            className="space-y-1"
            aria-label={t('stageLabel', { stage: t(`stage.${s.key}`), n: s.count, pct: s.pct })}
            title={s.key === 'goalCompleted' ? t('goalCompletedHint') : undefined}
          >
            <p className="flex items-baseline gap-1.5 text-sm" aria-hidden>
              {i > 0 && <span className="text-muted-foreground">↓</span>}
              <strong className="tabular-nums">{compact(s.count)}</strong>
              <span className="min-w-0 truncate">{t(`stage.${s.key}`)}</span>
            </p>
            <div className="flex items-center gap-2" aria-hidden>
              <div className="h-2 min-w-0 flex-1 rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.min(100, Math.max(s.count > 0 ? 2 : 0, s.pct))}%` }}
                />
              </div>
              <span className="w-12 shrink-0 text-end text-xs text-muted-foreground tabular-nums">
                {s.pct}%
              </span>
            </div>
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
