'use client';

import { useTranslations } from 'next-intl';
import { Select, Spinner, cn } from '@crm/ui';
import { PAGE_SIZES, type PageSize } from '../api/contacts';
import { pageWindow, totalPages } from '../lib/pagination';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';

const btn =
  'inline-flex size-9 items-center justify-center rounded-md border text-sm tabular-nums outline-none transition ' +
  'focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40';

/**
 * Footer of the table card: "Total Users: N" on the start side, previous / numbered pages / next, and the page size.
 * The numbers sit on top of a cursor API, so jumping several pages ahead is slower than stepping by one; the screen
 * shows the spinner while it walks.
 */
export function ContactsPagination({
  page,
  total,
  limit,
  loading,
  onPage,
  onLimit,
}: {
  page: number;
  /** Undefined until the first response (the count is not known yet). */
  total: number | undefined;
  limit: PageSize;
  /** A page is being fetched. */
  loading: boolean;
  onPage: (page: number) => void;
  onLimit: (limit: PageSize) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.list');
  const pages = totalPages(total ?? 0, limit);
  const slots = pageWindow(page, pages);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
      <div className="flex items-center gap-2 font-medium" aria-live="polite">
        {t('totalUsers', { total: total === undefined ? '-' : total.toLocaleString() })}
        {loading && <Spinner label={t('loading')} />}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Select
          aria-label={t('perPage')}
          className="h-9 w-auto"
          value={limit}
          onChange={(e) => onLimit(Number(e.target.value) as PageSize)}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {t('perPageOption', { count: n })}
            </option>
          ))}
        </Select>
        <nav aria-label={t('pagination')} className="flex items-center gap-1">
          <button
            type="button"
            className={cn(btn, 'border-border hover:bg-muted')}
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            aria-label={t('prevPage')}
          >
            <ChevronLeftIcon className="size-4 rtl:rotate-180" />
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
                  btn,
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
            className={cn(btn, 'border-border hover:bg-muted')}
            disabled={page >= pages}
            onClick={() => onPage(page + 1)}
            aria-label={t('nextPage')}
          >
            <ChevronRightIcon className="size-4 rtl:rotate-180" />
          </button>
        </nav>
      </div>
    </div>
  );
}
