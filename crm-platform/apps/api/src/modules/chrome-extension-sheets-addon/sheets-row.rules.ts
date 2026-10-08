import { canonicalizePhone, ERROR_CODES, extSheetsContactRowSchema } from '@crm/contracts';
import type { ExtSheetsContactRow, ExtSheetsRowResult } from '@crm/contracts';
import { z } from 'zod';

const emailOk = z.string().email();

/** A row failure in the shape the client reads. */
export function failedRow(
  index: number,
  ref: ExtSheetsRowResult['ref'],
  code: string,
  message: string,
  field?: string,
): ExtSheetsRowResult {
  return {
    index,
    ...(ref !== undefined ? { ref } : {}),
    status: 'failed',
    error: { code, message, ...(field ? { field } : {}) },
  };
}

/** The `ref` of a raw row, when it has one the client can use: a string or an integer, never an object. */
export function refOf(raw: unknown): string | number | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const ref = (raw as { ref?: unknown }).ref;
  return typeof ref === 'string' || (typeof ref === 'number' && Number.isInteger(ref))
    ? ref
    : undefined;
}

/** The first problem of a failed parse, with the field it is about, as one row error. */
export function rowIssue(index: number, raw: unknown, error: z.ZodError): ExtSheetsRowResult {
  const issue = error.issues[0]!;
  const field = issue.path.length > 0 ? String(issue.path[0]) : undefined;
  return failedRow(index, refOf(raw), ERROR_CODES.VALIDATION_FAILED, issue.message, field);
}

export interface PlannedContact {
  email?: string;
  phone?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  source: string;
  isUnsubscribed?: boolean;
  customFields: Record<string, unknown>;
}

export type ContactPlan =
  { ok: true; contact: PlannedContact } | { ok: false; message: string; field?: string };

/** Sheets cells that are not text become text; an empty attribute is "not given" and never clears a stored value. */
function cleanAttributes(attrs: ExtSheetsContactRow['attributes']): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || (typeof value === 'string' && value.trim() === '')) continue;
    out[key] = typeof value === 'string' ? value.trim() : value;
  }
  return out;
}

/**
 * What one sheet row means as a contact: the email lower-cased and checked, the phone made E.164 with the row's own country code, else the
 * request's default, else none (a number that does not say its country cannot be read). A row with neither email nor phone cannot be
 * reached or matched, so it is refused here, before anything is written.
 */
export function planContactRow(
  row: ExtSheetsContactRow,
  defaultCountryCode: string | undefined,
): ContactPlan {
  let email: string | undefined;
  if (row.email) {
    const lower = row.email.toLowerCase();
    if (!emailOk.safeParse(lower).success)
      return { ok: false, message: 'This is not an email address.', field: 'email' };
    email = lower;
  }
  let phone: string | undefined;
  if (row.phone) {
    const canonical = canonicalizePhone({
      number: row.phone,
      countryCode: row.country_code,
      defaultCountryCode,
    });
    if (!canonical)
      return { ok: false, message: 'This is not a usable phone number.', field: 'phone' };
    phone = canonical.e164;
  }
  if (!email && !phone) {
    return { ok: false, message: 'Give an email or a phone number.', field: 'email' };
  }
  return {
    ok: true,
    contact: {
      email,
      phone,
      name: row.name,
      firstName: row.first_name,
      lastName: row.last_name,
      source: row.source ?? 'google_sheets',
      isUnsubscribed: row.is_unsubscribed,
      customFields: cleanAttributes(row.attributes),
    },
  };
}

/** Reads every raw row on its own: a bad row is a result, never an exception that sinks the others. */
export function parseContactRows(
  rows: readonly unknown[],
): Array<
  | { index: number; ref: string | number | undefined; row: ExtSheetsContactRow }
  | { index: number; failed: ExtSheetsRowResult }
> {
  return rows.map((raw, index) => {
    const parsed = extSheetsContactRowSchema.safeParse(raw);
    return parsed.success
      ? { index, ref: parsed.data.ref, row: parsed.data }
      : { index, failed: rowIssue(index, raw, parsed.error) };
  });
}

/** `created + updated`, as Reference's `total`, plus the two counts it did not have. */
export function summarize(results: readonly ExtSheetsRowResult[]) {
  const count = (s: ExtSheetsRowResult['status']) => results.filter((r) => r.status === s).length;
  const created = count('created');
  const updated = count('updated');
  return {
    created,
    updated,
    unchanged: count('unchanged'),
    failed: count('failed'),
    total: created + updated,
  };
}
