'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { SalesOrderSummary } from '@crm/contracts';
import { cn, MenuItem, MenuSeparator } from '@crm/ui';
import { formatDay } from '../lib/dates';
import { salesOrderActions } from '../lib/sales-orders';
import { frozenEdge, isScrolledSideways, STICKY_ONLY, STICKY_ONLY_HEAD } from '../lib/sticky';
import { minorOf } from '../lib/wire';
import { BanIcon, CheckIcon, EyeIcon, InvoiceIcon, PencilIcon, TrashIcon } from './icons';
import { ContactPill, Money, useInvoicingCan } from './parts';
import type { SalesOrderDialogKind } from './sales-order-dialogs';
import {
  FulfilmentChip,
  InvoicingChip,
  OrderStatusChip,
  QuoteLink,
  salesOrderEditHref,
  salesOrderHref,
} from './sales-order-parts';
import { RowMenu } from './row-menu';

export const SO_COLUMNS = [
  'number',
  'buyer',
  'quote',
  'deal',
  'expected',
  'status',
  'invoicing',
  'fulfilment',
  'total',
  'invoices',
] as const;
type Column = (typeof SO_COLUMNS)[number];

/** Column widths in px (fixed layout: the table scrolls sideways inside its card when they do not fit). */
const WIDTHS: Record<Column, number> = {
  number: 200,
  buyer: 210,
  quote: 140,
  deal: 180,
  expected: 130,
  status: 130,
  invoicing: 160,
  fulfilment: 160,
  total: 140,
  invoices: 100,
};
const MIN_WIDTH = SO_COLUMNS.reduce((sum, c) => sum + WIDTHS[c], 0);
const NUMERIC: ReadonlySet<Column> = new Set(['total', 'invoices']);

/** The "..." menu of one order: only what its state and the person's permissions allow. */
export function SalesOrderRowMenu({
  order,
  onDialog,
}: {
  order: SalesOrderSummary;
  onDialog: (kind: SalesOrderDialogKind, order: SalesOrderSummary) => void;
}) {
  const t = useTranslations('invoicing.salesOrders.row');
  const router = useRouter();
  const can = useInvoicingCan();
  const allowed = salesOrderActions(order, can);
  return (
    <RowMenu label={t('moreFor', { name: order.number })}>
      {(close) => {
        const run = (fn: () => void) => () => {
          close();
          fn();
        };
        return (
          <>
            <MenuItem onSelect={run(() => router.push(salesOrderHref(order.id)))}>
              <EyeIcon /> {t('open')}
            </MenuItem>
            {allowed.has('edit') && (
              <MenuItem onSelect={run(() => router.push(salesOrderEditHref(order.id)))}>
                <PencilIcon /> {t('edit')}
              </MenuItem>
            )}
            {allowed.has('confirm') && (
              <MenuItem onSelect={run(() => onDialog('confirm', order))}>
                <CheckIcon /> {t('confirm')}
              </MenuItem>
            )}
            {allowed.has('invoice') && (
              <MenuItem onSelect={run(() => onDialog('invoice', order))}>
                <InvoiceIcon /> {t('invoiceAll')}
              </MenuItem>
            )}
            {allowed.has('fulfil') && (
              <MenuItem onSelect={run(() => onDialog('fulfil', order))}>
                <CheckIcon /> {t('fulfilAll')}
              </MenuItem>
            )}
            {(allowed.has('cancel') || allowed.has('delete')) && <MenuSeparator />}
            {allowed.has('cancel') && (
              <MenuItem danger onSelect={run(() => onDialog('cancel', order))}>
                <BanIcon /> {t('cancel')}
              </MenuItem>
            )}
            {allowed.has('delete') && (
              <MenuItem danger onSelect={run(() => onDialog('delete', order))}>
                <TrashIcon /> {t('delete')}
              </MenuItem>
            )}
          </>
        );
      }}
    </RowMenu>
  );
}

