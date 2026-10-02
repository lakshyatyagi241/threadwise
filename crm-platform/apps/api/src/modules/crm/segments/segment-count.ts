import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { contactConditions, whereOf } from '../contacts/contact-conditions';

/** A count that is not done in this long is abandoned and answered approximately. */
export const SEGMENT_COUNT_TIMEOUT_MS = 3000;

/** The segment's compiled rules as the contacts WHERE they are used with: live (not archived) contacts of the workspace, inside the caller's scope. */
export function segmentContactsWhere(orgId: number, rules: SQL, scope?: SQL): SQL {
  return whereOf(
    contactConditions(orgId, { includeArchived: false, tagMode: 'any', segment: rules }, scope),
  );
}

export interface CountResult {
  count: number;
  /** true: counting timed out; `count` is the last known value or the planner's estimate. */
  approximate: boolean;
}

const isTimeout = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '57014' || e?.cause?.code === '57014';
};

/**
 * How many contacts match, with a statement timeout so a segment over millions of rows can never
 * hold a request: past the limit the answer is `fallback` (the last cached count) or, with none, the
 * planner's row estimate, flagged `approximate`.
 *
 * The count runs in a savepoint: a cancelled statement aborts only that, the caller's transaction
 * (which goes on to read other things) stays usable, and the `statement_timeout` it set is undone
 * with the savepoint. On success it is put back by hand, because releasing a savepoint keeps a
 * SET LOCAL.
 */
export async function countWithTimeout(
  tx: Tx,
  where: SQL,
  opts: { timeoutMs?: number; fallback?: number | null } = {},
): Promise<CountResult> {
  const timeoutMs = opts.timeoutMs ?? SEGMENT_COUNT_TIMEOUT_MS;
  const before = (await tx.execute(sql`SELECT current_setting('statement_timeout') AS v`))
    .rows[0] as {
    v: string;
  };
  try {
    const n = await tx.transaction(async (sp) => {
      await sp.execute(sql`SELECT set_config('statement_timeout', ${String(timeoutMs)}, true)`);
      const res = await sp.execute(sql`SELECT count(*)::int AS n FROM contacts WHERE ${where}`);
      return Number((res.rows[0] as { n: number }).n);
    });
    await tx.execute(sql`SELECT set_config('statement_timeout', ${before.v}, true)`);
    return { count: n, approximate: false };
  } catch (err) {
    if (!isTimeout(err)) throw err;
    if (opts.fallback !== undefined && opts.fallback !== null) {
      return { count: opts.fallback, approximate: true };
    }
    return { count: await estimate(tx, where), approximate: true };
  }
}

/** The planner's row estimate for the same WHERE: free, and good enough to say "about this many". */
async function estimate(tx: Tx, where: SQL): Promise<number> {
  try {
    const res = await tx.execute(sql`EXPLAIN (FORMAT JSON) SELECT 1 FROM contacts WHERE ${where}`);
    const plan = (res.rows[0] as Record<string, Array<{ Plan?: { 'Plan Rows'?: number } }>>)[
      'QUERY PLAN'
    ];
    return Math.max(0, Math.round(Number(plan?.[0]?.Plan?.['Plan Rows'] ?? 0)));
  } catch {
    return 0;
  }
}
