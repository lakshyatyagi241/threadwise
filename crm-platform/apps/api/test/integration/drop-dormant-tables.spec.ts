import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * 20261216090000_drop_dormant_tables.sql drops 15 tables that nothing writes. Static analysis cannot see production rows, so the
 * migration refuses to run while any of them holds a row. This pins that tripwire, and the one fact it depends on: under forced
 * row-level security a non-superuser owner sees no rows unless `app.privileged` is on, so a plain count could pass by mistake.
 */
const DROP_FILE = '20261216090000_drop_dormant_tables.sql';
const MIGRATIONS = resolve(__dirname, '../../../../packages/db/migrations');
const DROPPED = [
  'line_flow_sessions',
  'telegram_flow_sessions',
  'viber_flow_sessions',
  'wechat_flow_sessions',
  'sla_breaches',
  'support_agents',
  'support_assignments',
  'team_chat_reads',
  'google_form_sessions',
  'invoice_webhook_events',
  'chat_templates',
  'flow_connected_devices',
  'playbooks',
  'package_features',
  'packages',
];
const KEPT = [
  'plans',
  'support_sla_breaches',
  'support_playbooks',
  'line_rich_menus',
  'tiktok_accounts',
];

describe('drop dormant tables: the non-empty tripwire', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let oneBehind: string;

  const exists = async (table: string): Promise<boolean> =>
    (await owner.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${table}`])).rows[0].ok;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();

    // Every migration except the drop, so a row can be planted before it runs.
    oneBehind = mkdtempSync(join(tmpdir(), 'mig-one-behind-'));
    for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql') && n !== DROP_FILE)) {
      cpSync(join(MIGRATIONS, f), join(oneBehind, f));
    }
    await runMigrations(container.getConnectionUri(), { dir: oneBehind, log: () => undefined });
  }, 300_000);

  afterAll(async () => {
    await owner?.end();
    await container?.stop();
    if (oneBehind) rmSync(oneBehind, { recursive: true, force: true });
  });

  it('refuses to run while a dormant table holds a row, and changes nothing', async () => {
    await owner.query(`INSERT INTO package_features (name) VALUES ('planted')`);

    await expect(
      runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined }),
    ).rejects.toThrow(/package_features holds 1 row/);

    for (const t of DROPPED) expect(await exists(t), `${t} must still exist`).toBe(true);
    const recorded = await owner.query(`SELECT 1 FROM _migrations WHERE id = $1`, [
      DROP_FILE.replace(/\.sql$/, ''),
    ]);
    expect(recorded.rowCount).toBe(0);
  }, 240_000);

  it('a non-superuser owner under forced RLS sees rows only with app.privileged on', async () => {
    await owner.query(`CREATE ROLE zz_probe_owner NOSUPERUSER NOBYPASSRLS`);
    await owner.query(`GRANT CREATE, USAGE ON SCHEMA public TO zz_probe_owner`);
    await owner.query(`SET ROLE zz_probe_owner`);
    try {
      await owner.query(`CREATE TABLE zz_probe (org_id bigint NOT NULL, id bigint)`);
      await owner.query(`ALTER TABLE zz_probe ENABLE ROW LEVEL SECURITY`);
      await owner.query(`ALTER TABLE zz_probe FORCE ROW LEVEL SECURITY`);
      await owner.query(`CREATE POLICY tenant_isolation ON zz_probe FOR ALL
        USING (org_id = current_org_id() OR app_is_privileged())
        WITH CHECK (org_id = current_org_id() OR app_is_privileged())`);
      await owner.query(`BEGIN`);
      await owner.query(`SELECT set_config('app.privileged', 'on', true)`);
      await owner.query(`INSERT INTO zz_probe VALUES (7, 1), (8, 2)`);
      const withFlag = await owner.query(`SELECT count(*)::int AS n FROM zz_probe`);
      await owner.query(`SELECT set_config('app.privileged', 'off', true)`);
      const withoutFlag = await owner.query(`SELECT count(*)::int AS n FROM zz_probe`);
      await owner.query(`COMMIT`);
      expect(withFlag.rows[0].n).toBe(2);
      expect(withoutFlag.rows[0].n).toBe(0);
    } finally {
      await owner.query(`RESET ROLE`);
      await owner.query(`DROP TABLE IF EXISTS zz_probe`);
      await owner.query(`DROP OWNED BY zz_probe_owner`);
      await owner.query(`DROP ROLE zz_probe_owner`);
    }
  });

  it('drops the 15 tables and the two dead package_id columns once they are empty', async () => {
    await owner.query(`DELETE FROM package_features`);

    await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });

    for (const t of DROPPED) expect(await exists(t), `${t} must be gone`).toBe(false);
    for (const t of KEPT) expect(await exists(t), `${t} must be kept`).toBe(true);
    const cols = await owner.query(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'package_id' AND table_name IN ('orders', 'subscriptions')`,
    );
    expect(cols.rowCount).toBe(0);
  }, 240_000);
});
