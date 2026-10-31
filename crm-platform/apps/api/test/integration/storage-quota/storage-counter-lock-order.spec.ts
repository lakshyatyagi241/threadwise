import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClientPair, runMigrations, type DbClientPair } from '@crm/db';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { StorageMeterService } from '../../../src/modules/storage-quota/storage-meter.service';
import type { StorageModeService } from '../../../src/modules/storage-quota/storage-mode.service';
import { StorageQuotaRepository } from '../../../src/modules/storage-quota/storage-quota.repository';

/**
 * The nightly counter check (`rebuildCounters`) and an upload settling (`commit`) on the same workspace must not deadlock. The check
 * locks `storage_org_state` first and then writes `storage_usage`; a commit that wrote `storage_usage` before taking the org-state lock
 * could hold one row while the check held the other. Both paths now take the org-state lock first. Runs against a real Postgres as the
 * restricted application role, like `storage-meter.spec.ts`.
 */
const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');

describe('storage counter check and commits take the workspace lock in one order', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let owner: Client;
  let clients: DbClientPair;
  let db: DatabaseService;
  let repo: StorageQuotaRepository;
  let meter: StorageMeterService;
  let org: number;

  const mode = {
    current: async () => 'observe' as const,
    configured: async () => 'observe' as const,
  } as unknown as StorageModeService;

  beforeAll(async () => {
    const existing = process.env.STORAGE_TEST_DATABASE_URL;
    let appUrl: string;
    if (existing) {
      owner = new Client({ connectionString: existing });
      const u = new URL(existing);
      appUrl = `postgres://crm_app_user:test@${u.host}${u.pathname}`;
    } else {
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
      await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });
      appUrl = `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`;
    }
    if (existing) await owner.connect();
    clients = createDbClientPair({ url: appUrl, poolMax: 12 });
    db = new DatabaseService(clients);
    repo = new StorageQuotaRepository();
    meter = new StorageMeterService(db, repo, mode);
    org = Number(
      (
        await owner.query(`INSERT INTO organizations (slug, name) VALUES ($1, $1) RETURNING id`, [
          `lock-order-${Date.now().toString(36)}`,
        ])
      ).rows[0].id,
    );
  }, 600_000);

  afterAll(async () => {
    await clients?.close();
    await owner?.end();
    await container?.stop();
  });

  it('a counter check racing uploads on the same workspace finishes every round without a deadlock', async () => {
    const rebuild = () =>
      db.txAs({ orgId: org, userId: null }, (tx) =>
        repo.rebuildCounters(tx, org, 1_000_000, () => 'ok', new Date()),
      );
    const upload = async (name: string) => {
      const r = await meter.reserve({ orgId: org, bytes: 500, category: 'inbox_media' });
      await r.commit({ key: `chat/${org}/2027/01/${name}.png` });
    };

    for (let round = 0; round < 15; round += 1) {
      const work: Promise<unknown>[] = [rebuild()];
      for (let i = 0; i < 6; i += 1) work.push(upload(`lo-${round}-${i}`));
      await expect(Promise.all(work)).resolves.toBeDefined();
    }

    const registry = Number(
      (
        await owner.query(
          `SELECT coalesce(sum(bytes),0)::text AS n FROM storage_objects WHERE org_id = $1 AND tier <> 'cold' AND state <> 'missing'`,
          [org],
        )
      ).rows[0].n,
    );
    await rebuild();
    const state = await owner.query(
      `SELECT hot_bytes::text AS hot FROM storage_org_state WHERE org_id = $1`,
      [org],
    );
    expect(Number(state.rows[0].hot)).toBe(registry);
  }, 300_000);
});
