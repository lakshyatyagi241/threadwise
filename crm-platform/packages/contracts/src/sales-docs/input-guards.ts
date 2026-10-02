import { z } from 'zod';
import { isKnownCurrency } from '@crm/tax';

/**
 * A real calendar day as `YYYY-MM-DD`. The shape alone is not enough: `2026-02-31` and `2026-13-01` match `\d{4}-\d{2}-\d{2}` and the
 * database refuses them, which used to surface as a 500 on every date field and date filter of proposals, estimates and invoicing.
 */
export function isCalendarDay(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1) return false;
  const probe = new Date(Date.UTC(2000, month - 1, day));
  probe.setUTCFullYear(year);
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** `YYYY-MM-DD` naming a day that exists. */
export const calendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD')
  .refine(isCalendarDay, 'a day that exists (2026-02-31 does not)');

/**
 * An ISO 4217 code the tax engine knows, upper-cased. Three letters are not enough: `ZZZ` and `XXX` used to be accepted and printed
 * as if they were money.
 */
export const isoCurrencySchema = z
  .string()
  .trim()
  .length(3)
  .transform((v) => v.toUpperCase())
  .refine((v) => isKnownCurrency(v), 'currency must be an ISO 4217 code');
