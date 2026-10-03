'use client';

import type { InvoiceResponse } from '@crm/contracts';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Spinner, cn } from '@crm/ui';
import { useCreditNotesList } from '../api/hooks';
import { formatDay } from '../lib/dates';
import { isKnownSource } from '../lib/labels';
import { quoteHref } from '../lib/sales-orders';
import { invoiceMinor, minorOf } from '../lib/wire';
import { NoteIcon, PlusIcon } from './icons';
import { creditNoteHref } from './invoice-menu';
import { ContactPill, ErrorLine, Money, useInvoicingCan } from './parts';

function Tile({
  label,
  children,
  strong,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  strong?: boolean;
  tone?: 'danger' | 'success';
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-lg border border-border px-3 py-2',
        strong && 'col-span-2 bg-muted/50',
      )}
    >
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 truncate',
          strong ? 'text-lg font-bold' : 'text-sm font-semibold',
          tone === 'danger' && 'text-danger',
          tone === 'success' && 'text-success',
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/**
 * Where the invoice stands in its own currency: total, paid, refunded, credited, balance and a credit when more was received or
 * credited than it asks for. Amounts come from `amountsMinor` (the server's numbers, never recomputed here).
 */
export function SummaryCards({ invoice }: { invoice: InvoiceResponse }) {
  const t = useTranslations('invoicing.detail');
  const m = invoiceMinor(invoice);
  const c = invoice.currency;
  const issued = invoice.status !== 'draft';
  return (
    <section
      aria-label={t('amountsLabel')}
      className="rounded-xl border border-border bg-background p-4"
    >
      <dl className="grid grid-cols-2 gap-2">
        <Tile label={t('total')}>
          <Money minor={m.total} currency={c} />
        </Tile>
        {issued && (
          <Tile label={t('paid')} tone={m.paid > 0 ? 'success' : undefined}>
            <Money minor={m.paid} currency={c} />
          </Tile>
        )}
        {issued && m.refunded > 0 && (
          <Tile label={t('refunded')} tone="danger">
            <Money minor={m.refunded} currency={c} />
          </Tile>
        )}
        {issued && m.credited > 0 && (
          <Tile label={t('credited')}>
            <Money minor={m.credited} currency={c} />
          </Tile>
        )}
        {issued && m.credit > 0 && (
          <Tile label={t('credit')} tone="success">
            <Money minor={m.credit} currency={c} />
          </Tile>
        )}
        {issued && invoice.status !== 'void' && (
          <Tile
            label={t('balance')}
            strong
            tone={invoice.status === 'overdue' && m.balance > 0 ? 'danger' : undefined}
          >
            <Money minor={m.balance} currency={c} />
          </Tile>
        )}
      </dl>
      {m.credit > 0 && <p className="mt-3 text-xs text-muted-foreground">{t('overpaid')}</p>}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-end" dir="auto">
        {children}
      </dd>
    </div>
  );
}

/** Dates and the records the invoice hangs on: contact, company, deal, the quote or sales order it came from, its owner. */
export function DetailsCard({ invoice }: { invoice: InvoiceResponse }) {
  const t = useTranslations('invoicing.detail');
  const locale = useLocale();
  const late = invoice.status === 'overdue' ? (invoice.daysOverdue ?? 0) : 0;
  // An order's invoice carries the order's number as its reference: keep that text for an invoice that predates the link.
  const orderText =
    !invoice.salesOrder && invoice.source === 'sales_order' ? invoice.reference : null;
  const linkClass = 'text-primary underline underline-offset-2';
  return (
    <section
      aria-label={t('detailsLabel')}
      className="rounded-xl border border-border bg-background p-4 text-xs"
    >
      <dl className="space-y-1.5">
        <Row label={t('issued')}>{formatDay(invoice.issueDate, locale) || '-'}</Row>
        <Row label={t('due')}>
          <span className={late > 0 ? 'font-medium text-danger' : undefined}>
            {formatDay(invoice.dueDate, locale) || t('noDue')}
            {late > 0 && ` (${t('daysLate', { count: late })})`}
          </span>
        </Row>
        <Row label={t('source')}>
          {isKnownSource(invoice.source) ? t(`sources.${invoice.source}`) : invoice.source}
        </Row>
        {invoice.contact && (
          <Row label={t('contact')}>
            <ContactPill contact={invoice.contact} />
          </Row>
        )}
        {invoice.company && <Row label={t('company')}>{invoice.company.name ?? '-'}</Row>}
        {invoice.deal && (
          <Row label={t('deal')}>
            <Link
              href={`/deals?deal=${invoice.deal.id}`}
              className="text-primary underline underline-offset-2"
            >
              {invoice.deal.title || t('dealFallback')}
            </Link>
          </Row>
        )}
        {invoice.quote && (
          <Row label={t('quote')}>
            <Link href={quoteHref(invoice.quote)} className={linkClass} dir="ltr">
              {invoice.quote.number}
            </Link>
          </Row>
        )}
        {invoice.salesOrder && (
          <Row label={t('salesOrder')}>
            <Link href={`/sales-orders/${invoice.salesOrder.id}`} className={linkClass} dir="ltr">
              {invoice.salesOrder.number}
            </Link>
          </Row>
        )}
        {orderText && <Row label={t('salesOrder')}>{orderText}</Row>}
        {invoice.recurring && (
          <Row label={t('recurring')}>
            <Link href={`/recurring-invoices/${invoice.recurring.id}`} className={linkClass}>
              {invoice.recurring.name}
            </Link>
          </Row>
        )}
        {invoice.reference && !orderText && !invoice.salesOrder && (
          <Row label={t('reference')}>{invoice.reference}</Row>
        )}
        {invoice.owner && <Row label={t('owner')}>{invoice.owner.name}</Row>}
        {invoice.createdBy && <Row label={t('createdBy')}>{invoice.createdBy.name}</Row>}
      </dl>
    </section>
  );
}

/** The credit notes issued against this invoice, each a link to its page, and the button that starts a new one. */
export function CreditNotesCard({
  invoiceId,
  canCreate,
}: {
  invoiceId: string;
  canCreate: boolean;
}) {
  const t = useTranslations('invoicing.detail.creditNotes');
  const locale = useLocale();
  const can = useInvoicingCan();
  const list = useCreditNotesList({ invoiceId }, { enabled: can.readCreditNotes });
  if (!can.readCreditNotes) return null;
  return (
    <section
      aria-labelledby="inv-credits"
      className="rounded-xl border border-border bg-background p-4 print:hidden"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="inv-credits" className="text-sm font-semibold">
          {t('title')}
        </h2>
        {canCreate && (
          <Link
            href={creditNoteHref(invoiceId)}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            <PlusIcon className="size-3.5" /> {t('create')}
          </Link>
        )}
      </div>
      {list.isPending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : list.isError ? (
        <ErrorLine error={list.error} onRetry={() => void list.refetch()} />
      ) : list.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.items.map((cn_) => (
            <li key={cn_.id}>
              <Link
                href={`/credit-notes/${cn_.id}`}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <NoteIcon className="size-4 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium" dir="ltr">
                      {cn_.number ?? t('draft')}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t(`status.${cn_.status}`)}
                      {cn_.issueDate && ` - ${formatDay(cn_.issueDate, locale)}`}
                    </span>
                  </span>
                </span>
                <Money
                  minor={minorOf(cn_.totalMinor)}
                  currency={cn_.currency}
                  className={cn(
                    'text-sm font-medium',
                    cn_.status === 'void' && 'text-muted-foreground line-through',
                  )}
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
