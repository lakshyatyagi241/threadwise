import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClientPair, runMigrations, type DbClientPair } from '@crm/db';
import { sql } from 'drizzle-orm';
import { vi } from 'vitest';
import { AppError } from '../../../src/common/errors/app-error';
import { PlatformStore } from '../../../src/modules/auth';
import { StorageFleetService } from '../../../src/modules/storage-quota/storage-fleet.service';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { ChatMediaStore } from '../../../src/infra/providers/chat-conversations/media';
import { StorageBackfillService } from '../../../src/modules/storage-quota/storage-backfill.service';
import { StorageMeterService } from '../../../src/modules/storage-quota/storage-meter.service';
import type { StorageModeService } from '../../../src/modules/storage-quota/storage-mode.service';
import { StorageQuotaRepository } from '../../../src/modules/storage-quota/storage-quota.repository';
import { StorageQuotaScheduler } from '../../../src/modules/storage-quota/storage-quota.scheduler';
import { StorageReconcileService } from '../../../src/modules/storage-quota/storage-reconcile.service';
import type { PlanEntitlementService } from '../../../src/modules/plans-subscriptions-trials';
import type { StorageQuotaPublisher } from '../../../src/modules/storage-quota/storage-quota.publisher';
import { BYTES_PER_GB } from '@crm/contracts';

/**
 * The storage meter against a real Postgres, as the restricted application role (a superuser skips every policy, so the owner
 * connection only arranges state and reads it back). Observe mode: nothing in here may refuse a write.
 *
 * `STORAGE_TEST_DATABASE_URL` points the suite at a database that is already migrated (a developer's scratch database, with the roles
 * `crm_app_user` / password `test`); without it a container is started and every migration is applied.
 */
const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');

