import type { CompanyActivityEntry, CompanySort } from '@crm/contracts';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';

/**
 * Pure rules of the companies module (the list cursor, the activity folding, the LIKE escape), kept out of the repository so a unit
 * test can pin them without a database.
 */

/** `%`, `_` and the escape character itself would otherwise act as wildcards in the search box. */
export const escapeLike = (v: string): string => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * The list's keyset: one sort key per row plus the id as tiebreaker. The sort is part of the cursor, so a cursor from one order
 * cannot be replayed against another. `created` carries the microsecond ISO string of `created_at` (a JS Date keeps milliseconds
 * only, and rows that share a millisecond would land on the wrong side of the bound); `name` carries the lower-cased name.
 */
export function encodeCompanyCursor(sort: CompanySort, key: string, id: number): string {
  return Buffer.from(JSON.stringify([sort, key, id]), 'utf8').toString('base64url');
}

export function decodeCompanyCursor(raw: string, sort: CompanySort): { key: string; id: number } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 3) throw new Error('malformed');
    const [s, key, id] = parsed as [unknown, unknown, unknown];
    if (
      s !== sort ||
      typeof key !== 'string' ||
      typeof id !== 'number' ||
      !Number.isSafeInteger(id)
    )
      throw new Error('malformed');
    if (sort === 'created' && Number.isNaN(new Date(key).getTime())) throw new Error('malformed');
    return { key, id };
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid pagination cursor', 400);
  }
}

/** A company's contacts are listed newest first by id (WaDesk's order), so the cursor is just the last id. */
export const encodeIdCursor = (id: number): string =>
  Buffer.from(String(id), 'utf8').toString('base64url');

export function decodeIdCursor(raw: string): number {
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  if (!/^\d{1,18}$/.test(text)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid pagination cursor', 400);
  }
  return Number(text);
}

/**
 * The fields a company's audit row can carry, in the order a person reads them. A key outside this list (a future column) is
 * still shown after these, so nothing a write recorded is hidden.
 */
export const ACTIVITY_FIELD_ORDER = [
  'name',
  'website',
  'email',
  'phone',
  'industry',
  'sizeRange',
  'address',
  'notes',
  'owner',
  'contactLinked',
  'contactUnlinked',
  'contactsUnlinked',
  'dealsUnlinked',
] as const;

/** Raw audit rows to the entries a screen shows: the changed fields of each row in a stable order. */
export function foldActivity(
  rows: Array<{
    action: string;
    actor: { id: string; name: string } | null;
    at: Date;
    delta: Record<string, { old: unknown; new: unknown }> | null;
  }>,
  resolve: (field: string, value: unknown) => unknown,
): CompanyActivityEntry[] {
  const rank = (field: string): number => {
    const i = (ACTIVITY_FIELD_ORDER as readonly string[]).indexOf(field);
    return i === -1 ? ACTIVITY_FIELD_ORDER.length : i;
  };
  return rows.map((r) => ({
    action: r.action === 'insert' || r.action === 'delete' ? r.action : 'update',
    actor: r.actor,
    at: r.at.toISOString(),
    changes: Object.entries(r.delta ?? {})
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([field, change]) => ({
        field,
        old: resolve(field, change.old),
        new: resolve(field, change.new),
      })),
  }));
}

/**
 * A website as people type it ("https://www.Acme.com/about", "acme.com") to the bare lower-case host the company match compares, or null
 * when it is not a host. `www.` is dropped: the two spellings are one site.
 */
export function normaliseCompanyDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim().toLowerCase();
  if (text === '' || text.length > 191) return null;
  const host = (text.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0] ?? '')
    .replace(/^.*@/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');
  return /^(?=.{1,191}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
    ? host
    : null;
}

/**
 * Every way a host is commonly stored in `companies.domain`, lower-cased: the company match compares `lower(domain)` with this list, which
 * keeps it on the (org_id, lower(domain)) index instead of normalising every row.
 */
export function companyDomainSpellings(host: string): string[] {
  const bare = [host, `www.${host}`];
  const withScheme = bare.flatMap((h) => [`http://${h}`, `https://${h}`]);
  return [...bare, ...withScheme].flatMap((h) => [h, `${h}/`]);
}
