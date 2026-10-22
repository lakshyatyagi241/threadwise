import { normalizeImportHeader } from '@crm/contracts';

/**
 * Cell and header rules shared by the contacts and companies CSV imports, so a custom property reads the same way in both.
 */

/** Header text as a key: lower-case letters and digits only, so "Phone Number" and "phone_number" both read `phonenumber`. */
export const normaliseHeader = normalizeImportHeader;

const TRUE = /^(true|yes|y|1|x|on)$/i;
const FALSE = /^(false|no|n|0|off)$/i;
/** A comma is a thousands separator only when it groups digits in threes (1,250.5). */
const THOUSANDS = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/;

/**
 * A number cell. "120,000" and "1,250.5" are numbers; any other comma ("12,5") is not a thousands separator, so the cell stays text
 * and the write rules refuse it instead of storing 125.
 */
export function readNumberCell(text: string): number | string {
  const n = Number(THOUSANDS.test(text) ? text.replace(/,/g, '') : text);
  return Number.isFinite(n) ? n : text;
}

/** A yes/no cell: true for yes, true, 1, x, on; false for no, false, 0, off. Anything else stays text. */
export function readBooleanCell(text: string): boolean | string {
  return TRUE.test(text) ? true : FALSE.test(text) ? false : text;
}
