// ACCURACY + RESOLVER HARNESS on a throwaway database. Seeds ground-truth scenarios, runs the REAL watcher (read-only role) against them,
// scores precision / recall / false positives / detection latency, then exercises every resolver playbook incl. failures.
// Usage: node run.mjs <adminUrlWithoutDb> <dbName> <roName> <outJson> [--quick] [--trials=N]   (run from apps/api so `pg` resolves)
// Thresholds are scaled x1/10 for speed (running 3 s, critical 8 s, blocker critical 4 s); the production defaults (60 s / 30 s) are
// asserted on the pure classifier at the end. Never contacts chat.googleapis.com: Chat is a collector function.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createWatcher, classify, cfg } from '../watcher.mjs';
import { createResolver } from '../resolver.mjs';
import { createMetrics } from '../lib.mjs';

const [admin, db, ro, outFile, ...flags] = process.argv.slice(2);
const quick = flags.includes('--quick');
const trials = Number((flags.find((f) => f.startsWith('--trials=')) ?? '').split('=')[1] ?? (quick ? 1 : 3));
const { Client } = createRequire(`${process.cwd()}/`)('pg');
const url = (user, pw) => `${admin.replace('postgres://crm:crm@', user ? `postgres://${user}:${pw}@` : 'postgres://crm:crm@')}/${db}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = async (app, u = url()) => { const c = new Client({ connectionString: u, application_name: app }); c.on('error', () => {}); await c.connect(); return c; };
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const ENV = { SLOW_RUNNING_SECONDS: '3', SLOW_IDLE_TX_SECONDS: '3', CRITICAL_SLOW_SECONDS: '8', CRITICAL_BLOCK_SECONDS: '4', SLOW_MEAN_MS: '300', SLOW_MAX_PER_MINUTE: '100000', SLOW_COOLDOWN_SECONDS: '600', AUTO_REMEDIATE: 'off' };

const RUN = Math.random().toString(36).slice(2, 6); // unique statement ids per run (pg_stat_statements keeps old ones)
const setup = await mk('acc-setup');
await setup.query('create table if not exists t_acc(a int)');
await setup.query('create extension if not exists pg_stat_statements').catch(() => {});

// ---- scenarios: expect = kinds that MUST be detected, allow = kinds that may appear without counting as false positives ----
const S = (name, o) => ({ name, expect: [], allow: [], ...o });
const scenarios = [
  S('fast queries', { run: async (c, m) => { for (let i = 0; i < 20; i++) await c.query(`select pg_sleep(0.05) as ${m}`); } }),
  S('slow pg_sleep 6 s (<critical)', { expect: ['slow'], channel: 'slowquery', noCritical: true, allow: ['statement'], run: (c, m) => c.query(`select pg_sleep(6) as ${m}`), resolveReply: true }),
  S('heavy aggregate', { expect: ['slow'], allow: ['statement'], run: (c, m) => c.query(`select count(*) as ${m} from generate_series(1,40000000) x where x%7=0`) }),
  S('critical slow 11 s (>=critical)', { expect: ['slow'], channel: 'slowquery', noCritical: true, allow: ['statement'], run: (c, m) => c.query(`select pg_sleep(11) as ${m}`) }),
  S('lock wait: waiter', { expect: ['blocked'], channel: 'slowquery', noCritical: true, app: 'lockB', special: 'lock' }),
  S('lock wait: blocker (idle in tx)', { expect: ['idle_in_tx'], channel: 'slowquery', noCritical: true, app: 'lockA', special: 'none' }),
  S('idle in transaction', { expect: ['idle_in_tx'], run: async (c) => { await c.query('begin'); await c.query('select 1'); await sleep(13000); } }),
  S('allow-listed pg_dump', { appName: 'pg_dump', run: (c, m) => c.query(`select pg_sleep(7) as ${m}`) }),
  S('allow-listed migration job', { appName: 'nightly-migrate', run: (c, m) => c.query(`select pg_sleep(7) as ${m}`) }),
  S('burst of identical statements', { run: async (c, m) => { for (let i = 0; i < 60; i++) await c.query(`select pg_sleep(0.05) as ${m}`); } }),
  S('statement slow only once', { run: async (c, m) => { for (let i = 0; i < 200; i++) await c.query(`select pg_sleep($1::float8) as ${m}`, [0.001]); await c.query(`select pg_sleep($1::float8) as ${m}`, [1.2]); } }),
  S('recurring slow statement 0.6 s', { expect: ['statement'], run: async (c, m) => { await c.query(`select pg_sleep(0.6) as ${m}`); await sleep(2500); for (let i = 0; i < 8; i++) await c.query(`select pg_sleep(0.6) as ${m}`); } }),
  S('clock edge: ends just before threshold (2 s)', { run: (c, m) => c.query(`select pg_sleep(2) as ${m}`) }),
];
const indeterminate = S('clock edge: 3.4 s (threshold 3 s + poll 1 s, may be missed)', { run: (c, m) => c.query(`select pg_sleep(3.4) as ${m}`) });
const use = quick ? scenarios.filter((s) => /^(fast|slow pg|critical|lock|idle|allow-listed pg_dump|statement slow only)/.test(s.name)) : scenarios;

