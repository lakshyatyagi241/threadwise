'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  manualInvoiceRequestSchema,
  type InvoiceRow,
  type InvoiceStatusFilter,
  type InvoiceWindow,
  type InvoicesResponse,
} from '@crm/contracts';
import {
  Button,
  ConfirmDialog,
  Field,
  Input,
  Menu,
  MenuItem,
  MenuLabel,
  Modal,
  Select,
  Textarea,
  cn,
} from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { ApiError } from '@/lib/api/errors';
import { BILLING_KEYS, billingApi } from '../../billing-api';
import {
  downloadText,
  money,
  periodEnd,
  shortMoney,
  signedPct,
  ymd,
} from '../../lib/billing-format';
import { useUrlState } from '../../lib/use-url-state';
import {
  BillingHeader,
  Crumb,
  ExportButton,
  FilterBar,
  Kpi,
  KpiStrip,
  PagerFooter,
  TableCard,
  Th,
  TwoToneTitle,
  WindowSelect,
} from './parts';

const NS = 'platform-payment-gateways.billing.invoices';
const DEFAULTS = { status: 'all', window: 'all', q: '' };
const STATUSES: InvoiceStatusFilter[] = [
  'all',
  'paid',
  'outstanding',
  'overdue',
  'refunded',
  'void',
];
const WINDOWS: InvoiceWindow[] = ['all', 'this_month', 'last_month', 'this_quarter', 'this_year'];

const BADGE_TONE: Record<InvoiceRow['badge'], string> = {
  paid: 'bg-success/15 text-success',
  outstanding: 'bg-warning/10 text-warning',
  overdue: 'bg-danger/10 text-danger',
  refunded: 'bg-muted text-muted-foreground',
  void: 'bg-muted text-muted-foreground',
};
const BADGE_DOT: Record<InvoiceRow['badge'], string> = {
  paid: 'bg-success',
  outstanding: 'bg-warning',
  overdue: 'bg-danger',
  refunded: 'bg-muted-foreground',
  void: 'bg-border',
};

export function InvoiceBadge({ badge, label }: { badge: InvoiceRow['badge']; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px]',
        BADGE_TONE[badge],
      )}
    >
      <span className={cn('size-1.5 rounded-full', BADGE_DOT[badge])} aria-hidden />
      {label}
    </span>
  );
}

type Action =
  | { kind: 'markPaid'; row: InvoiceRow }
  | { kind: 'void'; row: InvoiceRow }
  | { kind: 'delete'; row: InvoiceRow };

