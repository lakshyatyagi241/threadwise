import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * Personal-connect schema (migration 20261104090000_wadev_personal_connect): `device_risk_acknowledgements` and the new `devices`
 * columns, proven against a real Postgres as the restricted application role. Two workspaces never see or touch each other's rows, the
 * acknowledgement trail is append-only (and still lets a person or a workspace be removed), and the number is unique per workspace.
 */
describe('personal-connect schema', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let userA: number;
  let userB: number;
  let ackA: number;

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
          await owner.query<{ id: number }>(
            `INSERT INTO organizations (slug, name, plan) VALUES ($1, $2, 'starter') RETURNING id`,
            [slug, `Org ${slug}`],
          )
        ).rows[0]!.id,
      );
    orgA = await org('dev-a');
    orgB = await org('dev-b');
    const user = async (orgId: number, email: string) =>
      Number(
        (
          await owner.query<{ id: number }>(
            `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1, $2, $3, 'x') RETURNING id`,
            [orgId, email, `User ${email}`],
          )
        ).rows[0]!.id,
      );
    userA = await user(orgA, 'a@dev.test');
    userB = await user(orgB, 'b@dev.test');
    ackA = Number(
      (
        await owner.query<{ id: number }>(
          `INSERT INTO device_risk_acknowledgements (org_id, user_id, user_name, policy_version, text_sha256)
           VALUES ($1, $2, 'A', '2026-10-07.1', $3) RETURNING id`,
          [orgA, userA, 'a'.repeat(64)],
        )
      ).rows[0]!.id,
    );
    await owner.query(
      `INSERT INTO devices (org_id, device_name, country_code, phone_number, phone_digits, consent_id)
       VALUES ($1, 'A line', '+91', '7690059356', '917690059356', $2)`,
      [orgA, ackA],
    );
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
  const privileged = `SELECT set_config('app.privileged', 'on', true)`;

  it('both tables are forced-RLS tables', async () => {
    const { rows } = await owner.query(
      `SELECT relname, relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class
        WHERE relname IN ('devices', 'device_risk_acknowledgements') ORDER BY relname`,
    );
    expect(rows).toEqual([
      { relname: 'device_risk_acknowledgements', enabled: true, forced: true },
      { relname: 'devices', enabled: true, forced: true },
    ]);
  });

  it('a workspace never reads another workspace device, its state or its acknowledgements', async () => {
    const own = await inTx([asOrg(orgA)], () =>
      app.query(`SELECT connection_state, phone_digits FROM devices`),
    );
    expect(own.rows).toEqual([{ connection_state: 'created', phone_digits: '917690059356' }]);
    const other = await inTx([asOrg(orgB)], async () => ({
      devices: await app.query(`SELECT * FROM devices`),
      acks: await app.query(`SELECT * FROM device_risk_acknowledgements`),
    }));
    expect(other.devices.rows).toHaveLength(0);
    expect(other.acks.rows).toHaveLength(0);
    const none = await inTx([], () => app.query(`SELECT * FROM device_risk_acknowledgements`));
    expect(none.rows).toHaveLength(0);
  });

  it('a workspace cannot write an acknowledgement or a device into another workspace, nor move its state', async () => {
    await expect(
      inTx([asOrg(orgB)], () =>
        app.query(
          `INSERT INTO device_risk_acknowledgements (org_id, user_name, policy_version, text_sha256) VALUES ($1, 'x', 'v', $2)`,
          [orgA, 'b'.repeat(64)],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      inTx([asOrg(orgB)], () =>
        app.query(
          `INSERT INTO devices (org_id, device_name, phone_number) VALUES ($1, 'x', '123456')`,
          [orgA],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
    const upd = await inTx([asOrg(orgB)], () =>
      app.query(`UPDATE devices SET connection_state = 'connected' WHERE org_id = $1`, [orgA]),
    );
    expect(upd.rowCount).toBe(0);
  });

  it('composite foreign keys: an acknowledgement cannot name another workspace user, a device cannot name another workspace acknowledgement', async () => {
    await expect(
      owner.query(
        `INSERT INTO device_risk_acknowledgements (org_id, user_id, user_name, policy_version, text_sha256) VALUES ($1, $2, 'x', 'v', $3)`,
        [orgA, userB, 'c'.repeat(64)],
      ),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      owner.query(
        `INSERT INTO devices (org_id, device_name, phone_number, consent_id) VALUES ($1, 'x', '123456', $2)`,
        [orgB, ackA],
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  it('the acknowledgement trail is append-only: no UPDATE, no DELETE, even for the owner connection', async () => {
    await expect(
      owner.query(`UPDATE device_risk_acknowledgements SET user_name = 'edited' WHERE id = $1`, [
        ackA,
      ]),
    ).rejects.toThrow(/append-only/i);
    await expect(
      owner.query(
        `UPDATE device_risk_acknowledgements SET policy_version = 'other' WHERE id = $1`,
        [ackA],
      ),
    ).rejects.toThrow(/append-only/i);
    await expect(
      owner.query(`DELETE FROM device_risk_acknowledgements WHERE id = $1`, [ackA]),
    ).rejects.toThrow(/append-only/i);
    // as the application role too (its own workspace, the row it can see)
    await expect(
      inTx([asOrg(orgA)], () =>
        app.query(`UPDATE device_risk_acknowledgements SET locale = 'ar' WHERE id = $1`, [ackA]),
      ),
    ).rejects.toThrow(/append-only/i);
    await expect(
      inTx([asOrg(orgA)], () =>
        app.query(`DELETE FROM device_risk_acknowledgements WHERE id = $1`, [ackA]),
      ),
    ).rejects.toThrow(/append-only/i);
    const row = await owner.query(
      `SELECT user_name, locale FROM device_risk_acknowledgements WHERE id = $1`,
      [ackA],
    );
    expect(row.rows).toEqual([{ user_name: 'A', locale: 'en' }]);
  });

  it('removing the person keeps the record (user_id is set null, the name snapshot stays); removing the workspace removes it', async () => {
    const o = Number(
      (
        await owner.query<{ id: number }>(
          `INSERT INTO organizations (slug, name, plan) VALUES ('dev-c', 'dev-c', 'starter') RETURNING id`,
        )
      ).rows[0]!.id,
    );
    const u = Number(
      (
        await owner.query<{ id: number }>(
          `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1, 'c@dev.test', 'C', 'x') RETURNING id`,
          [o],
        )
      ).rows[0]!.id,
    );
    await owner.query(
      `INSERT INTO device_risk_acknowledgements (org_id, user_id, user_name, policy_version, text_sha256) VALUES ($1, $2, 'Cee', 'v', $3)`,
      [o, u, 'd'.repeat(64)],
    );
    await owner.query(`DELETE FROM users WHERE id = $1`, [u]);
    const kept = await owner.query(
      `SELECT user_id, user_name FROM device_risk_acknowledgements WHERE org_id = $1`,
      [o],
    );
    expect(kept.rows).toEqual([{ user_id: null, user_name: 'Cee' }]);
    await owner.query(`DELETE FROM organizations WHERE id = $1`, [o]);
    expect(
      (await owner.query(`SELECT 1 FROM device_risk_acknowledgements WHERE org_id = $1`, [o])).rows,
    ).toHaveLength(0);
  });

  it('the privileged flag (the operator console) may remove rows, nobody may edit one', async () => {
    const res = await inTx([privileged], async () => {
      const ins = await app.query(
        `INSERT INTO device_risk_acknowledgements (org_id, user_name, policy_version, text_sha256) VALUES ($1, 'op', 'v', $2) RETURNING id`,
        [orgB, 'e'.repeat(64)],
      );
      const id = ins.rows[0].id;
      const del = await app.query(`DELETE FROM device_risk_acknowledgements WHERE id = $1`, [id]);
      return del.rowCount;
    });
    expect(res).toBe(1);
  });

  it('a number is unique per workspace (digits), may repeat across workspaces, and legacy rows without digits do not collide', async () => {
    await expect(
      owner.query(
        `INSERT INTO devices (org_id, device_name, phone_number, phone_digits) VALUES ($1, 'twin', '7690059356', '917690059356')`,
        [orgA],
      ),
    ).rejects.toThrow(/uq_devices_org_phone_digits/);
    await owner.query(
      `INSERT INTO devices (org_id, device_name, phone_number, phone_digits) VALUES ($1, 'elsewhere', '7690059356', '917690059356')`,
      [orgB],
    );
    await owner.query(
      `INSERT INTO devices (org_id, device_name, phone_number) VALUES ($1, 'legacy 1', '5551234')`,
      [orgA],
    );
    await owner.query(
      `INSERT INTO devices (org_id, device_name, phone_number) VALUES ($1, 'legacy 2', '5551234')`,
      [orgA],
    );
  });

  it('connection_state is a closed set; `status` keeps its own meaning; there is no banned state', async () => {
    await expect(
      owner.query(`UPDATE devices SET connection_state = 'banned' WHERE org_id = $1`, [orgA]),
    ).rejects.toThrow(/chk_devices_connection_state/);
    const d = await owner.query(
      `INSERT INTO devices (org_id, device_name, phone_number) VALUES ($1, 'fresh', '999000111') RETURNING status, connection_state, state_reason`,
      [orgA],
    );
    expect(d.rows[0]).toEqual({
      status: 'disconnected',
      connection_state: 'created',
      state_reason: null,
    });
  });

  it('the wa.devices.* keys exist, are not scoped, and reach Owner and Admin presets only', async () => {
    const keys = await owner.query(
      `SELECT key, category, supports_scope FROM permission_defs WHERE key LIKE 'wa.devices.%' ORDER BY key`,
    );
    expect(keys.rows).toEqual(
      ['create', 'delete', 'disconnect', 'pair', 'read'].map((a) => ({
        key: `wa.devices.${a}`,
        category: 'whatsapp',
        supports_scope: false,
      })),
    );
    // a workspace provisioned now gets the presets from the one function sign-up uses
    const o = Number(
      (
        await owner.query<{ id: number }>(
          `INSERT INTO organizations (slug, name, plan) VALUES ('dev-presets', 'p', 'starter') RETURNING id`,
        )
      ).rows[0]!.id,
    );
    await owner.query(`SELECT provision_workspace_presets($1)`, [o]);
    const grants = await owner.query(
      `SELECT r.system_key, count(*)::int AS n
         FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id
        WHERE g.org_id = $1 AND g.permission_key LIKE 'wa.devices.%'
        GROUP BY r.system_key ORDER BY r.system_key`,
      [o],
    );
    expect(grants.rows).toEqual([
      { system_key: 'admin', n: 5 },
      { system_key: 'workspace_admin', n: 5 },
    ]);
  });
});
