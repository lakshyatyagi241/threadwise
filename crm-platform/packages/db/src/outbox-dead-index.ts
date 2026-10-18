import type { Client } from 'pg';

/**
 * Builds `idx_outbox_dead` on the partitioned `event_outbox` without blocking writes.
 *
 * A plain `CREATE INDEX` on the partitioned parent holds a SHARE lock on every partition while it scans, which stalls every request
 * that emits an event, and Postgres refuses `CREATE INDEX CONCURRENTLY` on a partitioned parent. The way around it, and the reason this
 * is code and not a migration (the runner sends a migration as one query, and CONCURRENTLY cannot share one):
 *
 *   1. create the parent index `ON ONLY` (instant, no scan; it stays invalid until every partition has its piece),
 *   2. build one index per partition with `CREATE INDEX CONCURRENTLY` (each is its own statement, so each is allowed),
 *   3. attach each to the parent, which turns the parent valid.
 *
 * Run it as the table owner (the migration role) before the migration that creates the index on a large table; the migration is then a
 * no-op (`IF NOT EXISTS`). Safe to run again: finished partitions are skipped, an index left invalid by an interrupted build is rebuilt.
 * New partitions get their piece from the parent index when they are created.
 */
const PARENT = 'idx_outbox_dead';

export async function buildOutboxDeadIndex(
  client: Client,
  log: (message: string) => void = () => undefined,
): Promise<{ built: string[] }> {
  const parent = await client.query<{ valid: boolean; children: number }>(
    `SELECT i.indisvalid AS valid, (SELECT count(*)::int FROM pg_inherits WHERE inhparent = i.indexrelid) AS children
       FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = $1 AND c.relnamespace = 'public'::regnamespace`,
    [PARENT],
  );
  if (parent.rows[0]?.valid) return { built: [] };

  await client.query(
    `CREATE INDEX IF NOT EXISTS ${PARENT} ON ONLY event_outbox (created_at) WHERE status = 'dead'`,
  );

  const partitions = await client.query<{ name: string }>(
    `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = 'event_outbox'::regclass ORDER BY c.relname`,
  );

  const built: string[] = [];
  for (const { name } of partitions.rows) {
    const table = client.escapeIdentifier(name);
    const childName = `${name}_dead_idx`;
    const child = client.escapeIdentifier(childName);

    const existing = await client.query<{ valid: boolean; attached: boolean }>(
      `SELECT i.indisvalid AS valid,
              EXISTS (SELECT 1 FROM pg_inherits h WHERE h.inhrelid = i.indexrelid) AS attached
         FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname = $1 AND c.relnamespace = 'public'::regnamespace`,
      [childName],
    );
    const row = existing.rows[0];
    if (row && !row.valid) {
      log(`dropping the invalid ${childName} left by an interrupted build`);
      await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${child}`);
    }
    if (!row || !row.valid) {
      log(`building ${childName}`);
      await client.query(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${child} ON ${table} (created_at) WHERE status = 'dead'`,
      );
      built.push(childName);
    }
    if (!row?.attached || !row.valid) {
      await client.query(`ALTER INDEX ${PARENT} ATTACH PARTITION ${child}`);
    }
  }
  return { built };
}
