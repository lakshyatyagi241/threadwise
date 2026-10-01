'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { totalPages } from '../lib/list-model';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';

const btn =
  'inline-flex size-9 items-center justify-center rounded-md border border-border text-sm tabular-nums outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40';

/** Pages shown around the current one: first, last, and two either side, with a gap marker between. */
export function pageWindow(page: number, pages: number): Array<number | 'gap'> {
  const keep = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2]);
  const out: Array<number | 'gap'> = [];
  let last = 0;
  for (const p of [...keep].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b)) {
    if (p - last > 1) out.push('gap');
    out.push(p);
    last = p;
  }
  return out;
}

/** "Showing 12 of 30 filtered broadcasts" and the numbered pages (Reference's footer and pager). */
export function BroadcastsPagination({
  page,
  total,
  shown,
  onPage,
}: {
  page: number;
  total: number | undefined;
  shown: number;
  onPage: (page: number) => void;
}) {
  const t = useTranslations('broadcasts.list');
  const pages = totalPages(total ?? 0);
  return (
    <>
      {total !== undefined && total > 0 && (
        <div
          className="border-t border-border px-5 py-3 text-center font-mono text-[11px] text-muted-foreground"
          aria-live="polite"
        >
          {t('showing', { shown: shown.toLocaleString(), total: total.toLocaleString() })}
        </div>
      )}
      {pages > 1 && (
        <nav aria-label={t('pagination')} className="mt-4 flex items-center justify-center gap-1">
          <button
            type="button"
            className={btn}
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            aria-label={t('prevPage')}
          >
            <ChevronLeftIcon className="size-4 rtl:rotate-180" />
          </button>
          {pageWindow(page, pages).map((slot, i) =>
            slot === 'gap' ? (
              <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-muted-foreground">
                &hellip;
              </span>
            ) : (
              <button
                key={slot}
                type="button"
                onClick={() => onPage(slot)}
                aria-current={slot === page ? 'page' : undefined}
                aria-label={t('goToPage', { page: slot })}
                className={cn(
                  btn,
                  slot === page && 'border-brand bg-brand text-brand-foreground hover:bg-brand',
                )}
              >
                {slot}
              </button>
            ),
          )}
          <button
            type="button"
            className={btn}
            disabled={page >= pages}
            onClick={() => onPage(page + 1)}
            aria-label={t('nextPage')}
          >
            <ChevronRightIcon className="size-4 rtl:rotate-180" />
          </button>
        </nav>
      )}
    </>
  );
}
