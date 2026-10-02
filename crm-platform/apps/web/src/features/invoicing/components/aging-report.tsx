'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Spinner, cn } from '@crm/ui';
import { useAging } from '../api/hooks';
import { bucketHref, bucketRows, minorBig, shareLabel, type BucketKey } from '../lib/aging';
import { formatDay } from '../lib/dates';
import { ErrorLine, Money } from './parts';

const BAR: Record<BucketKey, string> = {
  current: 'bg-success',
  d1_30: 'bg-primary',
  d31_60: 'bg-warning',
  d61_90: 'bg-[color-mix(in_srgb,var(--warning)_55%,var(--danger))]',
  d90_plus: 'bg-danger',
};

/**
 * What customers still owe, by how late it is (counted from the due date), one card per currency: a stacked bar and a table of
 * the five buckets with amount, share and invoice count. A bucket opens the invoices behind it. The figures come from the server
 * (`GET /payments/aging`); the screen only lays them out.
 */
export function AgingReport({
  currency = '',
  contact = '',
}: {
  currency?: string;
  contact?: string;
}) {
  const t = useTranslations('invoicing.aging');
  const locale = useLocale();
  const aging = useAging({ currency: currency || undefined, contactId: contact || undefined });

  if (aging.isPending) {
    return (
      <div role="status" className="flex items-center gap-2 p-6 text-muted-foreground">
        <Spinner /> {t('loading')}
      </div>
    );
  }
  if (aging.isError) return <ErrorLine error={aging.error} onRetry={() => void aging.refetch()} />;
  const { currencies, asOf } = aging.data;
  const shown = currencies.filter((c) => c.invoices > 0 || minorBig(c.total, c.currency) > 0n);
  if (shown.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
        <div className="text-lg font-semibold">{t('emptyTitle')}</div>
        <p className="mt-1 text-sm text-muted-foreground">{t('emptyMessage')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t('asOf', { date: formatDay(asOf, locale) })}
      </p>
      {shown.map((c) => {
        const rows = bucketRows(c.buckets, c.currency);
        const total = minorBig(c.total, c.currency);
        return (
          <section
            key={c.currency}
            aria-label={t('currencyLabel', { currency: c.currency })}
            className="space-y-3 rounded-xl border border-border bg-background p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold">
                {t('outstanding')} <Money minor={Number(total)} currency={c.currency} />
              </h2>
              <span className="text-sm text-muted-foreground">
                {t('invoices', { count: c.invoices })} - {c.currency}
              </span>
            </div>

            <div
              className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={t('barLabel')}
            >
              {rows.map((r) =>
                r.tenths > 0 ? (
                  <span
                    key={r.bucket}
                    className={cn('h-full', BAR[r.bucket])}
                    style={{ width: `${r.tenths / 10}%` }}
                  />
                ) : null,
              )}
            </div>

            <div className="thin-scrollbar overflow-x-auto">
              <table className="w-full min-w-[30rem] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="bg-muted px-3 py-2.5 text-start first:rounded-s-md">
                      {t('bucket')}
                    </th>
                    <th scope="col" className="bg-muted px-3 py-2.5 text-end">
                      {t('amount')}
                    </th>
                    <th scope="col" className="bg-muted px-3 py-2.5 text-end">
                      {t('share')}
                    </th>
                    <th scope="col" className="bg-muted px-3 py-2.5 text-end last:rounded-e-md">
                      {t('invoicesColumn')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.bucket} className="hover:bg-muted/50">
                      <th
                        scope="row"
                        className="border-b border-border px-3 py-2.5 text-start font-medium"
                      >
                        <Link
                          href={bucketHref(r.bucket, asOf, { currency: c.currency, contact })}
                          className="inline-flex items-center gap-2 hover:text-primary hover:underline"
                          title={t('openBucket')}
                        >
                          <span
                            aria-hidden="true"
                            className={cn('size-2.5 rounded-full', BAR[r.bucket])}
                          />
                          {t(`buckets.${r.bucket}`)}
                        </Link>
                      </th>
                      <td
                        className={cn(
                          'border-b border-border px-3 py-2.5 text-end',
                          r.amount === 0n && 'text-muted-foreground',
                        )}
                      >
                        <Money minor={Number(r.amount)} currency={c.currency} />
                      </td>
                      <td
                        dir="ltr"
                        className="border-b border-border px-3 py-2.5 text-end tabular-nums text-muted-foreground"
                      >
                        {shareLabel(r.tenths)}
                      </td>
                      <td className="border-b border-border px-3 py-2.5 text-end tabular-nums">
                        {r.invoices}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <th scope="row" className="px-3 py-2.5 text-start">
                      {t('total')}
                    </th>
                    <td className="px-3 py-2.5 text-end">
                      <Money minor={Number(total)} currency={c.currency} />
                    </td>
                    <td
                      dir="ltr"
                      className="px-3 py-2.5 text-end tabular-nums text-muted-foreground"
                    >
                      {total > 0n ? '100%' : '0%'}
                    </td>
                    <td className="px-3 py-2.5 text-end tabular-nums">{c.invoices}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
