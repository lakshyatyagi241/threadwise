import { sql, type SQL } from 'drizzle-orm';

/**
 * A `bigint[]` literal of workspace ids for `org_id = ANY(...)` in a background sweep that reads rows of many workspaces. The ids come
 * from the platform's own allow-list (numbers read from the database); each is coerced to an integer so nothing but digits can reach SQL.
 */
export function orgIdList(ids: Iterable<number>): SQL {
  const list = [...ids].map((n) => Math.trunc(Number(n))).filter((n) => Number.isFinite(n));
  return sql.raw(`ARRAY[${list.join(',')}]::bigint[]`);
}
