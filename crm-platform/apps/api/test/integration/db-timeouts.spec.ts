import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, runTransaction, type DbClient } from '@crm/db';

/** The code Postgres reports, wherever drizzle put it. */
const codeOf = (e: unknown): string | undefined => {
  for (let x = e as { code?: string; cause?: unknown } | undefined, i = 0; x && i < 5; i++) {
    if (typeof x.code === 'string') return x.code;
    x = x.cause as typeof x;
  }
  return undefined;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sheet 3 D-13: a lock wait and a forgotten transaction both end on their own, instead of holding a pooled connection. */
describe('lock_timeout and idle_in_transaction_session_timeout on the pool connections', () => {
  let container: StartedPostgreSqlContainer;
  let admin: DbClient; // no timeouts: sets up and observes
  let guarded: DbClient; // 300 ms lock wait, 600 ms idle inside a transaction
  let plain: DbClient; // the options unset: both off

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    const url = container.getConnectionUri();
    admin = createDbClient({ url, poolMax: 4, applicationName: 'timeouts-admin' });
    guarded = createDbClient({
      url,
      poolMax: 4,
      lockTimeoutMs: 300,
      idleInTransactionTimeoutMs: 600,
      applicationName: 'timeouts-guarded',
    });
    plain = createDbClient({ url, poolMax: 2, applicationName: 'timeouts-plain' });
    await admin.db.execute(sql`CREATE TABLE t (id int PRIMARY KEY, n int NOT NULL)`);
    await admin.db.execute(sql`INSERT INTO t VALUES (1, 0)`);
  }, 120_000);

  afterAll(async () => {
    await Promise.allSettled([guarded?.close(), plain?.close(), admin?.close()]);
    await container?.stop();
  });

  const show = async (c: DbClient, name: string) =>
    ((await c.db.execute(sql.raw(`SHOW ${name}`))).rows[0] as Record<string, string>)[name];

  it('the pool connections carry the limits, and a client without them has none', async () => {
    expect(await show(guarded, 'lock_timeout')).toBe('300ms');
    expect(await show(guarded, 'idle_in_transaction_session_timeout')).toBe('600ms');
    expect(await show(guarded, 'statement_timeout')).toBe('15s'); // unchanged default
    expect(await show(plain, 'lock_timeout')).toBe('0');
    expect(await show(plain, 'idle_in_transaction_session_timeout')).toBe('0');
  });

  it('a statement waiting for a row lock fails with 55P03 after the lock timeout, not after the statement timeout', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const holder = runTransaction(admin.db, async (tx) => {
      await tx.execute(sql`UPDATE t SET n = n + 1 WHERE id = 1`);
      await held; // keeps the row locked
    });
    await sleep(150); // the holder has the lock
    const t0 = Date.now();
    const err = await runTransaction(guarded.db, (tx) =>
      tx.execute(sql`UPDATE t SET n = n + 1 WHERE id = 1`),
    ).then(
      () => undefined,
      (e: unknown) => e,
    );
    const waited = Date.now() - t0;
    release();
    await holder;
    expect(codeOf(err)).toBe('55P03');
    expect(waited).toBeGreaterThanOrEqual(250);
    expect(waited).toBeLessThan(3_000); // far under the 15 s statement timeout
  });

  it('without a lock timeout the same wait just waits (the old behaviour)', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const holder = runTransaction(admin.db, async (tx) => {
      await tx.execute(sql`UPDATE t SET n = n + 1 WHERE id = 1`);
      await held;
    });
    await sleep(150);
    const waiter = runTransaction(plain.db, (tx) =>
      tx.execute(sql`UPDATE t SET n = n + 1 WHERE id = 1`),
    );
    await sleep(900); // longer than the guarded client's limit: still waiting, not failed
    release();
    await holder;
    await expect(waiter).resolves.toBeDefined();
  });

  it('a session left idle inside a transaction is ended by the server, and no such session is left', async () => {
    const err = await runTransaction(guarded.db, async (tx) => {
      await tx.execute(sql`SELECT 1`);
      await sleep(1_500); // idle inside the open transaction, past the 600 ms limit
      await tx.execute(sql`SELECT 2`);
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeDefined();
    // the client sees a dead connection (drizzle reports the failed rollback), so the proof is on the server side below
    expect(String((err as Error)?.message)).toMatch(/rollback|25P03|terminat|Connection/i);
    const left = (
      await admin.db.execute(sql`
        SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE application_name = 'timeouts-guarded' AND state = 'idle in transaction'`)
    ).rows[0] as { n: number };
    expect(left.n).toBe(0);
  });

  it('the pool keeps working after a connection was ended that way', async () => {
    await expect(guarded.db.execute(sql`SELECT 42 AS answer`)).resolves.toBeDefined();
  });
});
