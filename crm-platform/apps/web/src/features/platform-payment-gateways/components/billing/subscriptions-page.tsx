'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminSubscriptionRow } from '@crm/contracts';
import { Badge, Button, ConfirmDialog } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { BILLING_KEYS, billingApi } from '../../billing-api';
import { capitalize, money, ymd } from '../../lib/billing-format';
import { useUrlState } from '../../lib/use-url-state';
import {
  BillingHeader,
  Crumb,
  FilterBar,
  Kpi,
  PagerFooter,
  TableCard,
  Th,
  TwoToneTitle,
  WorkspaceLink,
} from './parts';
import { RefundDialog, type RefundTarget } from './refund-dialog';

const NS = 'platform-payment-gateways.billing.subscriptions';
const DEFAULTS = { status: 'all', kind: 'all', q: '' };
const STATUSES = ['all', 'active', 'past_due', 'pending', 'canceled', 'expired'] as const;
const TONE: Record<AdminSubscriptionRow['status'], 'success' | 'danger' | 'warning' | 'neutral'> = {
  active: 'success',
  past_due: 'danger',
  pending: 'warning',
  canceled: 'neutral',
  expired: 'neutral',
};

type Ending = { row: AdminSubscriptionRow; atCycleEnd: boolean };

/**
 * Admin > Subscriptions (TW-PAYGW-062): every plan and add-on subscription held with a payment provider across workspaces:
 * status, price, paid-until, a flag for a cancel the provider did not take, and the operator's controls: end it (at the cycle's
 * end or now), refresh it from the provider, refund one of its charges.
 */
