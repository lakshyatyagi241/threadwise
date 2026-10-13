'use client';

import { useLocale, useTranslations } from 'next-intl';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type { BillingStatusFilter, BillingWindow } from '@crm/contracts';
import { Card } from '@crm/ui';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { BILLING_KEYS, billingApi } from '../../billing-api';
import { capitalize, downloadText, money, wholeMoney, ymdHm } from '../../lib/billing-format';
import { useUrlState } from '../../lib/use-url-state';
import { TrendChart } from './charts';
import {
  BillingHeader,
  Crumb,
  DeltaChip,
  ExportButton,
  FilterBar,
  Kpi,
  KpiStrip,
  LinkPill,
  PagerFooter,
  StatusPill,
  TableCard,
  Th,
  TrendIcon,
  TwoToneTitle,
  CustomRange,
  WindowSelect,
  customRangeValid,
  windowPatch,
  WorkspaceLink,
  rowTone,
} from './parts';

const NS = 'platform-payment-gateways.billing.history';
const DEFAULTS = { window: '90d', from: '', to: '', status: 'all', gateway: '', q: '' };
const STATUSES: BillingStatusFilter[] = ['all', 'paid', 'failed', 'refunded', 'pending'];
export const BILLING_WINDOWS: BillingWindow[] = ['7d', '30d', '90d', '1y', 'all', 'custom'];

