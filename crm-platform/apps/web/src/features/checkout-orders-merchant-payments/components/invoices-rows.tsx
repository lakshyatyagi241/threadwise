'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { InvoiceSummary } from '@crm/contracts';
import { buyerLabel, formatCalendarDay, invoiceTone, invoiceTotal } from '../lib/store-invoices';
import { Th, ToneBadge } from './parts';

/** The status chip: the Sales status labels (`invoicing.status.*`) in this domain's tones. */
export function InvoiceStatusBadge({ status }: { status: string }) {
  const t = useTranslations('invoicing.status');
  return <ToneBadge tone={invoiceTone(status)}>{t.has(status) ? t(status) : status}</ToneBadge>;
}

const LINK =
  'font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded';

/** The store invoices table: number, buyer, status, total, issued, due and "Open in Sales". Scrolls sideways on a phone. */
export function InvoicesTable({ items }: { items: InvoiceSummary[] }) {
  const t = useTranslations('checkout-orders-merchant-payments.invoices');
  const locale = useLocale();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <Th>{t('columns.number')}</Th>
            <Th>{t('columns.buyer')}</Th>
            <Th>{t('columns.status')}</Th>
            <Th end>{t('columns.total')}</Th>
            <Th>{t('columns.issued')}</Th>
            <Th>{t('columns.due')}</Th>
            <Th end>
              <span className="sr-only">{t('columns.actions')}</span>
            </Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((inv) => {
            const buyer = buyerLabel(inv);
            const number = inv.number ?? t('row.draft');
            return (
              <tr key={inv.id} className="hover:bg-muted/40">
                <td className="whitespace-nowrap px-4 py-3">
                  <Link href={`/invoices/${inv.id}`} className={`${LINK} font-mono`}>
                    {number}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {inv.contact && buyer ? (
                    <Link href={`/contacts/${inv.contact.id}`} className={LINK}>
                      {buyer}
                    </Link>
                  ) : (
                    buyer || <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <InvoiceStatusBadge status={inv.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-end font-medium tabular-nums">
                  {invoiceTotal(inv, locale)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {formatCalendarDay(inv.issueDate, locale) || '—'}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {formatCalendarDay(inv.dueDate, locale) || '—'}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-end">
                  <Link
                    href={`/invoices/${inv.id}`}
                    aria-label={t('row.openAria', { number })}
                    className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {t('row.openInSales')}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
