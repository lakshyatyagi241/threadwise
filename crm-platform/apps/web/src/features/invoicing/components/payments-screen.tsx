'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Button,
  EmptyState,
  Input,
  Menu,
  MenuCheckboxItem,
  MenuItem,
  Select,
  Spinner,
  Switch,
  cn,
} from '@crm/ui';
import { PAYMENT_KINDS, type InvoiceSummary, type PaymentKind, type PaymentResponse } from '@crm/contracts';
import { invalidateInvoicing, useContactName, usePaymentSummary, usePaymentsList } from '../api/hooks';
import { minorNum } from '../lib/aging';
import { formatDay, todayKey } from '../lib/dates';
import {
  DEFAULT_PAYMENT_FILTERS,
  hasActivePaymentFilter,
  METHOD_ORDER,
  orderedWindow,
  parsePaymentFilters,
  paymentFiltersToSearch,
  paymentQuery,
  PAYMENTS_VIEWS,
  toggleMethod,
  type PaymentFilters,
  type PaymentsView,
} from '../lib/payment-filters';
import { currenciesOf } from '../lib/summary';
import { frozenEdge, isScrolledSideways, STICKY_ONLY, STICKY_ONLY_HEAD } from '../lib/sticky';
import { AgingReport } from './aging-report';
import { ContactPicker } from './contact-picker';
import { CloseIcon, EyeIcon, InvoiceIcon, PaymentIcon, PlusIcon, RefreshIcon, SearchIcon, UndoIcon } from './icons';
import { LedgerSummary } from './ledger-summary';
import { OutstandingView } from './outstanding-view';
import { ContactPill, ErrorLine, MethodChip, Money, useInvoicingCan, useWorkspaceZone } from './parts';
import { RecordPaymentDialog, RefundDialog } from './payment-dialogs';
import { PickInvoiceDialog } from './pick-invoice-dialog';
import { ReceiptDialog } from './receipt-dialog';
import { RowMenu } from './row-menu';

const COLS = ['date', 'receipt', 'invoice', 'contact', 'method', 'reference', 'amount', 'refunded', 'recordedBy', 'actions'] as const;
const COL_W: Record<(typeof COLS)[number], number> = {
  date: 156,
  receipt: 170,
  invoice: 160,
  contact: 200,
  method: 130,
  reference: 170,
  amount: 140,
  refunded: 150,
  recordedBy: 150,
  actions: 56,
};
const TABLE_W = Object.values(COL_W).reduce((a, b) => a + b, 0);
/** The invoices a payment can still be recorded against. */
const PAYABLE = ['issued', 'partially_paid', 'overdue'] as const;

/**
 * `/payments`: the money, three ways. The ledger lists every payment and refund (filters, "load more" in a pinned footer, refund
 * and receipt from a row); the aging report shows what is owed by how late it is; the third view shows what each contact owes.
 */