/** Admin > Billing history (TW-PAYGW-041): the payment-event ledger with KPIs, a trend, filters and every order's outcome. */
export function BillingHistoryPage() {
  const t = useTranslations(NS);
  const tc = useTranslations('platform-payment-gateways.billing.common');
  const locale = useLocale();
  const toast = useToast();
  const { values, page, set, setPage } = useUrlState(DEFAULTS);
  // A half-filled or reversed custom range keeps the 90-day report on screen until the two days are right.
  const custom = values.window === 'custom' && customRangeValid(values.from, values.to);
  const query = {
    window: (values.window === 'custom' && !custom ? '90d' : values.window) as BillingWindow,
    ...(custom ? { from: values.from, to: values.to } : {}),
    status: values.status as BillingStatusFilter,
    gateway: values.gateway || undefined,
    q: values.q || undefined,
    page,
  };
  const list = useQuery({
    queryKey: [...BILLING_KEYS.history, query],
    queryFn: ({ signal }) => billingApi.history(query, signal),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
  const exportCsv = useMutation({
    mutationFn: () => billingApi.exportHistory(query),
    onSuccess: (r) => {
      downloadText(r.filename, r.csv);
      if (r.truncated) toast.error(tc('exportTruncated', { rows: r.rows }));
    },
    onError: () => toast.error(tc('exportFailed')),
  });

  if (list.isPending) {
    return (
      <LoadingBlock className="flex min-h-64 items-center justify-center text-muted-foreground" />
    );
  }
  if (list.isError) return <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />;
  const d = list.data;
  const k = d.kpis;
  const cur = d.reportingCurrency;

  return (
    <div className="space-y-5">
      <Crumb items={[{ label: t('title') }]} />
      <BillingHeader
        eyebrow={t('eyebrow')}
        title={<TwoToneTitle first={t('titleFirst')} second={t('titleSecond')} />}
        description={t('description')}
        actions={
          <>
            <WindowSelect
              value={values.window}
              label={t('window')}
              onChange={(v) => set(windowPatch(v))}
              options={BILLING_WINDOWS.map((w) => ({ value: w, label: tc(`windows.${w}`) }))}
            />
            {values.window === 'custom' && (
              <CustomRange
                from={values.from}
                to={values.to}
                onChange={(p) => set(p)}
                fromLabel={tc('customFrom')}
                toLabel={tc('customTo')}
                invalidLabel={tc('customInvalid')}
              />
            )}
            <LinkPill href="/admin/billing-history/analytics">
              <TrendIcon />
              {tc('analytics')}
            </LinkPill>
            <ExportButton busy={exportCsv.isPending} onClick={() => exportCsv.mutate()}>
              {tc('exportCsv')}
            </ExportButton>
          </>
        }
      />

      <KpiStrip>
        <Kpi
          label={t('kpi.gross')}
          value={wholeMoney(k.gross.amount, cur, locale)}
          hint={
            <>
              <DeltaChip pct={k.grossDeltaPct} /> <span className="ms-1">{t('kpi.vsPrev')}</span>
            </>
          }
        />
        <Kpi
          tone="accent"
          label={t('kpi.charges')}
          value={k.charges.toLocaleString(locale)}
          hint={t('kpi.successRate', { pct: k.successPct })}
          hintTone="accent"
        />
        <Kpi
          tone="warning"
          label={t('kpi.failed')}
          value={k.failed.toLocaleString(locale)}
          hint={t('kpi.dunning')}
        />
        <Kpi
          label={t('kpi.refunds')}
          value={k.refunds.toLocaleString(locale)}
          hint={t('kpi.refundsTotal', { amount: wholeMoney(k.refundsMoney.amount, cur, locale) })}
        />
        <Kpi
          tone="danger"
          valueTone="danger"
          label={t('kpi.chargebacks')}
          value={k.chargebacks.toLocaleString(locale)}
          hint={t('kpi.disputed', { amount: wholeMoney(k.chargebacksMoney.amount, cur, locale) })}
          hintTone="danger"
        />
      </KpiStrip>

      <Card>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('trend.kicker')}
            </div>
            <h2 className="mt-1 text-xl font-semibold">{t('trend.title')}</h2>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-primary" aria-hidden />
              {t('trend.charges')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-danger" aria-hidden />
              {t('trend.refunds')}
            </span>
          </div>
        </div>
        <TrendChart
          label={t('trend.title')}
          labels={d.trend.labels}
          series={[
            { name: t('trend.charges'), values: d.trend.charges, color: 'var(--primary)' },
            { name: t('trend.refunds'), values: d.trend.refunds, color: 'var(--danger)' },
          ]}
        />
      </Card>

      <FilterBar
        label={t('statusFilter')}
        active={values.status}
        onPick={(id) => set({ status: id })}
        pills={STATUSES.map((id) => ({ id, label: t(`statuses.${id}`) }))}
        search={{ value: values.q, placeholder: t('search'), onSubmit: (v) => set({ q: v }) }}
      >
        <select
          aria-label={t('gateway')}
          value={values.gateway}
          onChange={(e) => set({ gateway: e.target.value })}
          className="h-8 rounded-full border border-border bg-background px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <option value="">{t('allGateways')}</option>
          {d.gateways.map((g) => (
            <option key={g} value={g}>
              {capitalize(g)}
            </option>
          ))}
        </select>
      </FilterBar>

      <TableCard
        minWidth={1040}
        footer={
          <PagerFooter
            page={d.page}
            pageSize={d.pageSize}
            total={d.total}
            noun={t('noun')}
            onPage={setPage}
          />
        }
      >
        <thead className="border-b border-border bg-muted/50">
          <tr>
            <Th className="w-[150px]">{t('col.date')}</Th>
            <Th className="w-[170px]">{t('col.order')}</Th>
            <Th>{t('col.workspace')}</Th>
            <Th className="w-[110px]">{t('col.gateway')}</Th>
            <Th className="w-[140px]">{t('col.plan')}</Th>
            <Th align="right" className="w-[120px]">
              {t('col.amount')}
            </Th>
            <Th align="center" className="w-[120px]">
              {t('col.status')}
            </Th>
            <Th align="center" className="w-[60px]">
              <span className="sr-only">{t('col.actions')}</span>
            </Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {d.data.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                {t('empty')}
              </td>
            </tr>
          ) : (
            d.data.map((o) => (
              <tr key={o.id} className={`hover:bg-muted/40 ${rowTone(o.status)}`}>
                <td className="px-3 py-3 ps-4 font-mono text-[11px]">{ymdHm(o.createdAt)}</td>
                <td className="px-3 py-3 font-mono text-[11px]">{o.orderNumber}</td>
                <td className="min-w-0 px-3 py-3">
                  <div className="truncate font-semibold leading-tight">
                    {o.workspace?.name ?? '—'}
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {o.customerEmail ?? o.customerName ?? '—'}
                  </div>
                </td>
                <td className="px-3 py-3 text-xs">
                  {o.gatewaySlug ? capitalize(o.gatewaySlug) : '—'}
                </td>
                <td className="truncate px-3 py-3 text-xs">{o.planName ?? '—'}</td>
                <td
                  className={`px-3 py-3 text-right font-mono ${o.status === 'paid' ? 'text-success' : o.status === 'refunded' || o.status === 'failed' ? 'text-danger' : ''}`}
                >
                  {o.status === 'refunded' ? '-' : ''}
                  {money(o.total, o.currency, locale)}
                </td>
                <td className="px-3 py-3 text-center">
                  <StatusPill status={o.status} label={tc(`status.${o.status}`)} />
                </td>
                <td className="px-3 py-3 text-center">
                  {o.workspace && (
                    <WorkspaceLink slug={o.workspace.slug} label={tc('openWorkspace')} />
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </TableCard>
    </div>
  );
}