async function trial(n) {
  const tag = `t${n}${RUN}`, cards = [], metrics = createMetrics(), t0 = Date.now();
  const w = createWatcher({ query: (() => { let c; return async (sql, p) => { if (!c) { c = new Client({ connectionString: url(ro, 'ropw'), application_name: 'gchat-watcher' }); c.on('error', () => {}); await c.connect(); await c.query('set default_transaction_read_only = on'); trial.ro = c; } return c.query(sql, p); }; })(), env: ENV, metrics, log: () => {},
    send: async (channel, msg, o = {}) => { cards.push({ channel, t: Date.now(), kind: o.meta?.kind, app: o.meta?.app, threadKey: o.threadKey, json: JSON.stringify(msg) }); } });
  const clients = [], starts = {};
  const items = [...use, ...(quick ? [] : [indeterminate])];
  for (const s of items) {
    s.mark = `m_${s.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 24)}_${tag}`;
    s.appUse = s.appName ?? `acc-${s.name.replace(/[^a-z0-9]+/gi, '').slice(0, 16)}-${tag}`;
  }
  const byApp = (n2) => items.find((s) => s.app === n2);
  const lockA = await mk(`acc-lockA-${tag}`); const lockB = await mk(`acc-lockB-${tag}`); clients.push(lockA, lockB);
  await lockA.query('begin'); await lockA.query('lock table t_acc in access exclusive mode');
  const lb = lockB.query(`select count(*) as m_lockb_${tag} from t_acc`).catch(() => {});
  starts.lockA = starts.lockB = Date.now();
  const running = items.filter((s) => s.run).map(async (s) => {
    const c = await mk(s.appUse); clients.push(c); starts[s.name] = Date.now();
    await s.run(c, s.mark).catch(() => {});
  });
  const end = Date.now() + (quick ? 14000 : 18000);
  while (Date.now() < end) { await w.poll(); await sleep(1000); }
  await w.poll();
  for (const c of clients) c.end().catch(() => {});
  await Promise.allSettled([...running, lb]);
  trial.ro?.end().catch(() => {});
  // pg_stat_statements on a shared busy server evicts fresh entries (it holds 5000): a statement scenario whose entry vanished cannot be
  // measured; it is reported as unmeasurable instead of counted as a miss.
  const present = new Set((await setup.query(`select query from pg_stat_statements s join pg_database d on d.oid=s.dbid where d.datname=$1 and query like '%as m\\_%'`, [db])).rows.map((x) => x.query));
  return items.map((s) => {
    const app = s.special ? `acc-${s.app}-${tag}` : s.appUse;
    const mine = cards.filter((x) => x.kind && x.kind !== 'ended' && (x.app === app || x.json.includes(s.mark)));
    const kinds = new Set(mine.map((x) => x.kind));
    const st = starts[s.name] ?? starts[s.app] ?? t0;
    const lat = {};
    for (const k of kinds) lat[k] = (mine.find((x) => x.kind === k).t - st) / 1000;
    const ended = s.resolveReply ? cards.some((x) => x.kind === 'ended' && mine.some((m) => m.threadKey === x.threadKey)) : null;
    const crit = mine.some((x) => x.channel === 'critical'), other = mine.some((x) => x.channel === 'slowquery');
    const lost = s.expect.includes('statement') && ![...present].some((q) => q.includes(s.mark));
    return { s, kinds, lat, ended, crit, other, nCards: mine.length, lost };
  });
}

