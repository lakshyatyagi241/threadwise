import type { FiscalYearConfig } from '../profiles/types';
import { isIsoDate } from '../profiles/utils';

/** Financial-year helpers on ISO dates ("YYYY-MM-DD"). Pure: no time zone, no `Date.now()`. */

export interface FiscalYear {
  /** Calendar year in which the fiscal year starts. */
  startYear: number;
  /** First day (ISO). */
  start: string;
  /** Last day (ISO, inclusive). */
  end: string;
  /** Label per the config, e.g. "2026-27". */
  label: string;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number): string =>
  `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;

function dayBefore(y: number, m: number, d: number): string {
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function fiscalYearLabel(
  startYear: number,
  format: FiscalYearConfig['labelFormat'],
): string {
  const yy = (y: number) => pad2(y % 100);
  switch (format) {
    case 'YYYY-YY':
      return `${startYear}-${yy(startYear + 1)}`;
    case 'YYYY-YYYY':
      return `${startYear}-${startYear + 1}`;
    case 'YY-YY':
      return `${yy(startYear)}-${yy(startYear + 1)}`;
    case 'YY':
      return yy(startYear);
    default:
      return String(startYear);
  }
}

/** The fiscal year that contains `date`. Throws RangeError for a malformed date. */
export function fiscalYearOf(date: string, cfg: FiscalYearConfig): FiscalYear {
  if (!isIsoDate(date)) throw new RangeError(`"${date}" is not an ISO date (YYYY-MM-DD)`);
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const startYear = m > cfg.startMonth || (m === cfg.startMonth && d >= cfg.startDay) ? y : y - 1;
  const start = iso(startYear, cfg.startMonth, cfg.startDay);
  const end = dayBefore(startYear + 1, cfg.startMonth, cfg.startDay);
  return { startYear, start, end, label: fiscalYearLabel(startYear, cfg.labelFormat) };
}

/** The fiscal year containing `date` for a profile's default financial-year rule. */
export const fiscalYearLabelOf = (date: string, cfg: FiscalYearConfig): string =>
  fiscalYearOf(date, cfg).label;
