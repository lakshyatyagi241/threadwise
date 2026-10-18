import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { mkdtemp, rm } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClientPair, runMigrations, type DbClientPair } from '@crm/db';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { LocalArchiveStorage } from '../../../src/infra/providers/data-retention/local-archive-storage.adapter';
import { AuditLogExportRunner } from '../../../src/modules/audit-log/audit-log-export.runner';
import { AuditLogRepository } from '../../../src/modules/audit-log/audit-log.repository';
import { AuthMaintenanceService } from '../../../src/modules/auth/maintenance/auth-maintenance.service';
import { ArchiveReader } from '../../../src/modules/data-retention/archive-reader.service';
import { PartitionArchiver } from '../../../src/modules/data-retention/partition-archiver.service';
import {
  deletePolicy,
  liveStats,
  loadPolicies,
  loadRuns,
  partitionSizes,
  recordRun,
  savePolicy,
} from '../../../src/modules/data-retention/retention-store';
import { RetentionWorker } from '../../../src/modules/data-retention/retention.worker';

/**
 * The retention policies against a real Postgres, as the role the worker connects as: the platform tables and their privileged-only
 * RLS, the store's statements, and the whole path for the audit log (nothing happens without a saved policy; with one, a closed month is
 * archived, dropped and readable again; the row-by-row prune steps aside only while the archive job really runs).
 */
