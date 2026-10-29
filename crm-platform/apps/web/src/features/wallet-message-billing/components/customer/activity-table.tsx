'use client';

import Link from 'next/link';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import type { WalletTransaction } from '@crm/contracts';
import { cn } from '@crm/ui';
import { formatDateTime } from '@/lib/format-datetime';
import { humanizeSource } from '../../lib/billing-variant';
import { TONE_CLASS, directionTone, formatAmount, formatMovement } from '../../lib/money';
import { TypePill } from './type-pill';

/** "Download invoice" for an entry paid through an order (a top-up): the order's invoice page, ready to print or save. */
export function InvoiceLink({ orderId }: { orderId: string | null | undefined }) {
  const t = useTranslations('wallet-message-billing.activity');
  if (!orderId) return null;
  return (
    <Link
      className="mt-0.5 inline-block text-xs underline"
      href={`/billing/orders/${orderId}/invoice`}
      data-testid="wallet-invoice-link"
    >
      {t('invoice')}
    </Link>
  );
}

export const formatWhen = (iso: string, locale: string, timeZone?: string): string =>
  formatDateTime(iso, locale, timeZone);

/** Wallet activity rows: description (with the operator's reason for an adjustment), type, date, signed amount, balance. */
export function ActivityTable({
  rows,
  currency,
  label,
}: {
  rows: readonly WalletTransaction[];
  currency: string;
  label: string;
}) {
  const t = useTranslations('wallet-message-billing.activity');
  const locale = useLocale();
  const timeZone = useTimeZone();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm" aria-label={label}>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="px-2 py-2 text-start font-medium">
              {t('description')}
            </th>
            <th scope="col" className="px-2 py-2 text-start font-medium">
              {t('type')}
            </th>
            <th scope="col" className="px-2 py-2 text-start font-medium">
              {t('date')}
            </th>
            <th scope="col" className="px-2 py-2 text-end font-medium">
              {t('amount')}
            </th>
            <th scope="col" className="px-2 py-2 text-end font-medium">
              {t('balance')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0 align-top">
              <td className="px-2 py-2">
                <div>{r.description || humanizeSource(r.source) || t('noDescription')}</div>
                {r.note && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t('reason')}: {r.note}
                  </div>
                )}
                <InvoiceLink orderId={r.invoiceOrderId} />
              </td>
              <td className="px-2 py-2">
                <TypePill type={r.type} />
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                {formatWhen(r.createdAt, locale, timeZone)}
              </td>
              <td
                className={cn(
                  'whitespace-nowrap px-2 py-2 text-end font-medium tabular-nums',
                  TONE_CLASS[directionTone(r.direction)],
                )}
              >
                {formatMovement(r.amountMinor, r.direction, currency, locale, r.amountExact)}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-end tabular-nums">
                {formatAmount(r.balanceAfterMinor, r.balanceAfterExact, currency, locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
