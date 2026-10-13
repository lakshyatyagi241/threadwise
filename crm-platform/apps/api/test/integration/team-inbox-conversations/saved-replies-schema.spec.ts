import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * `saved_replies` after migration 20261121090000 against a real Postgres: forced row level security (asserted as the restricted
 * application role, a superuser bypasses every policy), the composite foreign keys, the unique shortcut per owner, the CHECK constraints
 * that back the service's rules, the owner foreign key that deletes a personal reply with its user, and the usage trigger that counts a
 * use without moving the row version.
 */
describe('saved_replies: isolation, keys and constraints', () => {
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
    shortcut: string,
    extra: { title?: string; body?: string; category?: string | null; kinds?: string[] } = {},
  ) =>
    fails(
      `INSERT INTO saved_replies (org_id, user_id, shortcut, title, body, category, channel_kinds)
       VALUES ($1,$2,$3,$4,$5,$6,$7::text[])`,
      [
        org,
        user,
        shortcut,
        extra.title ?? 't',
        extra.body ?? 'b',
        extra.category ?? null,
        extra.kinds ?? [],
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
    orgA = await org('sr-a');
    orgB = await org('sr-b');
    userA = await user(orgA, 'a@sr.test');
    userA2 = await user(orgA, 'a2@sr.test');
    userB = await user(orgB, 'b@sr.test');
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
              (SELECT count(*) FROM pg_policies p WHERE p.tablename = 'saved_replies' AND p.policyname = 'tenant_isolation')::int AS policies
       FROM pg_class c WHERE c.relname = 'saved_replies'`,
    );
    expect(r).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true, policies: 1 });
  });

  it('a workspace sees only its own replies, and cannot write into another', async () => {
    await ins(orgA, null, 'iso_a');
    await ins(orgB, null, 'iso_b');
    const seen = await asTenant(orgA, async () =>
      (
        await app.query(`SELECT shortcut FROM saved_replies WHERE shortcut LIKE 'iso\\_%'`)
      ).rows.map((x) => x.shortcut),
    );
    expect(seen).toEqual(['iso_a']);
    await app.query('BEGIN');
    await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgA)]);
    await expect(
      app.query(
        `INSERT INTO saved_replies (org_id, shortcut, title, body) VALUES ($1,'sneak','t','b')`,
        [orgB],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await app.query('ROLLBACK');
  });

  it('an owner or author from another workspace is refused by the composite foreign keys', async () => {
    const owned = await fails(
      `INSERT INTO saved_replies (org_id, user_id, shortcut, title, body) VALUES ($1,$2,'xorg_owner','t','b')`,
      [orgA, userB],
    );
    expect(owned?.constraint).toBe('fk_saved_replies_user_id');
    const authored = await fails(
      `INSERT INTO saved_replies (org_id, created_by, shortcut, title, body) VALUES ($1,$2,'xorg_author','t','b')`,
      [orgA, userB],
    );
    expect(authored?.constraint).toBe('fk_saved_replies_created_by');
  });

  it('the shortcut is unique per workspace and owner: one shared reply, one personal reply per person', async () => {
    expect(await ins(orgA, null, 'dup')).toBeNull();
    expect((await ins(orgA, null, 'dup'))?.constraint).toBe('uq_saved_replies_owner_shortcut');
    // a personal reply may reuse a shared shortcut (the picker shows both), once per person
    expect(await ins(orgA, userA, 'dup')).toBeNull();
    expect((await ins(orgA, userA, 'dup'))?.constraint).toBe('uq_saved_replies_owner_shortcut');
    expect(await ins(orgA, userA2, 'dup')).toBeNull();
    // another workspace has its own namespace
    expect(await ins(orgB, null, 'dup')).toBeNull();
  });

  it('the shortcut is stored lower case, without spaces or a slash, 1 to 64 long', async () => {
    expect((await ins(orgA, null, 'Upper'))?.constraint).toBe('chk_saved_replies_shortcut');
    expect((await ins(orgA, null, 'has space'))?.constraint).toBe('chk_saved_replies_shortcut');
    expect((await ins(orgA, null, '/slash'))?.constraint).toBe('chk_saved_replies_shortcut');
    expect((await ins(orgA, null, ''))?.constraint).toBe('chk_saved_replies_shortcut');
    expect((await ins(orgA, null, 'x'.repeat(65)))?.constraint).toBe('chk_saved_replies_shortcut');
    expect(await ins(orgA, null, 'x'.repeat(64))).toBeNull();
    expect(await ins(orgA, null, 'مرحبا_بك')).toBeNull();
  });

  it('title, body, category, language and the channel list have the limits Reference validated', async () => {
    expect((await ins(orgA, null, 'c_title', { title: '  ' }))?.constraint).toBe(
      'chk_saved_replies_title',
    );
    expect((await ins(orgA, null, 'c_title2', { title: 'x'.repeat(129) }))?.constraint).toBe(
      'chk_saved_replies_title',
    );
    expect((await ins(orgA, null, 'c_body', { body: '   ' }))?.constraint).toBe(
      'chk_saved_replies_body',
    );
    expect((await ins(orgA, null, 'c_body2', { body: 'x'.repeat(4001) }))?.constraint).toBe(
      'chk_saved_replies_body',
    );
    expect(await ins(orgA, null, 'c_body3', { body: 'x'.repeat(4000) })).toBeNull();
    expect((await ins(orgA, null, 'c_cat', { category: 'x'.repeat(65) }))?.constraint).toBe(
      'chk_saved_replies_category',
    );
    expect(
      (await ins(orgA, null, 'c_kinds', { kinds: Array.from({ length: 21 }, (_, i) => `k${i}`) }))
        ?.constraint,
    ).toBe('chk_saved_replies_channel_kinds');
    const lang = await fails(
      `INSERT INTO saved_replies (org_id, shortcut, title, body, language) VALUES ($1,'c_lang','t','b','x')`,
      [orgA],
    );
    expect(lang?.constraint).toBe('chk_saved_replies_language');
  });

  it('deleting a user removes their personal replies (they never turn into shared ones) and blanks the author of shared ones', async () => {
    const gone = Number(
      (
        await one(
          `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'gone@sr.test','G','x') RETURNING id`,
          [orgA],
        )
      ).id,
    );
    await owner.query(
      `INSERT INTO saved_replies (org_id, user_id, created_by, shortcut, title, body) VALUES ($1,$2,$2,'gone_mine','t','b')`,
      [orgA, gone],
    );
    await owner.query(
      `INSERT INTO saved_replies (org_id, created_by, shortcut, title, body) VALUES ($1,$2,'gone_shared','t','b')`,
      [orgA, gone],
    );
    await owner.query(`DELETE FROM users WHERE org_id = $1 AND id = $2`, [orgA, gone]);
    const rows = (
      await owner.query(
        `SELECT shortcut, user_id, created_by FROM saved_replies WHERE org_id = $1 AND shortcut LIKE 'gone\\_%'`,
        [orgA],
      )
    ).rows;
    expect(rows).toEqual([{ shortcut: 'gone_shared', user_id: null, created_by: null }]);
  });

  it('counting a use does not move the row version or updated_at; an edit does', async () => {
    const created = await one(
      `INSERT INTO saved_replies (org_id, shortcut, title, body) VALUES ($1,'usage','t','b')
       RETURNING id, row_version, updated_at`,
      [orgA],
    );
    await new Promise((r) => setTimeout(r, 15));
    const used = await one(
      `UPDATE saved_replies SET used_count = used_count + 1, last_used_at = now() WHERE org_id = $1 AND id = $2
       RETURNING used_count, last_used_at, row_version, updated_at`,
      [orgA, created.id],
    );
    expect(Number(used.used_count)).toBe(1);
    expect(used.last_used_at).not.toBeNull();
    expect(used.row_version).toBe(created.row_version);
    expect(used.updated_at).toEqual(created.updated_at);

    const edited = await one(
      `UPDATE saved_replies SET title = 'new' WHERE org_id = $1 AND id = $2 RETURNING row_version, updated_at`,
      [orgA, created.id],
    );
    expect(edited.row_version).toBe(Number(created.row_version) + 1);
    expect((edited.updated_at as Date).getTime()).toBeGreaterThan(
      (created.updated_at as Date).getTime(),
    );

    // an edit that also counts a use is still an edit
    const both = await one(
      `UPDATE saved_replies SET used_count = used_count + 1, body = 'changed' WHERE org_id = $1 AND id = $2 RETURNING row_version`,
      [orgA, created.id],
    );
    expect(both.row_version).toBe(Number(created.row_version) + 2);
  });

  it('the list order index exists for most-used-first reads', async () => {
    const r = await one(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'saved_replies' AND indexname = 'idx_saved_replies_usage'`,
    );
    expect(String(r.indexdef)).toContain('used_count DESC');
  });
});
