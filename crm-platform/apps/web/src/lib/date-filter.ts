/** The day pair of a custom date filter, read from the address. Pure. */

/** Any schema that tells a day from a non-day (a Zod schema has this shape). */
export interface DaySchema {
  safeParse(v: unknown): { success: boolean };
}

/**
 * The first and last day of a custom range. Both are empty unless the range is `custom`; a day that is missing or fails `day` is an
 * open side, so a bad value falls back to no bound rather than an error.
 */
export function customDayRange(
  custom: boolean,
  from: string | null,
  to: string | null,
  day: DaySchema,
): { from: string; to: string } {
  const pick = (v: string | null): string =>
    custom && v !== null && day.safeParse(v).success ? v : '';
  return { from: pick(from), to: pick(to) };
}