const rows = {};
for (let n = 1; n <= trials; n++) {
  console.log(`-- trial ${n}/${trials}`);
  for (const r of await trial(n)) {
    const a = (rows[r.s.name] ??= { name: r.s.name, runs: 0, TP: 0, FN: 0, FP: 0, lat: [], indeterminate: r.s === indeterminate, channelOk: 0, channelRuns: 0, endedOk: 0, endedRuns: 0, cards: 0, expect: r.s.expect });
    a.runs++; a.cards += r.nCards;
    if (r.lost) { a.unmeasurable = (a.unmeasurable ?? 0) + 1; a.runs--; continue; }
    if (a.indeterminate) { if (r.kinds.has('slow')) a.TP++; continue; }
    for (const k of r.s.expect) { if (r.kinds.has(k)) { a.TP++; a.lat.push(r.lat[k]); } else a.FN++; }
    for (const k of r.kinds) if (!r.s.expect.includes(k) && !r.s.allow.includes(k)) a.FP++;
    if (r.s.channel) { a.channelRuns++; if (r.other && !r.crit) a.channelOk++; }
    if (r.ended != null) { a.endedRuns++; if (r.ended) a.endedOk++; }
  }
}
const table = Object.values(rows);
const real = table.filter((r) => !r.indeterminate && r.runs > 0);
const TP = real.reduce((x, r) => x + r.TP, 0), FN = real.reduce((x, r) => x + r.FN, 0), FP = real.reduce((x, r) => x + r.FP, 0);
const precision = TP + FP ? TP / (TP + FP) : 1, recall = TP + FN ? TP / (TP + FN) : 1;
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
console.log('\nscenario'.padEnd(52) + 'runs  TP  FN  FP  latency(avg/max s)  channel  resolve-reply');
for (const r of table) console.log(`${r.name.padEnd(51)} ${String(r.runs).padStart(3)} ${String(r.TP).padStart(3)} ${String(r.FN).padStart(3)} ${String(r.FP).padStart(3)}  ${r.lat.length ? `${avg(r.lat).toFixed(1)}/${Math.max(...r.lat).toFixed(1)}` : r.indeterminate ? 'n/a (indeterminate)' : '-'}  ${r.channelRuns ? `${r.channelOk}/${r.channelRuns}` : '-'}  ${r.endedRuns ? `${r.endedOk}/${r.endedRuns}` : '-'}`);
console.log(`\nprecision ${precision.toFixed(3)}  recall ${recall.toFixed(3)}  TP ${TP} FN ${FN} FP ${FP}`);
check('precision >= 0.95', precision >= 0.95, precision.toFixed(3));
check('recall >= 0.9', recall >= 0.9, recall.toFixed(3));
check('zero false positives on negative scenarios', real.filter((r) => !r.expect.length).every((r) => r.FP === 0), `FP total ${FP}`);
check('escalation: critical/slowquery channels as expected', real.every((r) => r.channelOk === r.channelRuns), real.filter((r) => r.channelRuns).map((r) => `${r.channelOk}/${r.channelRuns}`).join(' '));
check('resolve reply posted in the same thread when the slow query ends', real.every((r) => r.endedOk === r.endedRuns), '');

// ---- classifier at PRODUCTION defaults (the harness runs scaled thresholds; defaults are asserted on the pure function) ----
{
  const c = cfg({}), base = { state: 'active', application_name: 'api', usename: 'app', blockers: [] };
  check('defaults: 70 s slow query -> severity critical (shown CRITICAL, posted to slowquery only)', classify({ ...base, secs: 70 }, c, {}).severity === 'critical');
  check('defaults: 7 s slow query -> warning (slowquery)', classify({ ...base, secs: 7 }, c, {}).severity === 'warning');
  check('defaults: blocker with a 40 s waiter -> critical', classify({ ...base, secs: 8 }, c, {}, 40).severity === 'critical');
  check('defaults: waiter blocked 40 s -> critical blocked', (({ kind, severity }) => kind === 'blocked' && severity === 'critical')(classify({ ...base, secs: 40, blockers: [9] }, c, {})));
  check('defaults: idle in tx 30 s is not reported, 90 s is idle_in_tx', classify({ ...base, state: 'idle in transaction', state_secs: 30 }, c, {}) === null && classify({ ...base, state: 'idle in transaction', state_secs: 90 }, c, {}).kind === 'idle_in_tx');
  check('defaults: autovacuum/pg_dump/replication excluded', ['autovacuum: VACUUM x', 'select 1'].every((q) => classify({ ...base, secs: 99, query: q, application_name: q.startsWith('auto') ? '' : 'pg_dump' }, c, {}) === null) && classify({ ...base, secs: 99, usename: 'replicator' }, c, {}) === null);
}

