import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The team-chat tables against a real Postgres, as the restricted application role (a superuser bypasses every policy and
 * would make the isolation assertions vacuous, see rls.spec.ts). Constraint checks use the owner connection: owners skip RLS
 * but never CHECK, UNIQUE or FK.
 */
const TABLES = [
  'team_chat_channels',
  'team_chat_channel_members',
  'team_chat_messages',
  'team_chat_reactions',
  'team_chat_invitations',
  'team_chat_attachment_blobs',
];

describe('team chat: schema, constraints and isolation', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let userA: number;
  let userB: number;
  let chanA: number;
  let chanB: number;
  let msgA: number;
  let msgB: number;

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

    const one = async (sql: string, p: unknown[] = []) =>
      Number((await owner.query(sql, p)).rows[0].id);
    orgA = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('ca','A','starter') RETURNING id`,
    );
    orgB = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('cb','B','starter') RETURNING id`,
    );
    userA = await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'a@t.test','A','x') RETURNING id`,
      [orgA],
    );
    userB = await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'b@t.test','B','x') RETURNING id`,
      [orgB],
    );
    chanA = await one(
      `INSERT INTO team_chat_channels (org_id, name, slug) VALUES ($1,'general','general') RETURNING id`,
      [orgA],
    );
    chanB = await one(
      `INSERT INTO team_chat_channels (org_id, name, slug) VALUES ($1,'general','general') RETURNING id`,
      [orgB],
    );
    msgA = await one(
      `INSERT INTO team_chat_messages (org_id, channel_id, user_id, body) VALUES ($1,$2,$3,'hi A') RETURNING id`,
      [orgA, chanA, userA],
    );
    msgB = await one(
      `INSERT INTO team_chat_messages (org_id, channel_id, user_id, body) VALUES ($1,$2,$3,'hi B') RETURNING id`,
      [orgB, chanB, userB],
    );

    app = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: 'crm',
      user: 'crm_app_user',
      password: 'test',
    });
    await app.connect();
  }, 180_000);

  afterAll(async () => {
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
  const rejects = (sql: string, params: unknown[], pattern: RegExp) =>
    expect(owner.query(sql, params)).rejects.toThrow(pattern);

  describe('row-level security', () => {
    it.each(TABLES)(
      '%s: RLS is enabled and forced with a tenant policy that has USING and WITH CHECK',
      async (table) => {
        const res = await owner.query(
          `SELECT c.relrowsecurity, c.relforcerowsecurity,
                (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation'
                    AND p.qual IS NOT NULL AND p.with_check IS NOT NULL)::int AS policies
           FROM pg_class c WHERE c.relname = $1 AND c.relkind = 'r'`,
          [table],
        );
        expect(res.rows[0]).toMatchObject({
          relrowsecurity: true,
          relforcerowsecurity: true,
          policies: 1,
        });
      },
    );

    it('a workspace sees only its own channels and messages, even when the other id is known exactly', async () => {
      const own = await asOrg(
        orgA,
        async () => (await app.query(`SELECT id FROM team_chat_messages`)).rows,
      );
      expect(own.map((r) => Number(r.id))).toEqual([msgA]);
      const other = await asOrg(
        orgA,
        async () =>
          (
            await app.query(`SELECT 1 FROM team_chat_messages WHERE org_id = $1 AND id = $2`, [
              orgB,
              msgB,
            ])
          ).rows,
      );
      expect(other).toHaveLength(0);
    });

    it('with no tenant set a query sees no rows, and a write into another workspace is refused by WITH CHECK', async () => {
      await app.query('BEGIN');
      try {
        expect((await app.query(`SELECT 1 FROM team_chat_channels`)).rows).toHaveLength(0);
      } finally {
        await app.query('ROLLBACK');
      }
      await app.query('BEGIN');
      try {
        await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgA)]);
        await expect(
          app.query(
            `INSERT INTO team_chat_messages (org_id, channel_id, user_id, body) VALUES ($1,$2,$3,'smuggled')`,
            [orgB, chanB, userB],
          ),
        ).rejects.toThrow(/row-level security/);
      } finally {
        await app.query('ROLLBACK');
      }
    });
  });

  describe('foreign keys are composite', () => {
    it('a message cannot be written into a channel, or by a user, of another workspace', async () => {
      await rejects(
        `INSERT INTO team_chat_messages (org_id, channel_id, user_id, body) VALUES ($1,$2,$3,'x')`,
        [orgA, chanB, userA],
        /fk_team_chat_messages_channel_id/,
      );
      await rejects(
        `INSERT INTO team_chat_messages (org_id, channel_id, user_id, body) VALUES ($1,$2,$3,'x')`,
        [orgA, chanA, userB],
        /fk_team_chat_messages_user_id/,
      );
    });
    it('a reply cannot point at a message of another workspace', async () => {
      await rejects(
        `INSERT INTO team_chat_messages (org_id, channel_id, user_id, body, reply_to_id) VALUES ($1,$2,$3,'x',$4)`,
        [orgA, chanA, userA, msgB],
        /fk_team_chat_messages_reply_to_id/,
      );
    });
    it('an invitation cannot target a channel of another workspace', async () => {
      await rejects(
        `INSERT INTO team_chat_invitations (org_id, channel_id, requester_user_id, invitee_email) VALUES ($1,$2,$3,'x@t.test')`,
        [orgA, chanB, userA],
        /fk_team_chat_invitations_channel_id/,
      );
    });
  });

  describe('constraints', () => {
    it('a message must have text or an attachment, and a channel', async () => {
      await rejects(
        `INSERT INTO team_chat_messages (org_id, channel_id, user_id) VALUES ($1,$2,$3)`,
        [orgA, chanA, userA],
        /chk_team_chat_messages_has_content/,
      );
      await rejects(
        `INSERT INTO team_chat_messages (org_id, user_id, body) VALUES ($1,$2,'orphan')`,
        [orgA, userA],
        /chk_team_chat_messages_channel_required/,
      );
      await rejects(
        `INSERT INTO team_chat_messages (org_id, channel_id, user_id, attachment_path) VALUES ($1,$2,$3,'blob:x')`,
        [orgA, chanA, userA],
        /chk_team_chat_messages_attachment_name/,
      );
    });
    it('a channel slug is unique per workspace, not across workspaces', async () => {
      await rejects(
        `INSERT INTO team_chat_channels (org_id, name, slug) VALUES ($1,'general','general')`,
        [orgA],
        /uq_team_chat_channels_slug/,
      );
      expect(chanB).not.toBe(chanA);
    });
    it('a channel type and an invitation status are checked', async () => {
      await rejects(
        `INSERT INTO team_chat_channels (org_id, name, slug, type) VALUES ($1,'x','x','secret')`,
        [orgA],
        /chk_team_chat_channels_type/,
      );
      await rejects(
        `INSERT INTO team_chat_invitations (org_id, requester_user_id, invitee_email, status) VALUES ($1,$2,'x@t.test','maybe')`,
        [orgA, userA],
        /chk_team_chat_invitations_status/,
      );
    });
    it('one reaction per person, message and emoji', async () => {
      await owner.query(
        `INSERT INTO team_chat_reactions (org_id, message_id, user_id, emoji) VALUES ($1,$2,$3,'👍')`,
        [orgA, msgA, userA],
      );
      await rejects(
        `INSERT INTO team_chat_reactions (org_id, message_id, user_id, emoji) VALUES ($1,$2,$3,'👍')`,
        [orgA, msgA, userA],
        /uq_team_chat_reactions_message_id_user_id_emoji/,
      );
    });
    it('a member row is unique per channel and user, and a first read pointer of 0 is accepted (no FK on the pointer)', async () => {
      await owner.query(
        `INSERT INTO team_chat_channel_members (org_id, channel_id, user_id) VALUES ($1,$2,$3)`,
        [orgA, chanA, userA],
      );
      await rejects(
        `INSERT INTO team_chat_channel_members (org_id, channel_id, user_id) VALUES ($1,$2,$3)`,
        [orgA, chanA, userA],
        /uq_team_chat_channel_members_channel_id_user_id/,
      );
      const row = await owner.query(
        `SELECT last_read_message_id FROM team_chat_channel_members WHERE org_id = $1 AND channel_id = $2`,
        [orgA, chanA],
      );
      expect(Number(row.rows[0].last_read_message_id)).toBe(0);
    });
    it('deleting the message a person last read keeps their read pointer', async () => {
      const m = Number(
        (
          await owner.query(
            `INSERT INTO team_chat_messages (org_id, channel_id, user_id, body) VALUES ($1,$2,$3,'tmp') RETURNING id`,
            [orgA, chanA, userA],
          )
        ).rows[0].id,
      );
      await owner.query(
        `UPDATE team_chat_channel_members SET last_read_message_id = $1 WHERE org_id = $2 AND channel_id = $3 AND user_id = $4`,
        [m, orgA, chanA, userA],
      );
      await owner.query(`DELETE FROM team_chat_messages WHERE org_id = $1 AND id = $2`, [orgA, m]);
      const row = await owner.query(
        `SELECT last_read_message_id FROM team_chat_channel_members WHERE org_id = $1 AND channel_id = $2 AND user_id = $3`,
        [orgA, chanA, userA],
      );
      expect(row.rows).toHaveLength(1);
      expect(Number(row.rows[0].last_read_message_id)).toBe(m);
    });
    it('an attachment is at most 20 MB, one per message, and goes with its message', async () => {
      const m = Number(
        (
          await owner.query(
            `INSERT INTO team_chat_messages (org_id, channel_id, user_id, attachment_path, attachment_name) VALUES ($1,$2,$3,'blob:1','a.png') RETURNING id`,
            [orgA, chanA, userA],
          )
        ).rows[0].id,
      );
      await rejects(
        `INSERT INTO team_chat_attachment_blobs (org_id, message_id, bytes, byte_size) VALUES ($1,$2,'\\x01',20971521)`,
        [orgA, m],
        /chk_team_chat_attachment_blobs_size/,
      );
      await owner.query(
        `INSERT INTO team_chat_attachment_blobs (org_id, message_id, bytes, byte_size) VALUES ($1,$2,'\\x01',1)`,
        [orgA, m],
      );
      await rejects(
        `INSERT INTO team_chat_attachment_blobs (org_id, message_id, bytes, byte_size) VALUES ($1,$2,'\\x01',1)`,
        [orgA, m],
        /uq_team_chat_attachment_blobs_message_id/,
      );
      await owner.query(`DELETE FROM team_chat_messages WHERE org_id = $1 AND id = $2`, [orgA, m]);
      const left = await owner.query(
        `SELECT count(*)::int AS n FROM team_chat_attachment_blobs WHERE org_id = $1 AND message_id = $2`,
        [orgA, m],
      );
      expect(left.rows[0].n).toBe(0);
    });
    it('the touch trigger bumps row_version on update', async () => {
      const before = (
        await owner.query(`SELECT row_version FROM team_chat_messages WHERE id = $1`, [msgA])
      ).rows[0].row_version;
      await owner.query(`UPDATE team_chat_messages SET body = 'edited' WHERE id = $1`, [msgA]);
      const after = (
        await owner.query(`SELECT row_version FROM team_chat_messages WHERE id = $1`, [msgA])
      ).rows[0].row_version;
      expect(after).toBe(before + 1);
    });
  });

  describe('migration backfill', () => {
    it('every workspace that existed when the migration ran got a #general (the service creates it for later ones)', async () => {
      // Organizations created by this test arrive after the migration ran, so the backfill is checked against a rerun of its
      // statement: it must create exactly the missing channels and leave existing ones alone.
      const orgC = Number(
        (
          await owner.query(
            `INSERT INTO organizations (slug, name, plan) VALUES ('cc','C','starter') RETURNING id`,
          )
        ).rows[0].id,
      );
      await owner.query(`SELECT set_config('app.privileged', 'on', false)`);
      await owner.query(
        `INSERT INTO team_chat_channels (org_id, name, slug, description, type)
           SELECT o.id, 'general', 'general', 'Everyone in this workspace', 'public' FROM organizations o
         ON CONFLICT (org_id, slug) DO NOTHING`,
      );
      const rows = await owner.query(
        `SELECT org_id FROM team_chat_channels WHERE slug = 'general' AND org_id IN ($1,$2,$3) ORDER BY org_id`,
        [orgA, orgB, orgC],
      );
      expect(rows.rows.map((r) => Number(r.org_id))).toEqual([orgA, orgB, orgC]);
    });
  });
});
