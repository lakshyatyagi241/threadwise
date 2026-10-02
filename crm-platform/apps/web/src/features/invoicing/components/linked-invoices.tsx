'use client';

import type { LinkedInvoicesResponse } from '@crm/contracts';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Spinner, cn } from '@crm/ui';
import { invoicingApi } from '../api/service';
import { formatDay } from '../lib/dates';
import { isUnavailable } from '../lib/errors';
import { rowBalanceMinor } from '../lib/invoice-facts';
import { exponentOf, formatMoney } from '../lib/money';
import { invoiceMinor, majorToMinor } from '../lib/wire';
import { PlusIcon } from './icons';
import { ErrorLine, Money, StatusChip, useInvoicingCan } from './parts';

export interface LinkedInvoicesProps {
  /** The record whose invoices are listed, and the link a new invoice gets. */
  kind: 'contact' | 'deal';
  id: string;
  /** A short heading style for narrow panels (the deal drawer). */
  compact?: boolean;
  className?: string;
}

/**
 * The invoices of one contact or deal: the latest five with status and balance, the money rolled up per currency (invoiced, paid,
 * outstanding, overdue: currencies are never added together), a "New invoice" shortcut that links the new invoice to the record,
 * and a link to the Invoices list filtered to the contact. Shared by the contact page and the deal drawer so both behave the
 * same. Renders nothing for someone who may not read invoices.
 */
export function LinkedInvoices(props: LinkedInvoicesProps) {
  const can = useInvoicingCan();
  if (!can.read) return null;
  return <Panel {...props} canCreate={can.create} />;
}

type Totals = LinkedInvoicesResponse['totals'];

function TotalsStrip({ totals }: { totals: Totals }) {
  const t = useTranslations('invoicing.linked');
  const locale = useLocale();
  const currencies = [...new Set([...totals.invoiced, ...totals.outstanding].map((x) => x.currency))];
  if (currencies.length === 0) return null;
  const pick = (rows: Totals['invoiced'], c: string) => {
    const r = rows.find((x) => x.currency === c);
    return r ? majorToMinor(r.amount, exponentOf(c)) : 0;
  };
  return (
    <dl className="space-y-1.5 rounded-md bg-muted/50 px-3 py-2 text-xs">
      {currencies.map((c) => {
        const overdue = pick(totals.overdue, c);
        return (
          <div key={c} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
            <span dir="ltr" className="font-semibold text-muted-foreground">
              {c}
            </span>
            <span>
              <dt className="inline text-muted-foreground">{t('invoiced')} </dt>
              <dd className="inline font-medium tabular-nums" dir="ltr">
                {formatMoney(pick(totals.invoiced, c), c, locale)}
              </dd>
            </span>
            <span>
              <dt className="inline text-muted-foreground">{t('paid')} </dt>
              <dd className="inline font-medium tabular-nums" dir="ltr">
                {formatMoney(pick(totals.paid, c), c, locale)}
              </dd>
            </span>
            <span>
              <dt className="inline text-muted-foreground">{t('outstanding')} </dt>
              <dd className="inline font-semibold tabular-nums" dir="ltr">
                {formatMoney(pick(totals.outstanding, c), c, locale)}
              </dd>
            </span>
            {overdue > 0 && (
              <span className="text-danger">
                <dt className="inline">{t('overdue')} </dt>
                <dd className="inline font-semibold tabular-nums" dir="ltr">
                  {formatMoney(overdue, c, locale)}
                </dd>
              </span>
            )}
          </div>
        );
      })}
    </dl>
  );
}

function Panel({ kind, id, compact, className, canCreate }: LinkedInvoicesProps & { canCreate: boolean }) {
  const t = useTranslations('invoicing.linked');
  const locale = useLocale();
  const linked = useQuery({
    queryKey: ['invoicing', 'linked', kind, id],
    queryFn: ({ signal }) => invoicingApi.linked(kind, id, { limit: 5 }, signal),
    retry: false,
  });
  const rows = linked.data?.items ?? [];
  const heading = `linked-invoices-${kind}-${id}`;
  const newHref = `/invoices/new?${kind}=${id}`;
  // A deal's invoices are listed in full on the list through its contact; the list filters by contact only.
  const allHref = kind === 'contact' ? `/invoices?contact=${id}` : '/invoices';

  // Where the routes are not deployed the panel stays out of the way instead of showing an error on someone else's page.
  if (linked.isError && isUnavailable(linked.error)) return null;

  return (
    <section
      aria-labelledby={heading}
      className={cn(compact ? 'space-y-3' : 'space-y-3 rounded-md border border-border bg-background p-4 sm:p-5', className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id={heading} className={cn(compact ? 'text-sm font-semibold' : 'text-[11px] font-medium uppercase tracking-wider text-muted-foreground')}>
          {t('title')}
        </h2>
        <div className="flex items-center gap-3 text-sm">
          {canCreate && (
            <Link href={newHref} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              <PlusIcon className="size-3.5" /> {t('new')}
            </Link>
          )}
          {kind === 'contact' && rows.length > 0 && (
            <Link href={allHref} className="text-muted-foreground hover:text-foreground hover:underline">
              {t('viewAll')}
            </Link>
          )}
        </div>
      </div>
      {linked.isPending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : linked.isError ? (
        <ErrorLine error={linked.error} onRetry={() => void linked.refetch()} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <>
          {linked.data && <TotalsStrip totals={linked.data.totals} />}
          <ul className="divide-y divide-border">
            {rows.map((inv) => {
              const owes = rowBalanceMinor(inv) ?? 0;
              const open = inv.status === 'issued' || inv.status === 'partially_paid' || inv.status === 'overdue';
              return (
                <li key={inv.id}>
                  <Link
                    href={`/invoices/${inv.id}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium" dir="ltr">
                        {inv.number ?? t('draft')}
                      </span>
                      <span className="block text-xs text-muted-foreground">{formatDay(inv.issueDate, locale) || '-'}</span>
                    </span>
                    <StatusChip status={inv.status} />
                    <span className="text-end">
                      <Money minor={invoiceMinor(inv).total} currency={inv.currency} className="block text-sm font-medium" />
                      {open && owes > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          {t('owes')} <Money minor={owes} currency={inv.currency} />
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {linked.data?.hasMore && <p className="text-xs text-muted-foreground">{t('latest', { count: rows.length })}</p>}
        </>
      )}
    </section>
  );
}
