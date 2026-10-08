import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClientPair, runMigrations, type DbClientPair } from '@crm/db';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { NotificationsRepository } from '../../../src/modules/notifications/notifications.repository';

/**
 * The live-notification columns of `inbox_notifications` (migrations 20261106090000_notif_live_columns and 20261106090100_notif_collapse_latest_index) against a real Postgres, as the
 * restricted application role: the migration is safe on a table that already has rows, the tenant policy still isolates the new
 * columns, a person has at most one UNREAD row per collapse key, and two messages racing for the same (person, chat) end in one row
 * with the right count.
 */
const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
const NEW_MIGRATION = '20261106090000_notif_live_columns.sql';
// Later migrations that depend on the new columns (an index on subject_uuid) are held back with it, then applied with the rest.
const NEW_MIGRATIONS = [
  NEW_MIGRATION,
  '20261106090100_notif_collapse_latest_index.sql',
  '20261110090100_inbox_notifications_chat_waiting_idx.sql',
];

describe('inbox_notifications live columns', () => {
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
  let tmp: string;
  const conv = '11111111-1111-4111-8111-111111111111';

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

    // Everything BEFORE the new migration first, so a row exists when it runs: the "backfill" case.
    tmp = mkdtempSync(join(tmpdir(), 'notif-migrations-'));
    for (const f of readdirSync(MIGRATIONS)) {
      if (!NEW_MIGRATIONS.includes(f)) cpSync(join(MIGRATIONS, f), join(tmp, f));
    }
    await runMigrations(container.getConnectionUri(), { dir: tmp, log: () => undefined });

    const one = async (sql: string, p: unknown[] = []) =>
      Number((await owner.query(sql, p)).rows[0].id);
    orgA = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('na','A','starter') RETURNING id`,
    );
    orgB = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('nb','B','starter') RETURNING id`,
    );
    userA = await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'a@n.test','A','x') RETURNING id`,
      [orgA],
    );
    userA2 = await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'a2@n.test','A2','x') RETURNING id`,
      [orgA],
    );
    userB = await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'b@n.test','B','x') RETURNING id`,
      [orgB],
    );
    // A row written by the code that existed before this migration.
    await owner.query(
      `INSERT INTO inbox_notifications (org_id, user_id, type, title, dedupe_key) VALUES ($1,$2,'task_due','Task due','task.due:1')`,
      [orgA, userA],
    );

    await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });

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
      poolMax: 6,
    });
    db = new DatabaseService(clients);
  }, 240_000);

  afterAll(async () => {
    await clients?.close();
    await app?.end();
    await owner?.end();
    await container?.stop();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
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

  let nextEvent = 1000;
  /** `eventId` as the outbox would number it: ascending unless a test says otherwise. */
  const collapse = (
    orgId: number,
    userId: number,
    key: string,
    _label: string,
    eventId = ++nextEvent,
  ) =>
    db.txAs({ orgId, userId: null }, (tx) =>
      repo.collapseOrInsert(tx, orgId, {
        userId,
        type: 'new_message',
        link: `/inbox?c=${conv}`,
        dedupeKey: `message.received:${eventId}`,
        eventId,
        collapseKey: key,
        adds: 1,
        subjectKind: 'conversation',
        subjectUuid: conv,
        build: (count) => ({ title: `${count} new`, body: null, data: { count } }),
      }),
    );

  const unreadOf = async (orgId: number, userId: number, key: string) =>
    (
      await owner.query(
        `SELECT id, event_count, title FROM inbox_notifications WHERE org_id = $1 AND user_id = $2 AND collapse_key = $3 AND read_at IS NULL`,
        [orgId, userId, key],
      )
    ).rows;

  describe('the migration on a table that already had rows', () => {
    it('keeps the old row and gives the new columns their neutral values', async () => {
      const row = (
        await owner.query(
          `SELECT collapse_key, event_count, subject_kind, subject_uuid, read_at, title FROM inbox_notifications WHERE dedupe_key = 'task.due:1'`,
        )
      ).rows[0];
      expect(row).toMatchObject({
        collapse_key: null,
        event_count: 1,
        subject_kind: null,
        subject_uuid: null,
        read_at: null,
        title: 'Task due',
      });
    });

    it('is recorded as applied, and the table keeps its forced tenant policy', async () => {
      const applied = await owner.query(`SELECT 1 FROM _migrations WHERE id = $1`, [
        NEW_MIGRATION.replace(/\.sql$/, ''),
      ]);
      expect(applied.rows).toHaveLength(1);
      const res = await owner.query(
        `SELECT relrowsecurity, relforcerowsecurity,
                (SELECT count(*) FROM pg_policies p WHERE p.tablename = 'inbox_notifications' AND p.policyname = 'tenant_isolation')::int AS policies
           FROM pg_class WHERE relname = 'inbox_notifications' AND relkind = 'r'`,
      );
      expect(res.rows[0]).toMatchObject({
        relrowsecurity: true,
        relforcerowsecurity: true,
        policies: 1,
      });
    });

    it('refuses an event_count below one', async () => {
      await expect(
        owner.query(
          `INSERT INTO inbox_notifications (org_id, user_id, type, title, event_count) VALUES ($1,$2,'x','x',0)`,
          [orgA, userA],
        ),
      ).rejects.toThrow(/chk_inbox_notifications_event_count/);
    });
  });

  describe('isolation of the rows', () => {
    it('a workspace sees only its own rows (new columns included), and cannot write into another', async () => {
      await collapse(orgA, userA, 'msg:iso-a', 'iso-a');
      await collapse(orgB, userB, 'msg:iso-b', 'iso-b');

      const mine = await asOrg(
        orgA,
        async () =>
          (await app.query(`SELECT collapse_key, subject_uuid FROM inbox_notifications`)).rows,
      );
      expect(mine.map((r) => r.collapse_key)).toContain('msg:iso-a');
      expect(mine.map((r) => r.collapse_key)).not.toContain('msg:iso-b');

      const byKey = await asOrg(
        orgA,
        async () =>
          (
            await app.query(
              `SELECT 1 FROM inbox_notifications WHERE org_id = $1 AND collapse_key = 'msg:iso-b'`,
              [orgB],
            )
          ).rows,
      );
      expect(byKey).toHaveLength(0);

      await app.query('BEGIN');
      try {
        await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgA)]);
        await expect(
          app.query(
            `INSERT INTO inbox_notifications (org_id, user_id, type, title, collapse_key) VALUES ($1,$2,'x','x','msg:smuggled')`,
            [orgB, userB],
          ),
        ).rejects.toThrow(/row-level security/);
      } finally {
        await app.query('ROLLBACK');
      }
    });

    it('markSubjectRead never touches another person or another workspace', async () => {
      await collapse(orgA, userA, 'msg:subj', 'subj-1');
      await collapse(orgA, userA2, 'msg:subj', 'subj-2');
      await collapse(orgB, userB, 'msg:subj', 'subj-3');

      const changed = await db.txAs({ orgId: orgA, userId: userA }, (tx) =>
        repo.markSubjectRead(tx, orgA, userA, { kind: 'conversation', uuid: conv }),
      );
      expect(changed.length).toBeGreaterThan(0);
      expect(await unreadOf(orgA, userA, 'msg:subj')).toHaveLength(0);
      expect(await unreadOf(orgA, userA2, 'msg:subj')).toHaveLength(1);
      expect(await unreadOf(orgB, userB, 'msg:subj')).toHaveLength(1);
    });
  });

  describe('collapsing', () => {
    it('keeps one unread row per (person, key), and counts the messages', async () => {
      for (let i = 1; i <= 3; i += 1) await collapse(orgA, userA, 'msg:count', `count-${i}`);
      const rows = await unreadOf(orgA, userA, 'msg:count');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ event_count: 3, title: '3 new' });
    });

    it('a redelivery of the same event writes nothing and does not lose the row', async () => {
      await collapse(orgA, userA, 'msg:redeliver', 'redeliver-1', 5001);
      const again = await collapse(orgA, userA, 'msg:redeliver', 'redeliver-1', 5001);
      expect(again).toBeNull();
      const rows = await unreadOf(orgA, userA, 'msg:redeliver');
      expect(rows).toHaveLength(1);
      expect(rows[0].event_count).toBe(1);
    });

    it('a re-claimed batch (every event delivered again, oldest first) counts each message once', async () => {
      for (const id of [5101, 5102, 5103]) await collapse(orgA, userA, 'msg:batch', 'b', id);
      for (const id of [5101, 5102, 5103]) {
        expect(await collapse(orgA, userA, 'msg:batch', 'b', id)).toBeNull();
      }
      const rows = await unreadOf(orgA, userA, 'msg:batch');
      expect(rows).toHaveLength(1);
      expect(rows[0].event_count).toBe(3);
    });

    it('an old event redelivered after the person already read the row does not raise a new alert', async () => {
      await collapse(orgA, userA, 'msg:late', 'l', 5201);
      await owner.query(
        `UPDATE inbox_notifications SET read_at = now() WHERE org_id = $1 AND user_id = $2 AND collapse_key = 'msg:late'`,
        [orgA, userA],
      );
      expect(await collapse(orgA, userA, 'msg:late', 'l', 5201)).toBeNull();
      expect(await unreadOf(orgA, userA, 'msg:late')).toHaveLength(0);
      // A genuinely new event still starts a fresh row.
      expect(await collapse(orgA, userA, 'msg:late', 'l', 5202)).not.toBeNull();
    });

    it('a read row starts a fresh count, and the old one is kept as history', async () => {
      await collapse(orgA, userA, 'msg:fresh', 'fresh-1');
      await collapse(orgA, userA, 'msg:fresh', 'fresh-2');
      await owner.query(
        `UPDATE inbox_notifications SET read_at = now() WHERE org_id = $1 AND user_id = $2 AND collapse_key = 'msg:fresh'`,
        [orgA, userA],
      );
      const next = await collapse(orgA, userA, 'msg:fresh', 'fresh-3');
      expect(next?.collapsed).toBe(false);
      const unread = await unreadOf(orgA, userA, 'msg:fresh');
      expect(unread).toHaveLength(1);
      expect(unread[0].event_count).toBe(1);
      const all = await owner.query(
        `SELECT count(*)::int AS n FROM inbox_notifications WHERE org_id = $1 AND user_id = $2 AND collapse_key = 'msg:fresh'`,
        [orgA, userA],
      );
      expect(all.rows[0].n).toBe(2);
    });

    it('messages racing for the same person and chat end in one unread row whose count is the messages it accepted', async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => collapse(orgA, userA, 'msg:race', `race-${i}`)),
      );
      // The lock lets them in one at a time in whatever order it likes; an event below the newest row's id counts as a redelivery
      // (the accepted trade-off of concurrent workers: a count can come out short by a message, never doubled or lost as a row).
      const accepted = results.filter((r) => r !== null).length;
      expect(accepted).toBeGreaterThanOrEqual(1);
      const rows = await unreadOf(orgA, userA, 'msg:race');
      expect(rows).toHaveLength(1);
      expect(rows[0].event_count).toBe(accepted);
    });

    it('the database itself refuses a second unread row for one key (the backstop under the lock)', async () => {
      await owner.query(
        `INSERT INTO inbox_notifications (org_id, user_id, type, title, collapse_key) VALUES ($1,$2,'new_message','x','msg:unique')`,
        [orgA, userA],
      );
      await expect(
        owner.query(
          `INSERT INTO inbox_notifications (org_id, user_id, type, title, collapse_key) VALUES ($1,$2,'new_message','x','msg:unique')`,
          [orgA, userA],
        ),
      ).rejects.toThrow(/uq_inbox_notifications_collapse/);
    });
  });
});
