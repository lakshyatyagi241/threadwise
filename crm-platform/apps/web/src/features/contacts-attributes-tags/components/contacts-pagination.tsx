'use client';

import { useTranslations } from 'next-intl';
import { Select, Spinner, cn } from '@crm/ui';
import { PAGE_SIZES, type PageSize } from '../api/contacts';
import { rangeLabel, reachableSlots, totalPages } from '../lib/pagination';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';

const numBtn =
  'inline-flex size-8 items-center justify-center rounded-md border text-sm tabular-nums outline-none transition ' +
  'focus-visible:ring-2 focus-visible:ring-primary';
const stepBtn =
  'inline-flex size-8 items-center justify-center rounded-md outline-none transition focus-visible:ring-2 focus-visible:ring-primary';

/**
 * The footer of the table card, pinned under the scrolling rows: "Showing 1-50 of 30,442" at the start, then the page buttons
 * (previous, 1 2 3 4 5 ..., next), where the page stands ("Page 3 of 609") and the rows-per-page choice at the end. The API is
 * cursor-only, so a page is reached by loading the ones before it: the numbered buttons stop ten pages ahead of the current one
 * (`reachableSlots`), further pages are reached by stepping on, and the spinner shows while a page loads.
 */
export function ContactsPagination({
  page,
  total,
  limit,
  rowsOnPage,
  loading,
  onPage,
  onLimit,
  approximate = false,
}: {
  page: number;
  /** Undefined until the first response (the count is not known yet). */
  total: number | undefined;
  limit: PageSize;
  /** Rows on the page now (the last page is short). */
  rowsOnPage: number;
  /** A page is being fetched. */
  loading: boolean;
  onPage: (page: number) => void;
  onLimit: (limit: PageSize) => void;
  /** The total is an estimate: shown as "about N". */
  approximate?: boolean;
}) {
  const t = useTranslations('contacts-attributes-tags.list');
  const pages = totalPages(total ?? 0, limit);
  const slots = reachableSlots(page, pages);
  const first = page <= 1;
  const last = page >= pages;
  const range = rangeLabel(page, limit, rowsOnPage, total ?? rowsOnPage);
  const count =
    total === undefined ? '-' : approximate ? t('approxTotal', { total }) : total.toLocaleString();
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border bg-background px-4 py-2 text-sm">
      <p className="flex items-center gap-2 text-muted-foreground" aria-live="polite">
        {t('showing', {
          from: range.from.toLocaleString(),
          to: range.to.toLocaleString(),
          total: count,
        })}
        {loading && <Spinner label={t('loading')} />}
      </p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <nav aria-label={t('pagination')} className="flex items-center gap-1">
          <button
            type="button"
            className={cn(
              stepBtn,
              first ? 'cursor-not-allowed text-muted-foreground/50' : 'hover:bg-muted',
            )}
            disabled={first}
            onClick={() => onPage(page - 1)}
            aria-label={t('prevPage')}
          >
            <ChevronLeftIcon className="rtl:rotate-180" />
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
                    ? 'border-brand bg-brand font-semibold text-brand-foreground'
                    : 'border-transparent hover:bg-muted',
                )}
              >
                {slot}
              </button>
            ),
          )}
          <button
            type="button"
            className={cn(
              stepBtn,
              last ? 'cursor-not-allowed text-muted-foreground/50' : 'hover:bg-muted',
            )}
            disabled={last}
            onClick={() => onPage(page + 1)}
            aria-label={t('nextPage')}
          >
            <ChevronRightIcon className="rtl:rotate-180" />
          </button>
        </nav>
        <span className="hidden text-xs text-muted-foreground tabular-nums md:inline">
          {t('pageOf', { page: page.toLocaleString(), pages: pages.toLocaleString() })}
        </span>
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
