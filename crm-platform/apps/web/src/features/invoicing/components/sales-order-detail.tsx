'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { SalesOrderResponse } from '@crm/contracts';
import { Alert, Button, EmptyState, MenuItem, Spinner, cn } from '@crm/ui';
import { useSalesOrder } from '../api/hooks';
import { formatDateTime, formatDay } from '../lib/dates';
import { exponentOf } from '../lib/money';
import {
  linkedInvoiceStatus,
  lineFacts,
  orderFacts,
  qtyText,
  salesOrderActions,
} from '../lib/sales-orders';
import { majorToMinor } from '../lib/wire';
import { BackIcon, CheckIcon, InvoiceIcon, PencilIcon, TrashIcon, BanIcon } from './icons';
import { ContactPill, ErrorLine, Money, StatusChip, UserText, useInvoicingCan } from './parts';
import { RowMenu } from './row-menu';
import { useSalesOrderDialogs } from './sales-order-dialogs';
import {
  FulfilmentChip,
  InvoicingChip,
  OrderStatusChip,
  ProgressBar,
  QuoteLink,
  salesOrderEditHref,
} from './sales-order-parts';

const major = (s: string, currency: string): number => majorToMinor(s, exponentOf(currency));

/** `/sales-orders/[id]`: the order, how much of each line is billed and delivered, the invoices made from it and what to do next. */
export function SalesOrderDetail({ id }: { id: string }) {
  const t = useTranslations('invoicing.salesOrders.detail');
  const router = useRouter();
  const can = useInvoicingCan();
  const order = useSalesOrder(can.readSalesOrders ? id : null);
  const locale = useLocale();
  // A deleted order has no page to stay on: back to the list.
  const dialogs = useSalesOrderDialogs((kind) => {
    if (kind === 'delete') router.replace('/sales-orders');
  });

  if (!can.readSalesOrders) {
    return <EmptyState title={t('noAccessTitle')} message={t('noAccess')} />;
  }
  if (order.isPending) {
    return (
      <div role="status" className="flex items-center gap-2 p-6 text-muted-foreground">
        <Spinner /> {t('loading')}
      </div>
    );
  }
  if (order.isError) {
    return (
      <div className="space-y-3">
        <BackLink />
        <ErrorLine error={order.error} onRetry={() => void order.refetch()} />
      </div>
    );
  }
  const o = order.data;
  const allowed = salesOrderActions(o, can);
  const facts = orderFacts(o.lines);
  const open = (kind: Parameters<typeof dialogs.open>[0]) => dialogs.open(kind, o);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <BackLink />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight" dir="ltr">
                {o.number}
              </h1>
              <OrderStatusChip status={o.status} />
              {(o.status === 'confirmed' || o.status === 'closed') && (
                <>
                  <InvoicingChip status={o.invoicingStatus} />
                  <FulfilmentChip status={o.fulfilmentStatus} />
                </>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              <UserText>{o.buyerName ?? t('noBuyer')}</UserText>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {allowed.has('edit') && (
            <Link href={salesOrderEditHref(o.id)} className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted">
              <PencilIcon /> {t('edit')}
            </Link>
          )}
          {allowed.has('confirm') && (
            <Button variant="brand" className="min-h-10" onClick={() => open('confirm')}>
              <CheckIcon /> {t('confirm')}
            </Button>
          )}
          {allowed.has('fulfil') && (
            <Button variant="secondary" className="min-h-10" onClick={() => open('fulfil')}>
              {t('recordDelivery')}
            </Button>
          )}
          {allowed.has('invoice') && (
            <Button variant="brand" className="min-h-10" onClick={() => open('invoice')}>
              <InvoiceIcon /> {t('invoice')}
            </Button>
          )}
          {(allowed.has('cancel') || allowed.has('delete')) && (
            <RowMenu label={t('more')}>
              {(close) => (
                <>
                  {allowed.has('cancel') && (
                    <MenuItem
                      danger
                      onSelect={() => {
                        close();
                        open('cancel');
                      }}
                    >
                      <BanIcon /> {t('cancel')}
                    </MenuItem>
                  )}
                  {allowed.has('delete') && (
                    <MenuItem
                      danger
                      onSelect={() => {
                        close();
                        open('delete');
                      }}
                    >
                      <TrashIcon /> {t('delete')}
                    </MenuItem>
                  )}
                </>
              )}
            </RowMenu>
          )}
        </div>
      </header>

      {o.status === 'cancelled' && (
        <Alert tone="danger">
          <p className="font-medium">{t('cancelledOn', { date: formatDateTime(o.cancelledAt, locale) })}</p>
          {o.cancelReason && <UserText className="mt-1 block">{o.cancelReason}</UserText>}
        </Alert>
      )}
      {o.status === 'draft' && <Alert tone="info">{t('draftHint')}</Alert>}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="min-w-0 space-y-4">
          <LinesCard order={o} />
          <InvoicesCard order={o} />
          {(o.notes || o.terms) && (
            <section className="space-y-3 rounded-xl border border-border bg-background p-4 text-sm">
              {o.notes && (
                <div>
                  <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('notes')}</h2>
                  <UserText className="block whitespace-pre-wrap">{o.notes}</UserText>
                </div>
              )}
              {o.terms && (
                <div>
                  <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('terms')}</h2>
                  <UserText className="block whitespace-pre-wrap">{o.terms}</UserText>
                </div>
              )}
            </section>
          )}
        </div>
        <div className="min-w-0 space-y-4">
          {(o.status === 'confirmed' || o.status === 'closed') && (
            <section aria-label={t('progress')} className="space-y-3 rounded-xl border border-border bg-background p-4 text-sm">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('progress')}</h2>
              <ProgressRow label={t('invoiced')} pct={facts.invoicedPct} done={facts.invoiced} total={facts.ordered} />
              <ProgressRow label={t('fulfilled')} pct={facts.fulfilledPct} done={facts.fulfilled} total={facts.ordered} />
            </section>
          )}
          <TotalsCard order={o} />
          <DetailsCard order={o} />
        </div>
      </div>

      {dialogs.node}
    </div>
  );
}

