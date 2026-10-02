'use client';

import { useEffect, useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Input, Spinner, cn } from '@crm/ui';
import { useAcceptedQuotes, type QuoteRow } from '../api/sales-orders-quotes';
import { formatDay } from '../lib/dates';
import { minorOf } from '../lib/wire';
import { SearchIcon } from './icons';
import { ErrorLine, Money } from './parts';

/** The accepted proposals and estimates, searchable; picking one starts the order from it (its lines, buyer, currency and links). */
export function QuotePicker({ onPick, selectedId }: { onPick: (row: QuoteRow) => void; selectedId?: string | null }) {
  const t = useTranslations('invoicing.salesOrders.quotePicker');
  const locale = useLocale();
  const listId = useId();
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const h = window.setTimeout(() => setTerm(text), 300);
    return () => window.clearTimeout(h);
  }, [text]);
  const rows = useAcceptedQuotes(term);

  return (
    <div className="space-y-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          aria-controls={listId}
          className="ps-9"
        />
      </div>
      {rows.isError ? (
        <ErrorLine error={rows.error} onRetry={() => void rows.refetch()} />
      ) : (
        <ul id={listId} aria-label={t('results')} aria-busy={rows.isFetching} className="thin-scrollbar max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {rows.isPending && (
            <li className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
              <Spinner /> {t('loading')}
            </li>
          )}
          {rows.data?.length === 0 && <li className="px-3 py-4 text-sm text-muted-foreground">{term ? t('noMatch') : t('none')}</li>}
          {rows.data?.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPick(r)}
                aria-pressed={selectedId === r.id}
                className={cn(
                  'flex min-h-12 w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-start outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                  selectedId === r.id && 'bg-primary/5',
                )}
              >
                <span className="min-w-0 flex-1 basis-40">
                  <span className="flex items-center gap-2">
                    <span dir="ltr" className="font-medium">
                      {r.number}
                    </span>
                    <span className="rounded border border-border px-1.5 text-[11px] uppercase text-muted-foreground">{t(`kind.${r.kind}`)}</span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground" dir="auto">
                    {[r.title, r.buyerName].filter(Boolean).join(' - ') || t('untitled')}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">{r.decidedAt ? t('accepted', { date: formatDay(r.decidedAt.slice(0, 10), locale) }) : null}</span>
                <Money minor={minorOf(r.totals.totalMinor)} currency={r.currency} className="font-medium" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
