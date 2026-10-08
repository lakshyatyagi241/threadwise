import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * `unofficial_whatsapp_workspaces`: the per-workspace allow-list of the unofficial WhatsApp engine (owner decision 2026-10-06).
 * A tenant may read ONLY its own row (so a guard or a worker in a workspace context can ask "am I allowed"), and only the privileged
 * flag (the operator console) may write. Proven against a real Postgres as the restricted application role.
 */
describe('unofficial_whatsapp_workspaces row-level security', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;

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
    const a = await owner.query<{ id: number }>(
      `INSERT INTO organizations (slug, name, plan) VALUES ('wl-a','WL A','starter') RETURNING id`,
    );
    const b = await owner.query<{ id: number }>(
      `INSERT INTO organizations (slug, name, plan) VALUES ('wl-b','WL B','starter') RETURNING id`,
    );
    orgA = Number(a.rows[0]!.id);
    orgB = Number(b.rows[0]!.id);
    // Seeded as the owner (a superuser, so the policies do not apply to it): both workspaces are on the list.
    await owner.query(
      `INSERT INTO unofficial_whatsapp_workspaces (org_id, note) VALUES ($1, 'a'), ($2, 'b')`,
      [orgA, orgB],
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

  it('is a forced-RLS table', async () => {
    const { rows } = await owner.query(
      `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE relname = 'unofficial_whatsapp_workspaces'`,
    );
    expect(rows[0]).toEqual({ enabled: true, forced: true });
  });

  it('a tenant reads its own row and never another workspace row', async () => {
    const own = await inTx([asOrg(orgA)], async () =>
      app.query(`SELECT org_id, note FROM unofficial_whatsapp_workspaces`),
    );
    expect(own.rows.map((r) => ({ org_id: Number(r.org_id), note: r.note }))).toEqual([
      { org_id: orgA, note: 'a' },
    ]);
    const other = await inTx([asOrg(orgA)], async () =>
      app.query(`SELECT * FROM unofficial_whatsapp_workspaces WHERE org_id = $1`, [orgB]),
    );
    expect(other.rows).toHaveLength(0);
  });

  it('no tenant context reads nothing (fails closed)', async () => {
    const res = await inTx([], async () =>
      app.query(`SELECT * FROM unofficial_whatsapp_workspaces`),
    );
    expect(res.rows).toHaveLength(0);
  });

  it('a tenant cannot insert, update or delete, not even its own row', async () => {
    await owner.query(`DELETE FROM unofficial_whatsapp_workspaces WHERE org_id = $1`, [orgB]);
    await expect(
      inTx([asOrg(orgB)], async () =>
        app.query(`INSERT INTO unofficial_whatsapp_workspaces (org_id) VALUES ($1)`, [orgB]),
      ),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      inTx([asOrg(orgA)], async () =>
        app.query(`INSERT INTO unofficial_whatsapp_workspaces (org_id) VALUES ($1)`, [orgB]),
      ),
    ).rejects.toThrow(/row-level security/i);
    // UPDATE and DELETE of its own row match nothing: the write policies are privileged-only, so the row is not even targetable.
    const upd = await inTx([asOrg(orgA)], async () =>
      app.query(`UPDATE unofficial_whatsapp_workspaces SET note = 'hijack' WHERE org_id = $1`, [
        orgA,
      ]),
    );
    expect(upd.rowCount).toBe(0);
    const del = await inTx([asOrg(orgA)], async () =>
      app.query(`DELETE FROM unofficial_whatsapp_workspaces WHERE org_id = $1`, [orgA]),
    );
    expect(del.rowCount).toBe(0);
    const still = await owner.query(
      `SELECT note FROM unofficial_whatsapp_workspaces WHERE org_id = $1`,
      [orgA],
    );
    expect(still.rows).toEqual([{ note: 'a' }]);
  });

  it('the privileged flag (the operator console) reads and writes every row', async () => {
    const res = await inTx([privileged], async () => {
      await app.query(
        `INSERT INTO unofficial_whatsapp_workspaces (org_id, note) VALUES ($1, 'by operator')`,
        [orgB],
      );
      await app.query(
        `UPDATE unofficial_whatsapp_workspaces SET note = 'edited' WHERE org_id = $1`,
        [orgA],
      );
      const all = await app.query(
        `SELECT org_id, note, row_version FROM unofficial_whatsapp_workspaces ORDER BY org_id`,
      );
      await app.query(`DELETE FROM unofficial_whatsapp_workspaces WHERE org_id = $1`, [orgB]);
      return all.rows;
    });
    expect(res).toHaveLength(2);
    expect(res.find((r) => Number(r.org_id) === orgA)).toMatchObject({
      note: 'edited',
      row_version: 2,
    });
  });

  it('a tenant context plus the privileged flag is how the operator service works: no row is lost to the tenant policy', async () => {
    const res = await inTx([privileged, asOrg(orgA)], async () =>
      app.query(`SELECT org_id FROM unofficial_whatsapp_workspaces`),
    );
    expect(res.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('deleting a workspace removes its row (cascade); no orphan stays', async () => {
    const o = await owner.query<{ id: number }>(
      `INSERT INTO organizations (slug, name, plan) VALUES ('wl-c','WL C','starter') RETURNING id`,
    );
    const orgC = Number(o.rows[0]!.id);
    await owner.query(`INSERT INTO unofficial_whatsapp_workspaces (org_id) VALUES ($1)`, [orgC]);
    await owner.query(`DELETE FROM organizations WHERE id = $1`, [orgC]);
    const left = await owner.query(
      `SELECT 1 FROM unofficial_whatsapp_workspaces WHERE org_id = $1`,
      [orgC],
    );
    expect(left.rows).toHaveLength(0);
  });
});
