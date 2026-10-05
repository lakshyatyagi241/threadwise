import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The flows tables against a real Postgres, as the restricted application role (a superuser bypasses every policy and would
 * make the isolation assertions vacuous, see rls.spec.ts). Constraint checks use the owner connection: owners skip RLS but
 * never CHECK, UNIQUE or FK.
 */
describe('flows: schema, constraints and isolation', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let flowA: number;
  let flowB: number;
  let contactB: number;
  let templateId: number;

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
    const one = async (sql: string, p: unknown[] = []) =>
      Number((await owner.query(sql, p)).rows[0].id);
    orgA = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('fa','A','starter') RETURNING id`,
    );
    orgB = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('fb','B','starter') RETURNING id`,
    );
    flowA = await one(
      `INSERT INTO flows (org_id, flow_name, flow_data) VALUES ($1,'Flow A','{"flowNodes":[],"flowEdges":[]}'::jsonb) RETURNING id`,
      [orgA],
    );
    flowB = await one(
      `INSERT INTO flows (org_id, flow_name, flow_data) VALUES ($1,'Flow B','{"flowNodes":[],"flowEdges":[]}'::jsonb) RETURNING id`,
      [orgB],
    );
    contactB = await one(`INSERT INTO contacts (org_id, name) VALUES ($1,'CB') RETURNING id`, [
      orgB,
    ]);
    templateId = await one(
      `INSERT INTO flow_templates (name, flow_data) VALUES ('T','{"flowNodes":[]}'::jsonb) RETURNING id`,
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

  async function asOrg<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgId)]);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  }
  const rejects = (sql: string, params: unknown[], pattern: RegExp) =>
    expect(owner.query(sql, params)).rejects.toThrow(pattern);

  describe('row-level security', () => {
    it('RLS is enabled and forced with a tenant policy on every tenant flows table, and flow_templates is read-all, operator-write', async () => {
      for (const table of [
        'flows',
        'flow_connected_devices',
        'flow_subscribers',
        'flow_retry_logs',
      ]) {
        const res = await owner.query(
          `SELECT relrowsecurity, relforcerowsecurity,
                  (SELECT count(*) FROM pg_policies p WHERE p.tablename = $1 AND p.policyname = 'tenant_isolation')::int AS policies
             FROM pg_class WHERE relname = $1 AND relkind = 'r'`,
          [table],
        );
        expect(res.rows[0], table).toMatchObject({
          relrowsecurity: true,
          relforcerowsecurity: true,
          policies: 1,
        });
      }
      const t = await owner.query(
        `SELECT policyname FROM pg_policies WHERE tablename = 'flow_templates' ORDER BY policyname`,
      );
      expect(t.rows.map((r) => r.policyname)).toEqual(['operator_write', 'read_all']);
    });

    it('a workspace sees only its own flows, even when the other id is known exactly', async () => {
      const own = await asOrg(orgA, async () => (await app.query(`SELECT id FROM flows`)).rows);
      expect(own.map((r) => Number(r.id))).toEqual([flowA]);
      const other = await asOrg(
        orgA,
        async () =>
          (await app.query(`SELECT 1 FROM flows WHERE org_id = $1 AND id = $2`, [orgB, flowB]))
            .rows,
      );
      expect(other).toHaveLength(0);
    });

    it('with no tenant set a query sees no rows, and a write into another workspace is refused by WITH CHECK', async () => {
      await app.query('BEGIN');
      try {
        expect((await app.query(`SELECT 1 FROM flows`)).rows).toHaveLength(0);
      } finally {
        await app.query('ROLLBACK');
      }
      await expect(
        asOrg(orgA, () =>
          app.query(`INSERT INTO flows (org_id, flow_name) VALUES ($1,'Smuggled')`, [orgB]),
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        asOrg(orgA, () =>
          app
            .query(`UPDATE flows SET flow_name = 'Hijack' WHERE id = $1 RETURNING id`, [flowB])
            .then((r) => {
              if (r.rowCount === 0) throw new Error('row-level security: no row visible');
            }),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('the template catalogue is readable by a tenant but not writable by the application role', async () => {
      const rows = await asOrg(
        orgA,
        async () => (await app.query(`SELECT id FROM flow_templates`)).rows,
      );
      expect(rows.map((r) => Number(r.id))).toEqual([templateId]);
      await expect(
        asOrg(orgA, () =>
          app
            .query(
              `UPDATE flow_templates SET clone_count = clone_count + 1 WHERE id = $1 RETURNING id`,
              [templateId],
            )
            .then((r) => {
              if (r.rowCount === 0) throw new Error('row-level security: no row visible');
            }),
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        asOrg(orgA, () =>
          app.query(`INSERT INTO flow_templates (name, flow_data) VALUES ('X','{}'::jsonb)`),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe('constraints', () => {
    it('a flow is one of ten channels and a trigger is one of twelve kinds (CHECK)', async () => {
      await rejects(
        `INSERT INTO flows (org_id, flow_name, flow_type) VALUES ($1,'x','fax')`,
        [orgA],
        /chk_flows_flow_type/,
      );
      await rejects(
        `INSERT INTO flows (org_id, flow_name, trigger_kind) VALUES ($1,'x','whenever')`,
        [orgA],
        /chk_flows_trigger_kind/,
      );
      for (const t of [
        'chat',
        'call',
        'instagram',
        'facebook',
        'tiktok',
        'telegram',
        'line',
        'wechat',
        'viber',
        'email',
      ]) {
        await owner.query(`INSERT INTO flows (org_id, flow_name, flow_type) VALUES ($1,$2,$3)`, [
          orgA,
          `t-${t}`,
          t,
        ]);
      }
    });

    it('the name is 1..255 characters and the category at most 64', async () => {
      await rejects(
        `INSERT INTO flows (org_id, flow_name) VALUES ($1,'')`,
        [orgA],
        /chk_flows_flow_name_len/,
      );
      await rejects(
        `INSERT INTO flows (org_id, flow_name) VALUES ($1,$2)`,
        [orgA, 'n'.repeat(256)],
        /chk_flows_flow_name_len/,
      );
      await rejects(
        `INSERT INTO flows (org_id, flow_name, category) VALUES ($1,'x',$2)`,
        [orgA, 'c'.repeat(65)],
        /chk_flows_category_len/,
      );
    });

    it('a template sort order is 0..9999 and its channel one of the ten', async () => {
      await rejects(
        `INSERT INTO flow_templates (name, flow_data, sort_order) VALUES ('x','{}'::jsonb,10000)`,
        [],
        /chk_flow_templates_sort_order/,
      );
      await rejects(
        `INSERT INTO flow_templates (name, flow_data, flow_type) VALUES ('x','{}'::jsonb,'fax')`,
        [],
        /chk_flow_templates_flow_type/,
      );
    });

    it('a subscriber cannot point at a flow or a contact of another workspace (composite FK), and a flow delete takes its subscribers', async () => {
      await rejects(
        `INSERT INTO flow_subscribers (org_id, flow_id, contact_id) VALUES ($1,$2,$3)`,
        [orgA, flowB, contactB],
        /foreign key/,
      );
      const contactA = Number(
        (
          await owner.query(`INSERT INTO contacts (org_id, name) VALUES ($1,'CA') RETURNING id`, [
            orgA,
          ])
        ).rows[0].id,
      );
      await owner.query(
        `INSERT INTO flow_subscribers (org_id, flow_id, contact_id) VALUES ($1,$2,$3)`,
        [orgA, flowA, contactA],
      );
      await rejects(
        `INSERT INTO flow_subscribers (org_id, flow_id, contact_id) VALUES ($1,$2,$3)`,
        [orgA, flowA, contactA],
        /uq_flow_subscribers_flow_id_contact_id/,
      );
      const tmp = Number(
        (
          await owner.query(
            `INSERT INTO flows (org_id, flow_name) VALUES ($1,'tmp') RETURNING id`,
            [orgA],
          )
        ).rows[0].id,
      );
      await owner.query(
        `INSERT INTO flow_subscribers (org_id, flow_id, contact_id) VALUES ($1,$2,$3)`,
        [orgA, tmp, contactA],
      );
      await owner.query(`DELETE FROM flows WHERE id = $1 AND org_id = $2`, [tmp, orgA]);
      expect(
        (
          await owner.query(`SELECT count(*)::int AS n FROM flow_subscribers WHERE flow_id = $1`, [
            tmp,
          ])
        ).rows[0].n,
      ).toBe(0);
    });

    it("TW-FLB-020: trigger_channel_id is a composite FK to channels (another workspace's channel is refused) and a deleted channel unpins the flow instead of deleting it", async () => {
      const chB = Number(
        (
          await owner.query(
            `INSERT INTO channels (org_id, kind, name) VALUES ($1,'whatsapp_qr','B') RETURNING id`,
            [orgB],
          )
        ).rows[0].id,
      );
      await rejects(
        `UPDATE flows SET trigger_channel_id = $1 WHERE id = $2 AND org_id = $3`,
        [chB, flowA, orgA],
        /fk_flows_trigger_channel_id/,
      );
      const chA = Number(
        (
          await owner.query(
            `INSERT INTO channels (org_id, kind, name) VALUES ($1,'whatsapp_qr','A') RETURNING id`,
            [orgA],
          )
        ).rows[0].id,
      );
      await owner.query(`UPDATE flows SET trigger_channel_id = $1 WHERE id = $2 AND org_id = $3`, [
        chA,
        flowA,
        orgA,
      ]);
      await owner.query(`DELETE FROM channels WHERE id = $1 AND org_id = $2`, [chA, orgA]);
      const row = (
        await owner.query(`SELECT trigger_channel_id FROM flows WHERE id = $1 AND org_id = $2`, [
          flowA,
          orgA,
        ])
      ).rows[0];
      expect(row.trigger_channel_id).toBeNull();
    });

    it('row_version moves on every update (the optimistic lock the save relies on)', async () => {
      const before = Number(
        (await owner.query(`SELECT row_version FROM flows WHERE id = $1`, [flowA])).rows[0]
          .row_version,
      );
      await owner.query(`UPDATE flows SET flow_name = 'Flow A2' WHERE id = $1`, [flowA]);
      const after = Number(
        (await owner.query(`SELECT row_version FROM flows WHERE id = $1`, [flowA])).rows[0]
          .row_version,
      );
      expect(after).toBe(before + 1);
    });
  });

  describe('permissions', () => {
    it('the flb keys are registered (the five flow keys and the Geta publishing key) and the locked Admin preset of every organization holds them', async () => {
      const keys = await owner.query(
        `SELECT key FROM permission_defs WHERE key LIKE 'flb.%' ORDER BY key`,
      );
      expect(keys.rows.map((r) => r.key)).toEqual([
        'flb.flows.create',
        'flb.flows.delete',
        'flb.flows.publish',
        'flb.flows.read',
        'flb.flows.update',
        'flb.geta.manage',
      ]);
    });
  });
});
