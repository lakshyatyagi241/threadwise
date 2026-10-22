import { TEMPLATE_RANGES, tplFilterDaySchema, type TplRange } from '@crm/contracts';
import { customDayRange } from '@/lib/date-filter';

/** The library's date filter, as the address names it. Pure. */

export interface DateFilter {
  range: TplRange;
  /** The custom range's first and last day (`YYYY-MM-DD`); empty when that side is open. Kept only for `range=custom`. */
  from: string;
  to: string;
}

/** The address is the single source of truth for the filter: an unknown range falls back to all time. */
export function dateFilterOf(
  range: string | null,
  from: string | null,
  to: string | null,
): DateFilter {
  const r = TEMPLATE_RANGES.find((x) => x === range) ?? 'all';
  return { range: r, ...customDayRange(r === 'custom', from, to, tplFilterDaySchema) };
}