export function PaymentsScreen() {
  const t = useTranslations('invoicing.payments');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const can = useInvoicingCan();
  const panelId = useId();

  const filters = useMemo(() => parsePaymentFilters(search), [search]);
  const setFilters = useCallback(
    (patch: Partial<PaymentFilters>) =>
      router.replace(`${pathname}${paymentFiltersToSearch({ ...filters, ...patch })}`, { scroll: false }),
    [router, pathname, filters],
  );

  const [q, setQ] = useState(filters.q);
  const [seenQ, setSeenQ] = useState(filters.q);
  if (filters.q !== seenQ) {
    setSeenQ(filters.q);
    setQ(filters.q);
  }
  useEffect(() => {
    if (q.trim() === filters.q.trim()) return;
    const id = window.setTimeout(() => setFilters({ q: q.trim() }), 350);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const [picking, setPicking] = useState(false);
  const [paying, setPaying] = useState<InvoiceSummary | null>(null);
  const [refunding, setRefunding] = useState<PaymentResponse | null>(null);
  const [receipt, setReceipt] = useState<PaymentResponse | null>(null);

  const ledger = filters.view === 'ledger';
  const list = usePaymentsList(paymentQuery(filters), { enabled: ledger });
  const summary = usePaymentSummary(filters.days);
  const rows = list.items;
  const filtered = hasActivePaymentFilter({ ...filters, q });
  const reset = () => {
    setQ('');
    setFilters({ ...DEFAULT_PAYMENT_FILTERS, view: filters.view, days: filters.days });
  };

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground">
            <PaymentIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight">{t('title')}</h1>
            <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">{t('subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/invoices" className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted">
            {t('invoices')}
          </Link>
          {can.recordPayment && (
            <Button variant="brand" className="h-10 px-5" onClick={() => setPicking(true)}>
              <PlusIcon /> {t('record')}
            </Button>
          )}
        </div>
      </header>

      {filters.view !== 'aging' && (
        <LedgerSummary
          summary={summary.data}
          loading={summary.isPending}
          error={summary.isError}
          days={filters.days}
          onDays={(days) => setFilters({ days })}
          currency={filters.currency}
        />
      )}

      <div role="tablist" aria-label={t('viewLabel')} className="thin-scrollbar flex gap-1 overflow-x-auto border-b border-border">
        {PAYMENTS_VIEWS.map((v: PaymentsView) => (
          <button
            key={v}
            id={`${panelId}-${v}`}
            role="tab"
            type="button"
            aria-selected={filters.view === v}
            aria-controls={panelId}
            tabIndex={filters.view === v ? 0 : -1}
            onClick={() => setFilters({ view: v })}
            className={cn(
              'shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
              filters.view === v ? 'border-brand text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`views.${v}`)}
          </button>
        ))}
      </div>

      <div id={panelId} role="tabpanel" aria-labelledby={`${panelId}-${filters.view}`} className="space-y-3">
        <Toolbar
          filters={filters}
          q={q}
          onQ={setQ}
          onChange={setFilters}
          currencies={currenciesOf(summary.data, filters.currency)}
          filtered={filtered}
          onReset={reset}
          onRefresh={() => void invalidateInvoicing(qc)}
          refreshing={ledger ? list.isFetching : false}
        />

        {filters.view === 'aging' ? (
          <AgingReport currency={filters.currency} contact={filters.contact} />
        ) : filters.view === 'outstanding' ? (
          <OutstandingView filters={filters} filtered={filtered} onReset={reset} />
        ) : (
          <section
            aria-label={t('tableLabel')}
            aria-busy={list.isFetching}
            className="flex max-h-[max(26rem,calc(100dvh-24rem))] flex-col overflow-hidden rounded-xl border border-border bg-background"
          >
            <div className={cn('flex min-h-0 flex-1 flex-col transition-opacity', list.isPlaceholderData && 'opacity-60')}>
              {list.isPending ? (
                <div role="status" aria-label={t('loading')} className="divide-y divide-border">
                  {Array.from({ length: 6 }, (_, i) => (
                    <div key={i} className="flex h-14 animate-pulse items-center gap-4 px-4">
                      <span className="h-3 w-24 rounded bg-muted" />
                      <span className="h-3 w-20 rounded bg-muted" />
                      <span className="ms-auto h-3 w-16 rounded bg-muted" />
                    </div>
                  ))}
                </div>
              ) : list.isError ? (
                <div className="p-4">
                  <ErrorLine error={list.error} onRetry={() => void list.refetch()} />
                </div>
              ) : rows.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    title={filtered ? t('emptyFilteredTitle') : t('emptyTitle')}
                    message={filtered ? t('emptyFiltered') : t('emptyMessage')}
                    actions={
                      filtered ? (
                        <Button variant="secondary" onClick={reset}>
                          {t('resetFilters')}
                        </Button>
                      ) : can.recordPayment ? (
                        <Button variant="brand" onClick={() => setPicking(true)}>
                          {t('record')}
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                <PaymentsTable
                  rows={rows}
                  canRefund={can.refund}
                  onRefund={setRefunding}
                  onReceipt={setReceipt}
                  onOpen={(p) => p.invoice && router.push(`/invoices/${p.invoice.id}`)}
                />
              )}
            </div>
            {!list.isPending && !list.isError && rows.length > 0 && (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-4 py-2.5 text-sm">
                <span className="flex items-center gap-2 text-muted-foreground" aria-live="polite">
                  {list.isFetching && <Spinner label={t('loading')} />}
                  {t('showing', { count: rows.length })}
                </span>
                {list.hasNextPage ? (
                  <Button variant="secondary" size="sm" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                    {list.isFetchingNextPage && <Spinner />}
                    {t('loadMore')}
                  </Button>
                ) : (
                  <span className="text-muted-foreground">{t('allLoaded')}</span>
                )}
              </div>
            )}
          </section>
        )}
      </div>

      {picking && (
        <PickInvoiceDialog
          statuses={[...PAYABLE]}
          onClose={() => setPicking(false)}
          onPick={(inv) => {
            setPicking(false);
            setPaying(inv);
          }}
        />
      )}
      {paying && <RecordPaymentDialog invoice={paying} onClose={() => setPaying(null)} onDone={() => void invalidateInvoicing(qc)} />}
      {refunding && <RefundDialog payment={refunding} onClose={() => setRefunding(null)} onDone={() => void invalidateInvoicing(qc)} />}
      {receipt && <ReceiptDialog payment={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function Toolbar({
  filters,
  q,
  onQ,
  onChange,
  currencies,
  filtered,
  onReset,
  onRefresh,
  refreshing,
}: {
  filters: PaymentFilters;
  q: string;
  onQ: (q: string) => void;
  onChange: (p: Partial<PaymentFilters>) => void;
  currencies: string[];
  filtered: boolean;
  onReset: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const t = useTranslations('invoicing.payments.toolbar');
  const tm = useTranslations('invoicing.method');
  const tk = useTranslations('invoicing.payments.kinds');
  const name = useContactName(filters.contact);
  const view = filters.view;
  const setWindow = (p: { from?: string; to?: string }) => onChange(orderedWindow(p.from ?? filters.from, p.to ?? filters.to));
  return (
    <div className="flex flex-wrap items-center gap-2">
      {view !== 'aging' && (
        <div className="relative min-w-0 flex-1 basis-56 sm:max-w-sm">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={q}
            onChange={(e) => onQ(e.target.value)}
            placeholder={view === 'ledger' ? t('search') : t('searchContact')}
            aria-label={view === 'ledger' ? t('search') : t('searchContact')}
            className="ps-9"
          />
        </div>
      )}
      {view === 'ledger' && (
        <>
          <Select value={filters.kind} onChange={(e) => onChange({ kind: e.target.value as PaymentKind | '' })} aria-label={t('kind')} className="w-auto min-w-32">
            <option value="">{t('allKinds')}</option>
            {PAYMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {tk(k)}
              </option>
            ))}
          </Select>
          <Menu
            label={t('method')}
            trigger={filters.methods.length === 0 ? t('allMethods') : t('methodsCount', { count: filters.methods.length })}
            triggerClassName="h-10 min-w-36 justify-between"
          >
            {METHOD_ORDER.map((m) => (
              <MenuCheckboxItem key={m} checked={filters.methods.includes(m)} onCheckedChange={() => onChange({ methods: toggleMethod(filters.methods, m) })}>
                {tm(m)}
              </MenuCheckboxItem>
            ))}
            {filters.methods.length > 0 && (
              <MenuItem keepOpen onSelect={() => onChange({ methods: [] })}>
                {t('clearMethods')}
              </MenuItem>
            )}
          </Menu>
        </>
      )}
      <Select value={filters.currency} onChange={(e) => onChange({ currency: e.target.value })} aria-label={t('currency')} className="w-auto min-w-28">
        <option value="">{t('allCurrencies')}</option>
        {currencies.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
      {view !== 'outstanding' && (
        <ContactPicker compact value={filters.contact ? { id: filters.contact, label: name.data ?? '...' } : null} onChange={(c) => onChange({ contact: c?.id ?? '' })} />
      )}
      {view === 'ledger' && (
        <>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className="shrink-0">{t('from')}</span>
            <Input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setWindow({ from: e.target.value })} className="w-40" aria-label={t('paidFrom')} />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className="shrink-0">{t('to')}</span>
            <Input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setWindow({ to: e.target.value })} className="w-40" aria-label={t('paidTo')} />
          </label>
          {filters.invoice && (
            <button
              type="button"
              onClick={() => onChange({ invoice: '' })}
              className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border bg-muted px-3 text-sm hover:bg-background"
            >
              <InvoiceIcon className="size-4" /> {t('oneInvoice')}
              <CloseIcon className="size-3.5" aria-hidden="true" />
              <span className="sr-only">{t('clearInvoice')}</span>
            </button>
          )}
        </>
      )}
      {view === 'outstanding' && (
        <label className="flex h-10 items-center gap-2 rounded-md border border-border px-3 text-sm">
          <Switch checked={filters.onlyOverdue} onCheckedChange={(v) => onChange({ onlyOverdue: v })} label={t('onlyOverdue')} />
          <span>{t('onlyOverdue')}</span>
        </label>
      )}
      {filtered && (
        <Button variant="ghost" onClick={onReset}>
          {t('reset')}
        </Button>
      )}
      <Button variant="secondary" onClick={onRefresh} aria-label={t('refresh')} title={t('refresh')} className="ms-auto size-10 px-0">
        {refreshing ? <Spinner /> : <RefreshIcon />}
      </Button>
    </div>
  );
}

function PaymentsTable({
  rows,
  canRefund,
  onRefund,
  onReceipt,
  onOpen,
}: {
  rows: readonly PaymentResponse[];
  canRefund: boolean;
  onRefund: (p: PaymentResponse) => void;
  onReceipt: (p: PaymentResponse) => void;
  onOpen: (p: PaymentResponse) => void;
}) {
  const t = useTranslations('invoicing.payments.table');
  const locale = useLocale();
  const zone = useWorkspaceZone();
  const [scrolled, setScrolled] = useState(false);
  const th = 'sticky top-0 z-20 border-b border-border bg-muted px-3 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground';
  const numeric = new Set(['amount', 'refunded']);
  const day = (iso: string) => formatDay(todayKey(new Date(iso), zone), locale);
  return (
    <div
      role="region"
      aria-label={t('scrollArea')}
      tabIndex={0}
      onScroll={(e) => setScrolled(isScrolledSideways(e.currentTarget.scrollLeft))}
      className="thin-scrollbar h-full min-h-0 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
    >
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm" style={{ minWidth: TABLE_W }}>
        <colgroup>
          {COLS.map((c) => (
            <col key={c} style={{ width: COL_W[c] }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {COLS.map((c) => (
              <th key={c} scope="col" className={cn(th, numeric.has(c) && 'text-end', c === 'date' && `${STICKY_ONLY_HEAD} ${frozenEdge(scrolled)}`)}>
                {c === 'actions' ? <span className="sr-only">{t('columns.actions')}</span> : <span className="block truncate">{t(`columns.${c}`)}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const refund = p.kind === 'refund';
            const refunded = minorNum(p.refunded, p.currency);
            const refundable = minorNum(p.refundable, p.currency);
            return (
              <tr key={p.id} data-row-id={p.id} className="group h-14 align-middle transition-colors hover:bg-muted">
                {COLS.map((c) => (
                  <td key={c} className={cn('max-w-0 border-b border-border px-3 py-2', numeric.has(c) && 'text-end', c === 'date' && `${STICKY_ONLY} ${frozenEdge(scrolled)}`)}>
                    {c === 'date' && <span className="font-medium tabular-nums">{day(p.paidAt)}</span>}
                    {c === 'receipt' && (
                      <>
                        <button type="button" onClick={() => onReceipt(p)} dir="ltr" className="block max-w-full truncate text-start font-medium hover:text-primary hover:underline">
                          {p.receiptNumber ?? '-'}
                        </button>
                        {refund && p.refundOf && (
                          <span className="block truncate text-xs text-muted-foreground" dir="ltr">
                            {t('refundOf', { receipt: p.refundOf.receiptNumber ?? '-' })}
                          </span>
                        )}
                      </>
                    )}
                    {c === 'invoice' &&
                      (p.invoice ? (
                        <Link href={`/invoices/${p.invoice.id}`} className="font-medium hover:text-primary hover:underline" dir="ltr">
                          {p.invoice.number ?? '-'}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      ))}
                    {c === 'contact' && <ContactPill contact={p.contact} />}
                    {c === 'method' && <MethodChip method={p.method} />}
                    {c === 'reference' && (
                      <span className="block truncate text-muted-foreground" dir="auto" title={p.reference ?? undefined}>
                        {p.reference ?? '-'}
                      </span>
                    )}
                    {c === 'amount' && <Money minor={minorNum(p.amount, p.currency)} currency={p.currency} className={cn('font-semibold', refund ? 'text-danger' : 'text-success')} />}
                    {c === 'refunded' &&
                      (refund ? (
                        <span className="text-muted-foreground">-</span>
                      ) : (
                        <>
                          {refunded > 0 ? <Money minor={refunded} currency={p.currency} className="text-danger" /> : <span className="text-muted-foreground">-</span>}
                          {refundable > 0 && refundable !== minorNum(p.amount, p.currency) && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {t('refundable')} <Money minor={refundable} currency={p.currency} />
                            </span>
                          )}
                        </>
                      ))}
                    {c === 'recordedBy' && <span className="block truncate text-muted-foreground">{p.recordedBy?.name ?? '-'}</span>}
                    {c === 'actions' && (
                      <RowMenu label={t('moreFor', { date: day(p.paidAt) })}>
                        {(close) => (
                          <>
                            <MenuItem onSelect={() => { close(); onReceipt(p); }}>
                              <EyeIcon /> {t('receipt')}
                            </MenuItem>
                            {p.invoice && (
                              <MenuItem onSelect={() => { close(); onOpen(p); }}>
                                <InvoiceIcon /> {t('openInvoice')}
                              </MenuItem>
                            )}
                            {canRefund && !refund && refundable > 0 && (
                              <MenuItem danger onSelect={() => { close(); onRefund(p); }}>
                                <UndoIcon /> {t('refund')}
                              </MenuItem>
                            )}
                          </>
                        )}
                      </RowMenu>
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
