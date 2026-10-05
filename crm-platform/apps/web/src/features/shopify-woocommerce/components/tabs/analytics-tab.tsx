'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { StoreDashboard } from '@crm/contracts';
import { barHeight, money, type Kind } from '../../lib/model';
import { EmptyRow, Kpi, Panel, ROW, TD, TH, TableFrame } from '../ui';

/** The analytics tab (TW-ECOM-023): revenue, messages, COD impact, the 14 day revenue trend and which events fired how often. */
export function AnalyticsTab({ kind, data }: { kind: Kind; data: StoreDashboard }) {
  const t = useTranslations('ecom.analytics');
  const locale = useLocale();
  const a = data.analytics;
  const n = (v: number) => v.toLocaleString(locale);
  const d = kind === 'shopify' ? 0 : 2;
  const events = Object.entries(data.logsByEvent).sort((x, y) => y[1] - x[1]);

  return (
    <div className="space-y-4">
      {kind === 'shopify' ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label={t('revenue')} value={money(a.revenueTotal, data.currency, 0)} />
            <Kpi label={t('orders')} value={n(a.ordersTotal)} />
            <Kpi label={t('avgOrder')} value={money(a.aov, data.currency, 0)} />
            <Kpi label={t('messagesSent')} value={n(a.messagesSent)} />
            <Kpi label={t('offersSent')} value={n(a.offersSent)} />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label={t('codProtected')}
              value={money(a.codProtected, data.currency, 0)}
              hint={t('codConfirmed', { count: n(a.codConfirmed) })}
            />
            <Kpi
              label={t('rtoAvoided')}
              value={money(a.rtoAvoided, data.currency, 0)}
              hint={t('codCancelled', { count: n(a.codCancelled) })}
            />
            <Kpi label={t('recovery')} value={n(a.recoverySends)} hint={t('recoveryHint')} />
            <Kpi label={t('avgValue')} value={money(a.aov, data.currency, 0)} />
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi
            label={t('revenueMirrored')}
            value={money(a.revenueTotal, data.currency, d)}
            hint={t('ordersSynced', { count: n(a.ordersTotal) })}
          />
          <Kpi label={t('avgValue')} value={money(a.aov, data.currency, d)} hint={t('perOrder')} />
          <Kpi
            label={t('messagesSent')}
            value={n(a.messagesSent)}
            hint={t('offerBroadcasts', { count: n(a.offersSent) })}
          />
          <Kpi
            label={t('recoverySends')}
            value={n(a.recoverySends)}
            hint={t('recoverySendsHint')}
          />
          <Kpi
            label={t('codProtected')}
            value={money(a.codProtected, data.currency, d)}
            hint={t('codConfirmed', { count: n(a.codConfirmed) })}
          />
          <Kpi
            label={t('rtoAvoided')}
            value={money(a.rtoAvoided, data.currency, d)}
            hint={t('wouldBeRto')}
          />
          <Kpi label={t('activeAutomations')} value={n(data.activeEvents)} hint={t('firingOn')} />
        </div>
      )}

      <Panel title={t('trend')}>
        <div className="flex h-40 items-end gap-1.5" role="img" aria-label={t('trend')}>
          {a.trend.map((p) => (
            <div
              key={p.label}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
            >
              <div
                className="w-full rounded-t bg-brand/70"
                style={{ height: `${barHeight(p.value, a.trendMax)}%` }}
                title={money(p.value, data.currency)}
              />
              <span className="w-full truncate text-center text-[9px] text-muted-foreground">
                {p.label}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <div>
        <h3 className="mb-2 text-[19px] font-normal">{t('perf')}</h3>
        <TableFrame>
          <thead>
            <tr>
              <th className={TH}>{t('event')}</th>
              <th className={TH}>{t('fired')}</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <EmptyRow cols={2}>{t('noActivity')}</EmptyRow>
            ) : (
              events.map(([event, count]) => (
                <tr key={event} className={ROW}>
                  <td className={`${TD} font-mono text-[12px]`}>{event}</td>
                  <td className={`${TD} tabular-nums`}>{n(count)}</td>
                </tr>
              ))
            )}
          </tbody>
        </TableFrame>
      </div>
    </div>
  );
}