describe('retention policies', () => {
  const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let clients: DbClientPair;
  let db: DatabaseService;
  let dir: string;
  let storage: LocalArchiveStorage;

  const workerUrl = () =>
    `postgres://crm_worker_user:test@${container.getHost()}:${container.getPort()}/crm`;
  const appUrl = () =>
    `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`;

  const monthAgo = (k: number): string => {
    const d = new Date();
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k, 1));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const partitionExists = async (name: string) =>
    (await owner.query(`SELECT to_regclass('public.${name}') AS r`)).rows[0].r !== null;
  const config = (live: boolean) =>
    ({
      get: (k: string) =>
        ({
          RETENTION_ENABLED: live,
          RETENTION_DRY_RUN: !live,
          ARCHIVE_DRIVER: 's3',
          NODE_ENV: 'test',
        })[k],
    }) as never;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    for (const role of ['crm_app_user', 'crm_worker_user']) {
      await owner.query(
        `CREATE ROLE ${role} LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
      );
    }
    await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });
    clients = createDbClientPair({ url: workerUrl(), poolMax: 3 });
    db = new DatabaseService(clients);
    dir = await mkdtemp(join(tmpdir(), 'retention-policies-'));
    storage = new LocalArchiveStorage(dir);
  }, 240_000);

  afterAll(async () => {
    await clients?.close();
    await owner?.end();
    await container?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  describe('the platform tables', () => {
    it('are closed to anything that is not a privileged connection', async () => {
      const app = new Client({ connectionString: appUrl() });
      await app.connect();
      try {
        const { rows } = await app.query(`SELECT count(*)::int AS n FROM data_retention_policies`);
        expect(rows[0].n).toBe(0);
        await owner.query(
          `INSERT INTO data_retention_policies (item, live_days) VALUES ('an_events', 30)`,
        );
        // Not privileged: RLS shows an ordinary connection nothing, and refuses its writes.
        expect(
          (await app.query(`SELECT count(*)::int AS n FROM data_retention_policies`)).rows[0].n,
        ).toBe(0);
        await expect(
          app.query(
            `INSERT INTO data_retention_policies (item, live_days) VALUES ('audit_log', 30)`,
          ),
        ).rejects.toThrow(/row-level security/);
        await owner.query(`DELETE FROM data_retention_policies`);
      } finally {
        await app.end();
      }
    });

    it('refuse values the dashboard would never send', async () => {
      await expect(
        owner.query(`INSERT INTO data_retention_policies (item, live_days) VALUES ('x', 0)`),
      ).rejects.toThrow(/chk_retention_live/);
      await expect(
        owner.query(
          `INSERT INTO data_retention_policies (item, live_days, archive_days) VALUES ('x', 30, 0)`,
        ),
      ).rejects.toThrow(/chk_retention_archive/);
    });
  });

  describe('the store', () => {
    it('creates once, changes only with the version that was read, and resets', async () => {
      const values = { liveDays: 90, archiveDays: 275 };
      const first = await db.privileged((tx) => savePolicy(tx, 'audit_log', values, null, 5));
      expect(first).toMatchObject({ item: 'audit_log', rowVersion: 1, updatedBy: 5, ...values });

      // A second "create" and a stale version are both conflicts.
      await expect(
        db.privileged((tx) => savePolicy(tx, 'audit_log', values, null, 5)),
      ).rejects.toMatchObject({ code: 'ROW_VERSION_CONFLICT' });
      const second = await db.privileged((tx) =>
        savePolicy(tx, 'audit_log', { liveDays: 120, archiveDays: null }, 1, 6),
      );
      expect(second).toMatchObject({
        rowVersion: 2,
        liveDays: 120,
        archiveDays: null,
        updatedBy: 6,
      });
      await expect(
        db.privileged((tx) => savePolicy(tx, 'audit_log', values, 1, 5)),
      ).rejects.toMatchObject({ code: 'ROW_VERSION_CONFLICT' });

      expect((await db.privileged((tx) => loadPolicies(tx))).get('audit_log')?.liveDays).toBe(120);
      expect(await db.privileged((tx) => deletePolicy(tx, 'audit_log'))).toMatchObject({
        liveDays: 120,
      });
      expect(await db.privileged((tx) => deletePolicy(tx, 'audit_log'))).toBeNull();
    });

    it('keeps the last measured archive size when a later run does not measure it', async () => {
      const t1 = new Date('2027-01-01T03:00:00Z');
      await db.privileged((tx) =>
        recordRun(
          tx,
          'security_events',
          { mode: 'live', outcome: 'ok', deletedRows: 4, archive: { objects: 3, bytes: 900 } },
          t1,
        ),
      );
      await db.privileged((tx) =>
        recordRun(
          tx,
          'security_events',
          { mode: 'live', outcome: 'partial', deletedRows: 9, error: 'x' },
          new Date('2027-01-02T03:00:00Z'),
        ),
      );
      const run = (await db.privileged((tx) => loadRuns(tx))).get('security_events')!;
      expect(run).toMatchObject({
        outcome: 'partial',
        deletedRows: 9,
        error: 'x',
        at: '2027-01-02T03:00:00Z',
      });
      expect(run.archive).toEqual({ objects: 3, bytes: 900, measuredAt: '2027-01-01T03:00:00Z' });
    });

    it('measures the live data of every kind of item from the catalog', async () => {
      const month = monthAgo(2);
      await owner.query(`SELECT ensure_monthly_partition('audit_log'::regclass, $1::date)`, [
        `${month}-01`,
      ]);
      const audit = await db.privileged((tx) => liveStats(tx, 'audit_log'));
      expect(audit.partitions).toBeGreaterThanOrEqual(4);
      expect(audit.oldestMonth).toMatch(/^\d{4}-\d{2}$/);
      expect(audit.bytes).toBeGreaterThan(0);
      expect(
        (await db.privileged((tx) => partitionSizes(tx, 'audit_log'))).map((p) => p.month),
      ).toContain(month);
      // The catch-all partition is not a month.
      expect(
        (await db.privileged((tx) => partitionSizes(tx, 'audit_log'))).every((p) =>
          /^\d{4}-\d{2}$/.test(p.month),
        ),
      ).toBe(true);
      expect((await db.privileged((tx) => liveStats(tx, 'security_events'))).partitions).toBeNull();
      expect((await db.privileged((tx) => liveStats(tx, 'audit_log_exports'))).rows).toBe(0);
    });
  });

  describe('the audit log', () => {
    const OLD = monthAgo(30);
    const part = `audit_log_${OLD.replace('-', '')}`;

    async function seedOld(): Promise<void> {
      await owner.query(`SELECT ensure_monthly_partition('audit_log'::regclass, $1::date)`, [
        `${OLD}-01`,
      ]);
      await owner.query(
        `INSERT INTO audit_log (id, org_id, actor_id, actor_type, module, record_id, action, delta, at)
         SELECT nextval('audit_log_id_seq'), 7, 3, 'user', 'contacts', g, 'update', '{"name":{"old":"a","new":"b"}}'::jsonb,
                $1::timestamptz + g * interval '1 hour'
           FROM generate_series(1, 5) g`,
        [`${OLD}-03T00:00:00Z`],
      );
    }

    it('is left alone by the archive job until a policy is saved', async () => {
      await seedOld();
      const archiver = new PartitionArchiver(db, storage);
      const worker = new RetentionWorker(archiver, storage, undefined, undefined, db);
      await worker.run({ dryRun: false });
      expect(await partitionExists(part)).toBe(true);
      expect((await db.privileged((tx) => loadRuns(tx))).has('audit_log')).toBe(false);
    });

    it('is archived, dropped and readable again once a policy is saved', async () => {
      await db.privileged((tx) =>
        savePolicy(tx, 'audit_log', { liveDays: 400, archiveDays: 3000 }, null, 5),
      );
      const archiver = new PartitionArchiver(db, storage);
      const worker = new RetentionWorker(archiver, storage, undefined, undefined, db);
      await worker.run({ dryRun: false });

      expect(await partitionExists(part)).toBe(false);
      const run = (await db.privileged((tx) => loadRuns(tx))).get('audit_log')!;
      expect(run).toMatchObject({
        mode: 'live',
        outcome: 'ok',
        archivedMonths: 1,
        archivedRows: 5,
      });
      expect(run.archive?.objects).toBeGreaterThanOrEqual(2);

      const rows: Array<Record<string, unknown>> = [];
      const from = new Date(`${OLD}-01T00:00:00Z`);
      const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
      for await (const r of new ArchiveReader(storage).stream('audit_log', 7, from, to, {
        trusted: true,
      }))
        rows.push(r);
      expect(rows).toHaveLength(5);
      expect(rows[0]).toMatchObject({
        org_id: 7,
        module: 'contacts',
        action: 'update',
        actor_id: 3,
      });
      // The delta travels with the line, so an export from the archive renders the same changes.
      expect(rows[0]!.delta).toEqual({ name: { old: 'a', new: 'b' } });
    });

    it('is a dry run when the job only logs: nothing is dropped and the run says so', async () => {
      await db.privileged((tx) =>
        savePolicy(tx, 'an_events', { liveDays: 60, archiveDays: null }, null, 5),
      );
      const archiver = new PartitionArchiver(db, storage);
      const worker = new RetentionWorker(archiver, storage, undefined, undefined, db);
      await worker.run({ dryRun: true });
      const run = (await db.privileged((tx) => loadRuns(tx))).get('an_events')!;
      expect(run.mode).toBe('dry_run');
    });
  });

  describe('the row-by-row audit prune', () => {
    const MONTH = monthAgo(14);
    const rowsLeft = async () =>
      Number(
        (await owner.query(`SELECT count(*)::int AS n FROM audit_log WHERE org_id = 99`)).rows[0].n,
      );

    async function seed(): Promise<void> {
      await owner.query(`DELETE FROM audit_log WHERE org_id = 99`).catch(() => undefined);
      await owner.query(`SELECT ensure_monthly_partition('audit_log'::regclass, $1::date)`, [
        `${MONTH}-01`,
      ]);
      await owner.query(
        `INSERT INTO audit_log (id, org_id, actor_type, module, record_id, action, at)
         VALUES (nextval('audit_log_id_seq'), 99, 'system', 'm', 1, 'insert', $1::timestamptz)`,
        [`${MONTH}-10T00:00:00Z`],
      );
    }

    it('deletes past the security policy’s days when the audit log has no saved policy', async () => {
      await db.privileged((tx) => deletePolicy(tx, 'audit_log'));
      await seed();
      await new AuthMaintenanceService(db, config(true)).run();
      expect(await rowsLeft()).toBe(0);
    });

    it('steps aside while the archive job really runs, so nothing is deleted before it is archived', async () => {
      await db.privileged((tx) =>
        savePolicy(tx, 'audit_log', { liveDays: 500, archiveDays: null }, null, 5),
      );
      await seed();
      await new AuthMaintenanceService(db, config(true)).run();
      expect(await rowsLeft()).toBe(1);
    });

    it('keeps deleting by the security policy when the saved policy is not carried out yet (dry run)', async () => {
      await seed();
      await new AuthMaintenanceService(db, config(false)).run();
      expect(await rowsLeft()).toBe(0);
      await db.privileged((tx) => deletePolicy(tx, 'audit_log'));
    });

    it('applies a saved security log lifetime to the security log', async () => {
      await owner.query(`DELETE FROM security_events`);
      await owner.query(
        `INSERT INTO security_events (actor_type, event, status, at) VALUES
           ('system', 'old.event', 'info', now() - interval '60 days'),
           ('system', 'new.event', 'info', now() - interval '5 days')`,
      );
      await db.privileged((tx) =>
        savePolicy(tx, 'security_events', { liveDays: 30, archiveDays: null }, null, 5),
      );
      await new AuthMaintenanceService(db, config(true)).run();
      const { rows } = await owner.query(`SELECT event FROM security_events ORDER BY at`);
      expect(rows.map((r) => r.event)).toEqual(['new.event']);
      const run = (await db.privileged((tx) => loadRuns(tx))).get('security_events')!;
      expect(run).toMatchObject({ mode: 'live', outcome: 'ok', deletedRows: 1 });
    });
  });

  describe('an audit log export that reaches into the archive', () => {
    const EXP = monthAgo(8);
    let orgId = 0;
    let userId = 0;

    it('reads archived months back, after the live rows, with the actor’s name and the same filters', async () => {
      orgId = Number(
        (
          await owner.query(
            `INSERT INTO organizations (slug, name) VALUES ('t-export', 'Export Test') RETURNING id`,
          )
        ).rows[0].id,
      );
      userId = Number(
        (
          await owner.query(
            `INSERT INTO users (org_id, email, full_name) VALUES ($1, 'ada@export.test', 'Ada Lovelace') RETURNING id`,
            [orgId],
          )
        ).rows[0].id,
      );
      await owner.query(`SELECT ensure_monthly_partition('audit_log'::regclass, $1::date)`, [
        `${EXP}-01`,
      ]);
      await owner.query(
        `INSERT INTO audit_log (id, org_id, actor_id, actor_type, module, record_id, action, delta, at)
         SELECT nextval('audit_log_id_seq'), $1, $2, 'user', CASE WHEN g = 3 THEN 'deals' ELSE 'contacts' END, g, 'update',
                '{"stage":{"old":"new","new":"won"}}'::jsonb, $3::timestamptz + g * interval '1 hour'
           FROM generate_series(1, 3) g`,
        [orgId, userId, `${EXP}-05T00:00:00Z`],
      );
      await owner.query(
        `INSERT INTO audit_log (id, org_id, actor_id, actor_type, module, record_id, action, at)
         VALUES (nextval('audit_log_id_seq'), $1, $2, 'user', 'contacts', 99, 'insert', now() - interval '1 hour')`,
        [orgId, userId],
      );

      // Keep 100 days live: the closed month eight months back is archived and dropped, this month stays in the table.
      await db.privileged((tx) => deletePolicy(tx, 'audit_log'));
      await db.privileged((tx) =>
        savePolicy(tx, 'audit_log', { liveDays: 100, archiveDays: null }, null, 5),
      );
      await new RetentionWorker(
        new PartitionArchiver(db, storage),
        storage,
        undefined,
        undefined,
        db,
      ).run({ dryRun: false });
      expect(await partitionExists(`audit_log_${EXP.replace('-', '')}`)).toBe(false);

      const runner = new AuditLogExportRunner(
        db,
        new AuditLogRepository(),
        { get: () => 'http://localhost:3000' } as never,
        undefined,
        new ArchiveReader(storage),
      );
      const build = async (filters: Record<string, unknown>): Promise<string[]> => {
        const uuid = (
          await owner.query(
            `INSERT INTO audit_log_exports (org_id, requested_by, filters) VALUES ($1, $2, $3::jsonb) RETURNING uuid`,
            [orgId, userId, JSON.stringify(filters)],
          )
        ).rows[0].uuid as string;
        expect(await runner.run(orgId, uuid)).toBe('done');
        const gz = (
          await owner.query(`SELECT file_gz FROM audit_log_exports WHERE uuid = $1`, [uuid])
        ).rows[0].file_gz as Buffer;
        return gunzipSync(gz)
          .toString('utf8')
          .replace(/^\uFEFF/, '')
          .trim()
          .split('\r\n');
      };

      const all = await build({ from: `${EXP}-01T00:00:00Z`, to: new Date().toISOString() });
      // header, the live row first, then the three archived rows
      expect(all).toHaveLength(5);
      expect(all[1]).toContain(',contacts,insert,99,');
      expect(all.slice(2).every((l) => l.includes('Ada Lovelace') && l.includes(',update,'))).toBe(
        true,
      );
      expect(all[2]).toContain('stage');

      const deals = await build({
        from: `${EXP}-01T00:00:00Z`,
        to: new Date().toISOString(),
        module: 'deals',
      });
      expect(deals).toHaveLength(2);
      expect(deals[1]).toContain(',deals,update,3,');
    });

    it('keeps an export inside the table’s own months exactly as before when no policy is saved', async () => {
      await db.privileged((tx) => deletePolicy(tx, 'audit_log'));
      const runner = new AuditLogExportRunner(
        db,
        new AuditLogRepository(),
        { get: () => 'http://localhost:3000' } as never,
        undefined,
        new ArchiveReader(storage),
      );
      const uuid = (
        await owner.query(
          `INSERT INTO audit_log_exports (org_id, requested_by, filters) VALUES ($1, $2, '{}'::jsonb) RETURNING uuid`,
          [orgId, userId],
        )
      ).rows[0].uuid as string;
      expect(await runner.run(orgId, uuid)).toBe('done');
      const { rows } = await owner.query(
        `SELECT row_count FROM audit_log_exports WHERE uuid = $1`,
        [uuid],
      );
      expect(rows[0].row_count).toBe(1);
    });

    it('lets the saved file lifetime decide when a finished export expires', async () => {
      await db.privileged((tx) =>
        savePolicy(tx, 'audit_log_exports', { liveDays: 2, archiveDays: null }, null, 5),
      );
      const uuid = (
        await owner.query(
          `INSERT INTO audit_log_exports (org_id, requested_by, filters) VALUES ($1, $2, '{}'::jsonb) RETURNING uuid`,
          [orgId, userId],
        )
      ).rows[0].uuid as string;
      const runner = new AuditLogExportRunner(db, new AuditLogRepository(), {
        get: () => 'http://localhost:3000',
      } as never);
      await runner.run(orgId, uuid);
      const { rows } = await owner.query(
        `SELECT extract(epoch FROM (expires_at - completed_at)) / 86400 AS days FROM audit_log_exports WHERE uuid = $1`,
        [uuid],
      );
      expect(Math.round(Number(rows[0].days))).toBe(2);

      // Shortening the lifetime also reaches an export built earlier under the longer one.
      await owner.query(
        `UPDATE audit_log_exports SET completed_at = now() - interval '3 days', expires_at = now() + interval '4 days' WHERE uuid = $1`,
        [uuid],
      );
      const repo = new AuditLogRepository();
      expect(await db.privileged((tx) => repo.expireExports(tx, new Date(), null))).toBe(0);
      expect(await db.privileged((tx) => repo.expireExports(tx, new Date(), 2))).toBe(1);
      await db.privileged((tx) => deletePolicy(tx, 'audit_log_exports'));
    });
  });
});
