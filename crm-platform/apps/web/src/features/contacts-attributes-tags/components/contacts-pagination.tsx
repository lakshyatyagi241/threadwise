'use client';

import { useTranslations } from 'next-intl';
import { Select, Spinner, cn } from '@crm/ui';
import { PAGE_SIZES, type PageSize } from '../api/contacts';
import { pageWindow, totalPages } from '../lib/pagination';

const textBtn =
  'inline-flex h-8 items-center justify-center rounded-md px-2.5 text-sm font-medium outline-none transition ' +
  'focus-visible:ring-2 focus-visible:ring-primary';
const numBtn =
  'inline-flex size-8 items-center justify-center rounded-md border text-sm tabular-nums outline-none transition ' +
  'focus-visible:ring-2 focus-visible:ring-primary';

/**
 * Footer of the table card, pinned under the scrolling rows: Previous, numbered pages and Next in the middle; the
 * total and the rows-per-page choice at the end. The numbers sit on top of a cursor API, so jumping several pages
 * ahead is slower than stepping by one (see `loadContactPage`); the spinner shows while it walks.
 */
export function ContactsPagination({
  page,
  total,
  limit,
  loading,
  onPage,
  onLimit,
  onRecount,
}: {
  page: number;
  /** Undefined until the first response (the count is not known yet). */
  total: number | undefined;
  limit: PageSize;
  /** A page is being fetched. */
  loading: boolean;
  onPage: (page: number) => void;
  onLimit: (limit: PageSize) => void;
  /** "Total count": ask the API for the count again. */
  onRecount: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.list');
  const pages = totalPages(total ?? 0, limit);
  const slots = pageWindow(page, pages);
  const first = page <= 1;
  const last = page >= pages;
  return (
    <div className="grid shrink-0 items-center gap-3 border-t border-border bg-background px-4 py-2.5 text-sm md:grid-cols-[1fr_auto_1fr]">
      <div className="hidden items-center md:flex" aria-live="polite">
        {loading && <Spinner label={t('loading')} />}
      </div>

      <nav aria-label={t('pagination')} className="flex flex-wrap items-center justify-center gap-1">
        <button
          type="button"
          className={cn(textBtn, first ? 'cursor-not-allowed text-muted-foreground/60' : 'hover:bg-muted')}
          disabled={first}
          onClick={() => onPage(page - 1)}
          aria-label={t('prevPage')}
        >
          {t('previous')}
        </button>
        {slots.map((slot, i) =>
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
                numBtn,
                slot === page
                  ? 'border-brand font-semibold text-brand ring-1 ring-brand'
                  : 'border-transparent hover:bg-muted',
              )}
            >
              {slot}
            </button>
          ),
        )}
        <button
          type="button"
          className={cn(textBtn, last ? 'cursor-not-allowed text-muted-foreground/60' : 'hover:bg-muted')}
          disabled={last}
          onClick={() => onPage(page + 1)}
          aria-label={t('nextPage')}
        >
          {t('next')}
        </button>
      </nav>

      <div className="flex flex-wrap items-center justify-center gap-2 md:justify-end">
        <button
          type="button"
          onClick={onRecount}
          title={t('recount')}
          className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2.5 text-sm outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="text-muted-foreground">{t('totalCount')}</span>
          <span className="font-semibold tabular-nums">
            {total === undefined ? '-' : total.toLocaleString()}
          </span>
        </button>
        <Select
          aria-label={t('perPage')}
          className="h-8 w-auto py-0"
          value={limit}
          onChange={(e) => onLimit(Number(e.target.value) as PageSize)}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {t('perPageOption', { count: n })}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
