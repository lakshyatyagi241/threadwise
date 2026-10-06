import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The Forms add-on's tables against a real Postgres as the restricted application role (a superuser bypasses every policy): forced RLS,
 * a cross-tenant read AND write attempt, composite foreign keys, the immutability of a version, the public lookup function, the unique
 * keys, the bookkeeping trigger of the round-robin cursor, the stream's partitions, and the marketplace and permission seeds.
 */
describe('forms: schema, isolation, public lookup and seeds', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let userA: number;
  let formA: number;
  let formB: number;
  let versionA: number;
  let versionB: number;
  let contactA: number;
  let contactB: number;
  const keyA = 'AaAaAaAaAaAaAaAaAaAaAa';
  const keyB = 'BbBbBbBbBbBbBbBbBbBbBb';
  const definition = JSON.stringify({ title: 'T', steps: [{ id: 's', blocks: [] }] });

  const asTenant = async <T>(org: number, fn: () => Promise<T>): Promise<T> => {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(org)]);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  };
  const insertForm = async (
    org: number,
    name: string,
    key: string,
    status = 'draft',
    createdBy: number | null = null,
  ) =>
    Number(
      (
        await owner.query(
          `INSERT INTO web_forms (org_id, name, public_key, draft_definition, status, created_by)
           VALUES ($1,$2,$3,$4::jsonb,$5,$6) RETURNING id`,
          [org, name, key, definition, status, createdBy],
        )
      ).rows[0].id,
    );
  const insertVersion = async (org: number, form: number, n: number) =>
    Number(
      (
        await owner.query(
          `INSERT INTO web_form_versions (org_id, form_id, version, definition) VALUES ($1,$2,$3,$4::jsonb) RETURNING id`,
          [org, form, n, definition],
        )
      ).rows[0].id,
    );
  const insertSubmission = (
    org: number,
    form: number,
    version: number,
    key: string,
    contact: number | null = null,
    token = key + 'tok',
  ) =>
    owner.query(
      `INSERT INTO web_form_submissions (org_id, form_id, version_id, idempotency_key, receipt_token, contact_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [org, form, version, key, token, contact],
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
          await owner.query(
            `INSERT INTO organizations (slug,name,plan) VALUES ($1,$1,'starter') RETURNING id`,
            [slug],
          )
        ).rows[0].id,
      );
    orgA = await org('fa');
    orgB = await org('fb');
    userA = Number(
      (
        await owner.query(
          `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'a@x.test','Ann','x') RETURNING id`,
          [orgA],
        )
      ).rows[0].id,
    );
    formA = await insertForm(orgA, 'Contact us', keyA, 'draft', userA);
    formB = await insertForm(orgB, 'Contact us', keyB);
    versionA = await insertVersion(orgA, formA, 1);
    versionB = await insertVersion(orgB, formB, 1);
    contactA = Number(
      (
        await owner.query(`INSERT INTO contacts (org_id, name) VALUES ($1,'Ann C') RETURNING id`, [
          orgA,
        ])
      ).rows[0].id,
    );
    contactB = Number(
      (
        await owner.query(`INSERT INTO contacts (org_id, name) VALUES ($1,'Bob C') RETURNING id`, [
          orgB,
        ])
      ).rows[0].id,
    );
    await insertSubmission(orgA, formA, versionA, 'sub-a-0001', contactA);
    await insertSubmission(orgB, formB, versionB, 'sub-b-0001', contactB);
    await owner.query(
      `INSERT INTO web_form_events (org_id, form_id, visit_id, kind) VALUES ($1,$2,'visit-a-0001','view'), ($3,$4,'visit-b-0001','view')`,
      [orgA, formA, orgB, formB],
    );
    await owner.query(
      `INSERT INTO web_form_usage_monthly (org_id, period, spam_blocked) VALUES ($1, date_trunc('month', now())::date, 3)`,
      [orgA],
    );
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

  const TABLES = [
    'web_forms',
    'web_form_versions',
    'web_form_submissions',
    'web_form_usage_monthly',
    'web_form_events',
  ];

  it('RLS is enabled AND forced with a tenant_isolation policy on every table and on the stream partitions', async () => {
    const res = await owner.query(
      `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
              (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation')::int AS pol
       FROM pg_class c
       WHERE c.relkind IN ('r','p') AND (c.relname = ANY($1) OR c.relname LIKE 'web_form_events\\_%')
       ORDER BY c.relname`,
      [TABLES],
    );
    const names = res.rows.map((r) => r.relname as string);
    expect(names).toEqual(expect.arrayContaining([...TABLES, 'web_form_events_default']));
    for (const r of res.rows) {
      expect(r.rls, r.relname).toBe(true);
      expect(r.forced, r.relname).toBe(true);
      expect(r.pol, r.relname).toBe(1);
    }
  });

  it('a tenant reads only its own rows on every table', async () => {
    for (const t of TABLES) {
      const a = await asTenant(orgA, async () => (await app.query(`SELECT org_id FROM ${t}`)).rows);
      expect(a.length, t).toBeGreaterThan(0);
      expect(new Set(a.map((r) => Number(r.org_id))), t).toEqual(new Set([orgA]));
    }
    expect(
      await asTenant(
        orgA,
        async () => (await app.query(`SELECT 1 FROM web_forms WHERE id = $1`, [formB])).rows,
      ),
    ).toEqual([]);
    expect(
      await asTenant(
        orgA,
        async () =>
          (await app.query(`SELECT 1 FROM web_form_submissions WHERE org_id = $1`, [orgB])).rows,
      ),
    ).toEqual([]);
  });

  it('with no tenant at all the application role sees nothing (the public lookup function is the only way in)', async () => {
    for (const t of TABLES) expect((await app.query(`SELECT 1 FROM ${t}`)).rows, t).toEqual([]);
  });

  it('a tenant cannot write a row into another tenant, nor update or delete one', async () => {
    await expect(
      asTenant(orgA, () =>
        app.query(
          `INSERT INTO web_forms (org_id, name, public_key, draft_definition) VALUES ($1,'Sneaky',$2,'{}'::jsonb)`,
          [orgB, 'SnSnSnSnSnSnSnSnSnSnSn'],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asTenant(orgA, () =>
        app.query(
          `INSERT INTO web_form_events (org_id, form_id, visit_id, kind) VALUES ($1,$2,'visit-sneak','view')`,
          [orgB, formB],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    const upd = await asTenant(orgA, () =>
      app.query(`UPDATE web_forms SET name = 'Hacked' WHERE id = $1`, [formB]),
    );
    expect(upd.rowCount).toBe(0);
    const del = await asTenant(orgA, () =>
      app.query(`DELETE FROM web_form_submissions WHERE org_id = $1`, [orgB]),
    );
    expect(del.rowCount).toBe(0);
    expect(
      (await owner.query(`SELECT name FROM web_forms WHERE id = $1`, [formB])).rows[0].name,
    ).toBe('Contact us');
  });

  it("composite foreign keys: a submission cannot point at another tenant's form, version or contact", async () => {
    await expect(insertSubmission(orgA, formB, versionA, 'cross-form-0001')).rejects.toThrow(
      /fk_web_form_submissions_form/,
    );
    await expect(insertSubmission(orgA, formA, versionB, 'cross-ver-0001')).rejects.toThrow(
      /fk_web_form_submissions_version/,
    );
    await expect(
      insertSubmission(orgA, formA, versionA, 'cross-con-0001', contactB),
    ).rejects.toThrow(/fk_web_form_submissions_contact/);
    await expect(insertVersion(orgA, formB, 9)).rejects.toThrow(/fk_web_form_versions_form/);
    await expect(
      owner.query(
        `INSERT INTO web_forms (org_id, name, public_key, draft_definition, created_by) VALUES ($1,'X',$2,'{}'::jsonb,$3)`,
        [orgB, 'XxXxXxXxXxXxXxXxXxXxXx', userA],
      ),
    ).rejects.toThrow(/fk_web_forms_created_by/);
  });

  it('a version is immutable: its definition, number and form cannot change; the publisher link may be nulled', async () => {
    await expect(
      owner.query(`UPDATE web_form_versions SET definition = '{"x":1}'::jsonb WHERE id = $1`, [
        versionA,
      ]),
    ).rejects.toThrow(/immutable/);
    await expect(
      owner.query(`UPDATE web_form_versions SET version = 7 WHERE id = $1`, [versionA]),
    ).rejects.toThrow(/immutable/);
    await owner.query(`UPDATE web_form_versions SET published_by = $2 WHERE id = $1`, [
      versionA,
      userA,
    ]);
    await owner.query(`UPDATE web_form_versions SET published_by = NULL WHERE id = $1`, [versionA]);
  });

  it('a version number is unique per form, and a key, a receipt and an idempotency key are unique where they must be', async () => {
    await expect(insertVersion(orgA, formA, 1)).rejects.toThrow(/uq_web_form_versions_number/);
    await expect(insertForm(orgB, 'Other', keyA)).rejects.toThrow(/uq_web_forms_public_key/);
    await expect(
      insertSubmission(orgA, formA, versionA, 'sub-a-0001', null, 'othertoken-1'),
    ).rejects.toThrow(/uq_web_form_submissions_idempotency/);
    await expect(
      insertSubmission(orgA, formA, versionA, 'sub-a-0002', null, 'sub-a-0001tok'),
    ).rejects.toThrow(/uq_web_form_submissions_receipt/);
    // The same idempotency key on ANOTHER form is a different submission.
    const other = await insertForm(orgA, 'Second form', 'CcCcCcCcCcCcCcCcCcCcCc');
    const v = await insertVersion(orgA, other, 1);
    await insertSubmission(orgA, other, v, 'sub-a-0001', null, 'sub-a-0001tok-2');
  });

  it('a name is unique among the forms that are not archived', async () => {
    await expect(insertForm(orgA, 'CONTACT US', 'DdDdDdDdDdDdDdDdDdDdDd')).rejects.toThrow(
      /uq_web_forms_name/,
    );
    await owner.query(`UPDATE web_forms SET status = 'archived' WHERE id = $1`, [formA]);
    const reuse = await insertForm(orgA, 'contact us', 'DdDdDdDdDdDdDdDdDdDdDd');
    expect(reuse).toBeGreaterThan(0);
    await expect(
      owner.query(`UPDATE web_forms SET status = 'draft' WHERE id = $1`, [formA]),
    ).rejects.toThrow(/uq_web_forms_name/);
    await owner.query(`DELETE FROM web_forms WHERE id = $1`, [reuse]);
    await owner.query(`UPDATE web_forms SET status = 'draft' WHERE id = $1`, [formA]);
  });

  it('value rules: key shape, status, retention bounds, and a live form needs a live version', async () => {
    await expect(insertForm(orgA, 'Bad key', 'short')).rejects.toThrow(/chk_web_forms_key/);
    await expect(insertForm(orgA, 'Bad status', 'EeEeEeEeEeEeEeEeEeEeEe', 'live')).rejects.toThrow(
      /chk_web_forms_status/,
    );
    await expect(
      insertForm(orgA, 'Live without version', 'FfFfFfFfFfFfFfFfFfFfFf', 'published'),
    ).rejects.toThrow(/chk_web_forms_published/);
    await expect(
      owner.query(`UPDATE web_forms SET retention_days = 5 WHERE id = $1`, [formA]),
    ).rejects.toThrow(/chk_web_forms_retention/);
    await expect(
      owner.query(`UPDATE web_forms SET retention_days = 5000 WHERE id = $1`, [formA]),
    ).rejects.toThrow(/chk_web_forms_retention/);
    await owner.query(`UPDATE web_forms SET retention_days = NULL WHERE id = $1`, [formA]);
    await owner.query(`UPDATE web_forms SET retention_days = 365 WHERE id = $1`, [formA]);
    await expect(
      owner.query(
        `INSERT INTO web_form_submissions (org_id, form_id, version_id, idempotency_key, receipt_token, status) VALUES ($1,$2,$3,'sub-a-bad01','tok-bad-01','weird')`,
        [orgA, formA, versionA],
      ),
    ).rejects.toThrow(/chk_web_form_submissions_status/);
    await expect(insertSubmission(orgA, formA, versionA, 'short')).rejects.toThrow(
      /chk_web_form_submissions_key/,
    );
  });

  it("the round-robin cursor moves without touching the editor's row version; any other change bumps it", async () => {
    const before = (
      await owner.query(`SELECT row_version, updated_at FROM web_forms WHERE id = $1`, [formA])
    ).rows[0];
    await owner.query(`UPDATE web_forms SET rr_cursor = rr_cursor + 1 WHERE id = $1`, [formA]);
    const same = (
      await owner.query(`SELECT row_version, updated_at, rr_cursor FROM web_forms WHERE id = $1`, [
        formA,
      ])
    ).rows[0];
    expect(same.row_version).toBe(before.row_version);
    expect(same.updated_at).toEqual(before.updated_at);
    expect(Number(same.rr_cursor)).toBeGreaterThan(0);
    await owner.query(`UPDATE web_forms SET honeypot = false WHERE id = $1`, [formA]);
    const after = (await owner.query(`SELECT row_version FROM web_forms WHERE id = $1`, [formA]))
      .rows[0];
    expect(after.row_version).toBe(before.row_version + 1);
  });

  describe('web_form_lookup (the only door for an anonymous request)', () => {
    const lookup = async (key: string) =>
      (await app.query(`SELECT * FROM web_form_lookup($1)`, [key])).rows as Array<
        Record<string, unknown>
      >;

    it('finds the workspace, form and live version by key without any tenant context, and returns ids and a status only', async () => {
      await owner.query(
        `UPDATE web_forms SET status = 'published', published_version_id = $2, allowed_origins = ARRAY['https://a.example.com'] WHERE id = $1`,
        [formA, versionA],
      );
      const rows = await lookup(keyA);
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0]!).sort()).toEqual(
        [
          'route_allowed_origins',
          'route_form_id',
          'route_org_id',
          'route_published_version_id',
          'route_status',
        ].sort(),
      );
      expect(Number(rows[0]!.route_org_id)).toBe(orgA);
      expect(Number(rows[0]!.route_form_id)).toBe(formA);
      expect(Number(rows[0]!.route_published_version_id)).toBe(versionA);
      expect(rows[0]!.route_status).toBe('published');
      expect(rows[0]!.route_allowed_origins).toEqual(['https://a.example.com']);
    });

    it('does not leave the connection privileged: a direct read right after still sees nothing', async () => {
      await lookup(keyA);
      expect((await app.query(`SELECT 1 FROM web_forms`)).rows).toEqual([]);
    });

    it('returns a paused form (the page says it is closed), nothing for an archived or unknown key, and does not mix keys up', async () => {
      await owner.query(`UPDATE web_forms SET status = 'paused' WHERE id = $1`, [formA]);
      expect((await lookup(keyA))[0]!.route_status).toBe('paused');
      await owner.query(`UPDATE web_forms SET status = 'archived' WHERE id = $1`, [formA]);
      expect(await lookup(keyA)).toEqual([]);
      expect(await lookup('ZzZzZzZzZzZzZzZzZzZzZz')).toEqual([]);
      expect(await lookup(keyB)).toHaveLength(1);
      expect(Number((await lookup(keyB))[0]!.route_org_id)).toBe(orgB);
      await owner.query(
        `UPDATE web_forms SET status = 'draft', published_version_id = NULL WHERE id = $1`,
        [formA],
      );
    });
  });

  it('deleting a form takes its versions and submissions; deleting a contact only unlinks its submissions', async () => {
    const f = await insertForm(orgA, 'To delete', 'GgGgGgGgGgGgGgGgGgGgGg');
    const v = await insertVersion(orgA, f, 1);
    const c = Number(
      (
        await owner.query(`INSERT INTO contacts (org_id, name) VALUES ($1,'Gone') RETURNING id`, [
          orgA,
        ])
      ).rows[0].id,
    );
    await insertSubmission(orgA, f, v, 'del-0000001', c, 'del-token-1');
    await owner.query(
      `INSERT INTO web_form_events (org_id, form_id, visit_id, kind) VALUES ($1,$2,'visit-del-01','view')`,
      [orgA, f],
    );
    await owner.query(`DELETE FROM contacts WHERE org_id = $1 AND id = $2`, [orgA, c]);
    const kept = (
      await owner.query(
        `SELECT contact_id FROM web_form_submissions WHERE org_id = $1 AND form_id = $2`,
        [orgA, f],
      )
    ).rows;
    expect(kept).toEqual([{ contact_id: null }]);
    await owner.query(`DELETE FROM web_forms WHERE id = $1`, [f]);
    for (const t of ['web_form_versions', 'web_form_submissions']) {
      expect((await owner.query(`SELECT 1 FROM ${t} WHERE form_id = $1`, [f])).rows, t).toEqual([]);
    }
    // The events stream has no foreign key (schema-invariants): the service deletes a form's events with the form.
    expect(
      (await owner.query(`SELECT 1 FROM web_form_events WHERE form_id = $1`, [f])).rows,
    ).toHaveLength(1);
    await owner.query(`DELETE FROM web_form_events WHERE form_id = $1`, [f]);
  });

  it('events are a stream: monthly partitions exist for this month and the next, plus a default', async () => {
    const parts = (
      await owner.query(
        `SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent WHERE p.relname = 'web_form_events'`,
      )
    ).rows.map((r) => r.relname as string);
    const ym = (d: Date) =>
      `web_form_events_${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const now = new Date();
    expect(parts).toEqual(
      expect.arrayContaining([
        ym(now),
        ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))),
        'web_form_events_default',
      ]),
    );
    await expect(
      owner.query(
        `INSERT INTO web_form_events (org_id, form_id, visit_id, kind) VALUES ($1,$2,'visit-bad-01','explode')`,
        [orgA, formA],
      ),
    ).rejects.toThrow(/chk_web_form_events_kind/);
  });

  it('the usage counter is one row per workspace and month, and a period must be a first of month', async () => {
    await expect(
      owner.query(
        `INSERT INTO web_form_usage_monthly (org_id, period) VALUES ($1, date_trunc('month', now())::date)`,
        [orgA],
      ),
    ).rejects.toThrow(/duplicate key|web_form_usage_monthly_pkey/);
    await expect(
      owner.query(`INSERT INTO web_form_usage_monthly (org_id, period) VALUES ($1, '2020-01-15')`, [
        orgB,
      ]),
    ).rejects.toThrow(/chk_web_form_usage_period/);
  });

  describe('the marketplace listing, plans and permissions (phase 0)', () => {
    it('seeds the first-party listing as a DRAFT, paid monthly, unpriced, granting form_builder, comping nobody', async () => {
      const app1 = (await owner.query(`SELECT * FROM marketplace_apps WHERE slug = 'forms'`))
        .rows[0];
      expect(app1).toMatchObject({
        kind: 'mini_app',
        status: 'draft',
        first_party: true,
        pricing_model: 'paid_monthly',
        trial_days: 0,
        purchasable: true,
        grants_plan_features: ['form_builder'],
        grandfather_existing: false,
      });
      expect(app1.price_amount).toBeNull();
      const cat = (
        await owner.query(`SELECT slug FROM marketplace_categories WHERE id = $1`, [
          app1.category_id,
        ])
      ).rows[0];
      expect(cat.slug).toBe('sales-tools');
      const v = (
        await owner.query(
          `SELECT version, status, scopes FROM marketplace_app_versions WHERE app_id = $1`,
          [app1.id],
        )
      ).rows;
      expect(v).toHaveLength(1);
      expect(v[0]).toMatchObject({ version: '1.0.0', status: 'draft' });
      expect(v[0].scopes).toEqual(['contacts.read', 'contacts.write', 'forms.read', 'forms.write']);
    });

    it('every plan row has the feature off and the add-on caps (10 forms, 500 submissions, 50 AI generations)', async () => {
      // A fresh database has no plan rows (the seed script and the console create them), so the migration's two UPDATEs are run here
      // against a plan row of this test: they are what an existing installation's plans go through.
      await owner.query(
        `INSERT INTO plans (slug, name, is_free, features, limits) VALUES ('forms_seed_test', 'Test', true, '{"analytics": true}'::jsonb, '{"users": 3}'::jsonb)`,
      );
      const sqlText = readFileSync(
        resolve(
          __dirname,
          '../../../../../packages/db/migrations/20261031100200_mkt_forms_app.sql',
        ),
        'utf8',
      );
      const updates = sqlText.match(/UPDATE plans[\s\S]*?;/g) ?? [];
      expect(updates).toHaveLength(2);
      for (const u of updates) await owner.query(u);
      const rows = (
        await owner.query(`SELECT slug, features, limits FROM plans WHERE kind = 'plan'`)
      ).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].features.analytics).toBe(true);
      expect(rows[0].limits.users).toBe(3);
      for (const r of rows) {
        expect(r.features.form_builder, r.slug).toBe(false);
        expect(r.limits, r.slug).toMatchObject({
          forms: 10,
          form_submissions_monthly: 500,
          ai_form_generations_monthly: 50,
        });
      }
    });

    it('registers the eight keys, tagged with the plan feature that unlocks them, and the presets hold what the spec says', async () => {
      const keys = (
        await owner.query(
          `SELECT key, supports_scope, plan_feature FROM permission_defs WHERE key LIKE 'record.form%' ORDER BY key`,
        )
      ).rows;
      expect(keys.map((k) => k.key as string).sort()).toEqual(
        [
          'record.form-submissions.delete',
          'record.form-submissions.export',
          'record.form-submissions.read',
          'record.form-submissions.update',
          'record.forms.create',
          'record.forms.delete',
          'record.forms.read',
          'record.forms.update',
        ].sort(),
      );
      for (const k of keys) expect(k.plan_feature, k.key).toBe('form_builder');
      expect(Object.fromEntries(keys.map((k) => [k.key, k.supports_scope]))).toMatchObject({
        'record.forms.read': true,
        'record.forms.create': false,
        'record.form-submissions.export': false,
        'record.form-submissions.read': true,
      });
    });
  });
});
