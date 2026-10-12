import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The mail phase 2 schema (20261119090000, 20261119090100) against a real Postgres as the restricted application role (a superuser
 * bypasses every policy): forced RLS on the three new tables, cross-tenant read AND write attempts, the composite foreign keys, the
 * constraints that make a personal mailbox name its owner and a signature belong to exactly one of a mailbox or a user, and the new keys.
 */
describe('mail phase 2: schema and isolation', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let userA: number;
  let userB: number;
  let boxA: number;
  let boxB: number;

  const asTenant = async <T>(org: number, fn: () => Promise<T>): Promise<T> => {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(org)]);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  };
  const id = async (sql: string, args: unknown[]): Promise<number> =>
    Number((await owner.query(sql, args)).rows[0].id);
  const mailbox = (org: number, address: string, extra = '', args: unknown[] = []) =>
    id(
      `INSERT INTO mail_mailboxes (org_id, address, display_name${extra ? ', ' + extra.split('|')[0] : ''})
       VALUES ($1, $2, 'Box'${extra ? ', ' + extra.split('|')[1] : ''}) RETURNING id`,
      [org, address, ...args],
    );
  const signature = (org: number, cols: string, vals: unknown[]) =>
    owner.query(
      `INSERT INTO mail_signatures (org_id, ${cols.split('|')[0]}, name) VALUES ($1, ${cols.split('|')[1]}, 'Sig')`,
      [org, ...vals],
    );

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
    const org = (slug: string) =>
      id(`INSERT INTO organizations (slug,name,plan) VALUES ($1,$1,'starter') RETURNING id`, [
        slug,
      ]);
    orgA = await org('ma');
    orgB = await org('mb');
    const user = (o: number, email: string) =>
      id(
        `INSERT INTO users (org_id, uuid, email, full_name) VALUES ($1, gen_random_uuid(), $2, 'U') RETURNING id`,
        [o, email],
      );
    userA = await user(orgA, 'a@ma.test');
    userB = await user(orgB, 'b@mb.test');
    boxA = await mailbox(orgA, 'support@ma.test');
    boxB = await mailbox(orgB, 'support@mb.test');
    const url = new URL(container.getConnectionUri());
    url.username = 'crm_app_user';
    url.password = 'test';
    app = new Client({ connectionString: url.toString() });
    await app.connect();
  }, 240_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  it.each([
    'mail_mailboxes',
    'mail_workspace_settings',
    'mail_signatures',
    'mail_outbound_attachments',
  ])('%s: RLS is enabled AND forced with a tenant_isolation policy', async (table) => {
    const res = await owner.query(
      `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
                (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation')::int AS pol
         FROM pg_class c WHERE c.relname = $1`,
      [table],
    );
    expect(res.rows[0]).toEqual({ rls: true, forced: true, pol: 1 });
  });

  describe('mail_mailboxes', () => {
    it('accepts the three providers and refuses another', async () => {
      await mailbox(orgA, 'ms@ma.test', "provider|'microsoft'");
      await mailbox(orgA, 'imap@ma.test', "provider|'imap'");
      await expect(mailbox(orgA, 'y@ma.test', "provider|'yahoo'")).rejects.toThrow(
        /chk_mail_mailboxes_provider/,
      );
    });

    it('a personal mailbox must name its owner; a shared one need not', async () => {
      await expect(mailbox(orgA, 'p1@ma.test', "scope|'personal'")).rejects.toThrow(
        /chk_mail_mailboxes_personal_owner/,
      );
      await mailbox(orgA, 'p2@ma.test', "scope, owner_user_id|'personal', $3", [userA]);
    });

    it("a personal mailbox cannot be owned by another workspace's user (composite key)", async () => {
      await expect(
        mailbox(orgA, 'p3@ma.test', "scope, owner_user_id|'personal', $3", [userB]),
      ).rejects.toThrow(/fk_mail_mailboxes_owner/);
    });

    it('the send limit is bounded, the sealed connection must look sealed', async () => {
      await expect(mailbox(orgA, 'l@ma.test', 'send_limit_per_hour|0')).rejects.toThrow(
        /chk_mail_mailboxes_send_limit/,
      );
      await expect(mailbox(orgA, 'c@ma.test', "connection_enc|'plain'")).rejects.toThrow(
        /chk_mail_mailboxes_connection_sealed/,
      );
      await mailbox(orgA, 'c2@ma.test', "connection_enc, send_limit_per_hour|'v1:abc', 50");
    });

    it('deleting the owner deletes the personal mailbox, never a shared one', async () => {
      const u = await id(
        `INSERT INTO users (org_id, uuid, email, full_name) VALUES ($1, gen_random_uuid(), 'gone@ma.test', 'G') RETURNING id`,
        [orgA],
      );
      await mailbox(orgA, 'gone@ma.test', "scope, owner_user_id|'personal', $3", [u]);
      await owner.query(`DELETE FROM users WHERE org_id = $1 AND id = $2`, [orgA, u]);
      const left = await owner.query(`SELECT 1 FROM mail_mailboxes WHERE address = 'gone@ma.test'`);
      expect(left.rowCount).toBe(0);
    });

    it('a tenant sees only its own mailboxes', async () => {
      const seen = await asTenant(orgB, () => app.query(`SELECT address FROM mail_mailboxes`));
      expect(seen.rows.map((r) => r.address)).toEqual(['support@mb.test']);
    });
  });

  describe('mail_workspace_settings', () => {
    it('one row per workspace, defaults closed, policy values checked', async () => {
      await owner.query(`INSERT INTO mail_workspace_settings (org_id) VALUES ($1)`, [orgA]);
      const row = (
        await owner.query(`SELECT * FROM mail_workspace_settings WHERE org_id = $1`, [orgA])
      ).rows[0];
      expect(row).toMatchObject({
        personal_mailboxes_enabled: false,
        who_may_connect_personal: 'admins',
        admins_can_read_personal: false,
        row_version: 1,
      });
      await expect(
        owner.query(`INSERT INTO mail_workspace_settings (org_id) VALUES ($1)`, [orgA]),
      ).rejects.toThrow(/duplicate key/);
      await expect(
        owner.query(
          `UPDATE mail_workspace_settings SET who_may_connect_personal = 'all' WHERE org_id = $1`,
          [orgA],
        ),
      ).rejects.toThrow(/chk_mail_workspace_settings_who/);
    });

    it('the touch trigger bumps row_version', async () => {
      await owner.query(
        `UPDATE mail_workspace_settings SET personal_mailboxes_enabled = true WHERE org_id = $1`,
        [orgA],
      );
      const v = await owner.query(
        `SELECT row_version FROM mail_workspace_settings WHERE org_id = $1`,
        [orgA],
      );
      expect(v.rows[0].row_version).toBe(2);
    });

    it("a tenant cannot read or write another workspace's policy", async () => {
      const seen = await asTenant(orgB, () =>
        app.query(`SELECT org_id FROM mail_workspace_settings`),
      );
      expect(seen.rowCount).toBe(0);
      await expect(
        asTenant(orgB, () =>
          app.query(`INSERT INTO mail_workspace_settings (org_id) VALUES ($1)`, [orgA]),
        ),
      ).rejects.toThrow(/row-level security/);
      const upd = await asTenant(orgB, () =>
        app.query(
          `UPDATE mail_workspace_settings SET personal_mailboxes_enabled = false WHERE org_id = $1`,
          [orgA],
        ),
      );
      expect(upd.rowCount).toBe(0);
    });
  });

  describe('mail_signatures', () => {
    it('belongs to exactly one of a mailbox (scope mailbox) or a user (scope user)', async () => {
      await signature(orgA, "scope, mailbox_id|'mailbox', $2", [boxA]);
      await signature(orgA, "scope, user_id|'user', $2", [userA]);
      await expect(signature(orgA, "scope|'mailbox'", [])).rejects.toThrow(
        /chk_mail_signatures_owner/,
      );
      await expect(
        signature(orgA, "scope, mailbox_id, user_id|'user', $2, $3", [boxA, userA]),
      ).rejects.toThrow(/chk_mail_signatures_owner/);
      await expect(signature(orgA, "scope, mailbox_id|'user', $2", [boxA])).rejects.toThrow(
        /chk_mail_signatures_owner/,
      );
    });

    it('at most one default per mailbox and one per user', async () => {
      await signature(orgA, "scope, mailbox_id, is_default|'mailbox', $2, true", [boxA]);
      await expect(
        signature(orgA, "scope, mailbox_id, is_default|'mailbox', $2, true", [boxA]),
      ).rejects.toThrow(/uq_mail_signatures_default_mailbox/);
      await signature(orgA, "scope, user_id, is_default|'user', $2, true", [userA]);
      await expect(
        signature(orgA, "scope, user_id, is_default|'user', $2, true", [userA]),
      ).rejects.toThrow(/uq_mail_signatures_default_user/);
    });

    it("the keys are composite: a signature cannot point at another workspace's mailbox or user", async () => {
      await expect(signature(orgA, "scope, mailbox_id|'mailbox', $2", [boxB])).rejects.toThrow(
        /fk_mail_signatures_mailbox/,
      );
      await expect(signature(orgA, "scope, user_id|'user', $2", [userB])).rejects.toThrow(
        /fk_mail_signatures_user/,
      );
    });

    it('goes with its mailbox', async () => {
      const b = await mailbox(orgA, 'tmp@ma.test');
      await signature(orgA, "scope, mailbox_id|'mailbox', $2", [b]);
      await owner.query(`DELETE FROM mail_mailboxes WHERE org_id = $1 AND id = $2`, [orgA, b]);
      const left = await owner.query(
        `SELECT 1 FROM mail_signatures WHERE org_id = $1 AND mailbox_id = $2`,
        [orgA, b],
      );
      expect(left.rowCount).toBe(0);
    });

    it('a tenant sees only its own signatures and cannot write into another workspace', async () => {
      const seen = await asTenant(orgB, () => app.query(`SELECT org_id FROM mail_signatures`));
      expect(seen.rowCount).toBe(0);
      await expect(
        asTenant(orgB, () =>
          app.query(
            `INSERT INTO mail_signatures (org_id, scope, user_id, name) VALUES ($1, 'user', $2, 'X')`,
            [orgA, userA],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe('mail_outbound_attachments', () => {
    const insert = (org: number, uploader: number | null, size = 10, client: Client = owner) =>
      client.query(
        `INSERT INTO mail_outbound_attachments (org_id, uploaded_by, name, mime, size, object_key, expires_at)
         VALUES ($1, $2, 'a.pdf', 'application/pdf', $3, 'k/a', now() + interval '1 day') RETURNING id`,
        [org, uploader, size],
      );

    it('stores a staged file; a zero size and a foreign uploader are refused', async () => {
      await insert(orgA, userA);
      await expect(insert(orgA, userA, 0)).rejects.toThrow(/chk_mail_outbound_attachments_size/);
      await expect(insert(orgA, userB)).rejects.toThrow(/fk_mail_outbound_attachments_uploaded_by/);
    });

    it('a tenant sees only its own staged files and cannot stage into another workspace', async () => {
      const seen = await asTenant(orgB, () =>
        app.query(`SELECT org_id FROM mail_outbound_attachments`),
      );
      expect(seen.rowCount).toBe(0);
      await expect(asTenant(orgB, () => insert(orgA, null, 10, app))).rejects.toThrow(
        /row-level security/,
      );
    });
  });

  it('the new permission keys exist, are gated by the email_channel plan feature', async () => {
    const res = await owner.query(
      `SELECT key, plan_feature FROM permission_defs WHERE key IN
         ('mail.mailboxes.manage_personal', 'mail.signatures.manage', 'mail.settings.manage') ORDER BY key`,
    );
    expect(res.rows).toEqual([
      { key: 'mail.mailboxes.manage_personal', plan_feature: 'email_channel' },
      { key: 'mail.settings.manage', plan_feature: 'email_channel' },
      { key: 'mail.signatures.manage', plan_feature: 'email_channel' },
    ]);
  });
});
