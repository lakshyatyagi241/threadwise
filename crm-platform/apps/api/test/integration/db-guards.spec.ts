import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * Database-level guarantees added by the QA work (tasks 36, 40, 41), proved against a real Postgres with every migration applied.
 * Rerun any time with `pnpm --filter @crm/api exec vitest run test/integration/db-guards.spec.ts --testTimeout=120000`
 * (needs Docker; the container is created and removed by the test). `pnpm test:integration` runs it with the rest.
 *
 *  - audit_log is append-only (migration 20261211090000): no UPDATE ever, DELETE only inside a privileged transaction, on every
 *    partition including ones created later.
 *  - pg_stat_statements is available (migration 20261211100000) once the server preloads it, as the compose files do.
 *  - no constraint is left NOT VALID once every migration has run.
 *  - the seven redundant indexes are gone (migration 20261211110000), the wider index that replaced each is still there, and the
 *    planner still serves the old query shapes from an index.
 */
describe('database guards', () => {
  let container: StartedPostgreSqlContainer;
  let db: Client;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .withCommand([
        'postgres',
        '-c',
        'shared_preload_libraries=pg_stat_statements',
        '-c',
        'pg_stat_statements.track=all',
      ])
      .start();
    db = new Client({ connectionString: container.getConnectionUri() });
    await db.connect();
    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../packages/db/migrations'),
      log: () => undefined,
    });
  }, 240_000);

  afterAll(async () => {
    await db?.end();
    await container?.stop();
  });

  const addAudit = async (at?: string): Promise<number> => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO audit_log (id, org_id, actor_type, module, record_id, action, at)
       VALUES (nextval('audit_log_id_seq'), 1, 'user', 'db-guards', 1, 'insert', COALESCE($1::timestamptz, now()))
       RETURNING id`,
      [at ?? null],
    );
    return Number(rows[0]!.id);
  };

  describe('audit_log is append-only', () => {
    it('refuses UPDATE and unprivileged DELETE, and leaves the row unchanged', async () => {
      const id = await addAudit();
      await expect(
        db.query(`UPDATE audit_log SET action = 'tampered' WHERE id = $1`, [id]),
      ).rejects.toThrow(/append-only/);
      await expect(db.query(`DELETE FROM audit_log WHERE id = $1`, [id])).rejects.toThrow(
        /append-only/,
      );
      const { rows } = await db.query(`SELECT action FROM audit_log WHERE id = $1`, [id]);
      expect(rows[0].action).toBe('insert');
    });

    it('allows DELETE only inside a privileged transaction (retention prune, workspace erasure)', async () => {
      const id = await addAudit();
      await db.query('BEGIN');
      await db.query(`SELECT set_config('app.privileged', 'on', true)`);
      await db.query(`DELETE FROM audit_log WHERE id = $1`, [id]);
      await db.query('COMMIT');
      const { rows } = await db.query(`SELECT 1 FROM audit_log WHERE id = $1`, [id]);
      expect(rows).toHaveLength(0);
    });

    it('still refuses UPDATE when privileged', async () => {
      const id = await addAudit();
      await db.query('BEGIN');
      await db.query(`SELECT set_config('app.privileged', 'on', true)`);
      await expect(
        db.query(`UPDATE audit_log SET action = 'x' WHERE id = $1`, [id]),
      ).rejects.toThrow(/append-only/);
      await db.query('ROLLBACK');
    });

    it('covers a partition created after the trigger', async () => {
      // Eight months ahead: past the bootstrap partitions, inside the helper's one-year window.
      const { rows } = await db.query<{ m: string }>(
        `SELECT to_char((date_trunc('month', now()) + interval '8 months')::date, 'YYYY-MM-DD') AS m`,
      );
      const month = rows[0]!.m;
      await db.query(`SELECT ensure_monthly_partition('audit_log', $1::date)`, [month]);
      const id = await addAudit(`${month.slice(0, 8)}15T12:00:00Z`);
      await expect(
        db.query(`UPDATE audit_log SET action = 'x' WHERE id = $1`, [id]),
      ).rejects.toThrow(/append-only/);
      await expect(db.query(`DELETE FROM audit_log WHERE id = $1`, [id])).rejects.toThrow(
        /append-only/,
      );
    });
  });

  describe('pg_stat_statements', () => {
    it('is created and queryable', async () => {
      const ext = await db.query(`SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'`);
      expect(ext.rows).toHaveLength(1);
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM pg_stat_statements`);
      expect(rows[0].n).toBeGreaterThan(0);
    });

    it('is preloaded by the server', async () => {
      const { rows } = await db.query(`SHOW shared_preload_libraries`);
      expect(rows[0].shared_preload_libraries).toContain('pg_stat_statements');
    });
  });

  describe('constraints', () => {
    it('no constraint is left NOT VALID once every migration has run', async () => {
      // A CHECK added NOT VALID guards new writes and says nothing about rows already there until something validates it.
      // 20261116090100_cat_validate_value_checks does that for the catalogue checks; this proves nothing else was left behind.
      const { rows } = await db.query(
        `SELECT conrelid::regclass::text || '.' || conname AS name FROM pg_constraint WHERE NOT convalidated ORDER BY 1`,
      );
      const left = rows.map((r) => r.name as string);
      // The closed-set status/kind checks of 20270131090000 were added NOT VALID; 20270321090000_validate_deferred_checks validates them
      // (on a live database only where no stored row violates them, so a real environment can still list one here until its data is fixed).
      expect(left).toEqual([]);
    });
  });

  describe('redundant indexes', () => {
    /** [dropped, kept index that replaces it, a query the dropped one used to serve] */
    const REPLACED: Array<[string, string, string]> = [
      [
        'idx_chatbot_widget_visitors_widget_id',
        'idx_chatbot_widget_visitors_uuid_widget',
        `SELECT * FROM chatbot_widget_visitors WHERE org_id = 1 AND widget_id = 3`,
      ],
      [
        'idx_conversation_events_conversation_id',
        'idx_conversation_events_timeline',
        `SELECT * FROM conversation_events WHERE org_id = 1 AND conversation_id = 9`,
      ],
      [
        'idx_deal_activities_deal_id_created_at',
        'idx_deal_activities_timeline',
        `SELECT * FROM deal_activities WHERE org_id = 1 AND deal_id = 5 ORDER BY created_at ASC`,
      ],
      [
        'idx_payments_paid_at',
        'idx_payments_list',
        `SELECT * FROM payments WHERE org_id = 1 ORDER BY paid_at ASC LIMIT 10`,
      ],
      [
        'idx_appointments_starts_at',
        'idx_appointments_starts_id',
        `SELECT * FROM appointments WHERE org_id = 1 ORDER BY starts_at LIMIT 10`,
      ],
      [
        'idx_appointments_status',
        'idx_appointments_status_starts',
        `SELECT * FROM appointments WHERE org_id = 1 AND status = 'pending' ORDER BY starts_at LIMIT 10`,
      ],
    ];

    const present = async (name: string): Promise<boolean> =>
      (await db.query(`SELECT 1 FROM pg_indexes WHERE indexname = $1`, [name])).rows.length > 0;

    it.each(REPLACED)('%s is gone and %s is kept', async (dropped, kept) => {
      expect(await present(dropped)).toBe(false);
      expect(await present(kept)).toBe(true);
    });

    it.each(REPLACED)(
      'the query of %s is still served by an index',
      async (_dropped, _kept, query) => {
        // The tables are empty, so the planner would pick a sequential scan; forbid it to see which index it would use.
        await db.query('BEGIN');
        await db.query('SET LOCAL enable_seqscan = off');
        await db.query('SET LOCAL enable_bitmapscan = off');
        const { rows } = await db.query(`EXPLAIN ${query}`);
        await db.query('ROLLBACK');
        const plan = rows.map((r) => r['QUERY PLAN'] as string).join('\n');
        expect(plan).toMatch(/Index( Only)? Scan/);
        expect(plan).not.toMatch(/Seq Scan/);
      },
    );
  });
});
