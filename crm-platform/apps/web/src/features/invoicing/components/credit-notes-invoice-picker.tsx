'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import type { InvoiceResponse, InvoiceSummary } from '@crm/contracts';
import { Alert, Input, Spinner, cn } from '@crm/ui';
import { useInvoicesList } from '../api/hooks';
import { CREDITABLE_INVOICE_STATUSES } from '../lib/credit-notes';
import { invoiceMinor } from '../lib/wire';
import { SearchIcon } from './icons';
import { ErrorLine, Money, StatusChip } from './parts';

/** The money of the picked invoice: total, paid, already credited and still owed. */
export function InvoiceFacts({
  invoice,
}: {
  invoice: Pick<InvoiceResponse, 'amountsMinor' | 'currency'>;
}) {
  const t = useTranslations('invoicing.creditNotes.picker');
  const m = invoiceMinor(invoice);
  const cell = (label: string, minor: number, strong?: boolean) => (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('truncate text-sm', strong && 'font-semibold')}>
        <Money minor={minor} currency={invoice.currency} />
      </dd>
    </div>
  );
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
      {cell(t('total'), m.total)}
      {cell(t('paid'), m.paid)}
      {cell(t('credited'), m.credited)}
      {cell(t('balance'), m.balance, true)}
    </dl>
  );
}

/**
 * Picks the invoice to credit: search by number or buyer among the invoices a credit note can be made against (issued, partly
 * paid, overdue, paid). Once picked, the invoice's own numbers are shown; "Change" opens the search again (not while editing a
 * draft: a credit note belongs to one invoice).
 */
export function CreditInvoicePicker({
  invoiceId,
  invoice,
  loading,
  error,
  locked,
  onPick,
  onClear,
  invalid,
}: {
  invoiceId: string | null;
  invoice: InvoiceResponse | undefined;
  loading: boolean;
  error: unknown;
  locked: boolean;
  onPick: (inv: InvoiceSummary) => void;
  onClear: () => void;
  invalid?: boolean;
}) {
  const t = useTranslations('invoicing.creditNotes.picker');
  const listId = useId();
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const h = window.setTimeout(() => setTerm(text.trim()), 250);
    return () => window.clearTimeout(h);
  }, [text]);

  const hits = useInvoicesList(
    { status: CREDITABLE_INVOICE_STATUSES, q: term || undefined },
    { enabled: !invoiceId, limit: 10 },
  );

  if (invoiceId) {
    if (loading) {
      return (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-border p-3 text-sm text-muted-foreground"
        >
          <Spinner /> {t('loading')}
        </div>
      );
    }
    if (error || !invoice) return <ErrorLine error={error} />;
    return (
      <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Link
              href={`/invoices/${invoice.id}`}
              className="font-semibold text-primary hover:underline"
              dir="ltr"
            >
              {invoice.number}
            </Link>
            <StatusChip status={invoice.status} />
            <span className="min-w-0 truncate text-sm text-muted-foreground" dir="auto">
              {invoice.buyerName ?? invoice.contact?.name ?? ''}
            </span>
          </div>
          {!locked && (
            <button
              type="button"
              onClick={() => {
                onClear();
                setText('');
                setTerm('');
              }}
              className="h-10 rounded-md px-3 text-sm font-medium text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('change')}
            </button>
          )}
        </div>
        <InvoiceFacts invoice={invoice} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={t('search')}
          aria-invalid={invalid || undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={t('search')}
          className="ps-9"
        />
      </div>
      <div
        id={listId}
        role="listbox"
        aria-label={t('results')}
        className="thin-scrollbar max-h-72 overflow-auto rounded-md border border-border"
      >
        {hits.isPending ? (
          <div role="status" className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
            <Spinner /> {t('searching')}
          </div>
        ) : hits.isError ? (
          <div className="p-2">
            <ErrorLine error={hits.error} onRetry={() => void hits.refetch()} />
          </div>
        ) : hits.items.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">{t('none')}</p>
        ) : (
          <>
            {hits.items.map((inv) => {
              const m = invoiceMinor(inv);
              return (
                <button
                  key={inv.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => onPick(inv)}
                  className="flex min-h-12 w-full flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2 text-start text-sm last:border-b-0 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <span className="font-medium" dir="ltr">
                    {inv.number}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground" dir="auto">
                    {inv.buyerName ?? inv.contact?.name ?? ''}
                  </span>
                  <StatusChip status={inv.status} />
                  <span className="text-xs text-muted-foreground">
                    {t('totalShort')} <Money minor={m.total} currency={inv.currency} />
                  </span>
                </button>
              );
            })}
            {hits.hasNextPage && (
              <button
                type="button"
                onClick={() => void hits.fetchNextPage()}
                disabled={hits.isFetchingNextPage}
                className="h-10 w-full text-sm font-medium text-primary hover:bg-muted"
              >
                {hits.isFetchingNextPage ? <Spinner /> : t('more')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** A picked invoice that a credit note cannot be made against (draft, void ...). */
export function NotCreditableAlert() {
  const t = useTranslations('invoicing.creditNotes.picker');
  return <Alert tone="warning">{t('notCreditable')}</Alert>;
}
