import { Oid, plain, scrub, setOwn, toDate, type Doc } from '../util';
import type { ColSpec, Soft } from './types';

export const c = (name: string, pg: ColSpec['pg']): ColSpec => ({ name, pg });
export const TS_COLS: ColSpec[] = [c('created_at', 'timestamptz'), c('updated_at', 'timestamptz')];

const firstPresent = (doc: Doc, keys: string[]): { key: string; value: unknown } | null => {
  for (const key of keys) {
    const value = doc[key];
    if (value !== undefined && value !== null && value !== '') return { key, value };
  }
  return null;
};

/**
 * created/updated timestamps of a source document, preserved. Order of preference: the document's own date, the ObjectId's embedded
 * creation time, then `fallbackAt` (the dump manifest's generatedAt, so reruns agree) with a soft issue so it is visible.
 * Never 1970 by accident.
 */
export function times(
  doc: Doc,
  fallbackAt: string,
  createdKeys = ['created_time', 'created_at'],
  updatedKeys = ['modified_time', 'updated_at'],
): { created: string; updated: string; soft: Soft[] } {
  const soft: Soft[] = [];
  const read = (keys: string[]): Date | null => {
    const hit = firstPresent(doc, keys);
    if (!hit) return null;
    const d = toDate(hit.value);
    if (!d) {
      soft.push({
        code: 'BAD_DATE',
        reason: `${hit.key} is not a readable date`,
        detail: plain(hit.value),
      });
    }
    return d;
  };
  let created = read(createdKeys);
  if (!created) {
    created = doc._id instanceof Oid ? doc._id.date : null;
    if (!created) {
      created = new Date(fallbackAt);
      soft.push({
        code: 'NO_DATE',
        reason: 'no usable date and no ObjectId: stamped with the dump manifest time',
        detail: fallbackAt,
      });
    }
  }
  const updated = read(updatedKeys) ?? created;
  return { created: created.toISOString(), updated: updated.toISOString(), soft };
}

/** Keys of `doc` that no entry of `known` covers, credential-looking ones removed; own-property copy (safe for "__proto__"). */
export function rest(doc: Doc, known: Iterable<string>): Record<string, unknown> {
  const skip = new Set(known);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (skip.has(k) || v === null || v === undefined) continue;
    setOwn(out, k, plain(v));
  }
  return scrub(out).value as Record<string, unknown>;
}
