'use client';

import Link from 'next/link';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import type { StorePaymentRecord } from '@crm/contracts';
import { displayPhone, formatMoney, formatWhen, withShop } from '../lib/format';
import { PaymentStatusBadge, Th } from './parts';

/** The payment list: one row per store order, newest first. Wide on purpose; it scrolls sideways on a phone instead of reflowing. */
export function PaymentsTable({
  items,
  shopId,
}: {
  items: readonly StorePaymentRecord[];
  shopId: string | undefined;
}) {
  const t = useTranslations('checkout-orders-merchant-payments.payments.table');
  const locale = useLocale();
  const timeZone = useTimeZone();

  const method = (m: string) =>
    m === 'prepaid' ? t('methodPrepaid') : m === 'cod' ? t('methodCod') : m;
  const via = (v: string | null) =>
    v === null
      ? '—'
      : v === 'razorpay_link'
        ? t('via.razorpay_link')
        : v === 'whatsapp_pay'
          ? t('via.whatsapp_pay')
          : v;

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-background">
      <table className="w-full min-w-[60rem] text-sm" data-testid="payments-table">
        <caption className="sr-only">{t('caption')}</caption>
        <thead className="border-b border-border bg-muted/50 text-muted-foreground">
          <tr>
            <Th>{t('order')}</Th>
            <Th>{t('customer')}</Th>
            <Th>{t('status')}</Th>
            <Th>{t('method')}</Th>
            <Th>{t('paidVia')}</Th>
            <Th>{t('reference')}</Th>
            <Th end>{t('amount')}</Th>
            <Th>{t('shop')}</Th>
            <Th>{t('date')}</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((p) => (
            <tr key={p.orderId} data-testid="payment-row">
              <td className="whitespace-nowrap px-4 py-3">
                <Link
                  href={withShop(`/store/orders/${p.orderId}`, shopId)}
                  className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  #{p.orderNo}
                </Link>
              </td>
              <td className="px-4 py-3">
                <div className="font-medium">{p.customerName || '—'}</div>
                {p.customerPhone && (
                  <div className="text-xs text-muted-foreground" dir="ltr">
                    {displayPhone(p.customerPhone)}
                  </div>
                )}
              </td>
              <td className="px-4 py-3">
                <PaymentStatusBadge status={p.status} />
              </td>
              <td className="whitespace-nowrap px-4 py-3">{method(p.method)}</td>
              <td className="whitespace-nowrap px-4 py-3">{via(p.paidVia)}</td>
              <td className="px-4 py-3 font-mono text-xs" dir="ltr">
                {p.reference || '—'}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-end font-medium tabular-nums">
                {formatMoney(p.amountMinor, p.currencyCode, locale)}
              </td>
              <td className="px-4 py-3">{p.storefrontName || '—'}</td>
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                {formatWhen(p.createdAt, locale, timeZone)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