/** Admin > Invoices (TW-PAYGW-043..045): every order as a billing document, with KPIs, filters, a manual invoice and row actions. */
export function InvoicesPage() {
  const t = useTranslations(NS);
  const tc = useTranslations('platform-payment-gateways.billing.common');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { operator } = useOperator();
  const canEdit = operator.role === 'super_admin';
  const { values, page, set, setPage } = useUrlState(DEFAULTS);
  const [action, setAction] = useState<Action | null>(null);
  const [creating, setCreating] = useState(false);

  const query = {
    status: values.status as InvoiceStatusFilter,
    window: values.window as InvoiceWindow,
    q: values.q || undefined,
    page,
  };
  const list = useQuery({
    queryKey: [...BILLING_KEYS.invoices, query],
    queryFn: ({ signal }) => billingApi.invoices(query, signal),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
  const run = useMutation({
    mutationFn: (a: Action) =>
      a.kind === 'markPaid'
        ? // A plan, add-on or wallet order is settled for real (the customer gets what they paid for); a manual invoice only records the payment.
          billingApi.markPaid(a.row.id, { applyFulfilment: !a.row.manual })
        : a.kind === 'void'
          ? billingApi.voidInvoice(a.row.id)
          : billingApi.deleteInvoice(a.row.id),
    onSuccess: (r) => {
      toast.success(r.message);
      setAction(null);
      void qc.invalidateQueries({ queryKey: ['operator', 'billing'] });
    },
    onError: (e) => {
      toast.error(e instanceof ApiError && e.status < 500 ? e.message : tc('actionFailed'));
      setAction(null);
    },
  });
  const exportCsv = useMutation({
    mutationFn: () => billingApi.exportInvoices(query),
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
            <ExportButton busy={exportCsv.isPending} onClick={() => exportCsv.mutate()}>
              {tc('exportCsv')}
            </ExportButton>
            {canEdit && (
              <Button size="sm" className="rounded-full" onClick={() => setCreating(true)}>
                {t('manual.open')}
              </Button>
            )}
          </>
        }
      />

      <KpiStrip>
        <Kpi
          label={t('kpi.total')}
          value={k.total.toLocaleString(locale)}
          hint={t('kpi.allTime')}
        />
        <Kpi
          tone="accent"
          label={t('kpi.paid')}
          value={k.paid.toLocaleString(locale)}
          hint={`${k.paidPct}%`}
          hintTone="accent"
        />
        <Kpi
          tone="warning"
          label={t('kpi.outstanding')}
          value={k.outstanding.toLocaleString(locale)}
          hint={t('kpi.due', { amount: shortMoney(k.outstandingMoney.amount, cur, locale) })}
        />
        <Kpi
          tone="danger"
          valueTone="danger"
          label={t('kpi.overdue')}
          value={k.overdue.toLocaleString(locale)}
          hint={t('kpi.overdueHint')}
          hintTone="danger"
        />
        <Kpi
          label={t('kpi.thisMonth')}
          value={shortMoney(k.thisMonth.amount, cur, locale)}
          hint={`${signedPct(k.thisMonthDeltaPct)} ${t('kpi.mom')}`}
          hintTone={k.thisMonthDeltaPct >= 0 ? 'accent' : 'danger'}
        />
      </KpiStrip>

      <FilterBar
        label={t('statusFilter')}
        active={values.status}
        onPick={(id) => set({ status: id })}
        pills={STATUSES.map((id) => ({
          id,
          label: t(`statuses.${id}`),
          count:
            id === 'all'
              ? k.total
              : id === 'outstanding'
                ? k.outstanding
                : id === 'overdue'
                  ? k.overdue
                  : undefined,
        }))}
        search={{ value: values.q, placeholder: t('search'), onSubmit: (v) => set({ q: v }) }}
      >
        <WindowSelect
          value={values.window}
          label={t('window')}
          onChange={(v) => set({ window: v })}
          options={WINDOWS.map((w) => ({ value: w, label: t(`windows.${w}`) }))}
        />
      </FilterBar>

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
            <Th className="w-[160px]">{t('col.number')}</Th>
            <Th className="w-[110px]">{t('col.issued')}</Th>
            <Th className="w-[140px]">{t('col.due')}</Th>
            <Th>{t('col.workspace')}</Th>
            <Th>{t('col.item')}</Th>
            <Th align="right" className="w-[110px]">
              {t('col.amount')}
            </Th>
            <Th align="center" className="w-[120px]">
              {t('col.status')}
            </Th>
            <Th align="center" className="w-[70px]">
              {t('col.view')}
            </Th>
            <Th align="center" className="w-[56px]">
              <span className="sr-only">{t('col.actions')}</span>
            </Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {d.data.length === 0 ? (
            <tr>
              <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                {t('empty')}
              </td>
            </tr>
          ) : (
            d.data.map((inv) => (
              <InvoiceRowView
                key={inv.id}
                inv={inv}
                locale={locale}
                canEdit={canEdit}
                onAction={(kind) => setAction({ kind, row: inv })}
              />
            ))
          )}
        </tbody>
      </TableCard>

      <ConfirmDialog
        open={action?.kind === 'markPaid'}
        title={t('confirm.markPaidTitle')}
        message={action?.row.manual ? t('confirm.markPaidManual') : t('confirm.markPaid')}
        confirmLabel={t('actions.markPaid')}
        cancelLabel={tc('cancel')}
        busy={run.isPending}
        onConfirm={() => action && run.mutate(action)}
        onClose={() => setAction(null)}
      />
      <ConfirmDialog
        open={action?.kind === 'void'}
        title={t('confirm.voidTitle')}
        message={t('confirm.void')}
        confirmLabel={t('actions.void')}
        cancelLabel={tc('cancel')}
        tone="danger"
        busy={run.isPending}
        onConfirm={() => action && run.mutate(action)}
        onClose={() => setAction(null)}
      />
      <ConfirmDialog
        open={action?.kind === 'delete'}
        title={t('confirm.deleteTitle')}
        message={t('confirm.delete')}
        confirmLabel={t('actions.delete')}
        cancelLabel={tc('cancel')}
        tone="danger"
        busy={run.isPending}
        onConfirm={() => action && run.mutate(action)}
        onClose={() => setAction(null)}
      />
      {creating && <ManualInvoiceDialog data={d} onClose={() => setCreating(false)} />}
    </div>
  );
}

function InvoiceRowView({
  inv,
  locale,
  canEdit,
  onAction,
}: {
  inv: InvoiceRow;
  locale: string;
  canEdit: boolean;
  onAction: (kind: Action['kind']) => void;
}) {
  const t = useTranslations(NS);
  const tc = useTranslations('platform-payment-gateways.billing.common');
  const router = useRouter();
  const overdue = inv.badge === 'overdue';
  const open = inv.badge === 'outstanding' || overdue;
  const unpaid = inv.badge !== 'paid';
  const amountTone =
    inv.badge === 'paid'
      ? 'text-success'
      : inv.badge === 'refunded' || overdue
        ? 'text-danger'
        : '';
  return (
    <tr
      className={cn(
        'hover:bg-muted/40',
        inv.badge === 'outstanding' && 'bg-warning/5',
        overdue && 'bg-danger/5',
      )}
    >
      <td className="px-3 py-3 ps-4 font-mono text-[11px]">
        {inv.number}
        {inv.manual && (
          <span className="ms-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">
            {t('manual.tag')}
          </span>
        )}
      </td>
      <td className="px-3 py-3 font-mono text-[11px]">{ymd(inv.issuedAt)}</td>
      <td className={cn('px-3 py-3 font-mono text-[11px]', overdue && 'text-danger')}>
        {ymd(inv.dueAt)}
        {overdue && ` · ${t('daysLate', { days: inv.daysLate })}`}
      </td>
      <td className="px-3 py-3">
        <div className="font-semibold leading-tight">{inv.workspace?.name ?? '—'}</div>
        <div className="font-mono text-[11px] text-muted-foreground">
          {inv.ownerEmail ?? inv.ownerName ?? '—'}
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="text-xs">
          {inv.itemName}
          {inv.itemUnit && <span className="text-muted-foreground"> · {inv.itemUnit}</span>}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {inv.badge === 'refunded'
            ? t('refunded')
            : inv.billingPeriod
              ? `${ymd(inv.issuedAt)} → ${ymd(periodEnd(inv.issuedAt, inv.billingPeriod))}`
              : ymd(inv.issuedAt)}
        </div>
      </td>
      <td className={cn('px-3 py-3 text-end font-mono', amountTone)}>
        {inv.badge === 'refunded' ? '-' : ''}
        {money(inv.total, inv.currency, locale)}
      </td>
      <td className="px-3 py-3 text-center">
        <InvoiceBadge badge={inv.badge} label={t(`badges.${inv.badge}`)} />
      </td>
      <td className="px-3 py-3 text-center">
        <Link
          href={`/admin/invoices/${inv.id}`}
          title={t('viewInvoice')}
          aria-label={`${t('viewInvoice')} ${inv.number}`}
          className="mx-auto inline-flex size-7 items-center justify-center rounded-full border border-border text-primary hover:border-primary hover:bg-primary/10"
        >
          <svg
            viewBox="0 0 16 16"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <path d="M4 2h6l3 3v9H4zM10 2v3h3M6 8h5M6 11h5" />
          </svg>
        </Link>
      </td>
      <td className="px-3 py-3 text-center">
        <Menu
          label={t('rowMenu', { number: inv.number })}
          align="end"
          trigger={<span aria-hidden>…</span>}
          triggerClassName="size-8 rounded-full border-0 px-0"
        >
          <MenuLabel>{inv.number}</MenuLabel>
          <MenuItem onSelect={() => router.push(`/admin/invoices/${inv.id}`)}>
            {t('actions.view')}
          </MenuItem>
          {inv.workspace && (
            <MenuItem
              onSelect={() =>
                router.push(`/admin/workspaces?q=${encodeURIComponent(inv.workspace!.slug)}`)
              }
            >
              {tc('openWorkspace')}
            </MenuItem>
          )}
          {unpaid && canEdit && open && (
            <MenuItem onSelect={() => onAction('markPaid')}>{t('actions.markPaid')}</MenuItem>
          )}
          {unpaid && canEdit && open && (
            <MenuItem danger onSelect={() => onAction('void')}>
              {t('actions.void')}
            </MenuItem>
          )}
          {unpaid && canEdit && inv.badge !== 'refunded' && (
            <MenuItem danger onSelect={() => onAction('delete')}>
              {t('actions.delete')}
            </MenuItem>
          )}
        </Menu>
      </td>
    </tr>
  );
}

/** "Manual invoice": an admin-issued bill for a workspace (custom quote, setup fee). No plan is applied. */
function ManualInvoiceDialog({ data, onClose }: { data: InvoicesResponse; onClose: () => void }) {
  const tm = useTranslations(`${NS}.manual`);
  const tc = useTranslations('platform-payment-gateways.billing.common');
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    workspaceId: '',
    customerName: '',
    customerEmail: '',
    description: '',
    amount: '',
    currency: data.reportingCurrency,
    status: 'pending' as 'pending' | 'paid',
    issuedAt: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const create = useMutation({
    mutationFn: () =>
      billingApi.createInvoice(
        manualInvoiceRequestSchema.parse({
          ...form,
          customerName: form.customerName || undefined,
          customerEmail: form.customerEmail || undefined,
          issuedAt: form.issuedAt || undefined,
        }),
      ),
    onSuccess: (r) => {
      toast.success(tm('created', { number: r.number }));
      void qc.invalidateQueries({ queryKey: ['operator', 'billing'] });
      router.push(`/admin/invoices/${r.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors.length) {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
      } else toast.error(e instanceof ApiError && e.status < 500 ? e.message : tc('actionFailed'));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = manualInvoiceRequestSchema.safeParse({
      ...form,
      customerName: form.customerName || undefined,
      customerEmail: form.customerEmail || undefined,
      issuedAt: form.issuedAt || undefined,
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    create.mutate();
  };

  return (
    <Modal
      open
      size="md"
      onClose={onClose}
      eyebrow={tm('eyebrow')}
      title={tm('title')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="manual-invoice-form" disabled={create.isPending}>
            {tm('submit')}
          </Button>
        </>
      }
    >
      <form
        id="manual-invoice-form"
        onSubmit={submit}
        className="grid gap-3 sm:grid-cols-2"
        noValidate
      >
        <Field
          label={tm('workspace')}
          htmlFor="mi-ws"
          error={errors.workspaceId}
          className="sm:col-span-2"
        >
          <Select
            id="mi-ws"
            value={form.workspaceId}
            onChange={(e) => set('workspaceId', e.target.value)}
            invalid={!!errors.workspaceId}
          >
            <option value="">{tm('chooseWorkspace')}</option>
            {data.workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={tm('customerName')}
          htmlFor="mi-name"
          error={errors.customerName}
          hint={tm('customerNameHint')}
        >
          <Input
            id="mi-name"
            maxLength={191}
            value={form.customerName}
            onChange={(e) => set('customerName', e.target.value)}
          />
        </Field>
        <Field label={tm('customerEmail')} htmlFor="mi-email" error={errors.customerEmail}>
          <Input
            id="mi-email"
            type="email"
            maxLength={191}
            value={form.customerEmail}
            onChange={(e) => set('customerEmail', e.target.value)}
          />
        </Field>
        <Field
          label={tm('description')}
          htmlFor="mi-desc"
          error={errors.description}
          className="sm:col-span-2"
        >
          <Textarea
            id="mi-desc"
            rows={2}
            maxLength={500}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            invalid={!!errors.description}
          />
        </Field>
        <Field label={tm('amount')} htmlFor="mi-amount" error={errors.amount}>
          <Input
            id="mi-amount"
            inputMode="decimal"
            placeholder="250.00"
            value={form.amount}
            onChange={(e) => set('amount', e.target.value)}
            invalid={!!errors.amount}
          />
        </Field>
        <Field label={tm('currency')} htmlFor="mi-cur" error={errors.currency}>
          <Input
            id="mi-cur"
            maxLength={3}
            value={form.currency}
            onChange={(e) => set('currency', e.target.value.toUpperCase())}
            invalid={!!errors.currency}
          />
        </Field>
        <Field label={tm('status')} htmlFor="mi-status">
          <Select
            id="mi-status"
            value={form.status}
            onChange={(e) => set('status', e.target.value as 'pending' | 'paid')}
          >
            <option value="pending">{tm('statuses.pending')}</option>
            <option value="paid">{tm('statuses.paid')}</option>
          </Select>
        </Field>
        <Field
          label={tm('issuedAt')}
          htmlFor="mi-date"
          error={errors.issuedAt}
          hint={tm('issuedAtHint')}
        >
          <Input
            id="mi-date"
            type="date"
            value={form.issuedAt}
            onChange={(e) => set('issuedAt', e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}
