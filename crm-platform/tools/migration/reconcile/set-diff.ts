import { sql, type SQL } from 'drizzle-orm';

/** Anything with drizzle's `execute`: the database, or a tenant transaction. */
interface Runner {
  execute(query: SQL): PromiseLike<{ rows: unknown[] }>;
}

/**
 * How many tuples `got` (a query whose columns are named `cols`) lacks from `want`, and how many it has beyond it, both as sets.
 * Postgres does the comparison and only two numbers come back: fetching ~50,000 four-column rows to compare them here made one
 * statement last ~2 s on production (the join itself takes ~170 ms), enough to trip the slow-query alert.
 * `want` holds each tuple as its values joined by NUL (the form the oracles produce); `cols` are the caller's own constants, never data.
 */
export async function tupleDiff(
  db: Runner,
  want: Iterable<string>,
  got: SQL,
  cols: readonly string[],
): Promise<{ missing: number; unexpected: number }> {
  const rows = [...want].map((w) =>
    Object.fromEntries(w.split('\u0000').slice(0, cols.length).map((v, i) => [cols[i], v])),
  );
  const names = sql.raw(cols.join(', '));
  const typed = sql.raw(cols.map((c) => `${c} text`).join(', '));
  const r = await db.execute(sql`
    WITH want AS (SELECT ${names} FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS w(${typed})),
         got AS (${got})
    SELECT (SELECT count(*) FROM (SELECT ${names} FROM want EXCEPT SELECT ${names} FROM got) a)::int AS missing,
           (SELECT count(*) FROM (SELECT ${names} FROM got EXCEPT SELECT ${names} FROM want) b)::int AS unexpected`);
  return r.rows[0] as { missing: number; unexpected: number };
}
