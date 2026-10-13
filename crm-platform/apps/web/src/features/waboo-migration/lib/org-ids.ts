import { WMIG_DB_RE, WMIG_MAX_BATCH, deriveClientKey } from '@crm/contracts';

export interface ParsedOrgIds {
  ids: string[];
  invalid: string[];
  duplicates: string[];
  /** Two different ids that derive the same client key. */
  collisions: string[];
  tooMany: boolean;
  ok: boolean;
}

/** One organization id per line (a comma also separates); a line with spaces or other characters is invalid. Blank lines are ignored; the order is kept. */
export function parseOrgIds(text: string): ParsedOrgIds {
  const tokens = text
    .split(/[\r\n,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const keys = new Map<string, string>();
  const ids: string[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];
  const collisions: string[] = [];
  for (const t of tokens) {
    if (!WMIG_DB_RE.test(t)) invalid.push(t);
    else if (seen.has(t)) duplicates.push(t);
    else if (keys.has(deriveClientKey(t))) collisions.push(t);
    else {
      seen.add(t);
      keys.set(deriveClientKey(t), t);
      ids.push(t);
    }
  }
  const tooMany = ids.length > WMIG_MAX_BATCH;
  return {
    ids,
    invalid,
    duplicates,
    collisions,
    tooMany,
    ok: ids.length > 0 && !tooMany && invalid.length + duplicates.length + collisions.length === 0,
  };
}
