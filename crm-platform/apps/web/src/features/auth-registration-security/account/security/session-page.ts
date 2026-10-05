/**
 * Paging and wording for the "where you are signed in" table (WD-AUTH-031).
 * The API pages by cursor (ten per page, with the total), so "Prev" is a stack
 * of the cursors already visited and the range ("Showing 11-20 of 23") is worked
 * out from the page number.
 */

export const SESSIONS_PER_PAGE = 10;

export interface PageRange {
  /** 1-based position of the first and last row on screen; both 0 for an empty list. */
  from: number;
  to: number;
  /** 1-based page number and how many pages there are. */
  page: number;
  pages: number;
}

/** Where the current page sits in the whole list. `index` is 0 for the first page. */
export function pageRange(index: number, rows: number, total: number, size: number): PageRange {
  const start = index * size;
  return {
    from: rows === 0 ? 0 : start + 1,
    to: start + rows,
    page: index + 1,
    pages: Math.max(1, Math.ceil(total / size)),
  };
}

/**
 * A length of time as one phrase in the reader's language ("7 days", "30 days",
 * "1 hour"), using the largest unit it divides into evenly.
 */
export function durationLabel(seconds: number, locale: string): string {
  const [unit, divisor] =
    seconds % 86_400 === 0
      ? (['day', 86_400] as const)
      : seconds % 3_600 === 0
        ? (['hour', 3_600] as const)
        : (['minute', 60] as const);
  const count = Math.max(1, Math.round(seconds / divisor));
  try {
    return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long' }).format(
      count,
    );
  } catch {
    return `${count} ${unit}${count === 1 ? '' : 's'}`;
  }
}
