'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type { BillingWindow, OrderWindow } from '@crm/contracts';
import { Card, EmptyState } from '@crm/ui';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { BILLING_KEYS, billingApi } from '../../billing-api';
import { FunnelBand } from '@/components/funnel-shape';
import { downloadText, signedPct, wholeMoney } from '../../lib/billing-format';
import { useUrlState } from '../../lib/use-url-state';
import { CHART_COLORS, Donut, Heatmap, MotionBars, TrendChart } from './charts';
import {
  BillingHeader,
  Crumb,
  DeltaChip,
  ExportButton,
  Kpi,
  KpiStrip,
  LinkPill,
  TwoToneTitle,
  WindowSelect,
} from './parts';

const ANALYTICS_WINDOWS: BillingWindow[] = ['7d', '30d', '90d', '1y'];

function Section({
  kicker,
  title,
  children,
  className,
}: {
  kicker?: string;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      {kicker && (
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {kicker}
        </div>
      )}
      <h2 className={kicker ? 'mb-3 mt-1 text-xl font-semibold' : 'text-sm font-semibold'}>
        {title}
      </h2>
      {children}
    </Card>
  );
}

/** Admin > Billing history > Analytics (TW-PAYGW-042): cash flow, gateway share, top payers, status mix. */
export function BillingAnalyticsPage() {
  const tb = useTranslations('platform-payment-gateways.billing.billingAnalytics');
  const tc = useTranslations('platform-payment-gateways.billing.common');
  const locale = useLocale();
  const { values, set } = useUrlState({ window: '90d' });
  const window = values.window as BillingWindow;
  const q = useQuery({
    queryKey: [...BILLING_KEYS.historyAnalytics, window],
    queryFn: ({ signal }) => billingApi.historyAnalytics({ window }, signal),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
  if (q.isPending) {
    return (
      <LoadingBlock className="flex min-h-64 items-center justify-center text-muted-foreground" />
    );
  }
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const k = d.kpis;
  const cur = d.reportingCurrency;
  const m = (a: string) => wholeMoney(a, cur, locale);
  const windows = window === 'all' ? [...ANALYTICS_WINDOWS, 'all' as const] : ANALYTICS_WINDOWS;

  return (
    <div className="space-y-5">
      <Crumb
        items={[
          { label: tc('billingHistory'), href: '/admin/billing-history' },
          { label: tc('analytics') },
        ]}
      />
      <BillingHeader
        eyebrow={tb('eyebrow')}
        title={<TwoToneTitle first={tb('titleFirst')} second={tb('titleSecond')} />}
        description={tb('description')}
        actions={
          <>
            <WindowSelect
              value={window}
              label={tb('window')}
              onChange={(v) => set({ window: v })}
              options={windows.map((w) => ({ value: w, label: tc(`windows.${w}`) }))}
            />
            <LinkPill href="/admin/billing-history">{tb('viewLedger')}</LinkPill>
          </>
        }
      />
      <KpiStrip columns={6}>
        <Kpi
          label={tb('kpi.gross')}
          value={m(k.gross.amount)}
          hint={<DeltaChip pct={k.grossDeltaPct} />}
        />
        <Kpi
          tone="accent"
          label={tb('kpi.net')}
          value={m(k.net.amount)}
          hint={tb('kpi.netPct', { pct: k.netPct })}
          hintTone="accent"
        />
        <Kpi
          label={tb('kpi.success')}
          value={`${k.successPct}%`}
          hint={`${k.paidCount} / ${k.totalCharges}`}
          hintTone="accent"
        />
        <Kpi
          tone="warning"
          label={tb('kpi.failed')}
          value={m(k.failed.amount)}
          hint={tb('kpi.events', { count: k.failedCount })}
        />
        <Kpi
          label={tb('kpi.refunds')}
          value={m(k.refunds.amount)}
          hint={tb('kpi.events', { count: k.refundsCount })}
        />
        <Kpi
          tone="danger"
          valueTone="danger"
          label={tb('kpi.chargebacks')}
          value={m(k.chargebacks.amount)}
          hint={tb('kpi.disputes', { count: k.chargebacksCount })}
          hintTone="danger"
        />
      </KpiStrip>

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Section
          className="lg:col-span-8"
          kicker={tb('cashFlow.kicker')}
          title={tb('cashFlow.title')}
        >
          <TrendChart
            label={tb('cashFlow.title')}
            labels={d.trend.labels}
            series={[
              { name: tb('cashFlow.charges'), values: d.trend.charges, color: 'var(--primary)' },
              { name: tb('cashFlow.refunds'), values: d.trend.refunds, color: 'var(--danger)' },
              {
                name: tb('cashFlow.failed'),
                values: d.trend.failed ?? [],
                color: 'var(--warning)',
              },
            ]}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {[
              ['cashFlow.charges', 'bg-primary'],
              ['cashFlow.refunds', 'bg-danger'],
              ['cashFlow.failed', 'bg-warning'],
            ].map(([key, cls]) => (
              <span key={key} className="flex items-center gap-1.5">
                <span className={`size-2.5 rounded-full ${cls}`} aria-hidden />
                {tb(key as 'cashFlow.charges')}
              </span>
            ))}
          </div>
        </Section>
        <Section className="lg:col-span-4" title={tb('gatewayShare.title')}>
          <p className="mb-3 mt-1 text-xs text-muted-foreground">{tb('gatewayShare.hint')}</p>
          <Donut
            label={tb('gatewayShare.title')}
            items={d.gatewayMix.map((g, i) => ({
              label: g.label,
              value: g.value,
              color: CHART_COLORS[i % CHART_COLORS.length]!,
            }))}
            format={(v) => m(String(v))}
          />
        </Section>
      </section>

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card className="overflow-hidden p-0 lg:col-span-8">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">{tb('topPayers.title')}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{tb('topPayers.hint')}</p>
            </div>
            <Link
              href="/admin/workspaces"
              className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
            >
              {tb('topPayers.all')}
            </Link>
          </div>
          <div className="thin-scrollbar overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {tb('topPayers.workspace')}
                  </th>
                  <th scope="col" className="w-[100px] px-3 py-3 text-start font-medium">
                    {tb('topPayers.orders')}
                  </th>
                  <th scope="col" className="w-[140px] px-4 py-3 text-start font-medium">
                    {tb('topPayers.total')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.topWorkspaces.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                      {tb('topPayers.empty')}
                    </td>
                  </tr>
                ) : (
                  d.topWorkspaces.map((w, i) => (
                    <tr key={w.workspace?.id ?? `n${i}`} className="hover:bg-muted/40">
                      <td className="px-4 py-3 font-semibold">
                        {w.workspace ? (
                          <Link
                            href={`/admin/workspaces?q=${encodeURIComponent(w.workspace.slug)}`}
                            className="hover:underline"
                          >
                            {w.workspace.name}
                          </Link>
                        ) : (
                          tb('topPayers.unknown')
                        )}
                      </td>
                      <td className="px-3 py-3 font-mono">{w.orders}</td>
                      <td className="px-4 py-3 font-mono">
                        {new Intl.NumberFormat(locale, { style: 'currency', currency: cur }).format(
                          Number(w.total),
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
        <Section className="lg:col-span-4" title={tb('statusMix.title')}>
          <p className="mb-3 mt-1 text-xs text-muted-foreground">{tb('statusMix.hint')}</p>
          <Donut
            label={tb('statusMix.title')}
            items={d.statusMix.map((s, i) => ({
              label: s.label,
              value: s.value,
              color: CHART_COLORS[i % CHART_COLORS.length]!,
            }))}
          />
        </Section>
      </section>
    </div>
  );
}

const ORDER_WINDOWS: OrderWindow[] = ['90d', 'this_year', 'all'];

/** Admin > Order history > Analytics (TW-PAYGW-040). */
export function OrderAnalyticsPage() {
  const t = useTranslations('platform-payment-gateways.billing.orderAnalytics');
  const to = useTranslations('platform-payment-gateways.billing.orders');
  const tc = useTranslations('platform-payment-gateways.billing.common');
  const locale = useLocale();
  const toast = useToast();
  const { values, set } = useUrlState({ window: '90d' });
  const window = values.window as OrderWindow;
  const q = useQuery({
    queryKey: [...BILLING_KEYS.orderAnalytics, window],
    queryFn: ({ signal }) => billingApi.orderAnalytics({ window }, signal),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
  const exportCsv = useMutation({
    mutationFn: () => billingApi.exportOrders({ window }),
    onSuccess: (r) => downloadText(r.filename, r.csv),
    onError: () => toast.error(tc('exportFailed')),
  });
  if (q.isPending) {
    return (
      <LoadingBlock className="flex min-h-64 items-center justify-center text-muted-foreground" />
    );
  }
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const k = d.kpis;
  const cur = d.reportingCurrency;
  const m = (a: string) => wholeMoney(a, cur, locale);
  const maxAddon = Math.max(1, ...d.addons.map((a) => Number(a.total)));
  const maxFunnel = Math.max(1, ...d.funnel.map((f) => f.count));
  const maxCountry = Math.max(1, ...d.byCountry.map((c) => c.count));

  return (
    <div className="space-y-5">
      <Crumb
        items={[{ label: to('title'), href: '/admin/order-history' }, { label: tc('analytics') }]}
      />
      <BillingHeader
        eyebrow={t('eyebrow')}
        title={<TwoToneTitle first={t('titleFirst')} second={t('titleSecond')} />}
        description={t('description')}
        actions={
          <>
            <WindowSelect
              value={window}
              label={t('window')}
              onChange={(v) => set({ window: v })}
              options={ORDER_WINDOWS.map((w) => ({ value: w, label: to(`windows.${w}`) }))}
            />
            <LinkPill href="/admin/order-history">{t('viewLedger')}</LinkPill>
            <ExportButton busy={exportCsv.isPending} onClick={() => exportCsv.mutate()}>
              {tc('exportCsv')}
            </ExportButton>
          </>
        }
      />
      <KpiStrip columns={6}>
        <Kpi
          label={t('kpi.total')}
          value={k.total.toLocaleString(locale)}
          hint={`${signedPct(k.totalDeltaPct)} ${to('kpi.vsPrevious')}`}
          hintTone={k.totalDeltaPct >= 0 ? 'accent' : 'danger'}
        />
        <Kpi
          tone="accent"
          label={t('kpi.newMrr')}
          value={`+${m(k.newMrr)}`}
          hint={t('kpi.paid', { count: k.paidCount })}
          hintTone="accent"
        />
        <Kpi
          tone="warning"
          label={t('kpi.lostMrr')}
          value={`-${m(k.lostMrr)}`}
          hint={t('kpi.cancels', { count: k.cancels })}
        />
        <Kpi
          label={t('kpi.aov')}
          value={m(k.avgOrderValue)}
          hint={t('kpi.paidOrders')}
          hintTone="accent"
        />
        <Kpi
          label={t('kpi.attach')}
          value={`${k.attachPct}%`}
          hint={t('kpi.attachLabel', { addons: k.addons, total: k.total })}
        />
        <Kpi
          label={t('kpi.conversion')}
          value={`${k.conversionPct}%`}
          hint={t('kpi.conversionHint', { signups: k.signups })}
          hintTone="accent"
        />
      </KpiStrip>

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Section className="lg:col-span-8" kicker={t('motion.kicker')} title={t('motion.title')}>
          <MotionBars
            label={t('motion.title')}
            labels={d.motion.labels}
            up={d.motion.paid}
            down={d.motion.cancelled}
            upColor="var(--primary)"
            downColor="var(--danger)"
            upName={t('motion.paid')}
            downName={t('motion.cancelled')}
          />
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-primary" aria-hidden />
              {t('motion.paid')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-danger" aria-hidden />
              {t('motion.cancelled')}
            </span>
          </div>
        </Section>
        <Section className="lg:col-span-4" kicker={t('typeMix.kicker')} title={t('typeMix.title')}>
          <Donut
            label={t('typeMix.title')}
            items={d.typeMix.map((s, i) => ({
              label: s.label,
              value: s.value,
              color: CHART_COLORS[i % CHART_COLORS.length]!,
            }))}
          />
        </Section>
      </section>

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Section className="lg:col-span-5" kicker={t('addons.kicker')} title={t('addons.title')}>
          {d.addons.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">{t('addons.empty')}</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {d.addons.map((a) => (
                <li key={a.label}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-semibold">{a.label}</span>
                    <span className="font-mono text-xs">
                      {a.count} · {m(a.total)}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${Math.round((Number(a.total) / maxAddon) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section className="lg:col-span-4" kicker={t('funnel.kicker')} title={t('funnel.title')}>
          <ul className="space-y-0.5 text-sm">
            {d.funnel.map((f, i) => (
              <li
                key={f.label}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)] items-center gap-3"
              >
                <FunnelBand
                  topPct={(f.count / maxFunnel) * 100}
                  bottomPct={((d.funnel[i + 1]?.count ?? f.count * 0.75) / maxFunnel) * 100}
                  strength={1 - i * 0.14}
                />
                <p className="min-w-0 leading-tight">
                  <span className="block truncate">{f.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {f.count.toLocaleString(locale)}
                  </span>
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">{t('funnel.note')}</p>
        </Section>
        <Section
          className="lg:col-span-3"
          kicker={t('countries.kicker')}
          title={t('countries.title')}
        >
          {d.byCountry.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">{t('countries.empty')}</p>
          ) : (
            <ul className="space-y-2.5 text-sm">
              {d.byCountry.map((c) => (
                <li key={c.country}>
                  <div className="flex items-center justify-between">
                    <span>{c.country}</span>
                    <span className="font-mono text-xs">{c.count.toLocaleString(locale)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-brand"
                      style={{ width: `${Math.round((c.count / maxCountry) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </section>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('cohorts.kicker')}
            </div>
            <h2 className="mt-1 text-xl font-semibold">{t('cohorts.title')}</h2>
          </div>
          <span className="font-mono text-xs text-muted-foreground">{t('cohorts.last')}</span>
        </div>
        {d.cohorts.every((c) => c.size === 0) ? (
          <EmptyState title={t('cohorts.emptyTitle')} message={t('cohorts.empty')} />
        ) : (
          <Heatmap rows={d.cohorts} monthLabel={(i) => `M${i}`} />
        )}
      </Card>
    </div>
  );
}
