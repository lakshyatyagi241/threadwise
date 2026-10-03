'use client';

import { currencySymbol, type StoreOverview } from '@crm/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Badge, Card, StatTile } from '@crm/ui';
import { useOverview } from '../api/hooks';
import { isNoShop } from '../lib/errors';
import {
  barPercent,
  formatInt,
  formatMoney,
  formatOrderTotal,
  formatWhen,
  orderTone,
} from '../lib/format';
import { PlusIcon } from './icons';
import { ErrorPanel, Eyebrow, LinkButton, Skeleton } from './parts';
import { SalesChart } from './sales-chart';
import { StoreShell } from './store-shell';

export const WIZARD_HREF = '/connect?platform=wa-store';

/** `/store` (WD-STORE-001): five 30-day KPI tiles, sales by day, bestsellers and the newest orders. */
export function DashboardScreen() {
  const t = useTranslations('storefront-builder.admin.dashboard');
  const locale = useLocale();
  const router = useRouter();
  const shopParam = useSearchParams().get('shop') ?? undefined;
  const overview = useOverview(shopParam);
  const noShop = overview.isError && isNoShop(overview.error);

  useEffect(() => {
    if (noShop) router.replace(WIZARD_HREF);
  }, [noShop, router]);

  return (
    <StoreShell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>{t('eyebrow')}</Eyebrow>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <LinkButton href="/store/products/create" className="rounded-full">
          <PlusIcon /> {t('addProduct')}
        </LinkButton>
      </div>

      {overview.isPending || noShop ? (
        <DashboardSkeleton label={t('loading')} />
      ) : overview.isError ? (
        <ErrorPanel error={overview.error} onRetry={() => void overview.refetch()} />
      ) : (
        <Body data={overview.data} locale={locale} />
      )}
    </StoreShell>
  );
}

function DashboardSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-80 lg:col-span-2" />
        <Skeleton className="h-80" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

function Body({ data, locale }: { data: StoreOverview; locale: string }) {
  const t = useTranslations('storefront-builder.admin.dashboard');
  const { shop, stats, salesByDay, topProducts, recentOrders } = data;
  const currency = shop.currencyCode;
  const leader = Math.max(1, ...topProducts.map((p) => p.qty));
  const kpis = [
    { label: t('kpi.revenue'), value: formatMoney(stats.revenue30, currency, locale) },
    { label: t('kpi.orders'), value: formatInt(stats.orders30, locale) },
    { label: t('kpi.aov'), value: formatMoney(stats.aov, currency, locale) },
    { label: t('kpi.products'), value: formatInt(stats.products, locale) },
    { label: t('kpi.visits'), value: formatInt(stats.storefrontViews30, locale) },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {kpis.map((k) => (
          <StatTile
            key={k.label}
            label={k.label}
            value={<span className="block truncate text-2xl">{k.value}</span>}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="min-w-0 p-5 lg:col-span-2">
          <Eyebrow>{t('trend.eyebrow')}</Eyebrow>
          <h2 className="mb-3 mt-0.5 text-lg font-semibold leading-tight">{t('trend.title')}</h2>
          <SalesChart data={salesByDay} symbol={currencySymbol(currency)} />
        </Card>

        <Card className="p-5">
          <Eyebrow>{t('top.eyebrow')}</Eyebrow>
          <h2 className="mb-3 mt-0.5 text-lg font-semibold leading-tight">{t('top.title')}</h2>
          {topProducts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {t('top.empty')}
            </div>
          ) : (
            <ul className="space-y-3">
              {topProducts.map((p) => (
                <li key={p.name}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-mono" dir="auto">
                      {p.name}
                    </span>
                    <span className="font-mono font-medium tabular-nums">
                      {formatInt(p.qty, locale)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${barPercent(p.qty, leader)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold">{t('recent.title')}</h2>
          <span
            aria-disabled="true"
            title={t('recent.comingSoon')}
            className="cursor-not-allowed text-xs font-semibold text-muted-foreground"
          >
            {t('recent.viewAll')}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/60 text-muted-foreground">
              <tr>
                {(['when', 'customer', 'source', 'items'] as const).map((c) => (
                  <th
                    key={c}
                    scope="col"
                    className="px-4 py-2.5 text-start text-[11px] font-medium uppercase tracking-wider"
                  >
                    {t(`recent.columns.${c}`)}
                  </th>
                ))}
                <th
                  scope="col"
                  className="px-4 py-2.5 text-end text-[11px] font-medium uppercase tracking-wider"
                >
                  {t('recent.columns.total')}
                </th>
                <th
                  scope="col"
                  className="px-4 py-2.5 text-start text-[11px] font-medium uppercase tracking-wider"
                >
                  {t('recent.columns.status')}
                </th>
                <th
                  scope="col"
                  className="px-4 py-2.5 text-end text-[11px] font-medium uppercase tracking-wider"
                >
                  {t('recent.columns.open')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recentOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    <div className="text-base font-semibold text-foreground">
                      {t('recent.emptyTitle')}
                    </div>
                    <p className="mt-1 text-sm">{t('recent.emptyMessage')}</p>
                  </td>
                </tr>
              ) : (
                recentOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-muted/40">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                      {formatWhen(o.createdAt, locale)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{o.customerName || '—'}</div>
                      <div className="font-mono text-xs text-muted-foreground" dir="ltr">
                        {o.customerPhone}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className="font-mono">{o.source}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {t('recent.itemsCount', { count: o.itemsCount })}
                    </td>
                    <td className="px-4 py-3 text-end font-semibold tabular-nums">
                      {formatOrderTotal(o.totalMinor, o.currencyCode, locale)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={orderTone(o.status)} className="font-mono">
                        {o.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-end">
                      <span
                        aria-disabled="true"
                        title={t('recent.comingSoon')}
                        className="cursor-not-allowed text-xs font-semibold text-muted-foreground"
                      >
                        {t('recent.open')}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
