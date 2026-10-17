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
