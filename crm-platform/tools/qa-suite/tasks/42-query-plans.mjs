// #42 Query execution plans: EXPLAIN every critical query from data/critical-queries.json, flag scans and sorts that an index should serve, and diff against the saved baseline (before/after evidence).
import { ROOT, expectNone, fail, pass, pgClient, read, skip, warn } from '../lib/core.mjs';
import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const BASELINE = join(ROOT, 'tools/qa-suite/data/plan-baseline.json');
const LIT = {
  bigint: '1',
  integer: '1',
  smallint: '1',
  numeric: '1',
  uuid: `'00000000-0000-0000-0000-000000000001'::uuid`,
  text: `'x'`,
  'character varying': `'x'`,
  boolean: 'true',
  'timestamp with time zone': 'now()',
  'timestamp without time zone': 'now()',
  date: 'current_date',
  jsonb: `'{}'::jsonb`,
  USER_DEFINED: null,
};

function walkPlan(n, acc = []) {
  acc.push(n);
  for (const c of n.Plans ?? []) walkPlan(c, acc);
  return acc;
}

export default {
  id: 42,
  priority: 'P1',
  name: 'Query execution plans',
  owner: 'Punya',
  target: '100% critical data paths reviewed; measurable before/after evidence',
  async run({ args }) {
    const reg = JSON.parse(read(join(ROOT, 'tools/qa-suite/data/critical-queries.json'))).queries;
    const checks = [];
    const { client, error } = await pgClient();
    if (!client) {
      checks.push(skip('plan-live', `EXPLAIN ${reg.length} critical queries`, error));
      return {
        checks,
        metrics: { 'critical queries': reg.length },
        target: {
          met: null,
          text: `Needs DATABASE_URL (a seeded database: planner choices on an empty table mean nothing). Use --save-plans to store the "before" baseline, then re-run after the change for the "after" diff.`,
        },
      };
    }
    const analyze = args.includes('--analyze');
    const saved = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
    const now = {},
      seq = [],
      sorts = [],
      slow = [],
      regress = [],
      missing = [],
      small = [];
    for (const q of reg) {
      const cols = (
        await client.query(
          `SELECT column_name c, data_type t FROM information_schema.columns WHERE table_name=$1`,
          [q.table],
        )
      ).rows;
      if (!cols.length) {
        missing.push(`${q.name}: table ${q.table} does not exist`);
        continue;
      }
      const type = Object.fromEntries(cols.map((r) => [r.c, r.t]));
      const lit = (c) => (c === 'org_id' ? '1' : (LIT[type[c]] ?? `NULL`));
      const where =
        [
          ...(q.equals ?? []).map((c) => `${c} = ${lit(c)}`),
          ...(q.range ?? []).map((c) => `${c} >= ${lit(c)}`),
        ].join(' AND ') || 'true';
      const sql = `SELECT * FROM ${q.table} WHERE ${where}${q.orderBy ? ' ORDER BY ' + q.orderBy.join(', ') : ''} LIMIT 50`;
      let plan;
      try {
        plan = (
          await client.query(`EXPLAIN (FORMAT JSON${analyze ? ', ANALYZE, BUFFERS' : ''}) ${sql}`)
        ).rows[0]['QUERY PLAN'][0];
      } catch (e) {
        missing.push(`${q.name}: ${e.message.slice(0, 100)}`);
        continue;
      }
      const nodes = walkPlan(plan.Plan),
        rows =
          (
            await client.query(`SELECT reltuples::bigint n FROM pg_class WHERE relname=$1`, [
              q.table,
            ])
          ).rows[0]?.n ?? 0;
      const sc = nodes.find((n) => n['Node Type'] === 'Seq Scan' && n['Relation Name'] === q.table);
      const so = nodes.find((n) => n['Node Type'] === 'Sort');
      now[q.name] = {
        cost: plan.Plan['Total Cost'],
        rows,
        nodes: nodes.map((n) => n['Node Type'] + (n['Index Name'] ? `(${n['Index Name']})` : '')),
        ms: analyze ? plan['Execution Time'] : undefined,
      };
      if (rows < 5000) small.push(q.name);
      else {
        if (sc) seq.push(`${q.name}: Seq Scan on ${q.table} (~${rows} rows)  ${sql}`);
        if (so && q.orderBy)
          sorts.push(`${q.name}: explicit Sort node (index does not deliver the order)  ${sql}`);
      }
      if (analyze && plan['Execution Time'] > 100)
        slow.push(`${q.name}: ${plan['Execution Time'].toFixed(1)} ms`);
      const before = saved[q.name];
      if (before && now[q.name].cost > before.cost * 1.25)
        regress.push(
          `${q.name}: cost ${before.cost.toFixed(1)} -> ${now[q.name].cost.toFixed(1)} (+${Math.round((now[q.name].cost / before.cost - 1) * 100)}%)`,
        );
    }
    checks.push(
      expectNone('plan-missing', 'Every critical query can be planned', missing, {
        severity: 'medium',
      }),
    );
    checks.push(
      expectNone(
        'plan-seqscan',
        'No critical query does a Seq Scan on a table over 5,000 rows',
        seq,
        { severity: 'high' },
      ),
    );
    checks.push(
      expectNone(
        'plan-sort',
        'No critical ORDER BY needs an explicit Sort on a table over 5,000 rows',
        sorts,
        { level: 'warn' },
      ),
    );
    if (analyze)
      checks.push(
        expectNone(
          'plan-time',
          'Critical queries run in under 100 ms (EXPLAIN ANALYZE, warm cache not guaranteed)',
          slow,
          { level: 'warn' },
        ),
      );
    if (Object.keys(saved).length)
      checks.push(
        expectNone(
          'plan-regress',
          'No critical plan got >25% more expensive than the saved baseline',
          regress,
          { severity: 'high' },
        ),
      );
    else
      checks.push(
        warn(
          'plan-baseline',
          'A baseline of plans is saved for before/after comparison',
          'Run once with --save-plans on the "before" state.',
        ),
      );
    if (small.length)
      checks.push(
        warn(
          'plan-small',
          `${small.length} tables have under 5,000 rows, so scans there say nothing`,
          'Seed realistic volume (docs: db:seed) before trusting this check.',
          small,
        ),
      );
    if (args.includes('--save-plans')) {
      mkdirSync(dirname(BASELINE), { recursive: true });
      writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n');
      checks.push(
        pass(
          'plan-saved',
          `Saved ${Object.keys(now).length} plans to tools/qa-suite/data/plan-baseline.json`,
        ),
      );
    }
    await client.end();
    return {
      checks,
      metrics: {
        'critical queries': reg.length,
        planned: Object.keys(now).length,
        'too small to judge': small.length,
      },
      target: {
        met: seq.length === 0 && missing.length === 0 && small.length === 0 ? true : null,
        text: 'Seq scans on large tables are failures; commit plan-baseline.json after a reviewed change so the next run shows before/after.',
      },
    };
  },
};
