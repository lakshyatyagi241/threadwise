import { z } from 'zod';

/** A valid IANA zone name, checked by the platform's own tz database. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
export const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, 'timezone must be an IANA zone such as "Asia/Kolkata"');
