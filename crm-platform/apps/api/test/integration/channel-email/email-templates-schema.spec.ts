import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * `email_templates` (migration 20261202090000) against a real Postgres: forced row level security asserted as the restricted application
 * role (a superuser bypasses every policy), the composite foreign keys, the name unique per owner (case-insensitive), the CHECKs behind the
 * service's rules, the owner foreign key that deletes a personal template with its user, and the usage trigger that counts a use without
 * moving the row version. Also the permission keys of 20261202090100.
 */
describe('email_templates: isolation, keys and constraints', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let userA: number;
  let userA2: number;
  let userB: number;

  const one = async (sql: string, p: unknown[] = []) =>
    (await owner.query(sql, p)).rows[0] as Record<string, unknown>;
  const fails = async (sql: string, p: unknown[] = []) => {
    try {
      await owner.query(sql, p);
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
  const ins = (
    org: number,
    user: number | null,
    name: string,
    extra: {
      subject?: string;
      html?: string;
      text?: string;
      category?: string | null;
      purpose?: string;
      status?: string;
    } = {},
  ) =>
    fails(
      `INSERT INTO email_templates (org_id, user_id, name, subject, body_html, body_text, category, purpose, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        org,
        user,
        name,
        extra.subject ?? '',
        extra.html ?? '<p>x</p>',
        extra.text ?? '',
        extra.category ?? null,
        extra.purpose ?? 'general',
        extra.status ?? 'active',
      ],
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
    const org = async (slug: string) =>
      Number(
        (
          await one(
            `INSERT INTO organizations (slug, name, plan) VALUES ($1,$1,'starter') RETURNING id`,
            [slug],
          )
        ).id,
      );
    const user = async (o: number, email: string) =>
      Number(
        (
          await one(
            `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,$2,'U','x') RETURNING id`,
            [o, email],
          )
        ).id,
      );
    orgA = await org('et-a');
    orgB = await org('et-b');
    userA = await user(orgA, 'a@et.test');
    userA2 = await user(orgA, 'a2@et.test');
    userB = await user(orgB, 'b@et.test');
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

  it('keeps row level security enabled and forced with one tenant policy', async () => {
    const r = await one(
      `SELECT c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*) FROM pg_policies p WHERE p.tablename = 'email_templates' AND p.policyname = 'tenant_isolation')::int AS policies
       FROM pg_class c WHERE c.relname = 'email_templates'`,
    );
    expect(r).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true, policies: 1 });
  });

  it('a workspace sees only its own templates, and cannot write into another', async () => {
    await ins(orgA, null, 'iso a');
    await ins(orgB, null, 'iso b');
    const seen = await asTenant(orgA, async () =>
      (await app.query(`SELECT name FROM email_templates WHERE name LIKE 'iso %'`)).rows.map(
        (x) => x.name,
      ),
    );
    expect(seen).toEqual(['iso a']);
    await app.query('BEGIN');
    await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgA)]);
    await expect(
      app.query(
        `INSERT INTO email_templates (org_id, name, body_html) VALUES ($1,'sneak','<p>x</p>')`,
        [orgB],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await app.query('ROLLBACK');
  });

  it('with no tenant set the restricted role sees nothing', async () => {
    const n = await app.query(`SELECT count(*)::int AS n FROM email_templates`);
    expect(n.rows[0].n).toBe(0);
  });

  it('an owner or author from another workspace is refused by the composite foreign keys', async () => {
    const owned = await fails(
      `INSERT INTO email_templates (org_id, user_id, name, body_html) VALUES ($1,$2,'xorg owner','<p>x</p>')`,
      [orgA, userB],
    );
    expect(owned?.constraint).toBe('fk_email_templates_user');
    const authored = await fails(
      `INSERT INTO email_templates (org_id, created_by, name, body_html) VALUES ($1,$2,'xorg author','<p>x</p>')`,
      [orgA, userB],
    );
    expect(authored?.constraint).toBe('fk_email_templates_created_by');
  });

  it('the name is unique per owner, ignoring case: one shared template, one personal template per person', async () => {
    expect(await ins(orgA, null, 'Welcome')).toBeNull();
    expect((await ins(orgA, null, 'WELCOME'))?.constraint).toBe('uq_email_templates_shared_name');
    // a personal template may reuse a shared name (the picker shows both), once per person
    expect(await ins(orgA, userA, 'Welcome')).toBeNull();
    expect((await ins(orgA, userA, 'welcome'))?.constraint).toBe('uq_email_templates_user_name');
    expect(await ins(orgA, userA2, 'Welcome')).toBeNull();
    // another workspace has its own namespace
    expect(await ins(orgB, null, 'Welcome')).toBeNull();
  });

  it('name, subject, body, category, purpose and status have the limits the service validates', async () => {
    expect((await ins(orgA, null, '  '))?.constraint).toBe('chk_email_templates_name');
    expect((await ins(orgA, null, 'x'.repeat(121)))?.constraint).toBe('chk_email_templates_name');
    expect(await ins(orgA, null, 'x'.repeat(120))).toBeNull();
    expect((await ins(orgA, null, 's1', { subject: 'a\nb' }))?.constraint).toBe(
      'chk_email_templates_subject',
    );
    expect((await ins(orgA, null, 's2', { subject: 'x'.repeat(301) }))?.constraint).toBe(
      'chk_email_templates_subject',
    );
    expect((await ins(orgA, null, 'b1', { html: '   ' }))?.constraint).toBe(
      'chk_email_templates_body',
    );
    expect((await ins(orgA, null, 'b2', { html: 'x'.repeat(100_001) }))?.constraint).toBe(
      'chk_email_templates_body',
    );
    expect((await ins(orgA, null, 'b3', { text: 'x'.repeat(30_001) }))?.constraint).toBe(
      'chk_email_templates_body',
    );
    expect((await ins(orgA, null, 'c1', { category: 'x'.repeat(65) }))?.constraint).toBe(
      'chk_email_templates_category',
    );
    expect((await ins(orgA, null, 'c2', { category: '' }))?.constraint).toBe(
      'chk_email_templates_category',
    );
    expect((await ins(orgA, null, 'p1', { purpose: 'spam' }))?.constraint).toBe(
      'chk_email_templates_purpose',
    );
    expect((await ins(orgA, null, 'st1', { status: 'deleted' }))?.constraint).toBe(
      'chk_email_templates_status',
    );
  });

  it('deleting a user deletes their personal templates (never turns them shared) and keeps the author name optional', async () => {
    const u = Number(
      (
        await one(
          `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'gone@et.test','G','x') RETURNING id`,
          [orgA],
        )
      ).id,
    );
    expect(await ins(orgA, u, 'mine gone')).toBeNull();
    await owner.query(
      `INSERT INTO email_templates (org_id, name, body_html, created_by) VALUES ($1,'shared by gone','<p>x</p>',$2)`,
      [orgA, u],
    );
    await owner.query(`DELETE FROM users WHERE org_id = $1 AND id = $2`, [orgA, u]);
    const rows = (
      await owner.query(
        `SELECT name, user_id, created_by FROM email_templates WHERE org_id = $1 AND name IN ('mine gone','shared by gone')`,
        [orgA],
      )
    ).rows;
    expect(rows).toEqual([{ name: 'shared by gone', user_id: null, created_by: null }]);
  });

  it('counting a use leaves the row version and updated_at alone; an edit moves them', async () => {
    await ins(orgA, null, 'counted');
    const get = () =>
      one(
        `SELECT id, row_version, updated_at, used_count FROM email_templates WHERE org_id = $1 AND name = 'counted'`,
        [orgA],
      );
    const before = await get();
    await owner.query(
      `UPDATE email_templates SET used_count = used_count + 1, last_used_at = now() WHERE org_id = $1 AND id = $2`,
      [orgA, before.id],
    );
    const used = await get();
    expect(used.used_count).toBe(1);
    expect(used.row_version).toBe(before.row_version);
    expect(used.updated_at).toEqual(before.updated_at);
    await owner.query(`UPDATE email_templates SET subject = 'new' WHERE org_id = $1 AND id = $2`, [
      orgA,
      before.id,
    ]);
    const edited = await get();
    expect(edited.row_version).toBe(Number(before.row_version) + 1);
  });

  it('registers the two permission keys under the email add-on', async () => {
    const defs = (
      await owner.query(
        `SELECT key, plan_feature FROM permission_defs WHERE key LIKE 'mail.templates.%' ORDER BY key`,
      )
    ).rows;
    expect(defs).toEqual([
      { key: 'mail.templates.manage', plan_feature: 'email_channel' },
      { key: 'mail.templates.read', plan_feature: 'email_channel' },
    ]);
  });
});
