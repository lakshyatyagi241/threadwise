'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { StoreDashboard } from '@crm/contracts';
import { formatRelative } from '@/features/auth-registration-security/shared/relative-time';
import { money, type Kind } from '../../lib/model';
import { Kpi, Panel, Pill } from '../ui';

/** The overview tab (WD-ECOM-023): four figures, the newest five orders and the newest six webhook deliveries. */
export function OverviewTab({ kind, data }: { kind: Kind; data: StoreDashboard }) {
  const t = useTranslations('ecom.overview');
  const o = useTranslations('ecom.orders');
  const locale = useLocale();
  const [now] = useState(() => new Date().getTime());
  const n = (v: number) => v.toLocaleString(locale);
  const woo = data.woo;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kind === 'woocommerce' && woo ? (
          <>
            <Kpi
              label={t('revenue30')}
              value={money(data.revenue30d, data.currency)}
              hint={t('revenue30Hint')}
            />
            <Kpi
              label={t('orders30')}
              value={n(woo.orders30d)}
              hint={t('ordersAllTime', { count: n(data.counts.orders) })}
            />
            <Kpi
              label={t('customers')}
              value={n(data.counts.customers)}
              hint={t('customersNew', { count: n(woo.customers30d) })}
            />
            <Kpi
              label={t('itemsSold')}
              value={n(woo.itemsSold30d)}
              hint={t('activeAutomations', { count: data.activeEvents })}
            />
          </>
        ) : (
          <>
            <Kpi
              label={t('revenueRecent')}
              value={money(data.revenue30d, data.currency)}
              hint={t('revenueRecentHint')}
            />
            <Kpi
              label={t('ordersTotal')}
              value={n(data.counts.orders)}
              hint={t('ordersMirrorHint')}
            />
            <Kpi label={t('products')} value={n(data.counts.products)} hint={t('productsHint')} />
            <Kpi
              label={t('customers')}
              value={n(data.counts.customers)}
              hint={t('activeAutomations', { count: data.activeEvents })}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel
          title={t('recentOrders')}
          action={
            <Link
              href={`/${kind}?tab=orders`}
              className="text-xs font-medium text-brand hover:underline"
            >
              {t('viewAll')}
            </Link>
          }
        >
          {data.orders.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('noOrders')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.orders.slice(0, 5).map((order, i) => (
                <li
                  key={`${order.name}-${i}`}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium">{order.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{order.customer}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[13px] tabular-nums">
                      {money(order.total, order.currency || data.currency)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {o('status')}: {order.status ?? '—'}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title={t('recentActivity')}
          action={
            <Link
              href={`/${kind}?tab=logs`}
              className="text-xs font-medium text-brand hover:underline"
            >
              {t('viewAll')}
            </Link>
          }
        >
          {data.recentLogs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('noActivity')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.recentLogs.slice(0, 6).map((log) => (
                <li key={log.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[12px]">{log.eventType}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {formatRelative(log.createdAt, now, locale)}
                    </div>
                  </div>
                  <Pill status={log.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
