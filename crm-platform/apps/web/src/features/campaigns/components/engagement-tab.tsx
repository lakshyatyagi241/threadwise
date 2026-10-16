'use client';

import { useTranslations } from 'next-intl';
import { StatTile } from '@crm/ui';
import type { CampaignDetail } from '@crm/contracts';
import { HBars } from './charts';

const rate = (v: number) => `${v.toFixed(1)}%`;

/**
 * The Engagement tab (TW-CAMP-019): four cards, the top buttons from real tracked clicks, and the best contact groups by read
 * rate. A quick-reply button has no link to track, so it shows a dash instead of a zero that reads like "nobody tapped it".
 */
export function EngagementTab({ d }: { d: CampaignDetail }) {
  const t = useTranslations('campaigns.detail.engagement');
  const e = d.engagement;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t('opened')} value={rate(e.openedPct)} hint={String(e.openedCount)} />
        <StatTile label={t('clicked')} value={rate(e.clickedPct)} hint={String(e.clickedCount)} />
        <StatTile label={t('replied')} value={rate(e.repliedPct)} hint={String(e.repliedCount)} />
        <StatTile
          label={t('optedOut')}
          value={rate(e.optOutPct)}
          hint={String(e.optOutCount)}
          tone={e.optOutCount > 0 ? 'warning' : 'default'}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-background p-5 shadow-sm">
          <h3 className="mb-3 text-lg">{t('topButtons')}</h3>
          {d.buttonRows.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t('noButtons')}</p>
          ) : (
            <ul className="divide-y divide-border text-[13px]">
              {d.buttonRows.map((b, i) => (
                <li key={`${b.label}-${i}`} className="flex items-center justify-between py-2">
                  <span className="truncate pe-3">{b.label}</span>
                  {b.trackable ? (
                    <span className="tabular-nums text-muted-foreground">
                      {t('clicks', { count: b.count ?? 0 })} · {b.pct}%
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground" title={t('notTrackable')}>
                      —
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-background p-5 shadow-sm">
          <h3 className="mb-3 text-lg">{t('topSegments')}</h3>
          {d.segments.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t('noSegments')}</p>
          ) : (
            <>
              <HBars
                rows={d.segments.map((s) => ({ label: s.name, value: s.readPct }))}
                color="var(--primary)"
                label={t('topSegments')}
              />
              <table className="mt-4 w-full text-[12.5px]">
                <thead className="text-start text-muted-foreground">
                  <tr>
                    <th className="py-1 font-medium">{t('group')}</th>
                    <th className="py-1 font-medium">{t('recipients')}</th>
                    <th className="py-1 font-medium">{t('replies')}</th>
                    <th className="py-1 font-medium">{t('optOuts')}</th>
                    <th className="py-1 font-medium">{t('readRate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.segments.map((s) => (
                    <tr key={s.name} className="border-t border-border">
                      <td className="py-1.5">{s.name}</td>
                      <td className="tabular-nums">{s.recipients}</td>
                      <td className="tabular-nums">{s.replies}</td>
                      <td className="tabular-nums">{s.optOuts}</td>
                      <td className="tabular-nums">{rate(s.readPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
