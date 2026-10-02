import { Logger } from '@nestjs/common';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, runMigrations, withPrivileged, withTenant, type DbClient } from '@crm/db';
import type { DatabaseService } from '../../../src/infra/db/database.service';
import type { PlatformStore } from '../../../src/modules/auth';
import { TranslationUsageService } from '../../../src/modules/localization-translation/translation-usage.service';

/**
 * The i18n tables against a real Postgres, as the restricted application role (a superuser would bypass every
 * policy and make the RLS assertions vacuous, see rls.spec.ts): the seed, the single-default invariant, who can read
 * and write the registry and the provider catalogue, tenant isolation of the usage ledger, and the usage
 * service's SQL.
 */
describe('i18n schema, RLS and the usage ledger', () => {
  const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');

  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let dbClient: DbClient;
  let usage: TranslationUsageService;
  let orgA: number;
  let orgB: number;

  async function inTx<T>(setup: string[], fn: () => Promise<T>): Promise<T> {
    await app.query('BEGIN');
    try {
      for (const stmt of setup) await app.query(stmt);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  }
  const asOrg = <T>(orgId: number, fn: () => Promise<T>) =>
    inTx([`SELECT set_config('app.org_id', '${orgId}', true)`], fn);
  const asPrivileged = <T>(fn: () => Promise<T>) =>
    inTx([`SELECT set_config('app.privileged', 'on', true)`], fn);
  const asNobody = <T>(fn: () => Promise<T>) => inTx([], fn);

  beforeAll(async () => {
    Logger.overrideLogger(false);
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

    const org = async (slug: string) =>
      Number(
        (
          await owner.query(`INSERT INTO organizations (slug, name) VALUES ($1, $2) RETURNING id`, [
            slug,
            `Org ${slug}`,
          ])
        ).rows[0].id,
      );
    orgA = await org('i18n-a');
    orgB = await org('i18n-b');

    app = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: 'crm',
      user: 'crm_app_user',
      password: 'test',
    });
    await app.connect();

    dbClient = createDbClient({
      url: `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`,
      poolMax: 4,
    });
    const db = {
      primary: dbClient.db,
      txAs: (
        tenant: Parameters<DatabaseService['txAs']>[0],
        fn: Parameters<DatabaseService['txAs']>[1],
      ) => withTenant(dbClient.db, tenant, fn),
    } as unknown as DatabaseService;
    const store = {
      tx: (fn: Parameters<PlatformStore['tx']>[0]) => withPrivileged(dbClient.db, fn),
    } as unknown as PlatformStore;
    usage = new TranslationUsageService(db, store);
  }, 180_000);

  afterAll(async () => {
    await dbClient?.close();
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  describe('seed (TW-I18N-007, 014)', () => {
    it('ships 21 active languages, with ar, ur and he right-to-left, English first and Bengali last', async () => {
      const rows = (
        await owner.query(
          `SELECT code, direction, is_active FROM languages ORDER BY sort_order, name`,
        )
      ).rows as Array<{ code: string; direction: string; is_active: boolean }>;
      expect(rows).toHaveLength(21);
      expect(rows.every((r) => r.is_active)).toBe(true);
      expect(
        rows
          .filter((r) => r.direction === 'rtl')
          .map((r) => r.code)
          .sort(),
      ).toEqual(['ar', 'he', 'ur']);
      expect(rows[0]!.code).toBe('en');
      expect(rows[20]!.code).toBe('bn');
      expect(rows.find((r) => r.code === 'zh-CN')).toBeTruthy();
    });

    it('seeds the five providers: MyMemory (default) and Google (free) on, the rest off', async () => {
      const rows = (
        await owner.query(
          `SELECT slug, is_active, is_default, sort_order, credentials FROM translation_providers ORDER BY sort_order`,
        )
      ).rows as Array<{
        slug: string;
        is_active: boolean;
        is_default: boolean;
        credentials: string | null;
      }>;
      expect(rows.map((r) => [r.slug, r.is_active, r.is_default])).toEqual([
        ['mymemory', true, true],
        ['google_gtx', true, false],
        ['libretranslate', false, false],
        ['deepl', false, false],
        ['google_cloud', false, false],
      ]);
      expect(rows.every((r) => r.credentials === null)).toBe(true);
    });

    it('is idempotent and never overwrites an operator edit when the seed runs again', async () => {
      await owner.query(
        `UPDATE languages SET name = 'Anglais', is_active = false WHERE code = 'en'`,
      );
      const seed = readFileSync(
        resolve(MIGRATIONS, '20261003090000_i18n_registry_seed.sql'),
        'utf8',
      );
      // Only the INSERT statements: the index and permission statements are not idempotent by design.
      const inserts = seed.match(
        /INSERT INTO (?:languages|translation_providers)[\s\S]*?ON CONFLICT \(\w+\) DO NOTHING;/g,
      )!;
      expect(inserts).toHaveLength(2);
      for (const s of inserts) await owner.query(s);
      expect((await owner.query(`SELECT count(*)::int AS n FROM languages`)).rows[0].n).toBe(21);
      const en = (await owner.query(`SELECT name, is_active FROM languages WHERE code = 'en'`))
        .rows[0];
      expect(en).toEqual({ name: 'Anglais', is_active: false });
      await owner.query(
        `UPDATE languages SET name = 'English', is_active = true WHERE code = 'en'`,
      );
    });

    it('registers the workspace permission keys', async () => {
      const keys = (
        await owner.query(`SELECT key FROM permission_defs WHERE key LIKE 'i18n.%' ORDER BY key`)
      ).rows.map((r) => r.key);
      expect(keys).toEqual(['i18n.translation_settings.read', 'i18n.translation_settings.update']);
    });
  });

  describe('constraints', () => {
    it('refuses a second default provider (the database enforces the single default)', async () => {
      await expect(
        owner.query(`UPDATE translation_providers SET is_default = true WHERE slug = 'deepl'`),
      ).rejects.toThrow(/uq_translation_providers_single_default/);
    });

    it('refuses a duplicate language code and a direction other than ltr or rtl', async () => {
      await expect(
        owner.query(`INSERT INTO languages (code, name) VALUES ('en', 'Again')`),
      ).rejects.toThrow(/uq_languages_code/);
      await expect(
        owner.query(`INSERT INTO languages (code, name, direction) VALUES ('xx', 'X', 'sideways')`),
      ).rejects.toThrow(/chk_languages_direction/);
    });

    it('bumps row_version on every update (the optimistic lock)', async () => {
      const before = (await owner.query(`SELECT row_version FROM languages WHERE code = 'es'`))
        .rows[0].row_version as number;
      await owner.query(`UPDATE languages SET sort_order = sort_order WHERE code = 'es'`);
      const after = (await owner.query(`SELECT row_version FROM languages WHERE code = 'es'`))
        .rows[0].row_version as number;
      expect(after).toBe(before + 1);
    });
  });

  describe('row-level security', () => {
    it('lets every tenant and even an unscoped session read the language registry', async () => {
      expect(
        await asNobody(
          async () => (await app.query(`SELECT count(*)::int AS n FROM languages`)).rows[0].n,
        ),
      ).toBe(21);
      expect(
        await asOrg(
          orgA,
          async () => (await app.query(`SELECT count(*)::int AS n FROM languages`)).rows[0].n,
        ),
      ).toBe(21);
    });

    it('refuses a tenant a write to the registry, and allows the privileged flag', async () => {
      await asOrg(orgA, async () => {
        const res = await app.query(
          `UPDATE languages SET name = 'Hacked' WHERE code = 'en' RETURNING id`,
        );
        expect(res.rowCount).toBe(0); // the row is invisible to the write policy: nothing changes
      });
      await asOrg(orgA, async () => {
        await expect(
          app.query(`INSERT INTO languages (code, name) VALUES ('zz', 'Z')`),
        ).rejects.toThrow(/row-level security/);
      });
      await asPrivileged(async () => {
        const res = await app.query(
          `UPDATE languages SET native_name = 'EN' WHERE code = 'en' RETURNING id`,
        );
        expect(res.rowCount).toBe(1);
      });
    });

    it('hides the provider catalogue (and its credentials) from every tenant', async () => {
      await owner.query(
        `UPDATE translation_providers SET credentials = 'v1:x:y:z' WHERE slug = 'deepl'`,
      );
      expect(
        await asOrg(
          orgA,
          async () => (await app.query(`SELECT * FROM translation_providers`)).rowCount,
        ),
      ).toBe(0);
      expect(
        await asNobody(
          async () => (await app.query(`SELECT * FROM translation_providers`)).rowCount,
        ),
      ).toBe(0);
      expect(
        await asPrivileged(
          async () => (await app.query(`SELECT * FROM translation_providers`)).rowCount,
        ),
      ).toBe(5);
      await owner.query(`UPDATE translation_providers SET credentials = NULL WHERE slug = 'deepl'`);
    });

    it('isolates the usage ledger by organization, in both directions (USING and WITH CHECK)', async () => {
      await asOrg(orgA, async () => {
        await app.query(
          `INSERT INTO translation_usage (org_id, provider_slug, source_lang, target_lang) VALUES ($1, 'deepl', 'es', 'en')`,
          [orgA],
        );
        await expect(
          app.query(
            `INSERT INTO translation_usage (org_id, provider_slug, source_lang, target_lang) VALUES ($1, 'deepl', 'es', 'en')`,
            [orgB],
          ),
        ).rejects.toThrow(/row-level security/);
      });
      await owner.query(
        `INSERT INTO translation_usage (org_id, provider_slug, source_lang, target_lang) VALUES ($1, 'deepl', 'fr', 'en')`,
        [orgB],
      );
      expect(
        await asOrg(
          orgA,
          async () => (await app.query(`SELECT * FROM translation_usage`)).rowCount,
        ),
      ).toBe(0); // the first insert was rolled back with its transaction; org B's row is invisible to A
      await owner.query(`DELETE FROM translation_usage`);
    });

    it('has forced RLS on all three tables, and a policy on the default usage partition', async () => {
      const rows = (
        await owner.query(
          `SELECT relname, relrowsecurity, relforcerowsecurity,
                  (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
           FROM pg_class c
           WHERE relname IN ('languages', 'translation_providers', 'translation_usage', 'translation_usage_default')`,
        )
      ).rows as Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean; policies: number }>;
      expect(rows).toHaveLength(4);
      for (const r of rows) {
        expect(r.relrowsecurity).toBe(true);
        expect(r.relforcerowsecurity).toBe(true);
        expect(r.policies).toBeGreaterThan(0);
      }
    });
  });

  describe('TranslationUsageService (TW-I18N-029, 030)', () => {
    const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
    async function row(
      org: number,
      slug: string,
      charsIn: number,
      at: Date,
      fallback = false,
      charsOut = charsIn,
      cost = slug === 'deepl' ? charsIn * 20 : 0,
    ) {
      await owner.query(
        `INSERT INTO translation_usage (org_id, provider_slug, source_lang, target_lang, chars_in, chars_out, cost_micros, was_fallback, called_at, created_at)
         VALUES ($1, $2, 'es', 'en', $3, $4, $5, $6, $7, $7)`,
        [org, slug, charsIn, charsOut, cost, fallback, at],
      );
    }

    it('records a call with its cost, and a fallback flag', async () => {
      await owner.query(`DELETE FROM translation_usage`);
      await usage.record(orgA, {
        providerSlug: 'deepl',
        sourceLang: 'es',
        targetLang: 'en',
        charsIn: 100,
        charsOut: 90,
        wasFallback: false,
      });
      await usage.record(orgA, {
        providerSlug: 'google_gtx',
        sourceLang: 'es',
        targetLang: 'en',
        charsIn: 40,
        charsOut: 38,
        wasFallback: true,
      });
      const rows = (
        await owner.query(
          `SELECT provider_slug, chars_in, chars_out, cost_micros::int AS cost, was_fallback FROM translation_usage ORDER BY id`,
        )
      ).rows;
      expect(rows).toEqual([
        { provider_slug: 'deepl', chars_in: 100, chars_out: 90, cost: 2000, was_fallback: false },
        { provider_slug: 'google_gtx', chars_in: 40, chars_out: 38, cost: 0, was_fallback: true },
      ]);
    });

    it('records nothing without a workspace', async () => {
      await owner.query(`DELETE FROM translation_usage`);
      await usage.record(null, {
        providerSlug: 'deepl',
        sourceLang: 'es',
        targetLang: 'en',
        charsIn: 5,
        charsOut: 5,
        wasFallback: false,
      });
      expect(
        (await owner.query(`SELECT count(*)::int AS n FROM translation_usage`)).rows[0].n,
      ).toBe(0);
    });

    it("sums this month's characters and calls for one workspace only", async () => {
      await owner.query(`DELETE FROM translation_usage`);
      const now = new Date();
      await row(orgA, 'deepl', 100, now, false, 80);
      await row(orgA, 'mymemory', 50, now, false, 45);
      await row(orgB, 'deepl', 999, now);
      await row(orgA, 'deepl', 7, new Date(Date.UTC(2020, 0, 5))); // long ago: not this month
      expect(await usage.monthToDate(orgA)).toEqual({ characters: 275, calls: 2 });
      expect(await usage.monthToDate(orgB)).toEqual({ characters: 1998, calls: 1 });
    });

    it('builds the operator report for a range: totals, per provider, timeline, top workspaces', async () => {
      await owner.query(`DELETE FROM translation_usage`);
      await row(orgA, 'deepl', 100, day('2026-03-02'), false, 90);
      await row(orgA, 'deepl', 200, day('2026-03-03'), true, 180);
      await row(orgA, 'mymemory', 50, day('2026-03-03'), false, 40);
      await row(orgB, 'google_gtx', 400, day('2026-03-10'), false, 380);
      await row(orgB, 'deepl', 10, day('2026-04-01')); // outside the range

      const r = await usage.report({ from: '2026-03-01', to: '2026-03-31' }, day('2026-04-02'));
      expect(r.range.from).toBe('2026-03-01T00:00:00.000Z');
      expect(r.totals).toEqual({
        calls: 4,
        charsIn: 750,
        charsOut: 690,
        costMicros: String(100 * 20 + 200 * 20),
        fallbackHits: 1,
      });
      expect(
        r.byProvider.map((p) => [
          p.providerSlug,
          p.calls,
          p.charsIn,
          p.costMicros,
          p.ratePerMillionChars,
        ]),
      ).toEqual([
        ['deepl', 2, 300, '6000', '20000000'],
        ['google_gtx', 1, 400, '0', '0'],
        ['mymemory', 1, 50, '0', '0'],
      ]);
      expect(r.timeline.map((t) => [t.date, t.charsIn])).toEqual([
        ['2026-03-02', 100],
        ['2026-03-03', 250],
        ['2026-03-10', 400],
      ]);
      // ordered by cost, then characters: A spent money, B did not
      expect(r.topWorkspaces.map((w) => [w.name, w.calls, w.charsIn, w.costMicros])).toEqual([
        ['Org i18n-a', 3, 350, '6000'],
        ['Org i18n-b', 1, 400, '0'],
      ]);
    });

    it('defaults to the current month and returns empty sets for an empty ledger', async () => {
      await owner.query(`DELETE FROM translation_usage`);
      const r = await usage.report({}, day('2026-05-15'));
      expect(r.range.from).toBe('2026-05-01T00:00:00.000Z');
      expect(r.totals).toEqual({
        calls: 0,
        charsIn: 0,
        charsOut: 0,
        costMicros: '0',
        fallbackHits: 0,
      });
      expect(r.byProvider).toEqual([]);
      expect(r.timeline).toEqual([]);
      expect(r.topWorkspaces).toEqual([]);
    });

    it('includes the whole of the last day of the range', async () => {
      await owner.query(`DELETE FROM translation_usage`);
      await row(orgA, 'deepl', 10, new Date('2026-03-31T23:59:00.000Z'));
      const r = await usage.report({ from: '2026-03-31', to: '2026-03-31' }, day('2026-04-02'));
      expect(r.totals.calls).toBe(1);
    });
  });
});