export function SubscriptionsPage() {
  const t = useTranslations(NS);
  const tc = useTranslations('platform-payment-gateways.billing.common');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { operator } = useOperator();
  const canEdit = operator.role === 'super_admin';
  const { values, page, set, setPage } = useUrlState(DEFAULTS);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [refund, setRefund] = useState<RefundTarget | null>(null);

  const query = {
    status: values.status as (typeof STATUSES)[number],
    kind: values.kind as 'all' | 'plan' | 'addon',
    q: values.q || undefined,
    page,
  };
  const list = useQuery({
    queryKey: [...BILLING_KEYS.subscriptions, query],
    queryFn: ({ signal }) => billingApi.subscriptions(query, signal),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: BILLING_KEYS.subscriptions });

  const end = useMutation({
    mutationFn: (e: Ending) =>
      billingApi.cancelSubscription(e.row.id, { atCycleEnd: e.atCycleEnd }),
    onSuccess: (r) => {
      if (r.alreadyEnded) toast.error(t('alreadyEnded'));
      else if (r.remote === 'ok') toast.success(t('ended'));
      else toast.error(t(r.remote === 'failed' ? 'endedLocalOnly' : 'endedUnsupported'));
      setEnding(null);
      void refresh();
    },
    onError: () => {
      toast.error(tc('actionFailed'));
      setEnding(null);
    },
  });
  const sync = useMutation({
    mutationFn: (id: string) => billingApi.syncSubscription(id),
    onSuccess: (r) => {
      toast.success(t('synced', { outcome: r.outcome }));
      void refresh();
    },
    onError: () => toast.error(tc('actionFailed')),
  });

  if (list.isPending) {
    return (
      <LoadingBlock className="flex min-h-64 items-center justify-center text-muted-foreground" />
    );
  }
  if (list.isError) return <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />;
  const d = list.data;

  return (
    <div className="space-y-5">
      <Crumb items={[{ label: t('title') }]} />
      <BillingHeader
        eyebrow={t('eyebrow')}
        title={<TwoToneTitle first={t('titleFirst')} second={t('titleSecond')} />}
        description={t('description')}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi tone="accent" label={t('kpi.active')} value={d.kpis.active.toLocaleString(locale)} />
        <Kpi
          tone="danger"
          valueTone="danger"
          label={t('kpi.pastDue')}
          value={d.kpis.pastDue.toLocaleString(locale)}
        />
        <Kpi label={t('kpi.canceled')} value={d.kpis.canceled.toLocaleString(locale)} />
      </div>

      <FilterBar
        label={t('statusFilter')}
        active={values.status}
        onPick={(id) => set({ status: id })}
        pills={STATUSES.map((id) => ({ id, label: t(`statuses.${id}`) }))}
        search={{ value: values.q, placeholder: t('search'), onSubmit: (v) => set({ q: v }) }}
      />

      <TableCard
        minWidth={1100}
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
            <Th>{t('col.workspace')}</Th>
            <Th>{t('col.item')}</Th>
            <Th align="right" className="w-[120px]">
              {t('col.price')}
            </Th>
            <Th className="w-[120px]">{t('col.paidUntil')}</Th>
            <Th className="w-[130px]">{t('col.status')}</Th>
            <Th>{t('col.provider')}</Th>
            {canEdit && <Th align="right">{t('col.actions')}</Th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {d.data.length === 0 ? (
            <tr>
              <td
                colSpan={canEdit ? 7 : 6}
                className="px-4 py-10 text-center text-muted-foreground"
              >
                {t('empty')}
              </td>
            </tr>
          ) : (
            d.data.map((r) => {
              const live = r.status === 'active' || r.status === 'past_due';
              return (
                <tr key={r.id} className="hover:bg-muted/40" data-testid="subscription-row">
                  <td className="px-3 py-3 ps-4 font-semibold">
                    <span className="inline-flex items-center gap-2">
                      {r.workspace.name}
                      <WorkspaceLink slug={r.workspace.slug} label={tc('openWorkspace')} />
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="text-[13px]">{r.name}</div>
                    <div className="text-[11px] text-muted-foreground">{t(`kind.${r.kind}`)}</div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono">
                    {money(r.amount, r.currency, locale)}
                    <span className="block text-[11px] text-muted-foreground">
                      {tc(`periods.${r.billingCycle}`)}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-mono text-[11px]">
                    {r.currentPeriodEnd ? ymd(r.currentPeriodEnd) : '—'}
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={TONE[r.status]}>{t(`statuses.${r.status}`)}</Badge>
                    {r.cancelFailed && (
                      <div className="mt-1 text-[11px] text-danger" title={t('cancelFailedHint')}>
                        {t('cancelFailed')}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="text-[13px]">{capitalize(r.gateway)}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {r.gatewaySubscriptionId ?? '—'}
                    </div>
                  </td>
                  {canEdit && (
                    <td className="px-3 py-3 text-right">
                      <div className="inline-flex flex-wrap justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 rounded-full px-2 text-[11px]"
                          disabled={sync.isPending || !r.gatewaySubscriptionId}
                          onClick={() => sync.mutate(r.id)}
                        >
                          {t('actions.sync')}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 rounded-full px-2 text-[11px]"
                          disabled={!r.gatewaySubscriptionId}
                          onClick={() =>
                            setRefund({
                              kind: 'subscription',
                              id: r.id,
                              label: `${r.workspace.name} · ${r.name}`,
                              currency: r.currency,
                            })
                          }
                        >
                          {t('actions.refund')}
                        </Button>
                        {live && (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-7 rounded-full border-danger/40 px-2 text-[11px] text-danger"
                              onClick={() => setEnding({ row: r, atCycleEnd: true })}
                            >
                              {t('actions.endAtCycle')}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-7 rounded-full border-danger/40 px-2 text-[11px] text-danger"
                              onClick={() => setEnding({ row: r, atCycleEnd: false })}
                            >
                              {t('actions.endNow')}
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </TableCard>

      <ConfirmDialog
        open={ending !== null}
        title={t('confirm.title')}
        message={
          ending?.atCycleEnd
            ? t('confirm.atCycle', { name: ending.row.workspace.name })
            : t('confirm.now', { name: ending?.row.workspace.name ?? '' })
        }
        confirmLabel={ending?.atCycleEnd ? t('actions.endAtCycle') : t('actions.endNow')}
        cancelLabel={tc('back')}
        tone="danger"
        busy={end.isPending}
        onConfirm={() => ending && end.mutate(ending)}
        onClose={() => setEnding(null)}
      />
      <RefundDialog target={refund} locale={locale} onClose={() => setRefund(null)} />
    </div>
  );
}
