import { z } from 'zod';

/**
 * Date values that arrive as text (a filter, a segment rule, a custom date field): either a calendar
 * day `2026-10-03` (UTC) or a full instant with an offset `2026-10-03T09:30:00Z`. Anything else, and
 * any day that does not exist (`2026-02-31`), is refused at the edge, so what reaches the database
 * is always castable and a hand-written `'; DROP` never becomes a timestamp.
 */
export const DATE_MIN_YEAR = 1900;
export const DATE_MAX_YEAR = 2200;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;

export type ParsedDate = { kind: 'day' | 'instant'; iso: string };

/** `kind: 'day'` carries `YYYY-MM-DD`; `'instant'` carries the UTC ISO string. Null when it is neither. */
export function parseDateValue(raw: unknown): ParsedDate | null {
  if (typeof raw !== 'string') return null;
  const day = DAY.exec(raw);
  if (day) {
    const [y, m, d] = [Number(day[1]), Number(day[2]), Number(day[3])];
    if (y < DATE_MIN_YEAR || y > DATE_MAX_YEAR) return null;
    const t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
    return { kind: 'day', iso: raw };
  }
  if (INSTANT.test(raw)) {
    const t = new Date(raw);
    if (Number.isNaN(t.getTime())) return null;
    const y = t.getUTCFullYear();
    if (y < DATE_MIN_YEAR || y > DATE_MAX_YEAR) return null;
    return { kind: 'instant', iso: t.toISOString() };
  }
  return null;
}

/** A `YYYY-MM-DD` day or an ISO instant with an offset. */
export const dateOrInstantSchema = z
  .string()
  .max(40)
  .refine((v) => parseDateValue(v) !== null, 'expected a date (YYYY-MM-DD) or an ISO date-time');
