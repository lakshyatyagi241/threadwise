// Checks that the row-level-security helper functions are PARALLEL SAFE and that, as the application role, a scan of a big table is planned in
// parallel. A function left PARALLEL UNSAFE in a policy stops parallel plans for every query on that table.
//   PSQL_URL=postgres://crm@localhost:5433/crm APP_ROLE=crm_app_user node tools/perf/parallel-rls-check.mjs
// Needs a database with the migrations applied. With enough rows in `messages` for the planner to want workers (tools/perf/seed.sql) it also
// checks the plan; on a small table it only checks the three function flags, and says so.
import { execFileSync } from 'node:child_process';

const PSQL = process.env.PSQL ?? 'psql';
const URL = process.env.PSQL_URL ?? 'postgres://crm@localhost:5433/crm';
const ROLE = process.env.APP_ROLE ?? 'crm_app_user';
const run = (sql) =>
  execFileSync(PSQL, [URL, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();

const flags = run(
  `SELECT p.proname || '=' || p.proparallel::text FROM pg_proc p WHERE p.proname IN ('current_org_id','current_actor_id','app_is_privileged') AND p.pronamespace = 'public'::regnamespace ORDER BY 1`,
).split('\n');
const unsafe = flags.filter((f) => !f.endsWith('=s'));
if (unsafe.length) {
  console.error(
    `FAIL: not PARALLEL SAFE: ${unsafe.join(', ')} (see 20270131090100_rls_helpers_parallel_safe.sql)`,
  );
  process.exit(1);
}
console.log(`ok: ${flags.join(', ')}`);

const rows = Number(run(`SELECT count(*) FROM messages`));
if (rows < 200_000) {
  console.log(
    `only the function flags were checked: messages has ${rows} rows, too few for a parallel plan`,
  );
  process.exit(0);
}
const org = run(`SELECT org_id FROM messages GROUP BY org_id ORDER BY count(*) DESC LIMIT 1`);
const plan = execFileSync(
  PSQL,
  [
    URL,
    '-At',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `BEGIN; SET LOCAL ROLE ${ROLE}; SELECT set_config('app.org_id','${org}',true); EXPLAIN (COSTS OFF) SELECT count(*) FROM messages WHERE org_id = ${org}; ROLLBACK;`,
  ],
  { encoding: 'utf8' },
);
if (!/Gather/.test(plan)) {
  console.error(`FAIL: as ${ROLE} the scan of messages is not planned in parallel:\n${plan}`);
  process.exit(1);
}
console.log(`ok: as ${ROLE}, a scan of ${rows} messages is planned with a Gather`);
