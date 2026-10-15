import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * `wa_device_history_imports` and `devices.history_import_mode` (migration 20261204090000), proven against a real Postgres as the
 * restricted application role: a workspace never sees or writes another workspace's import runs, a run cannot name another workspace's
 * device, a device has at most one active run, the checks hold, and deleting the device removes its runs.
 */
describe('personal-number history import schema', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let userA: number;
  let deviceA: number;
  let deviceA2: number;
  let deviceB: number;

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
    const one = async (sql: string, params: unknown[]) =>
      Number((await owner.query<{ id: number }>(sql, params)).rows[0]!.id);
    orgA = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('his-a', 'A', 'starter') RETURNING id`,
      [],
    );
    orgB = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('his-b', 'B', 'starter') RETURNING id`,
      [],
    );
    userA = await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1, 'a@his.test', 'A', 'x') RETURNING id`,
      [orgA],
    );
    const device = (org: number, name: string, phone: string) =>
      one(
        `INSERT INTO devices (org_id, device_name, phone_number) VALUES ($1, $2, $3) RETURNING id`,
        [org, name, phone],
      );
    deviceA = await device(orgA, 'A1', '1000001');
    deviceA2 = await device(orgA, 'A2', '1000002');
    deviceB = await device(orgB, 'B1', '2000001');
    app = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: 'crm',
      user: 'crm_app_user',
      password: 'test',
    });
    await app.connect();
  }, 240_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  async function inTx<T>(settings: string[], fn: () => Promise<T>): Promise<T> {
    await app.query('BEGIN');
    try {
      for (const s of settings) await app.query(s);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  }
  const asOrg = (orgId: number) => `SELECT set_config('app.org_id', '${orgId}', true)`;

  const insert = (
    org: number,
    device: number,
    state = 'idle',
    by: number | null = null,
    mode = 'recent',
  ) =>
    owner.query(
      `INSERT INTO wa_device_history_imports (org_id, device_id, mode, state, requested_by_user_id, window_days, max_messages, max_messages_per_chat, max_chats)
       VALUES ($1, $2, $3, $4, $5, 90, 1000, 100, 100) RETURNING id`,
      [org, device, mode, state, by],
    );

  it('is a forced-RLS table with a tenant_isolation policy and a touch trigger', async () => {
    const { rows } = await owner.query(
      `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE relname = 'wa_device_history_imports'`,
    );
    expect(rows).toEqual([{ enabled: true, forced: true }]);
    const pol = await owner.query(
      `SELECT policyname FROM pg_policies WHERE tablename = 'wa_device_history_imports'`,
    );
    expect(pol.rows).toEqual([{ policyname: 'tenant_isolation' }]);
    const g = await insert(orgA, deviceA, 'done');
    const before = await owner.query(
      `SELECT row_version FROM wa_device_history_imports WHERE id = $1`,
      [g.rows[0].id],
    );
    await owner.query(`UPDATE wa_device_history_imports SET messages_count = 3 WHERE id = $1`, [
      g.rows[0].id,
    ]);
    const after = await owner.query(
      `SELECT row_version FROM wa_device_history_imports WHERE id = $1`,
      [g.rows[0].id],
    );
    expect(after.rows[0].row_version).toBe(before.rows[0].row_version + 1);
  });

  it('a workspace reads only its own runs, and cannot write into another workspace', async () => {
    await insert(orgB, deviceB);
    const own = await inTx([asOrg(orgA)], () =>
      app.query(`SELECT org_id FROM wa_device_history_imports`),
    );
    expect(new Set(own.rows.map((r) => Number(r.org_id)))).toEqual(new Set([orgA]));
    const none = await inTx([], () => app.query(`SELECT * FROM wa_device_history_imports`));
    expect(none.rows).toHaveLength(0);
    await expect(
      inTx([asOrg(orgB)], () =>
        app.query(
          `INSERT INTO wa_device_history_imports (org_id, device_id, mode, window_days, max_messages, max_messages_per_chat, max_chats)
           VALUES ($1, $2, 'recent', 90, 1, 1, 1)`,
          [orgA, deviceA],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
    const upd = await inTx([asOrg(orgB)], () =>
      app.query(`UPDATE wa_device_history_imports SET state = 'failed' WHERE org_id = $1`, [orgA]),
    );
    expect(upd.rowCount).toBe(0);
  });

  it('a run cannot name another workspace device or requester (composite foreign keys)', async () => {
    await expect(insert(orgA, deviceB)).rejects.toThrow(/foreign key/i);
    await expect(insert(orgB, deviceB, 'done', userA)).rejects.toThrow(/foreign key/i);
  });

  it('a device has at most one active run; finished runs pile up freely', async () => {
    await insert(orgA, deviceA2, 'idle');
    await expect(insert(orgA, deviceA2, 'running')).rejects.toThrow(
      /uq_wa_device_history_imports_active/,
    );
    await owner.query(
      `UPDATE wa_device_history_imports SET state = 'done' WHERE org_id = $1 AND device_id = $2`,
      [orgA, deviceA2],
    );
    await insert(orgA, deviceA2, 'idle');
    await insert(orgA, deviceA2, 'cancelled');
  });

  it('refuses a mode, a state or a count the engine never writes', async () => {
    await expect(insert(orgA, deviceA, 'done', null, 'everything')).rejects.toThrow(
      /ck_wa_device_history_imports_mode/,
    );
    await expect(insert(orgA, deviceA, 'paused')).rejects.toThrow(
      /ck_wa_device_history_imports_state/,
    );
    await expect(
      owner.query(`UPDATE wa_device_history_imports SET messages_count = -1 WHERE org_id = $1`, [
        orgA,
      ]),
    ).rejects.toThrow(/ck_wa_device_history_imports_counts/);
    await expect(
      owner.query(`UPDATE devices SET history_import_mode = 'all' WHERE org_id = $1`, [orgA]),
    ).rejects.toThrow(/ck_devices_history_import_mode/);
    const d = await owner.query(`SELECT history_import_mode FROM devices WHERE id = $1`, [deviceA]);
    expect(d.rows[0].history_import_mode).toBe('none');
  });

  it('deleting the device deletes its runs; deleting the requester keeps the run', async () => {
    const dev = Number(
      (
        await owner.query(
          `INSERT INTO devices (org_id, device_name, phone_number) VALUES ($1, 'Tmp', '3000001') RETURNING id`,
          [orgA],
        )
      ).rows[0].id,
    );
    const u = Number(
      (
        await owner.query(
          `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1, 'tmp@his.test', 'T', 'x') RETURNING id`,
          [orgA],
        )
      ).rows[0].id,
    );
    const run = (await insert(orgA, dev, 'done', u)).rows[0].id;
    await owner.query(`DELETE FROM users WHERE id = $1`, [u]);
    const kept = await owner.query(
      `SELECT requested_by_user_id FROM wa_device_history_imports WHERE id = $1`,
      [run],
    );
    expect(kept.rows[0].requested_by_user_id).toBeNull();
    await owner.query(`DELETE FROM devices WHERE id = $1`, [dev]);
    expect(
      (await owner.query(`SELECT 1 FROM wa_device_history_imports WHERE id = $1`, [run])).rows,
    ).toHaveLength(0);
  });

  it('the plan-feature migration grants personal_history_full only on an explicit unlimited marker or 3 or more devices, and never casts a non-number', async () => {
    const sqlText = readFileSync(
      resolve(
        __dirname,
        '../../../../../packages/db/migrations/20261204090100_wa_history_import_followups.sql',
      ),
      'utf8',
    );
    const updates = sqlText.slice(
      sqlText.indexOf('UPDATE plans'),
      sqlText.indexOf('ALTER TABLE conversations'),
    );
    const variants: Array<[string, string, boolean]> = [
      ['hz_three', '{"devices": 3}', true],
      ['hz_ten', '{"devices": 10}', true],
      ['hz_zero', '{"devices": 0}', true],
      ['hz_one', '{"devices": 1}', false],
      ['hz_missing', '{"contacts": 100}', false],
      ['hz_null', '{"devices": null}', false],
      ['hz_text', '{"devices": "many"}', false],
    ];
    for (const [slug, limits] of variants) {
      await owner.query(
        `INSERT INTO plans (slug, name, kind, amount, currency, billing_unit, billing_duration, is_free, limits, features)
         VALUES ($1, $1, 'plan', 0, 'USD', 'months', 1, true, $2::jsonb, '{}'::jsonb)`,
        [slug, limits],
      );
    }
    await owner.query(updates); // must not raise on the text and null values
    const got = await owner.query(
      `SELECT slug, features -> 'personal_history_full' AS f FROM plans WHERE slug LIKE 'hz%'`,
    );
    for (const [slug, , expected] of variants) {
      expect(got.rows.find((r) => r.slug === slug)?.f, slug).toBe(expected);
    }
    await owner.query(`DELETE FROM plans WHERE slug LIKE 'hz%'`);
  });
});
