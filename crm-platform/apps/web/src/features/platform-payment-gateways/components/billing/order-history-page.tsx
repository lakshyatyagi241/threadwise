'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminOrderRow, AwaitingApprovalRow, OrderTypeFilter } from '@crm/contracts';
import { Badge, Button, ConfirmDialog, Modal, Textarea } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { ApiError } from '@/lib/api/errors';
import { BILLING_KEYS, billingApi } from '../../billing-api';
import {
  capitalize,
  downloadText,
  money,
  shortMoney,
  signedPct,
  ymd,
} from '../../lib/billing-format';
import { useUrlState } from '../../lib/use-url-state';
import { RefundDialog, type RefundTarget } from './refund-dialog';
import {
  BillingHeader,
  Crumb,
  ExportButton,
  FilterBar,
  Kpi,
  KpiStrip,
  LinkPill,
  PagerFooter,
  StatusPill,
  Th,
  TableCard,
  TrendIcon,
  TwoToneTitle,
  CustomRange,
  WindowSelect,
  customRangeValid,
  windowPatch,
  WorkspaceLink,
  rowTone,
} from './parts';

const NS = 'platform-payment-gateways.billing.orders';
const DEFAULTS = { window: '90d', from: '', to: '', type: 'all', q: '' };
const TYPES: OrderTypeFilter[] = ['all', 'new', 'upgrade', 'downgrade', 'addon', 'cancel'];

type Pending =
  | { kind: 'approve'; row: { id: string; orderNumber: string } }
  | { kind: 'cancel'; row: { id: string; orderNumber: string } }
  | { kind: 'reject'; row: { id: string; orderNumber: string } };

