'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { CrmDashboardResponse } from '@crm/contracts';
import { cn } from '@crm/ui';
import { Panel } from '@/features/dashboards-analytics-charts/components/parts';
import { formatAmount } from '../lib/format';

type Invoices = NonNullable<CrmDashboardResponse['invoices']>;

/** Receivables aging: open invoice balances by how long past due, one block per currency (never summed across currencies). */
export function AgingPanel({ aging }: { aging: Invoices['aging'] }) {
  const t = useTranslations('crm-dashboard.aging');
  const locale = useLocale();
  return (
    <Panel
      title={t('title')}
      action={
        <Link href="/payments" className="text-xs font-medium text-primary hover:underline">
          {t('open')}
        </Link>
      }
    >
      {aging.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="space-y-4">
          {aging.map((block) => (
            <div key={block.currency}>
              {aging.length > 1 && (
                <div className="mb-1 text-xs font-medium text-muted-foreground">{block.currency}</div>
              )}
              <dl className="space-y-1.5">
                {block.buckets.map((b) => (
                  <div key={b.bucket} className="flex items-center justify-between text-sm">
                    <dt className="text-muted-foreground">{t(`bucket.${b.bucket}`)}</dt>
                    <dd
                      className={cn(
                        'font-mono tabular-nums',
                        b.bucket === 'd90_plus' && Number(b.amount) > 0 && 'font-medium text-danger',
                      )}
                    >
                      {formatAmount(b.amount, block.currency, locale)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/** The last payments received. */
export function PaymentsPanel({ payments }: { payments: Invoices['recentPayments'] }) {
  const t = useTranslations('crm-dashboard.payments');
  const locale = useLocale();
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(iso));
  return (
    <Panel title={t('title')}>
      {payments.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="space-y-1.5">
          {payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-muted-foreground">
                {p.contact?.name || date(p.paidAt)}
              </span>
              <span className="shrink-0 font-mono tabular-nums text-success">
                {formatAmount(p.amount, p.currency, locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
