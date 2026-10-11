import type { Client } from 'pg';

/** Shared by the worker authorization spec: waiting, fake BullMQ jobs, and whole-tenant row fingerprints. */

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function until<T>(
  label: string,
  probe: () => Promise<T | undefined | null | false> | T | undefined | null | false,
  ms = 20_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined && v !== null && v !== false) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
    await sleep(50);
  }
}

/** The part of a BullMQ job a processor reads, for calling `process()` directly with any payload (valid, forged or malformed). */
export function fakeJob<T>(
  name: string,
  data: T,
  o: { attemptsMade?: number; attempts?: number; id?: string } = {},
): never {
  return {
    id: o.id ?? `fake-${Math.random().toString(36).slice(2)}`,
    name,
    data,
    attemptsMade: o.attemptsMade ?? 0,
    opts: { attempts: o.attempts ?? 5 },
    moveToDelayed: async () => {
      throw new Error('unexpected: the processor asked to delay this job');
    },
    updateData: async () => undefined,
  } as never;
}

/** What `process()` did, without letting a rejection escape: the authorization verdict is read from the side effects. */
export async function outcome<T>(
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const VOLATILE =
  /(^|_)(sessions?|refresh|login_attempts?|rate_limits?|security_events?|throttle)(_|$)/;
let tableCache: string[] | null = null;

async function tenantTables(owner: Client): Promise<string[]> {
  if (tableCache) return tableCache;
  const res = await owner.query(
    `SELECT DISTINCT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'org_id'
        AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE')`,
  );
  tableCache = (res.rows as Array<{ table_name: string }>)
    .map((r) => r.table_name)
    .filter((t) => !VOLATILE.test(t))
    .sort();
  return tableCache;
}

export type Fingerprint = Map<string, string>;

/** One digest per tenant table (row count and the md5 of every row as text), for the given organizations. */
export async function fingerprint(
  owner: Client,
  orgIds: number[],
  only?: string[],
): Promise<Fingerprint> {
  const out: Fingerprint = new Map();
  for (const table of only ?? (await tenantTables(owner))) {
    try {
      const r = await owner.query(
        `SELECT count(*)::text AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h FROM "${table}" t WHERE org_id = ANY($1)`,
        [orgIds],
      );
      out.set(table, `${r.rows[0].n}:${r.rows[0].h}`);
    } catch {
      /* a table that cannot be read as a row is not part of the fingerprint */
    }
  }
  return out;
}

export function changed(before: Fingerprint, after: Fingerprint): string[] {
  return [...after].filter(([table, value]) => before.get(table) !== value).map(([table]) => table);
}
