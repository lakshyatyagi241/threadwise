import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbClientPair, runMigrations, type DbClientPair } from '@crm/db';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { AsyncOpsService } from '../../../src/modules/platform-async-ops/async-ops.service';
import { AsyncOpsStore } from '../../../src/modules/platform-async-ops/async-ops.store';

/**
 * Outbox replay against a real Postgres, as the application role (ASYNC-044/045/046).
 *
 * The unit spec proves the service logic with a fake transaction; only a real database proves the single replay statement: that it
 * selects only dead rows of the named type, honours the limit, leaves inactive workspaces alone, and that two replays at once never
 * take the same row twice.
 */
describe('outbox replay', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let clients: DbClientPair;
  let svc: AsyncOpsService;
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const queue = { getFailed: vi.fn().mockResolvedValue([]) };

  let activeOrg = 0;
  let suspendedOrg = 0;

  const seed = async (org: number, type: string, status: string, n = 1) => {
    for (let i = 0; i < n; i += 1) {
      await owner.query(
        `INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload, status, attempts, last_error)
         VALUES ($1, 'm', $2, $3, '{}', $4, $5, $6)`,
        [org, i + 1, type, status, status === 'dead' ? 26 : 0, status === 'dead' ? 'boom' : null],
      );
    }
  };
  const count = async (type: string, status: string) =>
    (
      await owner.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM event_outbox WHERE event_type = $1 AND status = $2`,
        [type, status],
      )
    ).rows[0]!.n;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await owner.query(
      `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../../packages/db/migrations'),
      log: () => undefined,
    });
    activeOrg = (
      await owner.query<{ id: number }>(
        `INSERT INTO organizations (slug, name, status) VALUES ('a', 'A', 'active') RETURNING id`,
      )
    ).rows[0]!.id;
    suspendedOrg = (
      await owner.query<{ id: number }>(
        `INSERT INTO organizations (slug, name, status) VALUES ('s', 'S', 'suspended') RETURNING id`,
      )
    ).rows[0]!.id;
    clients = createDbClientPair({
      url: `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`,
      poolMax: 4,
    });
    svc = new AsyncOpsService(
      new AsyncOpsStore(new DatabaseService(clients)),
      queue as never,
      audit as never,
    );
  }, 180_000);

  afterAll(async () => {
    await clients?.close();
    await owner?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await owner.query(`DELETE FROM event_outbox`);
    audit.record.mockClear();
  });

  it('re-queues dead events of the named type only, reset for a fresh run', async () => {
    await seed(activeOrg, 'wallet.charge', 'dead', 3);
    await seed(activeOrg, 'other.event', 'dead', 2);
    await seed(activeOrg, 'wallet.charge', 'done', 4);

    const out = await svc.replayOutbox({ eventType: 'wallet.charge', limit: 200 }, 1);

    expect(out).toEqual({ replayed: 3, skippedInactiveWorkspace: 0 });
    expect(await count('wallet.charge', 'pending')).toBe(3);
    expect(await count('wallet.charge', 'done')).toBe(4);
    expect(await count('other.event', 'dead')).toBe(2);
    const row = (
      await owner.query<{ attempts: number; last_error: string | null }>(
        `SELECT attempts, last_error FROM event_outbox WHERE status = 'pending' LIMIT 1`,
      )
    ).rows[0]!;
    expect(row).toEqual({ attempts: 0, last_error: null });
  });

  it('honours the limit', async () => {
    await seed(activeOrg, 'wallet.charge', 'dead', 5);
    expect((await svc.replayOutbox({ eventType: 'wallet.charge', limit: 2 }, 1)).replayed).toBe(2);
    expect(await count('wallet.charge', 'dead')).toBe(3);
  });

  it('leaves the events of a workspace that is no longer active dead and says so', async () => {
    await seed(activeOrg, 'wallet.charge', 'dead', 1);
    await seed(suspendedOrg, 'wallet.charge', 'dead', 2);

    const out = await svc.replayOutbox({ eventType: 'wallet.charge', limit: 200 }, 1);

    expect(out).toEqual({ replayed: 1, skippedInactiveWorkspace: 2 });
    expect(await count('wallet.charge', 'dead')).toBe(2);
  });

  it('two replays at once take every dead event exactly once between them', async () => {
    await seed(activeOrg, 'wallet.charge', 'dead', 40);

    const [a, b] = await Promise.all([
      svc.replayOutbox({ eventType: 'wallet.charge', limit: 30 }, 1),
      svc.replayOutbox({ eventType: 'wallet.charge', limit: 30 }, 2),
    ]);

    expect(a.replayed + b.replayed).toBe(40);
    expect(await count('wallet.charge', 'dead')).toBe(0);
    expect(await count('wallet.charge', 'pending')).toBe(40);
  });

  it('a second replay after the first finds nothing', async () => {
    await seed(activeOrg, 'wallet.charge', 'dead', 2);
    await svc.replayOutbox({ eventType: 'wallet.charge', limit: 200 }, 1);
    expect((await svc.replayOutbox({ eventType: 'wallet.charge', limit: 200 }, 1)).replayed).toBe(
      0,
    );
  });

  it('lists dead events grouped by type, oldest first, with no payload', async () => {
    await seed(activeOrg, 'wallet.charge', 'dead', 3);
    await seed(activeOrg, 'other.event', 'dead', 1);
    const groups = await svc.deadOutbox();
    expect(groups.map((g) => [g.eventType, g.count])).toEqual([
      ['wallet.charge', 3],
      ['other.event', 1],
    ]);
    expect(JSON.stringify(groups)).not.toContain('payload');
  });

  it('audits each replay with the operator', async () => {
    await seed(activeOrg, 'wallet.charge', 'dead', 1);
    await svc.replayOutbox({ eventType: 'wallet.charge', limit: 200 }, 7);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0]![1]).toMatchObject({ actorId: 7 });
  });
});
