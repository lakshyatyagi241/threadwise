'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { WalletTransaction } from '@crm/contracts';
import { cn } from '@crm/ui';
import { humanizeSource } from '../../lib/billing-variant';
import { TONE_CLASS, directionTone, formatMinor, formatMovement } from '../../lib/money';
import { TypePill } from './type-pill';

export const formatWhen = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

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
              </td>
              <td className="px-2 py-2">
                <TypePill type={r.type} />
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                {formatWhen(r.createdAt, locale)}
              </td>
              <td
                className={cn(
                  'whitespace-nowrap px-2 py-2 text-end font-medium tabular-nums',
                  TONE_CLASS[directionTone(r.direction)],
                )}
              >
                {formatMovement(r.amountMinor, r.direction, currency, locale)}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-end tabular-nums">
                {formatMinor(r.balanceAfterMinor, currency, locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