/** Admin > Order history (TW-PAYGW-037..039): KPIs, type pills, search, the approval queue and every order across workspaces. */
export function OrderHistoryPage() {
  const t = useTranslations(NS);
  const tc = useTranslations('platform-payment-gateways.billing.common');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { operator } = useOperator();
  const canEdit = operator.role === 'super_admin';
  const { values, page, set, setPage } = useUrlState(DEFAULTS);
  const [pending, setPending] = useState<Pending | null>(null);
  const [note, setNote] = useState('');
  const [refund, setRefund] = useState<RefundTarget | null>(null);

  // A half-filled or reversed custom range keeps the 90-day report on screen until the two days are right.
  const custom = values.window === 'custom' && customRangeValid(values.from, values.to);
  const query = {
    window: (values.window === 'custom' && !custom ? '90d' : values.window) as
      '90d' | 'this_year' | 'all' | 'custom',
    ...(custom ? { from: values.from, to: values.to } : {}),
    type: values.type as OrderTypeFilter,
    q: values.q || undefined,
    page,
  };
  const list = useQuery({
    queryKey: [...BILLING_KEYS.orders, query],
    queryFn: ({ signal }) => billingApi.orders(query, signal),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  const explain = (e: unknown) =>
    e instanceof ApiError && (e.status === 409 || e.status === 404)
      ? e.message
      : tc('actionFailed');

  const act = useMutation({
    mutationFn: (p: Pending) =>
      p.kind === 'approve'
        ? billingApi.approve(p.row.id)
        : p.kind === 'cancel'
          ? billingApi.cancel(p.row.id)
          : billingApi.reject(p.row.id, { reviewNote: note.trim() || undefined }),
    onSuccess: (r) => {
      (r.unchanged ? toast.error : toast.success)(r.message);
      setPending(null);
      setNote('');
      void qc.invalidateQueries({ queryKey: ['operator', 'billing'] });
    },
    onError: (e) => {
      toast.error(explain(e));
      setPending(null);
    },
  });

  const exportCsv = useMutation({
    mutationFn: () => billingApi.exportOrders(query),
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
  const cur = d.reportingCurrency;
  const sym = (n: string) => shortMoney(n, cur, locale);
  const k = d.kpis;

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
              options={[
                { value: '90d', label: t('windows.90d') },
                { value: 'this_year', label: t('windows.this_year') },
                { value: 'all', label: t('windows.all') },
                { value: 'custom', label: t('windows.custom') },
              ]}
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
            <LinkPill href="/admin/order-history/analytics">
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
          label={t('kpi.total')}
          value={k.total.toLocaleString(locale)}
          hint={`${signedPct(k.totalDeltaPct)} ${t('kpi.vsPrevious')}`}
          hintTone={k.totalDeltaPct >= 0 ? 'accent' : 'danger'}
        />
        <Kpi
          tone="accent"
          label={t('kpi.upgrades')}
          value={k.upgrades.count.toLocaleString(locale)}
          hint={t('kpi.mrrAdded', { amount: sym(k.upgrades.money.amount) })}
          hintTone="accent"
        />
        <Kpi
          tone="warning"
          label={t('kpi.downgrades')}
          value={k.downgrades.count.toLocaleString(locale)}
          hint={t('kpi.mrrLowered', { amount: sym(k.downgrades.money.amount) })}
        />
        <Kpi
          label={t('kpi.addons')}
          value={k.addons.count.toLocaleString(locale)}
          hint={t('kpi.attached', { amount: sym(k.addons.money.amount) })}
        />
        <Kpi
          tone="danger"
          valueTone="danger"
          label={t('kpi.cancellations')}
          value={k.cancellations.count.toLocaleString(locale)}
          hint={t('kpi.mrrLost', { amount: sym(k.cancellations.money.amount) })}
          hintTone="danger"
        />
      </KpiStrip>

      <FilterBar
        label={t('typeFilter')}
        active={values.type}
        onPick={(id) => set({ type: id })}
        pills={TYPES.map((id) => ({
          id,
          label: t(`types.${id}`),
          count: id === 'all' ? k.total : undefined,
        }))}
        search={{ value: values.q, placeholder: t('search'), onSubmit: (v) => set({ q: v }) }}
      />

      {d.awaiting.length > 0 && (
        <AwaitingPanel
          rows={d.awaiting}
          canEdit={canEdit}
          locale={locale}
          onApprove={(r) =>
            setPending({ kind: 'approve', row: { id: r.id, orderNumber: r.orderNumber } })
          }
          onReject={(r) =>
            setPending({ kind: 'reject', row: { id: r.id, orderNumber: r.orderNumber } })
          }
        />
      )}

      <TableCard
        minWidth={1080}
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
            <Th className="w-[150px]">{t('col.order')}</Th>
            <Th className="w-[110px]">{t('col.date')}</Th>
            <Th>{t('col.workspace')}</Th>
            <Th className="w-[130px]">{t('col.type')}</Th>
            <Th>{t('col.item')}</Th>
            <Th align="right" className="w-[120px]">
              {t('col.mrr')}
            </Th>
            <Th align="right" className="w-[110px]">
              {t('col.total')}
            </Th>
            <Th align="center" className="w-[130px]">
              {t('col.status')}
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
              <OrderRow
                key={o.id}
                o={o}
                locale={locale}
                canEdit={canEdit}
                onApprove={() =>
                  setPending({ kind: 'approve', row: { id: o.id, orderNumber: o.orderNumber } })
                }
                onCancel={() =>
                  setPending({ kind: 'cancel', row: { id: o.id, orderNumber: o.orderNumber } })
                }
                onRefund={() =>
                  setRefund({
                    kind: 'order',
                    id: o.id,
                    label: o.orderNumber,
                    currency: o.currency,
                    total: o.total,
                  })
                }
              />
            ))
          )}
        </tbody>
      </TableCard>

      <ConfirmDialog
        open={pending?.kind === 'approve'}
        title={t('confirm.approveTitle')}
        message={t('confirm.approve')}
        confirmLabel={t('actions.markPaid')}
        cancelLabel={tc('cancel')}
        busy={act.isPending}
        onConfirm={() => pending && act.mutate(pending)}
        onClose={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending?.kind === 'cancel'}
        title={t('confirm.cancelTitle')}
        message={t('confirm.cancel')}
        confirmLabel={t('actions.cancelOrder')}
        cancelLabel={tc('back')}
        tone="danger"
        busy={act.isPending}
        onConfirm={() => pending && act.mutate(pending)}
        onClose={() => setPending(null)}
      />
      <RefundDialog target={refund} locale={locale} onClose={() => setRefund(null)} />
      <Modal
        open={pending?.kind === 'reject'}
        onClose={() => setPending(null)}
        title={t('reject.title', { order: pending?.row.orderNumber ?? '' })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)} disabled={act.isPending}>
              {tc('cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={act.isPending}
              onClick={() => pending && act.mutate(pending)}
            >
              {t('actions.reject')}
            </Button>
          </>
        }
      >
        <label htmlFor="reject-note" className="block text-sm font-medium">
          {t('reject.reason')}
        </label>
        <Textarea
          id="reject-note"
          rows={3}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Modal>
    </div>
  );
}

