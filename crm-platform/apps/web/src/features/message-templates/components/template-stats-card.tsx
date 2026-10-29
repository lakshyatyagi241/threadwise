'use client';

import { useFormatter, useNow, useTranslations } from 'next-intl';
import type { TemplateStats } from '@crm/contracts';
import { Spinner, cn } from '@crm/ui';
import { useTemplateStats } from '../api/hooks';

const CARD = 'rounded-2xl border border-border bg-background shadow-sm';

/** The share of the messages sent with a template that reached a step, in whole percent (0 when nothing was sent). */
export function percentOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/**
 * "How this template did": what was sent with it and how far each message got (sent, delivered, read, replied, failed), as counts
 * and as a share of the sends. Read from the messages that carry the template, so broadcasts, campaigns, flows and agents all count.
 */
export function TemplateStatsCard({ id, enabled }: { id: string; enabled: boolean }) {
  const t = useTranslations('message-templates.detail.stats');
  const format = useFormatter();
  const now = useNow();
  const q = useTemplateStats(id, enabled);

  const body = (s: TemplateStats) => {
    if (s.total === 0)
      return <p className="px-5 py-4 text-[13px] text-muted-foreground">{t('none')}</p>;
    const steps: Array<{
      key: 'sent' | 'delivered' | 'read' | 'replied' | 'failed';
      tone: string;
    }> = [
      { key: 'sent', tone: 'text-foreground' },
      { key: 'delivered', tone: 'text-foreground' },
      { key: 'read', tone: 'text-foreground' },
      { key: 'replied', tone: 'text-foreground' },
      { key: 'failed', tone: 'text-danger' },
    ];
    return (
      <>
        <dl
          className="grid grid-cols-2 gap-px bg-border sm:grid-cols-5"
          data-testid="template-stats"
        >
          {steps.map(({ key, tone }) => (
            <div key={key} className="bg-background px-4 py-3">
              <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {t(key)}
              </dt>
              <dd className={cn('mt-1 text-xl font-semibold tabular-nums', tone)}>
                {format.number(s[key])}
                <span className="ms-1.5 text-[11px] font-normal text-muted-foreground">
                  {t('percent', { value: percentOf(s[key], s.total) })}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="border-t border-border px-5 py-2.5 text-[11px] text-muted-foreground">
          {t('footer', { total: s.total, queued: s.queued })}
          {s.lastSentAt &&
            ` · ${t('lastSent', { when: format.relativeTime(new Date(s.lastSentAt), now) })}`}
        </p>
      </>
    );
  };

  return (
    <div className={cn(CARD, 'mb-4 overflow-hidden')}>
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-3">
        <h2 className="text-[13px] font-semibold">{t('title')}</h2>
        <span className="text-[11px] text-muted-foreground">{t('hint')}</span>
      </div>
      {q.isPending ? (
        <div className="flex justify-center p-5">
          <Spinner label={t('loading')} />
        </div>
      ) : q.isError ? (
        <p className="px-5 py-4 text-[13px] text-muted-foreground">{t('error')}</p>
      ) : (
        body(q.data)
      )}
    </div>
  );
}