function Cell({ id, order, locale }: { id: Column; order: SalesOrderSummary; locale: string }) {
  switch (id) {
    case 'number':
      return (
        <Link
          href={salesOrderHref(order.id)}
          dir="ltr"
          title={order.number}
          className="block truncate font-medium outline-none hover:text-primary hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span dir="ltr">{order.number}</span>
        </Link>
      );
    case 'buyer':
      return order.contact ? (
        <ContactPill
          contact={{ id: order.contact.id, name: order.contact.name ?? order.buyerName }}
        />
      ) : order.buyerName ? (
        <span className="block truncate" dir="auto" title={order.buyerName}>
          {order.buyerName}
        </span>
      ) : (
        <span className="text-muted-foreground">-</span>
      );
    case 'quote':
      return <QuoteLink quote={order.quote} />;
    case 'deal':
      return order.deal ? (
        <Link
          href={`/deals?deal=${order.deal.id}`}
          title={order.deal.title}
          className="block truncate text-primary outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span dir="auto">{order.deal.title}</span>
        </Link>
      ) : (
        <span className="text-muted-foreground">-</span>
      );
    case 'expected':
      return (
        <span className="tabular-nums text-muted-foreground">
          {formatDay(order.expectedDate, locale) || '-'}
        </span>
      );
    case 'status':
      return <OrderStatusChip status={order.status} />;
    case 'invoicing':
      return order.status === 'draft' || order.status === 'cancelled' ? (
        <span className="text-muted-foreground">-</span>
      ) : (
        <InvoicingChip status={order.invoicingStatus} />
      );
    case 'fulfilment':
      return order.status === 'draft' || order.status === 'cancelled' ? (
        <span className="text-muted-foreground">-</span>
      ) : (
        <FulfilmentChip status={order.fulfilmentStatus} />
      );
    case 'total':
      return (
        <Money
          minor={minorOf(order.totalMinor)}
          currency={order.currency}
          className="font-medium"
        />
      );
    case 'invoices':
      return <span className="tabular-nums">{order.invoiceCount}</span>;
  }
}

/**
 * The orders as a table: the number is frozen, the rest scrolls sideways inside the card (never the page), the header sticks
 * while the rows scroll.
 */
export function SalesOrdersTable({
  orders,
  onDialog,
}: {
  orders: readonly SalesOrderSummary[];
  onDialog: (kind: SalesOrderDialogKind, order: SalesOrderSummary) => void;
}) {
  const t = useTranslations('invoicing.salesOrders.table');
  const locale = useLocale();
  const [scrolled, setScrolled] = useState(false);
  const th =
    'sticky top-0 z-20 border-b border-border bg-muted px-3 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground';
  return (
    <div
      role="region"
      aria-label={t('scrollArea')}
      tabIndex={0}
      onScroll={(e) => setScrolled(isScrolledSideways(e.currentTarget.scrollLeft))}
      className="thin-scrollbar h-full min-h-0 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
    >
      <table
        className="w-full table-fixed border-separate border-spacing-0 text-sm"
        style={{ minWidth: MIN_WIDTH }}
      >
        <colgroup>
          {SO_COLUMNS.map((c) => (
            <col key={c} style={{ width: WIDTHS[c] }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {SO_COLUMNS.map((c) => (
              <th
                key={c}
                scope="col"
                className={cn(
                  th,
                  NUMERIC.has(c) && 'text-end',
                  c === 'number' && `ps-4 ${STICKY_ONLY_HEAD} ${frozenEdge(scrolled)}`,
                )}
              >
                <span className="block truncate">{t(`columns.${c}`)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr
              key={o.id}
              data-row-id={o.id}
              className="group h-14 align-middle transition-colors hover:bg-muted"
            >
              {SO_COLUMNS.map((c) => (
                <td
                  key={c}
                  className={cn(
                    'max-w-0 border-b border-border px-3 py-2',
                    NUMERIC.has(c) && 'text-end',
                    c === 'number' && `ps-4 ${STICKY_ONLY} ${frozenEdge(scrolled)}`,
                  )}
                >
                  {c === 'number' ? (
                    <div className="flex min-w-0 items-center gap-1.5">
                      <div className="min-w-0 flex-1">
                        <Cell id={c} order={o} locale={locale} />
                      </div>
                      <SalesOrderRowMenu order={o} onDialog={onDialog} />
                    </div>
                  ) : (
                    <Cell id={c} order={o} locale={locale} />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