function OrderRow({
  o,
  locale,
  canEdit,
  onApprove,
  onCancel,
  onRefund,
}: {
  o: AdminOrderRow;
  locale: string;
  canEdit: boolean;
  onApprove: () => void;
  onCancel: () => void;
  onRefund: () => void;
}) {
  const t = useTranslations(NS);
  const tc = useTranslations('platform-payment-gateways.billing.common');
  const lost = o.status === 'failed' || o.status === 'refunded' || o.status === 'cancelled';
  const amount = money(o.total, o.currency, locale);
  const open = o.status === 'pending' || o.status === 'awaiting_approval';
  return (
    <tr className={`hover:bg-muted/40 ${rowTone(o.status)}`}>
      <td className="px-3 py-3 ps-4 font-mono text-[11px]">{o.orderNumber}</td>
      <td className="px-3 py-3 font-mono text-[11px]">{ymd(o.createdAt)}</td>
      <td className="px-3 py-3 font-semibold">
        <span className="inline-flex items-center gap-2">
          {o.workspace?.name ?? '—'}
          {o.workspace && <WorkspaceLink slug={o.workspace.slug} label={tc('openWorkspace')} />}
        </span>
      </td>
      <td className="px-3 py-3">
        <Badge
          tone={
            o.type === 'downgrade'
              ? 'warning'
              : o.type === 'new' || o.type === 'upgrade'
                ? 'success'
                : 'neutral'
          }
        >
          {t(`rowTypes.${o.type}`)}
        </Badge>
      </td>
      <td className="px-3 py-3">
        <div className="text-[13px]">
          {o.itemName ?? '—'}
          {o.billingPeriod && (
            <span className="text-muted-foreground"> · {tc(`periods.${o.billingPeriod}`)}</span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">{o.itemSub ?? '—'}</div>
      </td>
      <td
        className={`px-3 py-3 text-end font-mono ${lost ? 'text-danger' : o.status === 'paid' ? 'text-success' : ''}`}
      >
        {o.status === 'paid' ? `+${amount}` : lost ? `-${amount}` : '—'}
      </td>
      <td className={`px-3 py-3 text-end font-mono ${o.status === 'paid' ? 'text-success' : ''}`}>
        {amount}
      </td>
      <td className="px-3 py-3 text-center">
        <StatusPill status={o.status} label={tc(`status.${o.status}`)} />
        {o.awaitingApproval && (
          <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-warning">
            {t('awaitingApproval')}
          </div>
        )}
        {o.status === 'paid' && canEdit && (
          <div className="mt-1.5">
            <Button
              size="sm"
              variant="secondary"
              className="h-7 rounded-full border-danger/40 px-2 text-[11px] text-danger"
              onClick={onRefund}
            >
              {t('actions.refund')}
            </Button>
          </div>
        )}
        {open && canEdit && (
          <div className="mt-1.5 flex flex-col gap-1">
            <Button
              size="sm"
              variant="secondary"
              className="h-7 rounded-full px-2 text-[11px]"
              onClick={onApprove}
            >
              {t('actions.markPaid')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="h-7 rounded-full border-danger/40 px-2 text-[11px] text-danger"
              onClick={onCancel}
            >
              {t('actions.cancelOrder')}
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

/** Offline and bank-transfer orders with a payment proof waiting for a decision (TW-PAYGW-038). Never hidden by the filters. */
function AwaitingPanel({
  rows,
  canEdit,
  locale,
  onApprove,
  onReject,
}: {
  rows: AwaitingApprovalRow[];
  canEdit: boolean;
  locale: string;
  onApprove: (r: AwaitingApprovalRow) => void;
  onReject: (r: AwaitingApprovalRow) => void;
}) {
  const t = useTranslations(NS);
  return (
    <section
      aria-labelledby="awaiting-title"
      className="overflow-hidden rounded-xl border border-warning/50 bg-background"
    >
      <div className="flex items-center gap-2 border-b border-warning/40 bg-warning/10 px-5 py-3">
        <h2 id="awaiting-title" className="text-sm font-semibold text-warning">
          {t('awaiting.title')}
        </h2>
        <span className="font-mono text-[11px] text-warning/80">({rows.length})</span>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
            <div className="min-w-[160px]">
              <div className="font-mono text-[11px]">{r.orderNumber}</div>
              <div className="text-[11px] text-muted-foreground">
                {r.workspaceName ?? '—'} · {r.gatewaySlug ? capitalize(r.gatewaySlug) : '—'}
              </div>
            </div>
            <div className="font-mono text-xs text-primary">
              {money(r.total, r.currency, locale)}
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              {r.paymentReference && (
                <span>
                  {t('awaiting.ref')}{' '}
                  <span className="font-mono text-foreground">{r.paymentReference}</span>
                </span>
              )}
              {r.hasProof && (
                <span className="font-semibold text-primary">{t('awaiting.proofAttached')}</span>
              )}
              {r.proofNote && (
                <span className="max-w-[220px] truncate italic" title={r.proofNote}>
                  {r.proofNote}
                </span>
              )}
            </div>
            {canEdit && (
              <div className="ms-auto flex items-center gap-2">
                <Button size="sm" className="rounded-full" onClick={() => onApprove(r)}>
                  {t('actions.approve')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="rounded-full border-danger/50 text-danger"
                  onClick={() => onReject(r)}
                >
                  {t('actions.reject')}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
