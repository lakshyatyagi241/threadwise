import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, retryTransaction, runTransaction, type DbClient } from '@crm/db';

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

/** A real Postgres deadlock: two transactions take the same two rows in opposite order. */
describe('retryTransaction on a real deadlock', () => {
  let container: StartedPostgreSqlContainer;
  let client: DbClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    client = createDbClient({ url: container.getConnectionUri(), poolMax: 4 });
    await client.db.execute(sql`CREATE TABLE retry_probe (id int PRIMARY KEY, n int NOT NULL)`);
    await client.db.execute(sql`INSERT INTO retry_probe VALUES (1, 0), (2, 0)`);
  }, 120_000);

  afterAll(async () => {
    await client?.close();
    await container?.stop();
  });

  /** Locks `first`, waits at `gate` until the other side holds its row, then asks for `second`. */
  const crossLock = (first: number, second: number, gate: () => Promise<void>) =>
    runTransaction(client.db, async (tx) => {
      await tx.execute(sql`UPDATE retry_probe SET n = n + 1 WHERE id = ${first}`);
      await gate();
      await tx.execute(sql`UPDATE retry_probe SET n = n + 1 WHERE id = ${second}`);
    });

  const counts = async (): Promise<number[]> =>
    (
      (await client.db.execute(sql`SELECT n FROM retry_probe ORDER BY id`)).rows as Array<{
        n: number;
      }>
    ).map((r) => r.n);

  it('without a retry one side is rolled back with 40P01 and only the other one is applied', async () => {
    await client.db.execute(sql`UPDATE retry_probe SET n = 0`);
    const gate = barrier(2);
    const results = await Promise.allSettled([crossLock(1, 2, gate), crossLock(2, 1, gate)]);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(failed).toHaveLength(1);
    const e = failed[0]!.reason as { code?: string; cause?: { code?: string } };
    expect(e.code ?? e.cause?.code).toBe('40P01');
    expect(await counts()).toEqual([1, 1]);
  });

  it('with retryTransaction both sides end up applied, once each', async () => {
    await client.db.execute(sql`UPDATE retry_probe SET n = 0`);
    const gate = barrier(2); // only the first attempt of each side waits; a retry has no partner to wait for
    let tries = 0;
    const side = (first: number, second: number) => {
      let attempt = 0;
      return retryTransaction(
        () => {
          tries++;
          return crossLock(first, second, ++attempt === 1 ? gate : () => Promise.resolve());
        },
        { baseMs: 5 },
      );
    };
    await Promise.all([side(1, 2), side(2, 1)]);
    expect(tries).toBe(3); // one side was rolled back once and ran again
    expect(await counts()).toEqual([2, 2]); // two transactions, each added 1 to both rows
  });
});