// ---- resolver playbooks against the real database ----
const posts = []; const post = async (ch, msg, o = {}) => { posts.push({ ch, label: msg.cardsV2?.[0]?.card?.header?.title, text: msg.text, tk: o.threadKey }); };
const texts = (tk) => posts.filter((p) => p.tk === tk).map((p) => p.text).join(' | ');
const labels = (tk) => posts.filter((p) => p.tk === tk).map((p) => p.label).join('>');
const rowOf = async (pid) => (await setup.query(`select pid, state, extract(epoch from now()-query_start) as secs, extract(epoch from now()-state_change) as state_secs, query_start, application_name, usename, query from pg_stat_activity where pid=$1`, [pid])).rows[0];
const stillActive = async (pid) => (await setup.query(`select 1 from pg_stat_activity where pid=$1 and state='active'`, [pid])).rowCount > 0;
const mkDb = (extra = {}) => ({ recheck: async (r) => (await setup.query(`select 1 from pg_stat_activity where pid=$1 and date_trunc('milliseconds', query_start) = date_trunc('milliseconds', $2::timestamptz) and state=$3`, [r.pid, r.query_start, r.state])).rowCount > 0,
  cancel: async (pid) => (await setup.query('select pg_cancel_backend($1) as ok', [pid])).rows[0].ok, terminate: async (pid) => (await setup.query('select pg_terminate_backend($1) as ok', [pid])).rows[0].ok,
  isGone: async (r) => !(await setup.query(`select 1 from pg_stat_activity where pid=$1 and date_trunc('milliseconds', query_start) = date_trunc('milliseconds', $2::timestamptz) and state=$3`, [r.pid, r.query_start, r.state])).rowCount, ...extra });
const REN = { HARD_CANCEL_SECONDS: '1', VERIFY_SECONDS: '1', VERIFY_POLL_MS: '300', IDLE_BLOCKER_SECONDS: '1', CANCEL_BLOCKER_SECONDS: '2' };
const mkR = (env, extra = {}) => createResolver({ env: { ...REN, ...env }, post, log: () => {}, metrics: createMetrics(), db: mkDb(extra.db), ...extra.rest });
const victim = async (app, sql) => { const c = await mk(app); const pr = c.query(sql).then(() => 'done', (e) => e.code); const pid = (await c.query('select pg_backend_pid() as p').catch(() => null))?.rows?.[0]?.p; return { c, pr, pid }; };
const startSleep = async (app, sql = 'select pg_sleep(40)') => { const c = await mk(app); const { rows } = await c.query('select pg_backend_pid() as p'); const pr = c.query(sql).then(() => 'done', (e) => e.code); await sleep(1500); return { c, pr, pid: rows[0].p }; };
const spec = async (v, key, extra = {}) => { const row = await rowOf(v.pid); return { playbook: 'cancel_select', key, threadKey: key, channel: 'slowquery', row, text: 'select pg_sleep(?)', waiterSecs: 0, diagnosis: 'Slow execution', suggestion: 'cancel', evidence: `pid ${v.pid}`, ...extra }; };

