import { sql, type SQL } from 'drizzle-orm';

/**
 * A Postgres array for a list of bind parameters: drizzle expands a bare JS array into `($1, $2)`, which is a row, not an array,
 * so `= ANY(...)` and `unnest(...)` need this. An empty list is `ARRAY[]::<type>[]`.
 */
export const pgArray = (items: ReadonlyArray<string | number>, type: 'text' | 'numeric'): SQL =>
  items.length === 0
    ? sql.raw(`ARRAY[]::${type}[]`)
    : sql`ARRAY[${sql.join(
        items.map((i) => sql`${i}`),
        sql`, `,
      )}]::${sql.raw(type)}[]`;
