import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';
import { conversationVisible, type ConversationViewer } from '../../../src/realtime';
import {
  visibleToJoinedSql,
  visibleToSql,
} from '../../../src/modules/team-inbox-conversations/visibility-sql';

/**
 * The storage the inbox adds (migrations 20261015090000 .. 090200) against a real Postgres, and the one thing a mock cannot prove: the SQL
 * visibility condition of the list returns exactly the conversations the single-record rule (`conversationVisible`, the rule the thread and
 * the socket use) lets the same person open. Isolation is asserted as the restricted application role (a superuser bypasses every policy).
 */
describe('team inbox storage: isolation, constraints and the visibility rule', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let userA: number;
  let userA2: number;
  let userB: number;
  let chanA: number;
  let convA: number;

  const one = async (q: string, p: unknown[] = []) =>
    (await owner.query(q, p)).rows[0] as Record<string, unknown>;
  const fails = async (q: string, p: unknown[] = []) => {
    try {
      await owner.query(q, p);
    } catch (e) {
      return e as { code?: string; constraint?: string; message: string };
    }
    return null;
  };
  const asTenant = async <T>(org: number, fn: () => Promise<T>) => {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(org)]);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  };

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
    const url = new URL(container.getConnectionUri());
    url.username = 'crm_app_user';
    url.password = 'test';
    app = new Client({ connectionString: url.toString() });
    await app.connect();

    const org = async (slug: string) =>
      Number(
        (
          await one(
            `INSERT INTO organizations (slug, name, plan) VALUES ($1,$1,'starter') RETURNING id`,
            [slug],
          )
        ).id,
      );
    orgA = await org('tib-a');
    orgB = await org('tib-b');
    const user = async (o: number, email: string) =>
      Number(
        (
          await one(
            `INSERT INTO users (org_id, email, full_name) VALUES ($1,$2,'u') RETURNING id`,
            [o, email],
          )
        ).id,
      );
    userA = await user(orgA, 'a@a.test');
    userA2 = await user(orgA, 'a2@a.test');
    userB = await user(orgB, 'b@b.test');
    chanA = Number(
      (
        await one(
          `INSERT INTO channels (org_id, kind, name) VALUES ($1,'simulator','c') RETURNING id`,
          [orgA],
        )
      ).id,
    );
    convA = Number(
      (
        await one(
          `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1,$2,'1','t') RETURNING id`,
          [orgA, chanA],
        )
      ).id,
    );
  }, 240_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  describe('conversation_media_uploads', () => {
    const insert = (org: number, user: number | null) =>
      owner.query(
        `INSERT INTO conversation_media_uploads (org_id, user_id, media_key, kind, mime, size_bytes, name, sha256, expires_at)
         VALUES ($1,$2,'chat/1/2026/10/a.png','image','image/png',3,'a.png','00', now() + interval '1 day') RETURNING id`,
        [org, user],
      );

    it('forces row-level security with a policy, so even the table owner is held to it', async () => {
      const r = await one(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'conversation_media_uploads'`,
      );
      expect(r).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      const p = await one(
        `SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'conversation_media_uploads' AND policyname = 'tenant_isolation'`,
      );
      expect(p.n).toBe(1);
    });

    it("one workspace never sees, updates or deletes another workspace's upload", async () => {
      await insert(orgA, userA);
      const seenByB = await asTenant(
        orgB,
        async () => (await app.query(`SELECT * FROM conversation_media_uploads`)).rowCount,
      );
      expect(seenByB).toBe(0);
      const seenByA = await asTenant(
        orgA,
        async () => (await app.query(`SELECT * FROM conversation_media_uploads`)).rowCount,
      );
      expect(seenByA).toBeGreaterThan(0);
      const updated = await asTenant(
        orgB,
        async () => (await app.query(`UPDATE conversation_media_uploads SET name = 'x'`)).rowCount,
      );
      expect(updated).toBe(0);
      const deleted = await asTenant(
        orgB,
        async () => (await app.query(`DELETE FROM conversation_media_uploads`)).rowCount,
      );
      expect(deleted).toBe(0);
    });

    it('a workspace cannot write a row into another workspace (WITH CHECK), as the application role', async () => {
      let code: string | undefined;
      await app.query('BEGIN');
      try {
        await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgB)]);
        await app.query(
          `INSERT INTO conversation_media_uploads (org_id, media_key, kind, mime, size_bytes, name, sha256, expires_at)
           VALUES ($1,'k','image','image/png',1,'n','s', now())`,
          [orgA],
        );
      } catch (e) {
        code = (e as { code?: string }).code;
      } finally {
        await app.query('ROLLBACK');
      }
      expect(code).toBe('42501');
    });

    it("the uploader is a composite foreign key: another workspace's user cannot be named", async () => {
      const err = await fails(
        `INSERT INTO conversation_media_uploads (org_id, user_id, media_key, kind, mime, size_bytes, name, sha256, expires_at)
         VALUES ($1,$2,'k','image','image/png',1,'n','s', now())`,
        [orgA, userB],
      );
      expect(err?.code).toBe('23503');
    });

    it('constrains the kind and the size, and a claim names the send that made it (both set or both null)', async () => {
      const bad = (e: string) =>
        fails(
          `INSERT INTO conversation_media_uploads (org_id, media_key, kind, mime, size_bytes, name, sha256, expires_at)
           VALUES ($1,'k',$2,'x/y',$3,'n','s', now())`,
          [orgA, ...e.split(',')],
        );
      expect((await bad('sticker,1'))?.code).toBe('23514');
      expect((await bad('image,-1'))?.code).toBe('23514');
      expect(
        (
          await fails(
            `INSERT INTO conversation_media_uploads (org_id, media_key, kind, mime, size_bytes, name, sha256, expires_at, used_at)
         VALUES ($1,'k','image','x/y',1,'n','s', now(), now())`,
            [orgA],
          )
        )?.code,
      ).toBe('23514');
      expect(
        await fails(
          `INSERT INTO conversation_media_uploads (org_id, media_key, kind, mime, size_bytes, name, sha256, expires_at, used_at, used_by_client_message_id)
         VALUES ($1,'k','image','x/y',1,'n','s', now(), now(), gen_random_uuid())`,
          [orgA],
        ),
      ).toBeNull();
    });

    it("deleting the uploader keeps the reference (the file is still the workspace's) and deleting the workspace removes it", async () => {
      const u = Number(
        (
          await one(
            `INSERT INTO users (org_id, email, full_name) VALUES ($1,'gone@a.test','g') RETURNING id`,
            [orgA],
          )
        ).id,
      );
      const id = Number((await insert(orgA, u)).rows[0].id);
      await owner.query(`DELETE FROM users WHERE org_id = $1 AND id = $2`, [orgA, u]);
      expect(
        (await one(`SELECT user_id FROM conversation_media_uploads WHERE id = $1`, [id])).user_id,
      ).toBeNull();
    });
  });

  describe('conversation_events', () => {
    it('gives every event its own uuid, and only the five actor kinds a timeline can draw', async () => {
      const a = await one(
        `INSERT INTO conversation_events (org_id, conversation_id, actor_type, type) VALUES ($1,$2,'user','assigned') RETURNING uuid`,
        [orgA, convA],
      );
      const b = await one(
        `INSERT INTO conversation_events (org_id, conversation_id, actor_type, type) VALUES ($1,$2,'ai','ai_handoff') RETURNING uuid`,
        [orgA, convA],
      );
      expect(a.uuid).not.toBe(b.uuid);
      for (const kind of ['system', 'bot', 'flow']) {
        expect(
          await fails(
            `INSERT INTO conversation_events (org_id, conversation_id, actor_type, type) VALUES ($1,$2,$3,'x')`,
            [orgA, convA, kind],
          ),
        ).toBeNull();
      }
      const err = await fails(
        `INSERT INTO conversation_events (org_id, conversation_id, actor_type, type) VALUES ($1,$2,'human','x')`,
        [orgA, convA],
      );
      expect(err?.code).toBe('23514');
    });

    it('is isolated by workspace, including in the monthly partitions', async () => {
      const seenByB = await asTenant(
        orgB,
        async () => (await app.query(`SELECT * FROM conversation_events`)).rowCount,
      );
      expect(seenByB).toBe(0);
      const seenByA = await asTenant(
        orgA,
        async () => (await app.query(`SELECT * FROM conversation_events`)).rowCount,
      );
      expect(seenByA).toBeGreaterThan(0);
    });

    it('has the timeline index on the parent and on its partitions', async () => {
      const r = await one(
        `SELECT count(*)::int AS n FROM pg_indexes
         WHERE tablename LIKE 'conversation_events%' AND indexdef LIKE '%(org_id, conversation_id, created_at DESC, id DESC)'`,
      );
      expect(r.n).toBeGreaterThan(1);
    });
  });

  describe('conversation_notes', () => {
    const note = (mentions: string) =>
      fails(
        `INSERT INTO conversation_notes (org_id, conversation_id, body, mentions) VALUES ($1,$2,'n', $3::jsonb)`,
        [orgA, convA, mentions],
      );

    it('mentions default to an empty list and must always be an array', async () => {
      const r = await one(
        `INSERT INTO conversation_notes (org_id, conversation_id, body) VALUES ($1,$2,'n') RETURNING mentions`,
        [orgA, convA],
      );
      expect(r.mentions).toEqual([]);
      expect(await note('["6f1c7a52-3d7a-4a53-9b6e-2f0d2c1a9e10"]')).toBeNull();
      expect((await note('{"user_id":1}'))?.code).toBe('23514');
      expect((await note('"sara"'))?.code).toBe('23514');
      // JSON null is not an array either; a missing value is refused outright.
      expect((await note('null'))?.code).toBe('23514');
      expect(
        (
          await fails(
            `INSERT INTO conversation_notes (org_id, conversation_id, body, mentions) VALUES ($1,$2,'n', NULL)`,
            [orgA, convA],
          )
        )?.code,
      ).toBe('23502');
    });

    it('the body is 1 to 8000 characters', async () => {
      const body = (b: string) =>
        fails(`INSERT INTO conversation_notes (org_id, conversation_id, body) VALUES ($1,$2,$3)`, [
          orgA,
          convA,
          b,
        ]);
      expect((await body(''))?.code).toBe('23514');
      expect((await body('x'.repeat(8001)))?.code).toBe('23514');
      expect(await body('x'.repeat(8000))).toBeNull();
    });

    it('a note belongs to a conversation of its own workspace, and is removed with the conversation', async () => {
      const err = await fails(
        `INSERT INTO conversation_notes (org_id, conversation_id, body) VALUES ($1,$2,'n')`,
        [orgB, convA],
      );
      expect(err?.code).toBe('23503');
      const c = Number(
        (
          await one(
            `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1,$2,'9','t') RETURNING id`,
            [orgA, chanA],
          )
        ).id,
      );
      await owner.query(
        `INSERT INTO conversation_notes (org_id, conversation_id, body) VALUES ($1,$2,'n')`,
        [orgA, c],
      );
      await owner.query(`DELETE FROM conversations WHERE org_id = $1 AND id = $2`, [orgA, c]);
      expect(
        (
          await one(
            `SELECT count(*)::int AS n FROM conversation_notes WHERE conversation_id = $1 AND org_id = $2`,
            [c, orgA],
          )
        ).n,
      ).toBe(0);
    });
  });

  describe('the search indexes', () => {
    it('the four trigram indexes exist, so an ILIKE search does not scan the workspace', async () => {
      const r = await owner.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'conversations' AND indexname LIKE 'idx_conversations_%_trgm' ORDER BY 1`,
      );
      expect(r.rows.map((x) => x.indexname)).toEqual([
        'idx_conversations_peer_key_trgm',
        'idx_conversations_peer_name_trgm',
        'idx_conversations_preview_trgm',
        'idx_conversations_title_trgm',
      ]);
    });
  });

  describe('visibility: the list condition and the single-record rule give the same answer', () => {
    const SHAPES: Array<{ user: 'A' | 'A2' | null; team: 1 | 2 | null }> = [
      { user: null, team: null },
      { user: 'A', team: null },
      { user: 'A2', team: null },
      { user: null, team: 1 },
      { user: null, team: 2 },
      { user: 'A', team: 2 },
      { user: 'A2', team: 1 },
      { user: 'A2', team: 2 },
    ];
    const dialect = new PgDialect();

    it('agrees for every scope, every viewer and every way a conversation can be assigned', async () => {
      const team1 = Number(
        (await one(`INSERT INTO teams (org_id, name) VALUES ($1,'t1') RETURNING id`, [orgA])).id,
      );
      const team2 = Number(
        (await one(`INSERT INTO teams (org_id, name) VALUES ($1,'t2') RETURNING id`, [orgA])).id,
      );
      const users = { A: userA, A2: userA2 };
      const teams = { 1: team1, 2: team2 };
      const rows: Array<{
        id: number;
        assigneeUserId: number | null;
        assigneeTeamId: number | null;
        channelOwnerUserId: number | null;
      }> = [];
      // The channel a conversation is on decides the personal-mailbox part of the rule (TW-MAIL-035): a shared channel, a personal
      // mailbox of each user, and an email channel whose mailbox row is gone (owner -1).
      const emailChannel = async (
        name: string,
        mailbox: { scope: string; owner: number | null } | null,
      ) => {
        const uuid = (await one(`SELECT gen_random_uuid() AS u`)).u as string;
        if (mailbox) {
          await one(
            `INSERT INTO mail_mailboxes (org_id, uuid, provider, address, display_name, scope, owner_user_id)
             VALUES ($1,$2,'imap',$3::citext,$3::text,$4,$5) RETURNING id`,
            [orgA, uuid, `${name}@a.test`, mailbox.scope, mailbox.owner],
          );
        }
        return Number(
          (
            await one(
              `INSERT INTO channels (org_id, kind, name, external_id) VALUES ($1,'email',$2,$3) RETURNING id`,
              [orgA, name, uuid],
            )
          ).id,
        );
      };
      const channels: Array<{ id: number; owner: number | null }> = [
        { id: chanA, owner: null },
        { id: await emailChannel('shared', { scope: 'shared', owner: null }), owner: null },
        { id: await emailChannel('pa', { scope: 'personal', owner: userA }), owner: userA },
        { id: await emailChannel('pa2', { scope: 'personal', owner: userA2 }), owner: userA2 },
        { id: await emailChannel('gone', null), owner: -1 },
      ];
      let n = 100;
      for (const ch of channels) {
        for (const s of SHAPES) {
          const assigneeUserId = s.user ? users[s.user] : null;
          const assigneeTeamId = s.team ? teams[s.team] : null;
          const id = Number(
            (
              await one(
                `INSERT INTO conversations (org_id, channel_id, peer_key, title, assignee_user_id, assignee_team_id)
               VALUES ($1,$2,$3,'t',$4,$5) RETURNING id`,
                [orgA, ch.id, `v${(n += 1)}`, assigneeUserId, assigneeTeamId],
              )
            ).id,
          );
          rows.push({ id, assigneeUserId, assigneeTeamId, channelOwnerUserId: ch.owner });
        }
      }
      const mine = rows.map((r) => r.id);

      const viewers: ConversationViewer[] = [];
      for (const userId of [userA, userA2, 999999]) {
        for (const teamIds of [[], [team1], [team2], [team1, team2]]) {
          for (const scope of [null, 'all', 'team', 'team_and_below', 'own'] as const) {
            for (const readsPersonalMail of [false, true]) {
              for (const readsUnassigned of [false, true]) {
                viewers.push({ userId, scope, teamIds, readsUnassigned, readsPersonalMail });
              }
            }
          }
        }
      }
      expect(viewers.length).toBe(240);

      for (const viewer of viewers) {
        const q = dialect.sqlToQuery(
          sql`SELECT c.id FROM conversations c WHERE c.org_id = ${orgA} AND ${visibleToSql(viewer)}`,
        );
        const fromSql = new Set(
          (await owner.query(q.sql, q.params as unknown[])).rows
            .map((r) => Number(r.id))
            .filter((id) => mine.includes(id)),
        );
        const fromRule = new Set(
          rows.filter((r) => conversationVisible(viewer, r)).map((r) => r.id),
        );
        expect(fromSql, JSON.stringify(viewer)).toEqual(fromRule);

        // The join form the message history uses (no correlated sub-select, so its scans can run in parallel) must give the same rows.
        const joined = visibleToJoinedSql(viewer);
        const qj = dialect.sqlToQuery(
          sql`SELECT c.id FROM conversations c ${joined.joins} WHERE c.org_id = ${orgA} AND ${joined.where}`,
        );
        const fromJoined = (await owner.query(qj.sql, qj.params as unknown[])).rows.map((r) =>
          Number(r.id),
        );
        expect(fromJoined.length, 'a join must not duplicate a conversation').toBe(
          new Set(fromJoined).size,
        );
        expect(
          new Set(fromJoined.filter((id) => mine.includes(id))),
          JSON.stringify(viewer),
        ).toEqual(fromRule);
      }
    });
  });
});
