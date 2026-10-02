import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The platform content tables against a real Postgres, as the restricted application role (a superuser would bypass
 * every policy and make these assertions vacuous, see rls.spec.ts): anyone may read what visitors read, only the
 * privileged flag writes, the contact table is insert-only for the public, and the blog view counter's function does
 * its one job without leaking the flag or touching the post's version.
 */
describe('marketing-site tables: RLS, constraints, view counter', () => {
  const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
  const READABLE = [
    'frontend_content',
    'blog_posts',
    'blog_categories',
    'legal_pages',
    'pricing_faqs',
    'announcements',
    'guidebook_articles',
  ] as const;

  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;

  /** Runs `fn` on the application connection inside a transaction with the given settings, then rolls back. */
  async function as<T>(setup: string[], fn: () => Promise<T>): Promise<T> {
    await app.query('BEGIN');
    try {
      for (const stmt of setup) await app.query(stmt);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  }
  const nobody = <T>(fn: () => Promise<T>) => as([], fn);
  const privileged = <T>(fn: () => Promise<T>) =>
    as([`SELECT set_config('app.privileged', 'on', true)`], fn);
  const tenant = <T>(fn: () => Promise<T>) =>
    as([`SELECT set_config('app.org_id', '1', true)`], fn);

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
    app = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: 'crm',
      user: 'crm_app_user',
      password: 'test',
    });
    await app.connect();

    await owner.query(`
      INSERT INTO blog_categories (name, slug) VALUES ('Guides', 'guides');
      INSERT INTO blog_posts (title, slug, status, published_at, category_id) VALUES
        ('Live', 'live', 'published', now() - interval '1 day', (SELECT id FROM blog_categories)),
        ('Scheduled', 'scheduled', 'published', now() + interval '1 day', NULL),
        ('Draft', 'draft', 'draft', NULL, NULL);
      INSERT INTO frontend_content (ckey, type, draft, published) VALUES ('home.hero.eyebrow', 'text', 'd', 'p');
      INSERT INTO legal_pages (slug, title) VALUES ('terms', 'Terms');
      INSERT INTO pricing_faqs (question, answer) VALUES ('q', 'a');
      INSERT INTO announcements (text) VALUES ('hello');
      INSERT INTO guidebook_articles (slug, title) VALUES ('start', 'Start');
      INSERT INTO contact_messages (name, email, message) VALUES ('A', 'a@b.co', 'hi');
    `);
  }, 180_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  describe('every table has row-level security enabled AND forced', () => {
    it.each([...READABLE, 'contact_messages'])('%s', async (table) => {
      const res = await owner.query(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`,
        [table],
      );
      expect(res.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    });
  });

  describe('visitors read, only the privileged flag writes', () => {
    it.each(READABLE)('%s: readable with no tenant and no privilege', async (table) => {
      const rows = await nobody(async () => (await app.query(`SELECT 1 FROM ${table}`)).rows);
      expect(rows.length).toBeGreaterThan(0);
    });

    it.each(READABLE)('%s: readable inside a tenant transaction too', async (table) => {
      const rows = await tenant(async () => (await app.query(`SELECT 1 FROM ${table}`)).rows);
      expect(rows.length).toBeGreaterThan(0);
    });

    const WRITES: Record<
      (typeof READABLE)[number],
      { insert: string; update: string; remove: string }
    > = {
      frontend_content: {
        insert: `INSERT INTO frontend_content (ckey, draft) VALUES ('x.y.z', 'v')`,
        update: `UPDATE frontend_content SET draft = 'z'`,
        remove: `DELETE FROM frontend_content`,
      },
      blog_posts: {
        insert: `INSERT INTO blog_posts (title, slug) VALUES ('t', 'new-slug')`,
        update: `UPDATE blog_posts SET title = 'z'`,
        remove: `DELETE FROM blog_posts`,
      },
      blog_categories: {
        insert: `INSERT INTO blog_categories (name, slug) VALUES ('n', 'n')`,
        update: `UPDATE blog_categories SET name = 'z'`,
        remove: `DELETE FROM blog_categories`,
      },
      legal_pages: {
        insert: `INSERT INTO legal_pages (slug, title) VALUES ('privacy', 'P')`,
        update: `UPDATE legal_pages SET title = 'z'`,
        remove: `DELETE FROM legal_pages`,
      },
      pricing_faqs: {
        insert: `INSERT INTO pricing_faqs (question, answer) VALUES ('q2', 'a2')`,
        update: `UPDATE pricing_faqs SET answer = 'z'`,
        remove: `DELETE FROM pricing_faqs`,
      },
      announcements: {
        insert: `INSERT INTO announcements (text) VALUES ('t2')`,
        update: `UPDATE announcements SET text = 'z'`,
        remove: `DELETE FROM announcements`,
      },
      guidebook_articles: {
        insert: `INSERT INTO guidebook_articles (slug, title) VALUES ('s2', 't2')`,
        update: `UPDATE guidebook_articles SET title = 'z'`,
        remove: `DELETE FROM guidebook_articles`,
      },
    };

    describe.each(READABLE)('%s', (table) => {
      it('refuses an insert with no privilege and inside a tenant', async () => {
        await expect(nobody(() => app.query(WRITES[table].insert))).rejects.toThrow(
          /row-level security/,
        );
        await expect(tenant(() => app.query(WRITES[table].insert))).rejects.toThrow(
          /row-level security/,
        );
      });

      it('updates and deletes nothing without the privileged flag (the rows are invisible to the write)', async () => {
        for (const run of [nobody, tenant]) {
          expect((await run(() => app.query(WRITES[table].update))).rowCount).toBe(0);
          expect((await run(() => app.query(WRITES[table].remove))).rowCount).toBe(0);
        }
      });

      it('writes with the privileged flag', async () => {
        expect((await privileged(() => app.query(WRITES[table].update))).rowCount).toBeGreaterThan(
          0,
        );
        expect((await privileged(() => app.query(WRITES[table].remove))).rowCount).toBeGreaterThan(
          0,
        );
      });
    });

    it('the writes above changed nothing (every test rolled back)', async () => {
      const res = await owner.query(
        `SELECT (SELECT count(*) FROM blog_posts)::int AS posts, (SELECT count(*) FROM legal_pages)::int AS legal`,
      );
      expect(res.rows[0]).toEqual({ posts: 3, legal: 1 });
    });
  });

  describe('contact_messages: the public may add a message and nothing else', () => {
    it('inserts with no tenant and no privilege', async () => {
      const res = await nobody(() =>
        app.query(
          `INSERT INTO contact_messages (name, email, message, ip) VALUES ('V', 'v@x.co', 'hello', '203.0.113.1')`,
        ),
      );
      expect(res.rowCount).toBe(1);
    });

    it('cannot read, update or delete any message, with or without a tenant', async () => {
      for (const run of [nobody, tenant]) {
        expect((await run(() => app.query(`SELECT * FROM contact_messages`))).rowCount).toBe(0);
        expect(
          (await run(() => app.query(`UPDATE contact_messages SET is_read = true`))).rowCount,
        ).toBe(0);
        expect((await run(() => app.query(`DELETE FROM contact_messages`))).rowCount).toBe(0);
      }
    });

    it('cannot read the row it just inserted back (no RETURNING for visitors)', async () => {
      await expect(
        nobody(() =>
          app.query(
            `INSERT INTO contact_messages (name, email, message) VALUES ('V', 'v@x.co', 'x') RETURNING id`,
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('the privileged flag reads and deletes', async () => {
      expect((await privileged(() => app.query(`SELECT * FROM contact_messages`))).rowCount).toBe(
        1,
      );
      expect((await privileged(() => app.query(`DELETE FROM contact_messages`))).rowCount).toBe(1);
    });
  });

  describe('constraints hold even for the owner', () => {
    it('a blog slug, a category slug, a content key and a legal slug are unique', async () => {
      await expect(
        owner.query(`INSERT INTO blog_posts (title, slug) VALUES ('x', 'live')`),
      ).rejects.toThrow(/uq_blog_posts_slug/);
      await expect(
        owner.query(`INSERT INTO blog_categories (name, slug) VALUES ('x', 'guides')`),
      ).rejects.toThrow(/uq_blog_categories_slug/);
      await expect(
        owner.query(`INSERT INTO frontend_content (ckey) VALUES ('home.hero.eyebrow')`),
      ).rejects.toThrow(/uq_frontend_content_ckey/);
      await expect(
        owner.query(`INSERT INTO legal_pages (slug, title) VALUES ('terms', 'x')`),
      ).rejects.toThrow(/uq_legal_pages_slug/);
    });

    it('deleting a category keeps its posts, uncategorised', async () => {
      await owner.query('BEGIN');
      try {
        await owner.query(`DELETE FROM blog_categories WHERE slug = 'guides'`);
        const res = await owner.query(`SELECT category_id FROM blog_posts WHERE slug = 'live'`);
        expect(res.rows[0].category_id).toBeNull();
      } finally {
        await owner.query('ROLLBACK');
      }
    });

    it('the touch trigger bumps row_version and updated_at on an ordinary edit', async () => {
      await owner.query('BEGIN');
      try {
        const before = (
          await owner.query(`SELECT row_version, updated_at FROM blog_posts WHERE slug = 'draft'`)
        ).rows[0];
        await owner.query(`SELECT pg_sleep(0.01)`);
        await owner.query(`UPDATE blog_posts SET title = 'Draft 2' WHERE slug = 'draft'`);
        const after = (
          await owner.query(`SELECT row_version, updated_at FROM blog_posts WHERE slug = 'draft'`)
        ).rows[0];
        expect(after.row_version).toBe(before.row_version + 1);
        expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
      } finally {
        await owner.query('ROLLBACK');
      }
    });
  });

  describe('cms_record_blog_view()', () => {
    const views = async (slug: string) =>
      Number(
        (await owner.query(`SELECT views FROM blog_posts WHERE slug = $1`, [slug])).rows[0].views,
      );

    it('counts a view of a live post for a caller with no privilege, without moving updated_at or row_version', async () => {
      const before = (
        await owner.query(
          `SELECT views, updated_at, row_version FROM blog_posts WHERE slug = 'live'`,
        )
      ).rows[0];
      await app.query(`SELECT cms_record_blog_view('live')`);
      await app.query(`SELECT cms_record_blog_view('live')`);
      const after = (
        await owner.query(
          `SELECT views, updated_at, row_version FROM blog_posts WHERE slug = 'live'`,
        )
      ).rows[0];
      expect(Number(after.views)).toBe(Number(before.views) + 2);
      expect(after.updated_at).toEqual(before.updated_at);
      expect(after.row_version).toBe(before.row_version);
      await owner.query(`UPDATE blog_posts SET views = 0 WHERE slug = 'live'`);
    });

    it('counts nothing for a draft, a scheduled post or an unknown slug', async () => {
      await app.query(`SELECT cms_record_blog_view('draft')`);
      await app.query(`SELECT cms_record_blog_view('scheduled')`);
      await app.query(`SELECT cms_record_blog_view('nope')`);
      expect(await views('draft')).toBe(0);
      expect(await views('scheduled')).toBe(0);
    });

    it('does not leave the privileged flag on for the rest of the caller transaction', async () => {
      await app.query('BEGIN');
      try {
        await app.query(`SELECT cms_record_blog_view('live')`);
        const flag = (await app.query(`SELECT current_setting('app.privileged', true) AS v`))
          .rows[0].v;
        expect(flag === null || flag === '' || flag === 'off').toBe(true);
        // ...and so a following write in the same transaction is still refused.
        expect((await app.query(`UPDATE blog_posts SET title = 'hacked'`)).rowCount).toBe(0);
      } finally {
        await app.query('ROLLBACK');
      }
      await owner.query(`UPDATE blog_posts SET views = 0 WHERE slug = 'live'`);
    });

    it('is the only thing the function can do: it takes a slug and returns nothing', async () => {
      const res = await owner.query(
        `SELECT pg_get_function_result(oid) AS result, pg_get_function_arguments(oid) AS args, proconfig
           FROM pg_proc WHERE proname = 'cms_record_blog_view'`,
      );
      expect(res.rows[0].result).toBe('void');
      expect(res.rows[0].args).toBe('p_slug text');
      expect(res.rows[0].proconfig).toEqual(expect.arrayContaining(['app.privileged=on']));
    });

    it('is not executable by PUBLIC, only by the runtime roles', async () => {
      const res = await owner.query(
        `SELECT has_function_privilege('public', 'cms_record_blog_view(text)', 'EXECUTE') AS everyone,
                has_function_privilege('crm_app', 'cms_record_blog_view(text)', 'EXECUTE') AS app,
                has_function_privilege('crm_worker', 'cms_record_blog_view(text)', 'EXECUTE') AS worker`,
      );
      expect(res.rows[0]).toEqual({ everyone: false, app: true, worker: true });
    });
  });
});
