'use client';

import type { InvoiceCountsResponse } from '@crm/contracts';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { exponentOf, formatMoney } from '../lib/money';
import { majorToMinor } from '../lib/wire';

type Total = InvoiceCountsResponse['outstanding'][number];

const minorOf = (t: Total) => majorToMinor(t.amount, exponentOf(t.currency));

/**
 * What is still owed on the invoices of the current filter, one tile per currency (currencies are never added together), and
 * how much of it is past due. Both come from `GET /invoices/counts`, which ignores the status tab. Renders nothing when
 * nothing is owed.
 */
export function OutstandingStrip({ counts }: { counts: InvoiceCountsResponse | undefined }) {
  const t = useTranslations('invoicing.strip');
  const locale = useLocale();
  if (!counts) return null;
  const currencies = [...new Set([...counts.outstanding, ...counts.overdueAmount].map((x) => x.currency))];
  const open = currencies.filter((c) => {
    const o = counts.outstanding.find((x) => x.currency === c);
    const d = counts.overdueAmount.find((x) => x.currency === c);
    return (o && minorOf(o) > 0) || (d && minorOf(d) > 0);
  });
  if (open.length === 0) return null;
  return (
    <section aria-label={t('label')} className="flex flex-wrap gap-2">
      {open.map((c) => {
        const o = counts.outstanding.find((x) => x.currency === c);
        const d = counts.overdueAmount.find((x) => x.currency === c);
        const overdue = d ? minorOf(d) : 0;
        return (
          <div key={c} className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-1 rounded-xl border border-border bg-background px-4 py-2.5">
            <div>
              <div className="text-xs font-medium text-muted-foreground">{t('outstanding', { currency: c })}</div>
              <div dir="ltr" className="text-lg font-semibold tabular-nums">
                {formatMoney(o ? minorOf(o) : 0, c, locale)}
              </div>
            </div>
            {overdue > 0 && (
              <div>
                <div className="text-xs font-medium text-danger">{t('overdue')}</div>
                <div dir="ltr" className={cn('text-lg font-semibold tabular-nums text-danger')}>
                  {formatMoney(overdue, c, locale)}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