{ // cancel works
  const v = await startSleep('acc-rem1'); const r = mkR({ AUTO_REMEDIATE: 'on' });
  await r.handle(await spec(v, 'r1')); await r.settle();
  check('cancel: pg_cancel_backend cancels a runaway SELECT (client sees 57014)', (await v.pr) === '57014', texts('r1').slice(0, 300));
  check('cancel: lifecycle DIAGNOSED>ACTION>VERIFIED>RESOLVED in the thread', labels('r1') === 'DIAGNOSED>ACTION>VERIFIED>RESOLVED', labels('r1'));
  check('cancel: RESOLVED text says "resolved by cancelling pid N, after"', posts.some((p) => p.tk === 'r1' && /resolved by cancelling pid \d+ \(pg_cancel_backend, not terminated\), after/.test(p.text)));
  v.c.end().catch(() => {});
}
{ // refuses UPDATE
  const c0 = await mk('acc-rem2'); const { rows } = await c0.query('select pg_backend_pid() as p'); const pr = c0.query('update t_acc set a = a where (select pg_sleep(40)) is null').then(() => 'done', (e) => e.code); await sleep(1500);
  const v = { pid: rows[0].p }, r = mkR({ AUTO_REMEDIATE: 'on' });
  await r.handle(await spec(v, 'r2')); await r.settle();
  check('refuses an UPDATE (never cancelled, ESCALATED in the slowquery thread, not critical)', (await stillActive(v.pid)) && /ESCALATED/.test(labels('r2')) && posts.some((p) => p.tk === 'r2' && p.ch === 'slowquery' && /^ESCALATED/.test(p.text)) && !posts.some((p) => p.tk === 'r2' && p.ch === 'critical'), labels('r2'));
  await setup.query('select pg_cancel_backend($1)', [v.pid]); await pr; c0.end().catch(() => {});
}
{ // refuses allow-listed
  const v = await startSleep('pg_dump'); const r = mkR({ AUTO_REMEDIATE: 'on' });
  await r.handle(await spec(v, 'r3')); await r.settle();
  check('refuses an allow-listed application (pg_dump)', (await stillActive(v.pid)) && /ESCALATED/.test(labels('r3')) && posts.some((p) => /allow-listed/.test(p.text ?? '') || p.tk === 'r3'), labels('r3'));
  // dry-run: nothing happens
  const d = mkR({ AUTO_REMEDIATE: 'dry-run' }); await d.handle(await spec({ ...v }, 'r4', { row: { ...(await rowOf(v.pid)), application_name: 'api' } })); await d.settle();
  check('dry-run does nothing and says "Would cancel"/"would cancel"', (await stillActive(v.pid)) && posts.some((p) => p.tk === 'r4' && /DRY-RUN: would cancel pid/.test(p.text) && /AUTO_REMEDIATE=on/.test(p.text)), posts.filter((p) => p.tk === 'r4').map((p) => p.text).join(' | ').slice(0, 200));
  check('default mode (env unset or unknown) is dry-run', createResolver({ env: {}, post }).mode === 'dry-run' && createResolver({ env: { AUTO_REMEDIATE: 'yes' }, post }).mode === 'dry-run');
  const off = mkR({ AUTO_REMEDIATE: 'off' }); const before = posts.length; await off.handle(await spec(v, 'r5')); await off.settle();
  check('AUTO_REMEDIATE=off posts nothing', posts.length === before);
  await setup.query('select pg_cancel_backend($1)', [v.pid]); await v.pr; v.c.end().catch(() => {});
}
{ // rate limit
  const a = await startSleep('acc-rl1'), b = await startSleep('acc-rl2'); const r = mkR({ AUTO_REMEDIATE: 'on', AUTO_REMEDIATE_MAX_PER_HOUR: '1' });
  await r.handle(await spec(a, 'r6a')); await r.handle(await spec(b, 'r6b')); await r.settle();
  check('rate limit: 2nd cancel in the hour is refused and ESCALATED', labels('r6a').endsWith('RESOLVED') && /ESCALATED/.test(labels('r6b')) && (await stillActive(b.pid)), `${labels('r6a')} | ${labels('r6b')}`);
  await setup.query('select pg_cancel_backend($1)', [b.pid]); await b.pr; a.c.end().catch(() => {}); b.c.end().catch(() => {});
}
{ // action fails / verification fails / no cancel role
  const v = await startSleep('acc-f1');
  const r1 = mkR({ AUTO_REMEDIATE: 'on' }, { db: { cancel: async () => { throw Object.assign(new Error('x'), { code: '42501' }); } } });
  await r1.handle(await spec(v, 'r7')); await r1.settle();
  check('action fails -> ESCALATED (slowquery thread)', /ESCALATED/.test(labels('r7')) && posts.some((p) => p.tk === 'r7' && p.ch === 'slowquery' && /action failed/.test(p.text)) && !posts.some((p) => p.tk === 'r7' && p.ch === 'critical'), labels('r7'));
  const r2 = mkR({ AUTO_REMEDIATE: 'on' }, { db: { cancel: async () => true } }); // claims success but the query keeps running
  await r2.handle(await spec(v, 'r8')); await r2.settle();
  check('verification fails (query still running) -> ESCALATED, never RESOLVED', /ACTION>ESCALATED$/.test(labels('r8')) && !/RESOLVED/.test(labels('r8')), labels('r8'));
  const r3 = createResolver({ env: { ...REN, AUTO_REMEDIATE: 'on' }, post, log: () => {}, db: { isGone: async () => false } });
  await r3.handle(await spec(v, 'r9')); await r3.settle();
  check('no cancel role configured -> only suggested, ESCALATED', /ESCALATED/.test(labels('r9')) && (await stillActive(v.pid)), labels('r9'));
  await setup.query('select pg_cancel_backend($1)', [v.pid]); await v.pr; v.c.end().catch(() => {});
}
{ // terminate idle blocker; refuse active writer
  const A = await mk('acc-idleA'); await A.query('begin'); await A.query('lock table t_acc in access exclusive mode'); const pidA = (await A.query('select pg_backend_pid() as p')).rows[0].p; A.on('error', () => {});
  const B = await mk('acc-idleB'); const bp = B.query('select count(*) from t_acc').then(() => 'done', (e) => e.code); await sleep(2500);
  const row = await rowOf(pidA), r = mkR({ AUTO_REMEDIATE: 'on' });
  await r.handle({ playbook: 'terminate_idle', key: 'r10', threadKey: 'r10', channel: 'slowquery', row, text: 'lock table', waiterSecs: 2.5, diagnosis: 'Idle in transaction, blocking', suggestion: 'fix app', evidence: 'x' }); await r.settle();
  check('idle-in-tx blocker terminated, waiter proceeds, RESOLVED after verify', labels('r10') === 'DIAGNOSED>ACTION>VERIFIED>RESOLVED' && (await bp) === 'done', labels('r10'));
  const w = await startSleep('acc-writer', 'update t_acc set a = a where (select pg_sleep(40)) is null');
  const rr = mkR({ AUTO_REMEDIATE: 'on' }); const wr = { ...(await rowOf(w.pid)), state: 'active' };
  await rr.handle({ playbook: 'terminate_idle', key: 'r11', threadKey: 'r11', channel: 'slowquery', row: wr, text: 'update', waiterSecs: 9, diagnosis: 'x', suggestion: 'x', evidence: 'x' }); await rr.settle();
  check('active writer is NEVER terminated (ESCALATED)', (await stillActive(w.pid)) && /ESCALATED/.test(labels('r11')), labels('r11'));
  await setup.query('select pg_cancel_backend($1)', [w.pid]); await w.pr; w.c.end().catch(() => {}); B.end().catch(() => {});
}
{ // db_pool playbook
  const v = await startSleep('acc-pool'); const row = await rowOf(v.pid); let cancelled = false;
  const mkPool = (q) => mkR({ AUTO_REMEDIATE: 'on' }, { rest: { promQuery: q, offenders: () => [{ kind: 'slow', row, text: 'select pg_sleep(?)', waiterSecs: 0 }] }, db: { cancel: async (pid) => { cancelled = true; return (await setup.query('select pg_cancel_backend($1) as ok', [pid])).rows[0].ok; } } });
  const rp = mkPool(async () => (cancelled ? 0 : 5)); await rp.handle({ playbook: 'db_pool', key: 'r12', threadKey: 'r12', channel: 'critical', diagnosis: 'pool exhausted', suggestion: 's', evidence: 'e' }); await rp.settle();
  check('db_pool: cancels offender, pool waiting -> 0 verified, RESOLVED', labels('r12') === 'DIAGNOSED>ACTION>VERIFIED>RESOLVED' && (await v.pr) === '57014', labels('r12'));
  const v2 = await startSleep('acc-pool2'); const row2 = await rowOf(v2.pid);
  const rp2 = mkR({ AUTO_REMEDIATE: 'on' }, { rest: { promQuery: async () => 7, offenders: () => [{ kind: 'slow', row: row2, text: 'x', waiterSecs: 0 }] } });
  await rp2.handle({ playbook: 'db_pool', key: 'r13', threadKey: 'r13', channel: 'critical', diagnosis: 'pool', suggestion: 's', evidence: 'e' }); await rp2.settle();
  check('db_pool: pool still waiting after the action -> ESCALATED', /ESCALATED$/.test(labels('r13')), labels('r13'));
  await v2.pr; v.c.end().catch(() => {}); v2.c.end().catch(() => {});
}
{ // code_fix + release
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inc-')); const file = { normalized_query: 'select * from t where a = ?', queryid: '1', calls: 9, mean_ms: 900, max_ms: 1500, first_seen: 'x', last_seen: 'y', verdict: 'recurring' };
  const dry = mkR({ AUTO_REMEDIATE: 'dry-run', INCIDENTS_DIR: dir }); await dry.handle({ playbook: 'code_fix', key: 'st:1', threadKey: 'r14', channel: 'slowquery', text: 'select', file, diagnosis: 'd', suggestion: 's' }); await dry.settle();
  check('code_fix dry-run writes no incident file', !fs.existsSync(path.join(dir, 'open')));
  const r = mkR({ AUTO_REMEDIATE: 'on', INCIDENTS_DIR: dir }); await r.handle({ playbook: 'code_fix', key: 'st:2', threadKey: 'r15', channel: 'slowquery', text: 'select', file, diagnosis: 'd', suggestion: 's' }); await r.settle();
  const f = fs.readdirSync(path.join(dir, 'open'));
  check('code_fix writes incidents/open/<id>.json and posts "needs a code/index fix: ticket opened"', f.length === 1 && posts.some((p) => p.tk === 'r15' && /needs a code\/index fix: ticket opened/.test(p.text)) && JSON.parse(fs.readFileSync(path.join(dir, 'open', f[0]))).queryid === '1', f.join());
  await r.setRelease('abc1234'); await r.statementRecovered('st:2');
  check('statement fast again after a release -> RESOLVED in thread with the release sha, file moved to resolved/', posts.some((p) => p.tk === 'r15' && /RESOLVED/.test(p.label ?? '') && /release abc1234/.test(p.text)) && fs.readdirSync(path.join(dir, 'resolved')).length === 1);
  fs.rmSync(dir, { recursive: true, force: true });
}
{ // service stubs
  const r = mkR({ AUTO_REMEDIATE: 'on' }); await r.handle({ playbook: 'service', action: 'RedisDown', key: 'am:1', threadKey: 'r16', channel: 'critical', diagnosis: 'redis down', suggestion: 'restart redis', evidence: 'e', verify: async () => true }); await r.settle();
  check('service alert without an executor -> suggested + ESCALATED (nothing executed)', /ESCALATED/.test(labels('r16')) && posts.some((p) => p.tk === 'r16' && /no executor wired/.test(p.text)), labels('r16'));
  const r2 = mkR({ AUTO_REMEDIATE: 'on' }, { rest: { executors: { RedisDown: async () => ({ ok: true, desc: 'stub restarted redis' }) } } }); await r2.handle({ playbook: 'service', action: 'RedisDown', key: 'am:2', threadKey: 'r17', channel: 'critical', diagnosis: 'd', suggestion: 's', evidence: 'e', verify: async () => true }); await r2.settle();
  check('pluggable executor ok + verify ok -> RESOLVED', labels('r17') === 'DIAGNOSED>ACTION>VERIFIED>RESOLVED', labels('r17'));
}

await setup.end();
const failed = checks.filter((c) => c.status === 'FAIL');
fs.writeFileSync(outFile, JSON.stringify({ trials, quick, thresholds: ENV, precision, recall, TP, FN, FP, table: table.map((r) => ({ ...r, latAvg: avg(r.lat), latMax: r.lat.length ? Math.max(...r.lat) : null })), checks }, null, 2));
console.log(`\n${failed.length ? 'FAIL' : 'PASS'}: ${checks.length - failed.length}/${checks.length} checks`);
process.exit(failed.length ? 1 : 0);