describe('storage meter (observe mode) against Postgres', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let owner: Client;
  let clients: DbClientPair;
  let db: DatabaseService;
  let repo: StorageQuotaRepository;
  let meter: StorageMeterService;
  let orgA: number;
  let orgB: number;
  let seq = 0;

  const mode = {
    current: async () => 'observe' as const,
    configured: async () => 'observe' as const,
  } as unknown as StorageModeService;

  const row = async <T extends Record<string, unknown>>(
    q: string,
    params: unknown[] = [],
  ): Promise<T[]> => (await owner.query(q, params)).rows as T[];
  const state = async (org: number) =>
    (
      await row<{ hot_bytes: string; reserved_bytes: string }>(
        `SELECT hot_bytes::text, reserved_bytes::text FROM storage_org_state WHERE org_id = $1`,
        [org],
      )
    )[0];
  const registrySum = async (org: number) =>
    Number(
      (
        await row<{ n: string }>(
          `SELECT coalesce(sum(bytes),0)::text AS n FROM storage_objects WHERE org_id = $1 AND tier <> 'cold'`,
          [org],
        )
      )[0]!.n,
    );
  const key = (org: number, name?: string) => `chat/${org}/2027/01/${name ?? `f${(seq += 1)}`}.png`;

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
    const tag = Date.now().toString(36);
    const mk = async (slug: string) =>
      Number(
        (
          await owner.query(`INSERT INTO organizations (slug, name) VALUES ($1, $1) RETURNING id`, [
            `${slug}-${tag}`,
          ])
        ).rows[0].id,
      );
    orgA = await mk('sq-a');
    orgB = await mk('sq-b');
  }, 600_000);

  afterAll(async () => {
    await clients?.close();
    await owner?.end();
    await container?.stop();
  });

  it('reserve then commit moves the bytes from reserved to hot and registers the object as pending', async () => {
    const k = key(orgA);
    const r = await meter.reserve({ orgId: orgA, bytes: 1000, category: 'inbox_media' });
    expect(await state(orgA)).toMatchObject({ reserved_bytes: '1000' });
    await r.commit({ key: k, sha256: 'ab'.repeat(32) });
    expect(await state(orgA)).toMatchObject({ hot_bytes: '1000', reserved_bytes: '0' });
    const objs = await row<{ state: string; bytes: string; category: string }>(
      `SELECT state, bytes::text, category FROM storage_objects WHERE org_id = $1 AND key = $2`,
      [orgA, k],
    );
    expect(objs).toEqual([{ state: 'pending', bytes: '1000', category: 'inbox_media' }]);
    const usage = await row<{ hot_bytes: string; objects: string }>(
      `SELECT hot_bytes::text, objects::text FROM storage_usage WHERE org_id = $1 AND category = 'inbox_media'`,
      [orgA],
    );
    expect(usage).toEqual([{ hot_bytes: '1000', objects: '1' }]);
    expect(await row(`SELECT 1 FROM storage_reservations WHERE org_id = $1`, [orgA])).toHaveLength(
      0,
    );
  });

  it('commit is idempotent: the same key twice counts once, and a corrected size moves only the difference', async () => {
    const before = Number((await state(orgA))!.hot_bytes);
    const k = key(orgA);
    const first = await meter.reserve({ orgId: orgA, bytes: 500, category: 'campaign_media' });
    await first.commit({ key: k });
    await first.commit({ key: k });
    expect(Number((await state(orgA))!.hot_bytes)).toBe(before + 500);

    const bigger = await meter.reserve({ orgId: orgA, bytes: 800, category: 'campaign_media' });
    await bigger.commit({ key: k });
    expect(Number((await state(orgA))!.hot_bytes)).toBe(before + 800);
    expect(
      (
        await row<{ n: string }>(
          `SELECT count(*)::text n FROM storage_objects WHERE org_id=$1 AND key=$2`,
          [orgA, k],
        )
      )[0]!.n,
    ).toBe('1');
  });

  it('release gives a reservation back, and is a no-op after a commit', async () => {
    const reservedBefore = Number((await state(orgA))!.reserved_bytes);
    const r = await meter.reserve({ orgId: orgA, bytes: 4096, category: 'scheduled_media' });
    expect(Number((await state(orgA))!.reserved_bytes)).toBe(reservedBefore + 4096);
    await r.release();
    await r.release();
    expect(Number((await state(orgA))!.reserved_bytes)).toBe(reservedBefore);

    const hotBefore = Number((await state(orgA))!.hot_bytes);
    const c = await meter.reserve({ orgId: orgA, bytes: 100, category: 'scheduled_media' });
    await c.commit({ key: key(orgA) });
    await c.release();
    expect(Number((await state(orgA))!.hot_bytes)).toBe(hotBefore + 100);
  });

  it('recordRemoved gives the bytes back once, and an unknown key is a no-op', async () => {
    const k = key(orgA);
    const r = await meter.reserve({ orgId: orgA, bytes: 2000, category: 'inbox_media_inbound' });
    await r.commit({ key: k });
    const hot = Number((await state(orgA))!.hot_bytes);
    await meter.recordRemoved(orgA, k);
    await meter.recordRemoved(orgA, k);
    await meter.recordRemoved(orgA, key(orgA, 'never-registered'));
    expect(Number((await state(orgA))!.hot_bytes)).toBe(hot - 2000);
  });

  it('50 parallel uploads and deletes leave the counters equal to the registry (no lost update)', async () => {
    const files = Array.from({ length: 50 }, (_, i) => ({
      k: key(orgB, `par-${i}`),
      bytes: 1000 + i,
    }));
    await Promise.all(
      files.map(async (f) => {
        const r = await meter.reserve({ orgId: orgB, bytes: f.bytes, category: 'inbox_media' });
        await r.commit({ key: f.k });
      }),
    );
    const total = files.reduce((a, f) => a + f.bytes, 0);
    expect(await state(orgB)).toMatchObject({ hot_bytes: String(total), reserved_bytes: '0' });

    await Promise.all(
      files.filter((_, i) => i % 3 === 0).map((f) => meter.recordRemoved(orgB, f.k)),
    );
    const s = await state(orgB);
    expect(Number(s!.hot_bytes)).toBe(await registrySum(orgB));
    const usage = await row<{ hot_bytes: string; objects: string }>(
      `SELECT hot_bytes::text, objects::text FROM storage_usage WHERE org_id = $1 AND category = 'inbox_media'`,
      [orgB],
    );
    expect(Number(usage[0]!.hot_bytes)).toBe(await registrySum(orgB));
    expect(Number(usage[0]!.objects)).toBe(50 - Math.ceil(50 / 3));
  });

  it('the reaper returns reservations that were never committed or released', async () => {
    const before = Number((await state(orgB))!.reserved_bytes);
    await meter.reserve({ orgId: orgB, bytes: 7777, category: 'inbox_media' });
    expect(Number((await state(orgB))!.reserved_bytes)).toBe(before + 7777);
    await owner.query(
      `UPDATE storage_reservations SET expires_at = now() - interval '1 minute' WHERE org_id = $1`,
      [orgB],
    );
    const scheduler = new StorageQuotaScheduler(db, repo, {} as StorageQuotaPublisher, mode);
    const out = await scheduler.reapOnce();
    expect(out.reaped).toBeGreaterThanOrEqual(1);
    expect(Number((await state(orgB))!.reserved_bytes)).toBe(before);
    expect(await row(`SELECT 1 FROM storage_reservations WHERE org_id = $1`, [orgB])).toHaveLength(
      0,
    );
  });

  it("a metering statement that fails inside the CALLER's transaction rolls back to a savepoint: the caller still commits", async () => {
    const marker = key(orgA, 'caller-owned');
    const r = await meter.reserve({ orgId: orgA, bytes: 300, category: 'team_chat_attachment' });
    const tooLongKey = 'pg:' + 'x'.repeat(1100); // violates chk_storage_objects_key
    await db.txAs({ orgId: orgA, userId: null }, async (tx) => {
      // The caller's own write in the same transaction (a registry row stands in for the message and its blob).
      await repo.adopt(tx, {
        orgId: orgA,
        key: marker,
        category: 'team_chat_attachment',
        bytes: 10,
        ownerTable: 'team_chat_messages',
        ownerId: 1,
      });
      await r.commit({ key: tooLongKey }, tx); // the meter's statement fails; it must not poison `tx`
      await tx.execute(sql`SELECT 1`); // would throw "current transaction is aborted" without the savepoint
    });
    expect(
      await row(`SELECT 1 FROM storage_objects WHERE org_id = $1 AND key = $2`, [orgA, marker]),
    ).toHaveLength(1);
    expect(
      await row(`SELECT 1 FROM storage_objects WHERE org_id = $1 AND key = $2`, [orgA, tooLongKey]),
    ).toHaveLength(0);
    // The failed commit left the reservation in place; release (which the team chat catch-all calls) clears it.
    await r.release();
    expect(
      await row(`SELECT 1 FROM storage_reservations WHERE org_id = $1 AND bytes = 300`, [orgA]),
    ).toHaveLength(0);
  });

  it("workspace A cannot read or write workspace B's registry (forced RLS)", async () => {
    const seenByA = await db.txAs({ orgId: orgA, userId: null }, async (tx) => {
      const res = await tx.execute(sql`SELECT DISTINCT org_id FROM storage_objects`);
      return (res.rows as Array<{ org_id: string }>).map((r) => Number(r.org_id));
    });
    expect(seenByA).toEqual([orgA]);
    await expect(
      db.txAs({ orgId: orgA, userId: null }, (tx) =>
        tx.execute(
          sql`INSERT INTO storage_objects (org_id, key, category, bytes) VALUES (${orgB}, 'x', 'unknown', 1)`,
        ),
      ),
    ).rejects.toThrow();
  });

  it('a door commit racing the backfill adopt of the same key converges on one row and one count', async () => {
    const org = Number(
      (
        await owner.query(`INSERT INTO organizations (slug, name) VALUES ($1, $1) RETURNING id`, [
          `sq-race-${Date.now().toString(36)}`,
        ])
      ).rows[0].id,
    );
    const keys = Array.from({ length: 30 }, (_, i) => `chat/${org}/2027/01/race-${i}.png`);
    await Promise.all(
      keys.map(async (k) => {
        const r = await meter.reserve({ orgId: org, bytes: 700, category: 'inbox_media' });
        await Promise.all([
          r.commit({ key: k }),
          db.txAs({ orgId: org, userId: null }, (tx) =>
            repo.adopt(tx, {
              orgId: org,
              key: k,
              category: 'inbox_media',
              bytes: 700,
              ownerTable: 'messages',
              ownerId: 1,
            }),
          ),
        ]);
      }),
    );
    // no commit was lost to a unique violation: nothing is left reserved and every key is counted once
    expect(
      (
        await row<{ n: string }>(`SELECT count(*)::text n FROM storage_objects WHERE org_id = $1`, [
          org,
        ])
      )[0]!.n,
    ).toBe('30');
    expect((await state(org))!.reserved_bytes).toBe('0');
    const rec = new StorageReconcileService(db, repo, { limit: async () => 0 } as never, mode);
    // whatever the interleaving was, the stored counter equals the registry up to the adopts (which do not move counters): the check
    // brings both to the registry, and a second run finds nothing left to correct
    await rec.reconcileOrg(org);
    expect((await rec.reconcileOrg(org)).driftBytes).toBe(0);
    expect((await state(org))!.hot_bytes).toBe(String(30 * 700));
  });

  it('correcting the size of a cold object moves the cold counter, not the hot one', async () => {
    const org = Number(
      (
        await owner.query(`INSERT INTO organizations (slug, name) VALUES ($1, $1) RETURNING id`, [
          `sq-cold-${Date.now().toString(36)}`,
        ])
      ).rows[0].id,
    );
    const k = `chat/${org}/2027/01/cold.webm`;
    const first = await meter.reserve({ orgId: org, bytes: 1000, category: 'call_recording' });
    await first.commit({ key: k });
    // phase S5 will move it; here the tier is set by hand
    await owner.query(`UPDATE storage_objects SET tier = 'cold' WHERE org_id = $1 AND key = $2`, [
      org,
      k,
    ]);
    await owner.query(`UPDATE storage_org_state SET hot_bytes = 0 WHERE org_id = $1`, [org]);
    await owner.query(
      `UPDATE storage_usage SET hot_bytes = 0, cold_bytes = 1000 WHERE org_id = $1`,
      [org],
    );
    const again = await meter.reserve({ orgId: org, bytes: 1400, category: 'call_recording' });
    await again.commit({ key: k });
    expect((await state(org))!.hot_bytes).toBe('0');
    expect(
      await row<{ hot_bytes: string; cold_bytes: string }>(
        `SELECT hot_bytes::text, cold_bytes::text FROM storage_usage WHERE org_id = $1`,
        [org],
      ),
    ).toEqual([{ hot_bytes: '0', cold_bytes: '1400' }]);
    await meter.recordRemoved(org, k);
    expect((await state(org))!.hot_bytes).toBe('0');
    expect(
      (
        await row<{ cold_bytes: string; objects: string }>(
          `SELECT cold_bytes::text, objects::text FROM storage_usage WHERE org_id = $1`,
          [org],
        )
      )[0],
    ).toEqual({ cold_bytes: '0', objects: '0' });
  });

  describe('reconcile and backfill', () => {
    const entitlements = { limit: async () => 1 } as unknown as PlanEntitlementService;

    it('the counter check corrects a drifted counter, computes the cap and the level, and reports the drift', async () => {
      const org = Number(
        (
          await owner.query(`INSERT INTO organizations (slug, name) VALUES ($1, $1) RETURNING id`, [
            `sq-rec-${Date.now().toString(36)}`,
          ])
        ).rows[0].id,
      );
      const rec = new StorageReconcileService(db, repo, entitlements, mode);
      for (let i = 0; i < 3; i += 1) {
        const r = await meter.reserve({
          orgId: org,
          bytes: BYTES_PER_GB * 0.3,
          category: 'call_recording',
        });
        await r.commit({ key: `chat/${org}/2027/01/r${i}.webm` });
      }
      await owner.query(`UPDATE storage_org_state SET hot_bytes = 123 WHERE org_id = $1`, [org]);
      const out = await rec.reconcileOrg(org);
      expect(out.driftBytes).toBeGreaterThan(0);
      expect(out.hotBytes).toBe(Math.floor(BYTES_PER_GB * 0.3) * 3);
      expect(out.capBytes).toBe(BYTES_PER_GB);
      expect(out.level).toBe('warn80');
      const s = (
        await row<{
          hot_bytes: string;
          cap_bytes: string;
          level: string;
          last_drift_bytes: string;
        }>(
          `SELECT hot_bytes::text, cap_bytes::text, level, last_drift_bytes::text FROM storage_org_state WHERE org_id = $1`,
          [org],
        )
      )[0]!;
      expect(Number(s.hot_bytes)).toBe(out.hotBytes);
      expect(s.level).toBe('warn80');
      // a second run finds nothing to correct
      expect((await rec.reconcileOrg(org)).driftBytes).toBe(0);
    });

    it('syncs team chat blobs with the registry in both directions and links pending rows to their owner', async () => {
      const org = Number(
        (
          await owner.query(`INSERT INTO organizations (slug, name) VALUES ($1, $1) RETURNING id`, [
            `sq-tc-${Date.now().toString(36)}`,
          ])
        ).rows[0].id,
      );
      const chan = Number(
        (
          await owner.query(
            `INSERT INTO team_chat_channels (org_id, name, slug) VALUES ($1,'g','g') RETURNING id`,
            [org],
          )
        ).rows[0].id,
      );
      const msg = Number(
        (
          await owner.query(
            `INSERT INTO team_chat_messages (org_id, channel_id, body) VALUES ($1,$2,'hi') RETURNING id`,
            [org, chan],
          )
        ).rows[0].id,
      );
      await owner.query(
        `INSERT INTO team_chat_attachment_blobs (org_id, message_id, bytes, byte_size) VALUES ($1,$2,'\\x00'::bytea, 4096)`,
        [org, msg],
      );
      // a registry row whose blob is gone (its message was deleted and cascaded)
      await owner.query(
        `INSERT INTO storage_objects (org_id, key, category, bytes, state) VALUES ($1,'pg:team_chat_attachment_blobs:999999','team_chat_attachment',500,'live')`,
        [org],
      );
      // a pending door row whose owner row exists (a scheduled media file)
      const sk = `scheduled/${org}/pending.png`;
      await owner.query(
        `INSERT INTO scheduled_media (org_id, storage_key, file_name, mime, kind, size_bytes) VALUES ($1,$2,'a.png','image/png','image',64)`,
        [org, sk],
      );
      await owner.query(
        `INSERT INTO storage_objects (org_id, key, category, bytes, state) VALUES ($1,$2,'scheduled_media',64,'pending')`,
        [org, sk],
      );

      const rec = new StorageReconcileService(db, repo, entitlements, mode);
      const out = await rec.reconcileOrg(org);
      expect(out).toMatchObject({ blobsAdded: 1, blobsRemoved: 1, linked: 1 });
      const keys = await row<{ key: string; state: string }>(
        `SELECT key, state FROM storage_objects WHERE org_id = $1 ORDER BY key`,
        [org],
      );
      expect(keys.map((k) => k.key)).toEqual([sk, `pg:team_chat_attachment_blobs:${msg}`].sort());
      expect(keys.find((k) => k.key === sk)!.state).toBe('live');
      expect(out.hotBytes).toBe(64 + 4096);
    });

    it('the backfill is idempotent, uses server-side sizes, probes the kinds without a size column and ignores a client claim', async () => {
      const org = Number(
        (
          await owner.query(`INSERT INTO organizations (slug, name) VALUES ($1, $1) RETURNING id`, [
            `sq-bf-${Date.now().toString(36)}`,
          ])
        ).rows[0].id,
      );
      await owner.query(
        `INSERT INTO scheduled_media (org_id, storage_key, file_name, mime, kind, size_bytes) VALUES ($1,$2,'a.png','image/png','image',2048)`,
        [org, `scheduled/${org}/a.png`],
      );
      await owner.query(
        `INSERT INTO mail_outbound_attachments (org_id, name, mime, size, object_key, expires_at) VALUES ($1,'a.pdf','application/pdf',1500,$2, now() + interval '1 day')`,
        [org, `chat/${org}/2027/01/m.pdf`],
      );
      const contact = Number(
        (await owner.query(`INSERT INTO contacts (org_id) VALUES ($1) RETURNING id`, [org])).rows[0]
          .id,
      );
      // file_size_bytes is a client claim (999999); the object is measured instead (7000 by the probe)
      await owner.query(
        `INSERT INTO contact_files (org_id, contact_id, file_name, file_size_bytes, storage_key) VALUES ($1,$2,'c.pdf',999999,$3)`,
        [org, contact, `chat/${org}/2027/01/c.pdf`],
      );
      // a key that belongs to another workspace and a URL stored in the same column are not objects of this workspace
      await owner.query(
        `INSERT INTO contact_files (org_id, contact_id, file_name, storage_key) VALUES ($1,$2,'x.pdf',$3), ($1,$2,'y.pdf','https://example.test/y.pdf')`,
        [org, contact, `chat/${org + 1}/2027/01/other.pdf`],
      );

      const media = {
        sizeOf: async (_org: number, k: string) => (k.endsWith('c.pdf') ? 7000 : null),
      } as unknown as ChatMediaStore;
      const rec = new StorageReconcileService(db, repo, entitlements, mode);
      const backfill = new StorageBackfillService(db, repo, mode, rec, media);
      const first = await backfill.backfillOrg(org);
      expect(first.adopted['scheduled_media.storage_key']).toBe(1);
      expect(first.adopted['mail_outbound_attachments.object_key']).toBe(1);
      expect(first.adopted['contact_files.storage_key']).toBe(1);

      const objs = await row<{ key: string; bytes: string; category: string; state: string }>(
        `SELECT key, bytes::text, category, state FROM storage_objects WHERE org_id = $1 ORDER BY key`,
        [org],
      );
      expect(objs.map((o) => [o.category, o.bytes, o.state])).toEqual(
        expect.arrayContaining([
          ['scheduled_media', '2048', 'live'],
          ['email_attachment_staged', '1500', 'live'],
          ['contact_file', '7000', 'live'],
        ]),
      );
      expect(objs).toHaveLength(3);
      expect((await state(org))!.hot_bytes).toBe(String(2048 + 1500 + 7000));
      expect(
        (
          await row<{ backfilled_at: Date | null }>(
            `SELECT backfilled_at FROM storage_org_state WHERE org_id = $1`,
            [org],
          )
        )[0]!.backfilled_at,
      ).not.toBeNull();

      const second = await backfill.backfillOrg(org);
      expect(Object.values(second.adopted).every((n) => n === 0)).toBe(true);
      expect((await state(org))!.hot_bytes).toBe(String(2048 + 1500 + 7000));
    });

    it('a size check that errors defers the workspace (not marked done, nothing registered at zero) and a later run finishes it; keys are registered in canonical form', async () => {
      const org = Number(
        (
          await owner.query(`INSERT INTO organizations (slug, name) VALUES ($1, $1) RETURNING id`, [
            `sq-defer-${Date.now().toString(36)}`,
          ])
        ).rows[0].id,
      );
      const contact = Number(
        (await owner.query(`INSERT INTO contacts (org_id) VALUES ($1) RETURNING id`, [org])).rows[0]
          .id,
      );
      // a client may store the key with a leading storage/ or slash; the doors register chat/<org>/...
      await owner.query(
        `INSERT INTO contact_files (org_id, contact_id, file_name, storage_key) VALUES ($1,$2,'a.pdf',$3)`,
        [org, contact, `storage/chat/${org}/2027/01/a.pdf`],
      );
      const rec = new StorageReconcileService(db, repo, entitlements, mode);
      const down = {
        sizeOf: async () => Promise.reject(new Error('bucket unreachable')),
      } as unknown as ChatMediaStore;
      const first = await new StorageBackfillService(db, repo, mode, rec, down).backfillOrg(org);
      expect(first.deferred).toBe(1);
      expect(await row(`SELECT 1 FROM storage_objects WHERE org_id = $1`, [org])).toHaveLength(0);
      expect(
        (
          await row<{ backfilled_at: Date | null }>(
            `SELECT backfilled_at FROM storage_org_state WHERE org_id = $1`,
            [org],
          )
        )[0]!.backfilled_at,
      ).toBeNull();
      // and the pick-up still sees the workspace
      expect(await db.privileged((tx) => repo.orgsToBackfill(tx, 100000))).toContain(org);

      const up = { sizeOf: async () => 4321 } as unknown as ChatMediaStore;
      const second = await new StorageBackfillService(db, repo, mode, rec, up).backfillOrg(org);
      expect(second.deferred).toBe(0);
      expect(
        await row<{ key: string; bytes: string }>(
          `SELECT key, bytes::text FROM storage_objects WHERE org_id = $1`,
          [org],
        ),
      ).toEqual([{ key: `chat/${org}/2027/01/a.pdf`, bytes: '4321' }]);
      expect(
        (
          await row<{ backfilled_at: Date | null }>(
            `SELECT backfilled_at FROM storage_org_state WHERE org_id = $1`,
            [org],
          )
        )[0]!.backfilled_at,
      ).not.toBeNull();
      // a door that later removes the object by its canonical key gives the bytes back
      await meter.recordRemoved(org, `chat/${org}/2027/01/a.pdf`);
      expect((await state(org))!.hot_bytes).toBe('0');
    });

    it('backfill and counter check do nothing when the mode is off', async () => {
      const off = { current: async () => 'off' as const } as unknown as StorageModeService;
      const org = Number(
        (
          await owner.query(`INSERT INTO organizations (slug, name) VALUES ($1, $1) RETURNING id`, [
            `sq-off-${Date.now().toString(36)}`,
          ])
        ).rows[0].id,
      );
      const rec = new StorageReconcileService(db, repo, entitlements, off);
      expect((await rec.reconcileOrg(org)).skipped).toBe(true);
      expect((await new StorageBackfillService(db, repo, off, rec).backfillOrg(org)).skipped).toBe(
        true,
      );
      expect(await row(`SELECT 1 FROM storage_org_state WHERE org_id = $1`, [org])).toHaveLength(0);
      const m = new StorageMeterService(db, repo, off);
      await (
        await m.reserve({ orgId: org, bytes: 10, category: 'inbox_media' })
      ).commit({ key: `chat/${org}/a.png` });
      expect(await row(`SELECT 1 FROM storage_objects WHERE org_id = $1`, [org])).toHaveLength(0);
    });
  });

  describe('operator fleet view (read only)', () => {
    it('totals, categories, the biggest workspaces first, levels and drift; and one workspace panel is audited', async () => {
      const mkOrg = async (tag: string) => {
        const r = await owner.query(
          `INSERT INTO organizations (slug, name) VALUES ($1, $2) RETURNING id, uuid`,
          [`sq-fl-${tag}-${Date.now().toString(36)}`, `Fleet ${tag}`],
        );
        return { id: Number(r.rows[0].id), uuid: String(r.rows[0].uuid) };
      };
      const big = await mkOrg('big');
      const small = await mkOrg('small');
      const put = async (
        org: number,
        bytes: number,
        category: 'call_recording' | 'inbox_media',
        n: string,
      ) => {
        const r = await meter.reserve({ orgId: org, bytes, category });
        await r.commit({ key: `chat/${org}/2027/01/${n}.bin` });
      };
      await put(big.id, 900, 'call_recording', 'a');
      await put(big.id, 100, 'inbox_media', 'b');
      await put(small.id, 50, 'inbox_media', 'c');
      // the nightly check gives each a cap (1 byte of plan is impossible, so use the stored columns directly) and a level
      await owner.query(
        `UPDATE storage_org_state SET cap_bytes = 1000, level = 'full', last_reconciled_at = now(), last_drift_bytes = 7 WHERE org_id = $1`,
        [big.id],
      );

      const audit = { recordStandalone: vi.fn(async () => undefined) };
      const fleet = new StorageFleetService(new PlatformStore(db), repo, mode, audit as never);
      const out = await fleet.fleet();

      expect(out.mode).toBe('observe');
      expect(out.totals.hotBytes).toBeGreaterThanOrEqual(1050);
      expect(out.totals.workspaces).toBeGreaterThanOrEqual(2);
      const names = out.top.map((w) => w.name);
      expect(names.indexOf('Fleet big')).toBeLessThan(names.indexOf('Fleet small'));
      const bigRow = out.top.find((w) => w.name === 'Fleet big')!;
      expect(bigRow).toMatchObject({
        hotBytes: 1000,
        capBytes: 1000,
        level: 'full',
        workspaceId: big.uuid,
      });
      expect(
        out.byCategory.find((c) => c.category === 'call_recording')!.hotBytes,
      ).toBeGreaterThanOrEqual(900);
      expect(out.levels.full).toBeGreaterThanOrEqual(1);
      expect(Object.keys(out.levels).sort()).toEqual(['full', 'ok', 'over', 'warn80']);
      expect(out.drift.workspacesWithDrift).toBeGreaterThanOrEqual(1);
      expect(out.drift.driftBytes).toBeGreaterThanOrEqual(7);
      expect(out.drift.lastRunAt).not.toBeNull();
      expect(audit.recordStandalone).not.toHaveBeenCalled(); // the aggregate leaves no per-workspace trace

      const detail = await fleet.workspace(big.uuid);
      expect(detail).toMatchObject({ workspaceId: big.uuid, name: 'Fleet big' });
      expect(detail.summary).toMatchObject({
        hotBytes: 1000,
        capBytes: 1000,
        level: 'full',
        mode: 'observe',
      });
      expect(detail.summary.byCategory.map((c) => c.category).sort()).toEqual([
        'call_recording',
        'inbox_media',
      ]);
      expect(audit.recordStandalone).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'platform.storage.workspace_viewed',
          payload: { workspace: big.uuid },
        }),
      );
      await expect(fleet.workspace('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(
        AppError,
      );
    });

    it('a workspace waiting out its deletion window is in no figure, so the totals equal the sum of what the operator sees', async () => {
      const r = await owner.query(
        `INSERT INTO organizations (slug, name) VALUES ($1, 'Fleet gone') RETURNING id`,
        [`sq-fl-gone-${Date.now().toString(36)}`],
      );
      const gone = Number(r.rows[0].id);
      const put = await meter.reserve({ orgId: gone, bytes: 123456789, category: 'inbox_media' });
      await put.commit({ key: `chat/${gone}/2027/01/g.bin` });
      const audit = { recordStandalone: vi.fn(async () => undefined) };
      const fleet = new StorageFleetService(new PlatformStore(db), repo, mode, audit as never);
      const live = await fleet.fleet();
      await owner.query(
        `UPDATE organizations SET status = 'deleted', deleted_at = now() WHERE id = $1`,
        [gone],
      );
      const after = await fleet.fleet();
      expect(after.totals.hotBytes).toBe(live.totals.hotBytes - 123456789);
      expect(after.top.map((w) => w.name)).not.toContain('Fleet gone');
      expect(after.byCategory.find((c) => c.category === 'inbox_media')!.hotBytes).toBe(
        live.byCategory.find((c) => c.category === 'inbox_media')!.hotBytes - 123456789,
      );
    });
  });
});
