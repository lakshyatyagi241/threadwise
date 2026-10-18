import { sql, type SQL } from 'drizzle-orm';

/**
 * A table alias or column name that a helper puts into SQL text (`${alias}.org_id`). Drizzle cannot bind an identifier, so the
 * helper has to write it in, and the one thing that may be written in is a plain name. Anything else (a dot, a quote, a space, a
 * semicolon, a comment marker) is refused, never escaped or coerced: a caller that passes request text here has a bug, and a
 * thrown error finds it where a quiet injection would not (QA task 30).
 */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/** The name itself, validated. */
export function identifier(name: string): string {
  if (typeof name !== 'string' || !IDENTIFIER.test(name)) {
    throw new Error(`Not a safe SQL identifier: ${JSON.stringify(name)}`);
  }
  return name;
}

/** The name as SQL, for `sql`${rawIdentifier(alias)}.col``. */
export const rawIdentifier = (name: string): SQL => sql.raw(identifier(name));

/**
 * The column a patch key updates, from a fixed map of allowed columns. The key must be one the map itself holds: a key that is not
 * there (a field nobody may update, or `constructor` / `__proto__`, which a plain lookup would find on the prototype) is refused, and the
 * column name the map gives is validated like any identifier.
 */
export function rawMappedColumn(map: Readonly<Record<string, string>>, key: string): SQL {
  if (!Object.prototype.hasOwnProperty.call(map, key)) {
    throw new Error(`Not an updatable column: ${JSON.stringify(key)}`);
  }
  return rawIdentifier(map[key]!);
}
