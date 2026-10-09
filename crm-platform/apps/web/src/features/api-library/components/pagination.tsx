'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Select, Spinner, cn } from '@crm/ui';
import { PAGE_SIZES, formatTotal, pageWindow, rangeOf, type PageSize } from '../lib/pagination';

const BTN =
  'inline-flex h-8 items-center justify-center rounded-md border text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-primary';

/**
 * Footer of a table card: "Showing 11-20 of 53", previous / numbered pages with ellipsis / next, and the rows-per-page choice.
 * Under the `sm` breakpoint the numbers collapse to previous / next with "Page 2 of 6". The buttons are real buttons (Tab, Enter,
 * Space); the current page carries `aria-current="page"`.
 */
export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  rows,
  fetching,
  onPage,
  onPageSize,
  note,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: PageSize;
  /** Rows on this page (the last page has fewer). */
  rows: number;
  /** A page is on its way: the footer says so while the old rows stay. */
  fetching?: boolean;
  onPage: (page: number) => void;
  onPageSize: (size: PageSize) => void;
  /** A line under the range (log retention). */
  note?: string;
}) {
  const t = useTranslations('api-library.pagination');
  const locale = useLocale();
  const pages = Math.max(1, totalPages);
  const first = page <= 1;
  const last = page >= pages;
  const { from, to } = rangeOf(page, pageSize, rows, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-border bg-muted/30 px-4 py-2.5 text-sm">
      <div className="min-w-0 text-muted-foreground" aria-live="polite">
        <p className="flex items-center gap-2">
          {total === 0 ? t('none') : t('range', { from, to, total: formatTotal(total, locale) })}
          {fetching && <Spinner label={t('loading')} />}
        </p>
        {note && <p className="text-xs">{note}</p>}
      </div>

      <nav aria-label={t('label')} className="flex items-center gap-1">
        <button
          type="button"
          disabled={first}
          onClick={() => onPage(page - 1)}
          aria-label={t('previousPage')}
          className={cn(
            BTN,
            'gap-1 border-border px-2.5',
            first ? 'cursor-not-allowed text-muted-foreground/60' : 'hover:bg-muted',
          )}
        >
          <span aria-hidden="true" className="rtl:rotate-180">
            ‹
          </span>
          {t('previous')}
        </button>

        <span className="px-2 tabular-nums text-muted-foreground sm:hidden">
          {t('pageOf', { page, pages })}
        </span>
        <ol className="hidden items-center gap-1 sm:flex">
          {pageWindow(page, pages).map((slot, i) => (
            <li key={slot === 'gap' ? `gap-${i}` : slot}>
              {slot === 'gap' ? (
                <span aria-hidden="true" className="px-1 text-muted-foreground">
                  &hellip;
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onPage(slot)}
                  aria-current={slot === page ? 'page' : undefined}
                  aria-label={t('goToPage', { page: slot })}
                  className={cn(
                    BTN,
                    'min-w-8 px-2 tabular-nums',
                    slot === page
                      ? 'border-brand font-semibold text-brand ring-1 ring-brand dark:text-primary'
                      : 'border-transparent hover:bg-muted',
                  )}
                >
                  {slot}
                </button>
              )}
            </li>
          ))}
        </ol>

        <button
          type="button"
          disabled={last}
          onClick={() => onPage(page + 1)}
          aria-label={t('nextPage')}
          className={cn(
            BTN,
            'gap-1 border-border px-2.5',
            last ? 'cursor-not-allowed text-muted-foreground/60' : 'hover:bg-muted',
          )}
        >
          {t('next')}
          <span aria-hidden="true" className="rtl:rotate-180">
            ›
          </span>
        </button>
      </nav>

      <label className="flex items-center gap-2 text-muted-foreground">
        <span className="hidden sm:inline">{t('perPage')}</span>
        <Select
          aria-label={t('perPage')}
          className="h-8 w-auto py-0"
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value) as PageSize)}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {t('perPageOption', { count: n })}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
}
