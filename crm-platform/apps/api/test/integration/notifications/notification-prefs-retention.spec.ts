import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClientPair, runMigrations, type DbClientPair } from '@crm/db';
import { resolve } from 'node:path';
import type { RetentionConfig } from '../../../src/config/domains/notifications.env';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { NotificationRetentionService } from '../../../src/modules/notifications/notification-retention.service';
import { NotificationsRepository } from '../../../src/modules/notifications/notifications.repository';

/**
 * Per-person notification preferences and the retention job (BL-096 phase 2, migration 20261107090000_notif_user_prefs_retention)
 * against a real Postgres, as the restricted application role: the preferences table isolates tenants, a partial update keeps what it
 * does not name and is idempotent, the stored choice decides whether a row exists (person, then owner, then default), and the daily
 * prune deletes by age in bounded batches without touching recent rows, even with a second worker competing.
 */
const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
const DAY = 86_400_000;

describe('notification preferences and retention', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let clients: DbClientPair;
  let db: DatabaseService;
  const repo = new NotificationsRepository();
  let orgA: number;
  let orgB: number;
  let userA: number;
  let userA2: number;
  let userB: number;

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
    await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });

    const one = async (sql: string, p: unknown[] = []) =>
      Number((await owner.query(sql, p)).rows[0].id);
    orgA = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('pa','A','starter') RETURNING id`,
    );
    orgB = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('pb','B','starter') RETURNING id`,
    );
    userA = await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'a@p.test','A','x') RETURNING id`,
      [orgA],
    );
    userA2 = await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'a2@p.test','A2','x') RETURNING id`,
      [orgA],
    );
    userB = await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'b@p.test','B','x') RETURNING id`,
      [orgB],
    );

    app = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: 'crm',
      user: 'crm_app_user',
      password: 'test',
    });
    await app.connect();
    clients = createDbClientPair({
      url: `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`,
      poolMax: 8,
    });
    db = new DatabaseService(clients);
  }, 240_000);

  afterAll(async () => {
    await clients?.close();
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  async function asOrg<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgId)]);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  }

  const apply = (
    orgId: number,
    userId: number,
    type: string,
    patch: Parameters<NotificationsRepository['applyUserPref']>[4],
  ) => db.txAs({ orgId, userId }, (tx) => repo.applyUserPref(tx, orgId, userId, type, patch));
  const stored = (orgId: number, userId: number) =>
    db.txAs({ orgId, userId }, (tx) => repo.userPrefsOf(tx, orgId, userId));

  describe('the preferences table', () => {
    it('has row level security enabled AND forced, with a tenant policy', async () => {
      const r = await owner.query(
        `SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = 'notification_user_prefs'`,
      );
      expect(r.rows[0]).toEqual({ on: true, forced: true });
      const p = await owner.query(
        `SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'notification_user_prefs' AND policyname = 'tenant_isolation'`,
      );
      expect(p.rows[0].n).toBe(1);
    });

    it('isolates two workspaces: a person is never shown, or able to write, another workspace row', async () => {
      await apply(orgA, userA, 'new_message', { toast: false });
      await apply(orgB, userB, 'new_message', { sound: false });

      expect((await stored(orgA, userA)).get('new_message')).toEqual({
        bell: null,
        toast: false,
        sound: null,
      });
      expect((await stored(orgB, userB)).get('new_message')).toEqual({
        bell: null,
        toast: null,
        sound: false,
      });
      // The other workspace's person is invisible from here, even asked for by id.
      expect((await stored(orgA, userB)).size).toBe(0);
      expect(
        await asOrg(
          orgA,
          async () => (await app.query(`SELECT org_id FROM notification_user_prefs`)).rows,
        ),
      ).toEqual([{ org_id: orgA }]);
      // No tenant set: nothing is visible at all.
      expect(
        (await app.query(`SELECT count(*)::int AS n FROM notification_user_prefs`)).rows[0].n,
      ).toBe(0);
      // A row for the other workspace cannot be written from this one (WITH CHECK), and a composite FK stops a foreign user.
      await expect(
        asOrg(orgA, () =>
          app.query(
            `INSERT INTO notification_user_prefs (org_id, user_id, type, bell) VALUES ($1, $2, 'mention', true)`,
            [orgB, userB],
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
      await expect(
        asOrg(orgA, () =>
          app.query(
            `INSERT INTO notification_user_prefs (org_id, user_id, type, bell) VALUES ($1, $2, 'mention', true)`,
            [orgA, userB],
          ),
        ),
      ).rejects.toThrow(/foreign key/i);
    });

    it('a partial update keeps what it does not name; null goes back to inheriting; an empty row disappears', async () => {
      await apply(orgA, userA2, 'mention', { toast: false });
      await apply(orgA, userA2, 'mention', { sound: false });
      expect((await stored(orgA, userA2)).get('mention')).toEqual({
        bell: null,
        toast: false,
        sound: false,
      });
      await apply(orgA, userA2, 'mention', { toast: null });
      expect((await stored(orgA, userA2)).get('mention')).toEqual({
        bell: null,
        toast: null,
        sound: false,
      });
      await apply(orgA, userA2, 'mention', { sound: null });
      expect((await stored(orgA, userA2)).has('mention')).toBe(false);
      expect(
        (
          await owner.query(
            `SELECT count(*)::int AS n FROM notification_user_prefs WHERE user_id = $1`,
            [userA2],
          )
        ).rows[0].n,
      ).toBe(0);
    });

    it('applying the same update twice changes nothing, not even the row version', async () => {
      await apply(orgA, userA2, 'task_due', { bell: false, toast: true });
      const v1 = (
        await owner.query(
          `SELECT row_version, updated_at FROM notification_user_prefs WHERE user_id = $1 AND type = 'task_due'`,
          [userA2],
        )
      ).rows[0];
      await apply(orgA, userA2, 'task_due', { bell: false, toast: true });
      await apply(orgA, userA2, 'task_due', { bell: false });
      const v2 = (
        await owner.query(
          `SELECT row_version, updated_at FROM notification_user_prefs WHERE user_id = $1 AND type = 'task_due'`,
          [userA2],
        )
      ).rows[0];
      expect(v2.row_version).toBe(v1.row_version);
      expect(v2.updated_at).toEqual(v1.updated_at);
      await apply(orgA, userA2, 'task_due', { bell: null, toast: null });
      expect((await stored(orgA, userA2)).has('task_due')).toBe(false);
    });

    it('rejects a type longer than 64 characters at the database', async () => {
      await expect(apply(orgA, userA, 'x'.repeat(65), { bell: true })).rejects.toThrow();
    });
  });

  describe('a stored choice decides whether a row exists (person, then owner, then default)', () => {
    const write = (
      orgId: number,
      userId: number,
      type: string,
      key: string,
      extra: Record<string, unknown> = {},
    ) =>
      db.txAs({ orgId, userId: null }, (tx) =>
        repo.insertReturning(tx, orgId, {
          userId,
          type,
          title: 't',
          body: null,
          link: null,
          data: null,
          dedupeKey: key,
          ...extra,
        }),
      );

    it('writes the row with the catalogue toast and sound when the person never chose', async () => {
      const row = await write(orgA, userA, 'new_chat', 'dflt-1');
      expect(row).toMatchObject({ toast: true, sound: true });
      const quiet = await write(orgA, userA, 'task_completed', 'dflt-2');
      expect(quiet).toMatchObject({ toast: false, sound: false });
    });

    it("the person's bell off means no row, and the push flags carry their toast and sound choice", async () => {
      await apply(orgA, userA, 'task_assigned', { bell: false });
      expect(await write(orgA, userA, 'task_assigned', 'bell-off-1')).toBeNull();
      await apply(orgA, userA, 'task_assigned', { bell: true, toast: false, sound: true });
      const row = await write(orgA, userA, 'task_assigned', 'bell-on-1');
      expect(row).toMatchObject({ toast: false, sound: true });
    });

    it("the owner's in-app toggle is the default for the bell, and the person's own choice beats it", async () => {
      await owner.query(
        `UPDATE organizations SET settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{notificationPrefs}', $2::jsonb) WHERE id = $1`,
        [
          orgA,
          JSON.stringify({
            events: { mention_in_inbox: { inapp: false, email: false, slack: false } },
            categories: {},
          }),
        ],
      );
      // Owner off, person silent: no row (read from the settings by the writer itself).
      expect(await write(orgA, userA2, 'mention', 'ws-off-1')).toBeNull();
      // The same type for a type the toggle does not govern is unaffected.
      expect(await write(orgA, userA2, 'task_due', 'ws-off-2')).not.toBeNull();
      // The person turned it on for themselves: theirs wins.
      await apply(orgA, userA2, 'mention', { bell: true });
      expect(await write(orgA, userA2, 'mention', 'ws-off-3')).not.toBeNull();
      // Back to inheriting: the owner's off applies again.
      await apply(orgA, userA2, 'mention', { bell: null });
      expect(await write(orgA, userA2, 'mention', 'ws-off-4')).toBeNull();
      await owner.query(
        `UPDATE organizations SET settings = settings - 'notificationPrefs' WHERE id = $1`,
        [orgA],
      );
    });

    it('a collapsing writer with the bell off leaves the existing unread row alone', async () => {
      const collapse = (eventId: number) =>
        db.txAs({ orgId: orgA, userId: null }, (tx) =>
          repo.collapseOrInsert(tx, orgA, {
            userId: userA,
            type: 'new_message',
            link: '/inbox',
            dedupeKey: `message.received:${eventId}`,
            eventId,
            collapseKey: 'msg:prefs',
            adds: 1,
            build: (n) => ({ title: `${n}`, body: null, data: { count: n } }),
          }),
        );
      expect(await collapse(5001)).not.toBeNull();
      await apply(orgA, userA, 'new_message', { bell: false });
      expect(await collapse(5002)).toBeNull();
      const rows = (
        await owner.query(
          `SELECT event_count FROM inbox_notifications WHERE org_id = $1 AND user_id = $2 AND collapse_key = 'msg:prefs' AND read_at IS NULL`,
          [orgA, userA],
        )
      ).rows;
      expect(rows).toEqual([{ event_count: 1 }]);
      await apply(orgA, userA, 'new_message', { bell: null });
    });
  });

  describe('retention', () => {
    const NOW = new Date('2027-03-01T03:30:00Z');
    const retention = () => new NotificationRetentionService(db);
    const config = (over: Partial<RetentionConfig> = {}): RetentionConfig => ({
      enabled: true,
      readDays: 90,
      unreadDays: 180,
      batchSize: 3000,
      maxBatches: 100,
      ...over,
    });
    const count = async (where: string) =>
      Number(
        (await owner.query(`SELECT count(*)::int AS n FROM inbox_notifications WHERE ${where}`))
          .rows[0].n,
      );

    async function seed(rows: number): Promise<void> {
      await owner.query(`DELETE FROM inbox_notifications`);
      // Row g is g % 400 days old at NOW; even rows were read; the two workspaces get alternate rows.
      await owner.query(
        `INSERT INTO inbox_notifications (org_id, user_id, type, title, dedupe_key, created_at, read_at)
         SELECT CASE WHEN g % 2 = 0 THEN $1::bigint ELSE $2::bigint END,
                CASE WHEN g % 2 = 0 THEN $3::bigint ELSE $4::bigint END,
                'task_due', 'old', 'seed-' || g,
                $5::timestamptz - (g % 400) * interval '1 day' - interval '1 hour',
                CASE WHEN g % 4 < 2 THEN $5::timestamptz - (g % 400) * interval '1 day' ELSE NULL END
         FROM generate_series(1, $6::int) g`,
        [orgA, orgB, userA, userB, NOW.toISOString(), rows],
      );
    }

    it('deletes read rows older than 90 days and unread older than 180, never the last 90 days, on a large backlog', async () => {
      await seed(30_000);
      const recentBefore = await count(
        `created_at >= '${new Date(NOW.getTime() - 90 * DAY).toISOString()}'`,
      );
      const expectedRead = await count(
        `read_at IS NOT NULL AND created_at < '${new Date(NOW.getTime() - 90 * DAY).toISOString()}'`,
      );
      const expectedUnread = await count(
        `read_at IS NULL AND created_at < '${new Date(NOW.getTime() - 180 * DAY).toISOString()}'`,
      );
      expect(expectedRead).toBeGreaterThan(3000);
      expect(expectedUnread).toBeGreaterThan(3000);

      const res = await retention().runOnce(NOW, config());
      expect(res).toMatchObject({
        skipped: false,
        readDeleted: expectedRead,
        unreadDeleted: expectedUnread,
        moreToDo: false,
      });
      // Several bounded batches, not one giant delete.
      expect(res.batches).toBeGreaterThan(4);

      expect(
        await count(`created_at >= '${new Date(NOW.getTime() - 90 * DAY).toISOString()}'`),
      ).toBe(recentBefore);
      expect(await count(`read_at IS NOT NULL AND created_at < '${res.readCutoff}'`)).toBe(0);
      expect(await count(`read_at IS NULL AND created_at < '${res.unreadCutoff}'`)).toBe(0);
      // Unread rows between 90 and 180 days are kept: someone may still want them.
      expect(
        await count(
          `read_at IS NULL AND created_at < '${res.readCutoff}' AND created_at >= '${res.unreadCutoff}'`,
        ),
      ).toBeGreaterThan(0);
      // Both workspaces were pruned (the job spans tenants).
      expect(await count(`org_id = ${orgA}`)).toBeGreaterThan(0);
      expect(await count(`org_id = ${orgB}`)).toBeGreaterThan(0);
    }, 120_000);

    it('a second run on the same clock finds nothing to do', async () => {
      const res = await retention().runOnce(NOW, config());
      expect(res).toMatchObject({ readDeleted: 0, unreadDeleted: 0, skipped: false });
    });

    it('stops at the per-run batch limit and reports that more is left; the next run continues', async () => {
      await seed(12_000);
      const first = await retention().runOnce(NOW, config({ batchSize: 100, maxBatches: 3 }));
      expect(first.moreToDo).toBe(true);
      expect(first.readDeleted).toBe(300);
      expect(first.unreadDeleted).toBe(300);
      const rest = await retention().runOnce(NOW, config());
      expect(rest.moreToDo).toBe(false);
      expect(await count(`read_at IS NOT NULL AND created_at < '${rest.readCutoff}'`)).toBe(0);
      expect(await count(`read_at IS NULL AND created_at < '${rest.unreadCutoff}'`)).toBe(0);
    }, 120_000);

    it('leaves everything alone while another worker holds the lock, and two workers together delete each row once', async () => {
      await seed(9_000);
      const before = await count('true');
      const lockHolder = new Client({ connectionString: container.getConnectionUri() });
      await lockHolder.connect();
      try {
        await lockHolder.query('BEGIN');
        await lockHolder.query(
          `SELECT pg_advisory_xact_lock(hashtextextended('notification-retention', 0))`,
        );
        const skipped = await retention().runOnce(NOW, config());
        expect(skipped.skipped).toBe(true);
        expect(await count('true')).toBe(before);
        await lockHolder.query('ROLLBACK');
      } finally {
        await lockHolder.end();
      }

      const expected = await count(
        `(read_at IS NOT NULL AND created_at < '${new Date(NOW.getTime() - 90 * DAY).toISOString()}') OR (read_at IS NULL AND created_at < '${new Date(NOW.getTime() - 180 * DAY).toISOString()}')`,
      );
      const [a, b] = await Promise.all([
        retention().runOnce(NOW, config({ batchSize: 500 })),
        retention().runOnce(NOW, config({ batchSize: 500 })),
      ]);
      // A worker that lost the lock at some batch simply stops; together they leave nothing behind after a follow-up pass.
      await retention().runOnce(NOW, config());
      expect(await count('true')).toBe(before - expected);
      expect(a.readDeleted + a.unreadDeleted + b.readDeleted + b.unreadDeleted).toBeLessThanOrEqual(
        expected,
      );
    }, 120_000);

    it('never prunes below the configured floor: an unread age lower than the read age is raised to it', async () => {
      const { retentionConfig } = await import('../../../src/config/domains/notifications.env');
      expect(
        retentionConfig({
          NOTIFY_RETENTION_READ_DAYS: '120',
          NOTIFY_RETENTION_UNREAD_DAYS: '60',
        } as never),
      ).toMatchObject({ readDays: 120, unreadDays: 120 });
      expect(() => retentionConfig({ NOTIFY_RETENTION_READ_DAYS: '10' } as never)).toThrow();
      expect(retentionConfig({} as never)).toMatchObject({
        enabled: true,
        readDays: 90,
        unreadDays: 180,
        batchSize: 5000,
        maxBatches: 200,
      });
    });
  });
});