function BackLink() {
  const t = useTranslations('invoicing.salesOrders.detail');
  return (
    <Link
      href="/sales-orders"
      aria-label={t('back')}
      className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border hover:bg-muted"
    >
      <BackIcon />
    </Link>
  );
}

function ProgressRow({ label, pct, done, total }: { label: string; pct: number; done: bigint; total: bigint }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span>{label}</span>
        <span dir="ltr" className="tabular-nums text-muted-foreground">
          {qtyText(done)} / {qtyText(total)} ({pct}%)
        </span>
      </div>
      <ProgressBar pct={pct} label={label} />
    </div>
  );
}

/** The lines with ordered, invoiced, fulfilled and still-to-invoice quantities and a bar for each progress. */
function LinesCard({ order }: { order: SalesOrderResponse }) {
  const t = useTranslations('invoicing.salesOrders.lines');
  const tracked = order.status === 'confirmed' || order.status === 'closed';
  const th = 'border-b border-border bg-muted px-3 py-2.5 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground';
  return (
    <section aria-label={t('title')} className="overflow-hidden rounded-xl border border-border bg-background">
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">{t('title')}</h2>
      <div role="region" aria-label={t('scrollArea')} tabIndex={0} className="thin-scrollbar overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
        <table className="w-full min-w-[46rem] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th scope="col" className={cn(th, 'sticky start-0 z-10 w-[26%]')}>
                {t('item')}
              </th>
              <th scope="col" className={cn(th, 'text-end')}>{t('ordered')}</th>
              <th scope="col" className={cn(th, 'w-[16%]')}>{t('invoiced')}</th>
              <th scope="col" className={cn(th, 'w-[16%]')}>{t('fulfilled')}</th>
              <th scope="col" className={cn(th, 'text-end')}>{t('toInvoice')}</th>
              <th scope="col" className={cn(th, 'text-end')}>{t('unitPrice')}</th>
              <th scope="col" className={cn(th, 'text-end')}>{t('amount')}</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => {
              const f = lineFacts(l);
              const cell = 'border-b border-border px-3 py-3 align-top';
              return (
                <tr key={l.id}>
                  <td className={cn(cell, 'sticky start-0 z-10 bg-background')}>
                    <UserText className="block font-medium">{l.description}</UserText>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {l.sku && <span dir="ltr">{l.sku} </span>}
                      {l.taxName ? t('taxLine', { name: l.taxName, rate: l.taxRate }) : l.taxRate !== '0' ? t('taxRate', { rate: l.taxRate }) : null}
                    </span>
                  </td>
                  <td className={cn(cell, 'text-end tabular-nums')} dir="ltr">
                    {qtyText(f.ordered)}
                  </td>
                  <td className={cell}>
                    {tracked ? (
                      <div className="space-y-1">
                        <span dir="ltr" className="tabular-nums">
                          {qtyText(f.invoiced)}
                        </span>
                        <ProgressBar pct={f.invoicedPct} label={t('invoicedBar', { name: l.description })} />
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className={cell}>
                    {tracked ? (
                      <div className="space-y-1">
                        <span dir="ltr" className="tabular-nums">
                          {qtyText(f.fulfilled)}
                        </span>
                        <ProgressBar pct={f.fulfilledPct} label={t('fulfilledBar', { name: l.description })} />
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className={cn(cell, 'text-end tabular-nums', f.toInvoice > 0n && tracked ? 'font-medium' : 'text-muted-foreground')} dir="ltr">
                    {tracked ? qtyText(f.toInvoice) : '-'}
                  </td>
                  <td className={cn(cell, 'text-end')}>
                    <Money minor={major(l.unitPrice, order.currency)} currency={order.currency} />
                  </td>
                  <td className={cn(cell, 'text-end')}>
                    <Money minor={major(l.amounts.total, order.currency)} currency={order.currency} className="font-medium" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TotalsCard({ order }: { order: SalesOrderResponse }) {
  const t = useTranslations('invoicing.salesOrders.totals');
  const c = order.currency;
  const a = order.amounts;
  const row = (label: string, value: number, extra?: string, negative?: boolean) => (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">
        {label}
        {extra && <span className="block text-xs">{extra}</span>}
      </dt>
      <dd>
        {negative && <span dir="ltr">-</span>}
        <Money minor={value} currency={c} />
      </dd>
    </div>
  );
  return (
    <section aria-label={t('title')} className="rounded-xl border border-border bg-background p-4 text-sm">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('title')}</h2>
      <dl className="space-y-1.5">
        {row(t('subtotal'), major(a.subtotal, c))}
        {major(a.discount, c) > 0 && row(t('discount'), major(a.discount, c), undefined, true)}
        {major(a.shipping, c) > 0 && row(t('shipping'), major(a.shipping, c), order.shippingInvoiced ? t('shippingBilled') : t('shippingPending'))}
        {row(t('tax'), major(a.tax, c))}
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2 text-lg font-bold">
          <dt>{t('total')}</dt>
          <dd>
            <Money minor={major(a.total, c)} currency={c} />
          </dd>
        </div>
      </dl>
    </section>
  );
}

function DetailsCard({ order }: { order: SalesOrderResponse }) {
  const t = useTranslations('invoicing.salesOrders.info');
  const locale = useLocale();
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-end">{value}</dd>
    </div>
  );
  const dash = <span className="text-muted-foreground">-</span>;
  return (
    <section aria-label={t('title')} className="rounded-xl border border-border bg-background p-4 text-sm">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('title')}</h2>
      <dl className="space-y-2">
        {row(t('buyer'), order.contact ? <ContactPill contact={{ id: order.contact.id, name: order.contact.name ?? order.buyer.name }} /> : order.buyer.name ? <UserText>{order.buyer.name}</UserText> : dash)}
        {order.buyer.email && row(t('email'), <span dir="ltr" className="break-all">{order.buyer.email}</span>)}
        {order.buyer.phone && row(t('phone'), <span dir="ltr">{order.buyer.phone}</span>)}
        {row(t('quote'), <QuoteLink quote={order.quote} className="inline-block max-w-full" />)}
        {row(
          t('deal'),
          order.deal ? (
            <Link href={`/deals?deal=${order.deal.id}`} className="text-primary underline-offset-2 hover:underline">
              <UserText>{order.deal.title}</UserText>
            </Link>
          ) : (
            dash
          ),
        )}
        {row(t('owner'), order.owner ? <UserText>{order.owner.name}</UserText> : dash)}
        {row(t('reference'), order.reference ? <UserText>{order.reference}</UserText> : dash)}
        {row(t('expected'), formatDay(order.expectedDate, locale) || dash)}
        {row(t('created'), formatDateTime(order.createdAt, locale))}
        {order.confirmedAt && row(t('confirmed'), formatDateTime(order.confirmedAt, locale))}
      </dl>
    </section>
  );
}

/** The invoices made from the order, each linking to its page. A voided one gave its quantities back. */
function InvoicesCard({ order }: { order: SalesOrderResponse }) {
  const t = useTranslations('invoicing.salesOrders.invoices');
  return (
    <section aria-label={t('title')} className="overflow-hidden rounded-xl border border-border bg-background">
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">{t('title')}</h2>
      {order.invoices.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{order.status === 'draft' ? t('noneDraft') : t('none')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {order.invoices.map((inv) => (
            <li key={inv.id}>
              <Link
                href={`/invoices/${inv.id}`}
                className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <span className={cn('min-w-0 flex-1 basis-32 truncate font-medium', !inv.number && 'italic text-muted-foreground')} dir="ltr">
                  {inv.number ?? t('draft')}
                </span>
                <StatusChip status={linkedInvoiceStatus(inv.status)} />
                <Money minor={major(inv.total, order.currency)} currency={order.currency} className="font-medium" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {order.invoices.some((i) => i.status === 'void') && <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">{t('voidNote')}</p>}
    </section>
  );
}
