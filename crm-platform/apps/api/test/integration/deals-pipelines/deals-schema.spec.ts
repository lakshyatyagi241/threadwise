import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The deals-pipelines tables against a real Postgres, as the restricted application role (a superuser bypasses every policy
 * and would make the isolation assertions vacuous, see rls.spec.ts). Constraint checks use the owner connection: owners skip
 * RLS but never CHECK, UNIQUE or FK.
 */
describe('pipelines, stages, deals, timeline, lost reasons and settings: schema and isolation', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let pipeA: number;
  let pipeB: number;
  const stageA: Record<string, number> = {};
  let stageB: number;
  let dealA: number;
  let dealB: number;
  let reasonA: number;

  const TABLES = [
    'pipelines',
    'pipeline_stages',
    'deals',
    'deal_activities',
    'deal_lost_reasons',
    'deal_settings',
  ];

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

    const a = await owner.query(
      `INSERT INTO organizations (slug, name, plan) VALUES ('a','A','starter') RETURNING id`,
    );
    const b = await owner.query(
      `INSERT INTO organizations (slug, name, plan, settings) VALUES ('b','B','starter','{"currency":"usd"}') RETURNING id`,
    );
    orgA = Number(a.rows[0].id);
    orgB = Number(b.rows[0].id);

    // The default pipelines come from the organizations trigger, not from this test.
    pipeA = Number(
      (await owner.query(`SELECT id FROM pipelines WHERE org_id = $1`, [orgA])).rows[0].id,
    );
    pipeB = Number(
      (await owner.query(`SELECT id FROM pipelines WHERE org_id = $1`, [orgB])).rows[0].id,
    );
    for (const r of (
      await owner.query(`SELECT id, name FROM pipeline_stages WHERE org_id = $1`, [orgA])
    ).rows) {
      stageA[r.name as string] = Number(r.id);
    }
    stageB = Number(
      (
        await owner.query(
          `SELECT id FROM pipeline_stages WHERE org_id = $1 AND name = 'New Lead'`,
          [orgB],
        )
      ).rows[0].id,
    );

    reasonA = Number(
      (
        await owner.query(
          `INSERT INTO deal_lost_reasons (org_id, name) VALUES ($1,'Budget') RETURNING id`,
          [orgA],
        )
      ).rows[0].id,
    );
    await owner.query(`INSERT INTO deal_lost_reasons (org_id, name) VALUES ($1,'Price')`, [orgB]);
    dealA = Number(
      (
        await owner.query(
          `INSERT INTO deals (org_id, pipeline_id, stage_id, title, value_minor, currency) VALUES ($1,$2,$3,'Deal A',10000,'USD') RETURNING id`,
          [orgA, pipeA, stageA['New Lead']],
        )
      ).rows[0].id,
    );
    dealB = Number(
      (
        await owner.query(
          `INSERT INTO deals (org_id, pipeline_id, stage_id, title, value_minor, currency) VALUES ($1,$2,$3,'Deal B',5000,'USD') RETURNING id`,
          [orgB, pipeB, stageB],
        )
      ).rows[0].id,
    );
    await owner.query(
      `INSERT INTO deal_activities (org_id, deal_id, type, body) VALUES ($1,$2,'note','a'), ($3,$4,'note','b')`,
      [orgA, dealA, orgB, dealB],
    );
    await owner.query(
      `INSERT INTO deal_settings (org_id, lost_reason_required) VALUES ($1,true), ($2,false)`,
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

  async function asOrg<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgId)]);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  }

  const rejects = async (sql: string, params: unknown[], pattern: RegExp) => {
    await expect(owner.query(sql, params)).rejects.toThrow(pattern);
  };

  describe('row-level security', () => {
    it('WD-DEAL-RLS: RLS is enabled and forced, with a tenant policy, on every deals table', async () => {
      const res = await owner.query(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
                (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation')::int AS policies
           FROM pg_class c WHERE c.relname = ANY($1) AND c.relkind = 'r' ORDER BY c.relname`,
        [TABLES],
      );
      expect(res.rows).toHaveLength(TABLES.length);
      for (const r of res.rows) {
        expect(r, r.relname).toMatchObject({
          relrowsecurity: true,
          relforcerowsecurity: true,
          policies: 1,
        });
      }
    });

    it('WD-DEAL-RLS: a workspace sees only its own pipelines, stages, deals, timeline, reasons and settings', async () => {
      for (const [org, other] of [
        [orgA, orgB],
        [orgB, orgA],
      ] as const) {
        await asOrg(org, async () => {
          for (const t of TABLES) {
            const rows = (await app.query(`SELECT org_id FROM ${t}`)).rows;
            expect(rows.length, t).toBeGreaterThan(0);
            expect(
              rows.every((r) => Number(r.org_id) === org),
              t,
            ).toBe(true);
            expect(
              rows.some((r) => Number(r.org_id) === other),
              t,
            ).toBe(false);
          }
        });
      }
    });

    it("WD-DEAL-RLS: another workspace's deal is invisible even when its id is known exactly", async () => {
      const rows = await asOrg(
        orgA,
        async () =>
          (await app.query(`SELECT * FROM deals WHERE org_id = $1 AND id = $2`, [orgB, dealB]))
            .rows,
      );
      expect(rows).toHaveLength(0);
    });

    it('WD-DEAL-RLS: with no tenant set a query sees no rows at all', async () => {
      await app.query('BEGIN');
      try {
        for (const t of TABLES)
          expect((await app.query(`SELECT 1 FROM ${t}`)).rows, t).toHaveLength(0);
      } finally {
        await app.query('ROLLBACK');
      }
    });

    it('WD-DEAL-RLS: a workspace cannot write a row into another one (WITH CHECK, not only USING)', async () => {
      const writes: Array<[string, unknown[]]> = [
        [`INSERT INTO pipelines (org_id, name) VALUES ($1, 'Smuggled')`, [orgB]],
        [
          `INSERT INTO pipeline_stages (org_id, pipeline_id, name) VALUES ($1,$2,'S')`,
          [orgB, pipeB],
        ],
        [
          `INSERT INTO deals (org_id, pipeline_id, stage_id, title) VALUES ($1,$2,$3,'x')`,
          [orgB, pipeB, stageB],
        ],
        [
          `INSERT INTO deal_activities (org_id, deal_id, type) VALUES ($1,$2,'note')`,
          [orgB, dealB],
        ],
        [`INSERT INTO deal_lost_reasons (org_id, name) VALUES ($1,'x')`, [orgB]],
        [`INSERT INTO deal_settings (org_id) VALUES ($1)`, [orgB]],
      ];
      for (const [sql, params] of writes) {
        await expect(
          asOrg(orgA, () => app.query(sql, params)),
          sql,
        ).rejects.toThrow(/row-level security/i);
      }
    });

    it("WD-DEAL-RLS: updating or deleting another workspace's deal touches nothing", async () => {
      const upd = await asOrg(orgA, () =>
        app.query(`UPDATE deals SET title = 'hacked' WHERE id = $1`, [dealB]),
      );
      expect(upd.rowCount).toBe(0);
      const del = await asOrg(orgA, () => app.query(`DELETE FROM deals WHERE id = $1`, [dealB]));
      expect(del.rowCount).toBe(0);
      expect(
        (await owner.query(`SELECT title FROM deals WHERE id = $1`, [dealB])).rows[0].title,
      ).toBe('Deal B');
    });

    it('WD-DEAL-001: the deals and pipelines capability keys exist, and every Admin role holds them with scope all', async () => {
      const keys = await owner.query(
        `SELECT key, supports_scope FROM permission_defs WHERE key LIKE 'record.deals.%' OR key LIKE 'record.pipelines.%' ORDER BY key`,
      );
      expect(keys.rows.map((r) => r.key)).toEqual([
        'record.deals.create',
        'record.deals.delete',
        'record.deals.read',
        'record.deals.report',
        'record.deals.update',
        'record.pipelines.create',
        'record.pipelines.delete',
        'record.pipelines.read',
        'record.pipelines.update',
      ]);
      expect(Object.fromEntries(keys.rows.map((r) => [r.key, r.supports_scope]))).toMatchObject({
        'record.deals.read': true,
        'record.deals.update': true,
        'record.deals.delete': true,
        'record.deals.report': true,
        'record.deals.create': false,
        'record.pipelines.read': false,
      });
    });
  });

  describe('the default pipeline (WD-DEAL-002)', () => {
    it('WD-DEAL-002 #1: a new organization gets one default pipeline "Sales Pipeline" with the six-stage ladder, in order', async () => {
      const stages = await owner.query(
        `SELECT name, probability, color, is_won, is_lost FROM pipeline_stages WHERE org_id = $1 ORDER BY sort_order`,
        [orgA],
      );
      expect(stages.rows.map((r) => [r.name, r.probability, r.color, r.is_won, r.is_lost])).toEqual(
        [
          ['New Lead', 10, '#64748B', false, false],
          ['Qualified', 25, '#0EA5E9', false, false],
          ['Proposal', 50, '#6366F1', false, false],
          ['Negotiation', 75, '#F59E0B', false, false],
          ['Won', 100, '#16A34A', true, false],
          ['Lost', 0, '#DC2626', false, true],
        ],
      );
      const p = await owner.query(
        `SELECT name, is_default, currency, sort_order FROM pipelines WHERE org_id = $1`,
        [orgA],
      );
      expect(p.rows).toEqual([
        { name: 'Sales Pipeline', is_default: true, currency: 'INR', sort_order: 0 },
      ]);
    });

    it("WD-DEAL-002: the pipeline starts in the organization's own currency when it has one", async () => {
      const p = await owner.query(`SELECT currency FROM pipelines WHERE org_id = $1`, [orgB]);
      expect(p.rows[0].currency).toBe('USD');
    });

    it('WD-DEAL-002: seeding does not leave row-level security lifted for the rest of the transaction', async () => {
      // The trigger lifts RLS for its own two statements (a seed script or a sign-up may not have), then puts the old setting back.
      await owner.query('BEGIN');
      try {
        await owner.query(
          `INSERT INTO organizations (slug, name, plan) VALUES ('lifted','Lifted','starter')`,
        );
        const p = (
          await owner.query(`SELECT coalesce(current_setting('app.privileged', true), '') AS p`)
        ).rows[0].p;
        expect(p).not.toBe('on');
      } finally {
        await owner.query('ROLLBACK');
      }
      await owner.query('BEGIN');
      try {
        await owner.query(`SELECT set_config('app.privileged', 'on', true)`);
        await owner.query(
          `INSERT INTO organizations (slug, name, plan) VALUES ('kept','Kept','starter')`,
        );
        const p = (await owner.query(`SELECT current_setting('app.privileged', true) AS p`)).rows[0]
          .p;
        expect(p).toBe('on');
      } finally {
        await owner.query('ROLLBACK');
      }
    });

    it('WD-DEAL-002: the seeding function cannot be called by a tenant (it exists only as a trigger)', async () => {
      const res = await owner.query(
        `SELECT proname FROM pg_proc WHERE proname = 'seed_default_pipeline'`,
      );
      expect(res.rows).toHaveLength(0);
    });

    it('WD-DEAL-041 / D-09: there can be only one default pipeline per workspace', async () => {
      await rejects(
        `INSERT INTO pipelines (org_id, name, is_default) VALUES ($1,'Second default',true)`,
        [orgA],
        /uq_pipelines_one_default/,
      );
      await owner.query(
        `INSERT INTO pipelines (org_id, name, is_default) VALUES ($1,'Not default',false)`,
        [orgA],
      );
      await owner.query(`DELETE FROM pipelines WHERE org_id = $1 AND name = 'Not default'`, [orgA]);
    });

    it('WD-DEAL-041: pipeline names are unique per workspace ignoring case and spaces, and a currency is three capital letters', async () => {
      await rejects(
        `INSERT INTO pipelines (org_id, name) VALUES ($1,'  sales pipeline ')`,
        [orgA],
        /uq_pipelines_org_lower_name/,
      );
      await rejects(
        `INSERT INTO pipelines (org_id, name, currency) VALUES ($1,'X','usd')`,
        [orgA],
        /chk_pipelines_currency/,
      );
      await rejects(
        `INSERT INTO pipelines (org_id, name) VALUES ($1,'   ')`,
        [orgA],
        /chk_pipelines_name/,
      );
      // the same name in another workspace is fine
      const ok = await owner.query(
        `INSERT INTO pipelines (org_id, name) VALUES ($1,'Sales Pipeline 2') RETURNING id`,
        [orgB],
      );
      await owner.query(`DELETE FROM pipelines WHERE id = $1`, [ok.rows[0].id]);
    });
  });

  describe('stages (WD-DEAL-041)', () => {
    it('WD-DEAL-041 port decision: a pipeline has at most one won and one lost stage', async () => {
      await rejects(
        `INSERT INTO pipeline_stages (org_id, pipeline_id, name, is_won, probability) VALUES ($1,$2,'Won again',true,100)`,
        [orgA, pipeA],
        /uq_pipeline_stages_one_won/,
      );
      await rejects(
        `INSERT INTO pipeline_stages (org_id, pipeline_id, name, is_lost, probability) VALUES ($1,$2,'Lost again',true,0)`,
        [orgA, pipeA],
        /uq_pipeline_stages_one_lost/,
      );
    });

    it('WD-DEAL-041: a stage cannot be both won and lost, a won stage is 100%, a lost one 0%, probability stays 0-100', async () => {
      await rejects(
        `INSERT INTO pipeline_stages (org_id, pipeline_id, name, is_won, is_lost) VALUES ($1,$2,'Both',true,true)`,
        [orgB, pipeB],
        /chk_pipeline_stages_kind|chk_pipeline_stages_terminal_probability/,
      );
      await rejects(
        `UPDATE pipeline_stages SET probability = 80 WHERE id = $1`,
        [stageA['Won']],
        /chk_pipeline_stages_terminal_probability/,
      );
      await rejects(
        `UPDATE pipeline_stages SET probability = 101 WHERE id = $1`,
        [stageA['Qualified']],
        /chk_pipeline_stages_probability/,
      );
    });

    it('WD-DEAL-041: stage names are unique within a pipeline ignoring case, and a colour is #RRGGBB', async () => {
      await rejects(
        `INSERT INTO pipeline_stages (org_id, pipeline_id, name) VALUES ($1,$2,' qualified')`,
        [orgA, pipeA],
        /uq_pipeline_stages_pipeline_lower_name/,
      );
      await rejects(
        `INSERT INTO pipeline_stages (org_id, pipeline_id, name, color) VALUES ($1,$2,'Colourless','green')`,
        [orgA, pipeA],
        /chk_pipeline_stages_color/,
      );
    });

    it('WD-DEAL-041 / D-09: a stage or a pipeline that still holds deals cannot be deleted (NO ACTION, not a silent cascade)', async () => {
      await rejects(
        `DELETE FROM pipeline_stages WHERE id = $1`,
        [stageA['New Lead']],
        /fk_deals_stage_id/,
      );
      await rejects(`DELETE FROM pipelines WHERE id = $1`, [pipeA], /violates foreign key/);
      expect((await owner.query(`SELECT 1 FROM deals WHERE id = $1`, [dealA])).rows).toHaveLength(
        1,
      );
    });
  });

  describe('deals (WD-DEAL-006..013)', () => {
    it("WD-DEAL-007 #2 / D-11: a deal's stage must belong to the deal's own pipeline, enforced by the database", async () => {
      const other = await owner.query(
        `INSERT INTO pipelines (org_id, name) VALUES ($1,'Other') RETURNING id`,
        [orgA],
      );
      const otherStage = await owner.query(
        `INSERT INTO pipeline_stages (org_id, pipeline_id, name) VALUES ($1,$2,'O1') RETURNING id`,
        [orgA, other.rows[0].id],
      );
      await rejects(
        `INSERT INTO deals (org_id, pipeline_id, stage_id, title) VALUES ($1,$2,$3,'cross')`,
        [orgA, pipeA, otherStage.rows[0].id],
        /fk_deals_stage_id/,
      );
      await rejects(
        `UPDATE deals SET stage_id = $2 WHERE id = $1`,
        [dealA, otherStage.rows[0].id],
        /fk_deals_stage_id/,
      );
      // and a deal cannot point at another workspace's stage
      await rejects(
        `INSERT INTO deals (org_id, pipeline_id, stage_id, title) VALUES ($1,$2,$3,'xorg')`,
        [orgA, pipeA, stageB],
        /fk_deals_stage_id/,
      );
      await owner.query(`DELETE FROM pipelines WHERE id = $1`, [other.rows[0].id]);
    });

    it('WD-DEAL-008: status and its stamps agree (won needs won_at, open has neither, a reason belongs to a lost deal only)', async () => {
      const ins = (
        status: string,
        won: string | null,
        lost: string | null,
        reason: string | null,
      ) =>
        owner.query(
          `INSERT INTO deals (org_id, pipeline_id, stage_id, title, status, won_at, lost_at, lost_reason)
           VALUES ($1,$2,$3,'s',$4,$5::timestamptz,$6::timestamptz,$7)`,
          [orgA, pipeA, stageA['New Lead'], status, won, lost, reason],
        );
      await expect(ins('won', null, null, null)).rejects.toThrow(/chk_deals_status_stamps/);
      await expect(ins('open', '2026-10-01', null, null)).rejects.toThrow(
        /chk_deals_status_stamps/,
      );
      await expect(ins('lost', null, null, null)).rejects.toThrow(/chk_deals_status_stamps/);
      await expect(ins('open', null, null, 'stale')).rejects.toThrow(/chk_deals_status_stamps/);
      await expect(ins('won', '2026-10-01', '2026-10-02', null)).rejects.toThrow(
        /chk_deals_status_stamps/,
      );
      await expect(ins('maybe', null, null, null)).rejects.toThrow(/chk_deals_status/);
      await expect(ins('lost', null, '2026-10-01', 'Budget')).resolves.toBeTruthy();
      await owner.query(`DELETE FROM deals WHERE title = 's'`);
    });

    it('WD-DEAL-006 / D-03: value is never negative, the currency is three capital letters, the source is a known one', async () => {
      const ins = (extra: string, val: unknown) =>
        owner.query(
          `INSERT INTO deals (org_id, pipeline_id, stage_id, title, ${extra}) VALUES ($1,$2,$3,'v',$4)`,
          [orgA, pipeA, stageA['New Lead'], val],
        );
      await expect(ins('value_minor', -1)).rejects.toThrow(/chk_deals_value/);
      await expect(ins('currency', 'eur')).rejects.toThrow(/chk_deals_currency/);
      await expect(ins('currency', 'EURO')).rejects.toThrow(/chk_deals_currency/);
      await expect(ins('source', 'carrier-pigeon')).rejects.toThrow(/chk_deals_source/);
      await expect(
        owner.query(
          `INSERT INTO deals (org_id, pipeline_id, stage_id, title) VALUES ($1,$2,$3,'   ')`,
          [orgA, pipeA, stageA['New Lead']],
        ),
      ).rejects.toThrow(/chk_deals_title/);
    });

    it('WD-DEAL-013 / D-13: deleting a deal removes its timeline; deleting a contact or an owner only unlinks them', async () => {
      const user = Number(
        (
          await owner.query(
            `INSERT INTO users (org_id, email, full_name) VALUES ($1,'u@x.test','U') RETURNING id`,
            [orgA],
          )
        ).rows[0].id,
      );
      const contact = Number(
        (
          await owner.query(
            `INSERT INTO contacts (org_id, name, phone) VALUES ($1,'C','+910000000001') RETURNING id`,
            [orgA],
          )
        ).rows[0].id,
      );
      const company = Number(
        (
          await owner.query(`INSERT INTO companies (org_id, name) VALUES ($1,'Co') RETURNING id`, [
            orgA,
          ])
        ).rows[0].id,
      );
      const d = Number(
        (
          await owner.query(
            `INSERT INTO deals (org_id, pipeline_id, stage_id, title, owner_user_id, contact_id, company_id)
             VALUES ($1,$2,$3,'links',$4,$5,$6) RETURNING id`,
            [orgA, pipeA, stageA['New Lead'], user, contact, company],
          )
        ).rows[0].id,
      );
      await owner.query(
        `INSERT INTO deal_activities (org_id, deal_id, type, body) VALUES ($1,$2,'note','x'), ($1,$2,'note','y')`,
        [orgA, d],
      );

      await owner.query(`DELETE FROM contacts WHERE id = $1`, [contact]);
      await owner.query(`DELETE FROM companies WHERE id = $1`, [company]);
      await owner.query(`DELETE FROM users WHERE id = $1`, [user]);
      const row = (
        await owner.query(`SELECT contact_id, company_id, owner_user_id FROM deals WHERE id = $1`, [
          d,
        ])
      ).rows[0];
      expect(row).toEqual({ contact_id: null, company_id: null, owner_user_id: null });

      await owner.query(`DELETE FROM deals WHERE id = $1`, [d]);
      expect(
        (await owner.query(`SELECT 1 FROM deal_activities WHERE deal_id = $1`, [d])).rows,
      ).toHaveLength(0);
    });

    it('WD-DEAL-011: the touch trigger bumps row_version on every update (the optimistic lock)', async () => {
      const before = (await owner.query(`SELECT row_version FROM deals WHERE id = $1`, [dealA]))
        .rows[0].row_version;
      await owner.query(`UPDATE deals SET title = 'Deal A' WHERE id = $1`, [dealA]);
      const after = (await owner.query(`SELECT row_version FROM deals WHERE id = $1`, [dealA]))
        .rows[0].row_version;
      expect(after).toBe(before + 1);
    });
  });

  describe('timeline and tasks (WD-DEAL-015, 016)', () => {
    it('WD-DEAL-015 #3 / port decision: only the known activity types exist, and only a task has a due date or a done stamp', async () => {
      const ins = (type: string, extra = '', val: unknown = null) =>
        owner.query(
          `INSERT INTO deal_activities (org_id, deal_id, type${extra ? `, ${extra}` : ''}) VALUES ($1,$2,$3${extra ? ',$4::timestamptz' : ''})`,
          extra ? [orgA, dealA, type, val] : [orgA, dealA, type],
        );
      await expect(ins('tweet')).rejects.toThrow(/chk_deal_activities_type/);
      await expect(ins('note', 'due_at', '2026-11-01')).rejects.toThrow(
        /chk_deal_activities_task_fields/,
      );
      await expect(ins('call', 'done_at', '2026-11-01')).rejects.toThrow(
        /chk_deal_activities_task_fields/,
      );
      await expect(ins('task', 'due_at', '2026-11-01')).resolves.toBeTruthy();
      await owner.query(`DELETE FROM deal_activities WHERE type = 'task'`);
    });

    it('WD-DEAL-017: the reminder sweep has a partial index shaped for open, unreminded tasks', async () => {
      const res = await owner.query(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_deal_activities_task_sweep'`,
      );
      expect(res.rows[0].indexdef).toMatch(/due_at/);
      expect(res.rows[0].indexdef).toMatch(/done_at IS NULL/);
      expect(res.rows[0].indexdef).toMatch(/reminded_at IS NULL/);
    });
  });

  describe('lost reasons and settings (WD-DEAL-043, D-08)', () => {
    it('WD-DEAL-043: reason names are unique per workspace ignoring case', async () => {
      await rejects(
        `INSERT INTO deal_lost_reasons (org_id, name) VALUES ($1,' BUDGET ')`,
        [orgA],
        /uq_deal_lost_reasons_org_lower_name/,
      );
      const ok = await owner.query(
        `INSERT INTO deal_lost_reasons (org_id, name) VALUES ($1,'Budget') RETURNING id`,
        [orgB],
      );
      await owner.query(`DELETE FROM deal_lost_reasons WHERE id = $1`, [ok.rows[0].id]);
    });

    it('WD-DEAL-043: deleting a reason keeps the deals and the reason text, and only clears the link', async () => {
      const d = Number(
        (
          await owner.query(
            `INSERT INTO deals (org_id, pipeline_id, stage_id, title, status, lost_at, lost_reason, lost_reason_id)
             VALUES ($1,$2,$3,'lostdeal','lost', now(), 'Budget', $4) RETURNING id`,
            [orgA, pipeA, stageA['Lost'], reasonA],
          )
        ).rows[0].id,
      );
      await owner.query(`DELETE FROM deal_lost_reasons WHERE id = $1`, [reasonA]);
      const row = (
        await owner.query(`SELECT lost_reason, lost_reason_id FROM deals WHERE id = $1`, [d])
      ).rows[0];
      expect(row).toEqual({ lost_reason: 'Budget', lost_reason_id: null });
      await owner.query(`DELETE FROM deals WHERE id = $1`, [d]);
    });

    it('WD-DEAL-043: a workspace has at most one settings row', async () => {
      await rejects(
        `INSERT INTO deal_settings (org_id) VALUES ($1)`,
        [orgA],
        /deal_settings_org_id_key|duplicate key/,
      );
    });
  });

  describe('workspace deletion', () => {
    it('WD-DEAL-046: deleting a whole workspace removes its pipelines, stages, deals and timeline together (NO ACTION is checked at statement end)', async () => {
      const o = await owner.query(
        `INSERT INTO organizations (slug, name, plan) VALUES ('gone','Gone','starter') RETURNING id`,
      );
      const id = Number(o.rows[0].id);
      const p = Number(
        (await owner.query(`SELECT id FROM pipelines WHERE org_id = $1`, [id])).rows[0].id,
      );
      const s = Number(
        (await owner.query(`SELECT id FROM pipeline_stages WHERE org_id = $1 LIMIT 1`, [id]))
          .rows[0].id,
      );
      const d = Number(
        (
          await owner.query(
            `INSERT INTO deals (org_id, pipeline_id, stage_id, title) VALUES ($1,$2,$3,'d') RETURNING id`,
            [id, p, s],
          )
        ).rows[0].id,
      );
      await owner.query(
        `INSERT INTO deal_activities (org_id, deal_id, type) VALUES ($1,$2,'note')`,
        [id, d],
      );
      await owner.query(`DELETE FROM organizations WHERE id = $1`, [id]);
      for (const t of TABLES) {
        expect(
          (await owner.query(`SELECT 1 FROM ${t} WHERE org_id = $1`, [id])).rows,
          t,
        ).toHaveLength(0);
      }
    });
  });
});
