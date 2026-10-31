import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClientPair, runMigrations, type DbClientPair } from '@crm/db';
import { DatabaseService } from '../../../src/infra/db/database.service';
import type { ChatMediaStore } from '../../../src/infra/providers/chat-conversations/media';
import { StorageBackfillService } from '../../../src/modules/storage-quota/storage-backfill.service';
import type { StorageModeService } from '../../../src/modules/storage-quota/storage-mode.service';
import { StorageQuotaRepository } from '../../../src/modules/storage-quota/storage-quota.repository';
import { StorageReconcileService } from '../../../src/modules/storage-quota/storage-reconcile.service';

/**
 * The backfill pick-up serves the least recently attempted workspace first. A workspace whose size probe keeps failing is
 * deferred, but it must not keep its slot: after an attempt it goes to the back of the queue, so later workspaces start.
 * Runs against a real Postgres as the restricted application role, like `storage-meter.spec.ts`.
 */
const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');

describe('backfill pick-up serves the least recently attempted workspace first', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let owner: Client;
  let clients: DbClientPair;
  let db: DatabaseService;
  let repo: StorageQuotaRepository;
  let mode: StorageModeService;

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
    mode = { current: async () => 'observe' as const } as unknown as StorageModeService;
  }, 600_000);

  afterAll(async () => {
    await clients?.close();
    await owner?.end();
    await container?.stop();
  });

  const newOrg = async (name: string) =>
    Number(
      (
        await owner.query(`INSERT INTO organizations (slug, name) VALUES ($1, $1) RETURNING id`, [
          `${name}-${Date.now().toString(36)}`,
        ])
      ).rows[0].id,
    );
  const pickUp = (limit: number) => db.privileged((tx) => repo.orgsToBackfill(tx, limit));

  it('a workspace never attempted is picked up before one attempted earlier, and an attempt sends a workspace to the back', async () => {
    const attempted = await newOrg('bf-attempted');
    const fresh = await newOrg('bf-fresh');
    await owner.query(
      `INSERT INTO storage_org_state (org_id, backfill_attempted_at) VALUES ($1, now() - interval '1 hour')`,
      [attempted],
    );
    expect(await pickUp(100000)).toEqual(expect.arrayContaining([attempted, fresh]));
    const order = await pickUp(100000);
    expect(order.indexOf(fresh)).toBeLessThan(order.indexOf(attempted));
  });

  it('a workspace whose size probe keeps failing goes to the back, so a later workspace is still picked up', async () => {
    const stuck = await newOrg('bf-stuck');
    const later = await newOrg('bf-later');
    const rec = new StorageReconcileService(db, repo, { limit: async () => 0 } as never, mode);
    const down = {
      sizeOf: async () => Promise.reject(new Error('bucket unreachable')),
    } as unknown as ChatMediaStore;
    // the stuck workspace has a file whose size the store cannot tell, so the run defers it
    const contact = Number(
      (await owner.query(`INSERT INTO contacts (org_id) VALUES ($1) RETURNING id`, [stuck])).rows[0]
        .id,
    );
    await owner.query(
      `INSERT INTO contact_files (org_id, contact_id, file_name, storage_key) VALUES ($1, $2, 'a.pdf', $3)`,
      [stuck, contact, `chat/${stuck}/2027/01/a.pdf`],
    );

    const result = await new StorageBackfillService(db, repo, mode, rec, down).backfillOrg(stuck);
    expect(result.deferred).toBe(1);
    const order = await pickUp(100000);
    expect(order.indexOf(later)).toBeLessThan(order.indexOf(stuck));
  });
});
