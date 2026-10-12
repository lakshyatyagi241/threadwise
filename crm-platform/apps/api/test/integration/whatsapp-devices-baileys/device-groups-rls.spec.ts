import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * `wa_device_groups` (migration 20261120090000) and the `wa.groups.*` keys (20261120090100), proven against a real Postgres as the
 * restricted application role: a workspace never sees or writes another workspace's groups, a group cannot name another workspace's device,
 * a number's group id is unique per device, deleting the device removes its groups and deleting the creator keeps the group.
 */
describe('personal-number groups schema', () => {
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
      `INSERT INTO organizations (slug, name, plan) VALUES ('grp-a', 'A', 'starter') RETURNING id`,
      [],
    );
    orgB = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('grp-b', 'B', 'starter') RETURNING id`,
      [],
    );
    userA = await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1, 'a@grp.test', 'A', 'x') RETURNING id`,
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
  const insert = (org: number, device: number, jid: string, by: number | null = null) =>
    owner.query(
      `INSERT INTO wa_device_groups (org_id, device_id, group_jid, subject, created_by_user_id) VALUES ($1, $2, $3, 'S', $4) RETURNING id`,
      [org, device, jid, by],
    );

  it('is a forced-RLS table with a tenant_isolation policy and a touch trigger', async () => {
    const { rows } = await owner.query(
      `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE relname = 'wa_device_groups'`,
    );
    expect(rows).toEqual([{ enabled: true, forced: true }]);
    const pol = await owner.query(
      `SELECT policyname FROM pg_policies WHERE tablename = 'wa_device_groups'`,
    );
    expect(pol.rows).toEqual([{ policyname: 'tenant_isolation' }]);
    const g = await insert(orgA, deviceA, '120363000000000001');
    const before = await owner.query(`SELECT row_version FROM wa_device_groups WHERE id = $1`, [
      g.rows[0].id,
    ]);
    await owner.query(`UPDATE wa_device_groups SET subject = 'T' WHERE id = $1`, [g.rows[0].id]);
    const after = await owner.query(`SELECT row_version FROM wa_device_groups WHERE id = $1`, [
      g.rows[0].id,
    ]);
    expect(after.rows[0].row_version).toBe(before.rows[0].row_version + 1);
  });

  it('a workspace reads only its own groups, and cannot write into another workspace', async () => {
    await insert(orgB, deviceB, '120363000000000002');
    const own = await inTx([asOrg(orgA)], () =>
      app.query(`SELECT group_jid FROM wa_device_groups`),
    );
    expect(own.rows.map((r) => r.group_jid)).toEqual(['120363000000000001']);
    const none = await inTx([], () => app.query(`SELECT * FROM wa_device_groups`));
    expect(none.rows).toHaveLength(0);
    await expect(
      inTx([asOrg(orgB)], () =>
        app.query(
          `INSERT INTO wa_device_groups (org_id, device_id, group_jid) VALUES ($1, $2, 'x')`,
          [orgA, deviceA],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
    const upd = await inTx([asOrg(orgB)], () =>
      app.query(`UPDATE wa_device_groups SET subject = 'hijack' WHERE org_id = $1`, [orgA]),
    );
    expect(upd.rowCount).toBe(0);
  });

  it('a group cannot name another workspace device or creator (composite foreign keys)', async () => {
    await expect(insert(orgA, deviceB, '120363000000000003')).rejects.toThrow(/foreign key/i);
    await expect(insert(orgB, deviceB, '120363000000000004', userA)).rejects.toThrow(
      /foreign key/i,
    );
  });

  it('a group id is unique per device but may appear on another number', async () => {
    await expect(insert(orgA, deviceA, '120363000000000001')).rejects.toThrow(
      /uq_wa_device_groups_device_jid/,
    );
    await insert(orgA, deviceA2, '120363000000000001');
  });

  it('keeps the closed sets and the roster cap', async () => {
    await expect(
      owner.query(`UPDATE wa_device_groups SET member_add_mode = 'nobody' WHERE group_jid = $1`, [
        '120363000000000001',
      ]),
    ).rejects.toThrow(/ck_wa_device_groups_member_add_mode/);
    await expect(
      owner.query(`UPDATE wa_device_groups SET participants = '{}'::jsonb WHERE group_jid = $1`, [
        '120363000000000001',
      ]),
    ).rejects.toThrow(/ck_wa_device_groups_participants/);
  });

  it('deleting the creator keeps the group (created_by set null); deleting the device removes its groups', async () => {
    const g = await insert(orgA, deviceA2, '120363000000000005', userA);
    await owner.query(`DELETE FROM users WHERE id = $1`, [userA]);
    const kept = await owner.query(
      `SELECT created_by_user_id FROM wa_device_groups WHERE id = $1`,
      [g.rows[0].id],
    );
    expect(kept.rows).toEqual([{ created_by_user_id: null }]);
    await owner.query(`DELETE FROM devices WHERE org_id = $1 AND id = $2`, [orgA, deviceA2]);
    const gone = await owner.query(
      `SELECT 1 FROM wa_device_groups WHERE org_id = $1 AND device_id = $2`,
      [orgA, deviceA2],
    );
    expect(gone.rows).toHaveLength(0);
  });

  it('the wa.groups.* keys exist unscoped with NO plan feature and reach Owner and Admin presets only', async () => {
    const keys = await owner.query(
      `SELECT key, category, supports_scope, plan_feature FROM permission_defs WHERE key LIKE 'wa.groups.%' ORDER BY key`,
    );
    expect(keys.rows).toEqual(
      ['create', 'leave', 'manage', 'read'].map((a) => ({
        key: `wa.groups.${a}`,
        category: 'whatsapp',
        supports_scope: false,
        plan_feature: null,
      })),
    );
    const o = Number(
      (
        await owner.query<{ id: number }>(
          `INSERT INTO organizations (slug, name, plan) VALUES ('grp-presets', 'p', 'starter') RETURNING id`,
        )
      ).rows[0]!.id,
    );
    await owner.query(`SELECT provision_workspace_presets($1)`, [o]);
    const grants = await owner.query(
      `SELECT r.system_key, count(*)::int AS n
         FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id
        WHERE g.org_id = $1 AND g.permission_key LIKE 'wa.groups.%'
        GROUP BY r.system_key ORDER BY r.system_key`,
      [o],
    );
    expect(grants.rows).toEqual([
      { system_key: 'admin', n: 4 },
      { system_key: 'workspace_admin', n: 4 },
    ]);
  });
});
