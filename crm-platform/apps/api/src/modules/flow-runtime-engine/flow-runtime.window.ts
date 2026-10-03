/** Pure helpers of the flow runtime read side: the date window of the tables (TW-FLR-053, 054) and the search pattern. */

export interface DayWindow {
  days?: number | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}

/**
 * The window as ISO instants (UTC), either end open. Explicit `dateFrom` / `dateTo` days win over `days` (Reference: explicit dates beat
 * the period chip); `days` counts today as the first day, so 7 is today and the six days before. Zero or no `days` is all time.
 * Timestamps are UTC here where Reference uses the workspace calendar.
 */
export function windowOf(
  w: DayWindow,
  now = new Date(),
): { from: string | null; to: string | null } {
  if (w.dateFrom || w.dateTo) {
    return {
      from: w.dateFrom ? `${w.dateFrom}T00:00:00.000Z` : null,
      to: w.dateTo ? `${w.dateTo}T23:59:59.999Z` : null,
    };
  }
  if (!w.days) return { from: null, to: null };
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { from: new Date(startOfToday - (w.days - 1) * 86_400_000).toISOString(), to: null };
}

/** A user's search words as an ILIKE pattern that matches them literally (`%` and `_` are escaped). */
export const likePattern = (term: string): string => `%${term.replace(/[\\%_]/g, '\\$&')}%`;
