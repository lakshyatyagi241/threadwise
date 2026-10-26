import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, type DbClient, type DbClientPair } from '@crm/db';
import { DatabaseService } from '../../src/infra/db/database.service';

/** Resolves for everyone once `n` callers have arrived. */
function barrier(n: number): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const all = new Promise<void>((r) => (release = r));
  return () => {
    if (++arrived >= n) release();
    return all;
  };
}

const noWait = { sleep: () => Promise.resolve(), random: () => 0 };

/** The `retry` option of DatabaseService on a real Postgres: what the hot write paths rely on. */
describe('DatabaseService.txAs with retry, on real Postgres', () => {
  let container: StartedPostgreSqlContainer;
  let client: DbClient;
  let svc: DatabaseService;
  const tenant = { orgId: 1 };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    client = createDbClient({ url: container.getConnectionUri(), poolMax: 6 });
    svc = new DatabaseService({ primary: client, replica: client } as unknown as DbClientPair);
    await client.db.execute(sql`CREATE TABLE probe (id int PRIMARY KEY, n int NOT NULL)`);
    await client.db.execute(
      sql`CREATE TABLE ledger (provider_id text PRIMARY KEY, amount int NOT NULL)`,
    );
  }, 120_000);

  afterAll(async () => {
    await client?.close();
    await container?.stop();
  });

  const rows = async (q: ReturnType<typeof sql>) => (await client.db.execute(q)).rows;

  it('two writers that deadlock both end up applied exactly once', async () => {
    await client.db.execute(sql`DELETE FROM probe`);
    await client.db.execute(sql`INSERT INTO probe VALUES (1, 0), (2, 0)`);
    const gate = barrier(2); // only a first attempt waits; a retry has no partner to wait for
    const side = (first: number, second: number) => {
      let attempt = 0;
      return svc.txAs(
        tenant,
        async (tx) => {
          await tx.execute(sql`UPDATE probe SET n = n + 1 WHERE id = ${first}`);
          if (++attempt === 1) await gate();
          await tx.execute(sql`UPDATE probe SET n = n + 1 WHERE id = ${second}`);
        },
        { retry: noWait },
      );
    };
    await Promise.all([side(1, 2), side(2, 1)]);
    expect(await rows(sql`SELECT n FROM probe ORDER BY id`)).toEqual([{ n: 2 }, { n: 2 }]);
  });

  it('a dropped connection is retried when the work is idempotent, and the ledger holds one row', async () => {
    await client.db.execute(sql`DELETE FROM ledger`);
    const write = (tx: Parameters<Parameters<typeof svc.txAs>[1]>[0]) =>
      tx.execute(
        sql`INSERT INTO ledger VALUES ('wamid.2', 5) ON CONFLICT (provider_id) DO NOTHING`,
      );
    let attempt = 0;
    await svc.txAs(
      tenant,
      async (tx) => {
        await write(tx);
        if (++attempt === 1) {
          throw Object.assign(new Error('Connection terminated unexpectedly'), {
            code: 'ECONNRESET',
          });
        }
      },
      { retry: { ...noWait, idempotent: true } },
    );
    expect(attempt).toBe(2);
    expect(await rows(sql`SELECT provider_id, amount FROM ledger`)).toEqual([
      { provider_id: 'wamid.2', amount: 5 },
    ]);

    // The case the flag exists for: the first run DID commit and the caller only saw the connection drop. Running the same
    // work again (what the retry does) must not add a second row.
    await svc.txAs(tenant, write);
    await svc.txAs(tenant, write);
    expect(await rows(sql`SELECT count(*)::int AS n FROM ledger`)).toEqual([{ n: 1 }]);
  });

  it('a rolled-back run leaves nothing behind, so the retry never sees a partial write', async () => {
    await client.db.execute(sql`DELETE FROM ledger`);
    let attempt = 0;
    await svc.txAs(
      tenant,
      async (tx) => {
        await tx.execute(sql`INSERT INTO ledger VALUES ('a', 1)`);
        if (++attempt === 1) {
          await tx.execute(sql`INSERT INTO ledger VALUES ('b', 2)`);
          throw Object.assign(new Error('deadlock'), { code: '40P01' });
        }
        await tx.execute(sql`INSERT INTO ledger VALUES ('c', 3)`);
      },
      { retry: noWait },
    );
    expect(await rows(sql`SELECT provider_id FROM ledger ORDER BY provider_id`)).toEqual([
      { provider_id: 'a' },
      { provider_id: 'c' },
    ]);
  });
});
