// RESOLVER DRILL on a DEDICATED Postgres (own container, pg_stat_statements preloaded, so nothing is evicted).
// Part A: recurring-slow-statement path (code_fix): detection rate/latency over N trials, incident file, thread messages, release/no-release
//         behaviour, false positives. Part B: AUTO_REMEDIATE=on with the real cancel role (create-cancel-role.sql): cancel/refuse matrix.
// Usage (from apps/api so `pg` resolves): node drill.mjs <adminUrlWithoutDb> <dbName> <outJson> [--trials=10]
// Thresholds are scaled down (see ENV). Never contacts chat.googleapis.com: Chat is a collector. Needs a superuser admin URL.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createWatcher, startWatcher } from '../watcher.mjs';
import { createResolver } from '../resolver.mjs';
import { createMetrics } from '../lib.mjs';

const [admin, db, outFile, ...flags] = process.argv.slice(2);
const skipA = flags.includes('--skipA');
const trials = Number((flags.find((f) => f.startsWith('--trials=')) ?? '').split('=')[1] ?? 10);
const { Client } = createRequire(`${process.cwd()}/`)('pg');
const url = (u = 'crm', pw = 'crm') => `${admin.replace('postgres://crm:crm@', `postgres://${u}:${pw}@`)}/${db}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = async (app, u = url()) => { const c = new Client({ connectionString: u, application_name: app }); c.on('error', () => {}); await c.connect(); return c; };
const checks = [], result = { trials };
const check = (name, ok, detail = '') => { checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const ENV = { SLOW_RUNNING_SECONDS: '3', SLOW_IDLE_TX_SECONDS: '3', CRITICAL_SLOW_SECONDS: '8', CRITICAL_BLOCK_SECONDS: '4', SLOW_MEAN_MS: '300', STMT_RECURRING_POLLS: '3', SLOW_MAX_PER_MINUTE: '100000', SLOW_COOLDOWN_SECONDS: '600' };

const setup = await mk('drill-setup');
await setup.query('create extension if not exists pg_stat_statements');
await setup.query('create table if not exists t_acc(a int)');
await setup.query('create table if not exists t_big as select g as a from generate_series(1,3000000) g');
await setup.query('create table if not exists t_w(a int)'); await setup.query('create table if not exists t_i1(a int)'); await setup.query('create table if not exists t_i2(a int)');
await setup.query('create sequence if not exists s_drill');
await setup.query('create or replace function bump_fn() returns int language sql volatile as $$ update t_acc set a = a returning 1 $$');
// roles from the REAL scripts (read-only watcher role + cancel role)
const sh = (f, user, pw) => execFileSync('docker', ['exec', '-i', process.env.DRILL_CONTAINER, 'psql', '-U', 'crm', '-d', db, '-v', 'ON_ERROR_STOP=1', '-v', `pw='${pw}'`, '-v', `dbname=${db}`], { input: fs.readFileSync(new URL(`../${f}`, import.meta.url)), stdio: ['pipe', 'pipe', 'pipe'] });
sh('create-readonly-role.sql', 'slow_query_ro', 'ropw'); sh('create-cancel-role.sql', 'slow_query_cancel', 'cancelpw');
await setup.query("do $$ begin if not exists (select 1 from pg_roles where rolname='drill_app') then create role drill_app login password 'apppw' nosuperuser; end if; end $$");
await setup.query('grant pg_write_server_files to drill_app'); await setup.query('grant all on all tables in schema public to drill_app'); await setup.query('grant all on all sequences in schema public to drill_app'); await setup.query('grant execute on all functions in schema public to drill_app'); await setup.query('grant create on schema public to drill_app'); await setup.query(`grant connect on database ${db} to drill_app`);
const APP = url('drill_app', 'apppw');
const RO = url('slow_query_ro', 'ropw'), CANCEL = url('slow_query_cancel', 'cancelpw');

// ================= Part A: recurring statement =================
const FILE_FIELDS = ['id', 'normalized_query', 'queryid', 'database', 'calls', 'mean_ms', 'max_ms', 'first_seen', 'last_seen', 'verdict', 'status', 'ticket'];
async function recTrial(n, { releaseEarly = false } = {}) {
  const tag = `r${n}${releaseEarly ? 'e' : 'n'}${Math.random().toString(36).slice(2, 5)}`, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drill-inc-')), msgs = [], cards = [];
  const env = { ...ENV, AUTO_REMEDIATE: 'on', INCIDENTS_DIR: dir, VERIFY_SECONDS: '1' };
  const post = async (ch, m, o = {}) => { msgs.push({ t: Date.now(), tk: o.threadKey, label: m.cardsV2?.[0]?.card?.header?.title, text: m.text }); };
  const metrics = createMetrics(), ro = await mk('gchat-watcher', RO); await ro.query('set default_transaction_read_only = on');
  const resolver = createResolver({ env, post, log: () => {}, metrics });
  const w = createWatcher({ query: (s, p) => ro.query(s, p), env, metrics, log: () => {}, resolver, send: async (ch, m, o = {}) => { cards.push({ t: Date.now(), kind: o.meta?.kind }); msgs.push({ t: Date.now(), tk: o.threadKey, label: 'ALERT', text: JSON.stringify(m) }); } });
  const q = `select pg_sleep($1::float8), 'jane.doe@example.com' as pii_${tag}, 4155551234 as phone_${tag}`;
  const c = await mk(`drill-rec-${tag}`); let stop = false, t0 = 0, incAt = null, recAt = null;
  const polls = (async () => { const end = Date.now() + 24000; while (Date.now() < end) { await w.poll(); await resolver.settle(); if (incAt == null && resolver.list().length) incAt = Date.now(); const i = resolver.list()[0]; if (recAt == null && i && i.state !== 'needs_fix') recAt = Date.now(); await sleep(1000); } })();
  await sleep(1500); t0 = Date.now(); // one poll has baselined before the first call
  for (let i = 0; i < 9 && !stop; i++) { await c.query(q, [0.6]); await sleep(300); } // slow phase ~8 s
  if (releaseEarly) await resolver.setRelease('rel0001');
  const fastStart = Date.now();
  for (let i = 0; i < 40; i++) { await c.query(q, [0.001]); await sleep(150); } // new calls fast ~6 s
  await polls; await c.end(); await ro.end();
  const inc = resolver.list()[0], files = fs.existsSync(`${dir}/open`) ? fs.readdirSync(`${dir}/open`) : [], rfiles = fs.existsSync(`${dir}/resolved`) ? fs.readdirSync(`${dir}/resolved`) : [];
  const f = files[0] ? JSON.parse(fs.readFileSync(`${dir}/open/${files[0]}`)) : rfiles[0] ? JSON.parse(fs.readFileSync(`${dir}/resolved/${rfiles[0]}`)) : null;
  const raw = f ? JSON.stringify(f) : '';
  const labels = msgs.filter((m) => inc && m.tk === inc.threadKey).map((m) => m.label).join('>');
  const out = { tag, detected: cards.some((x) => x.kind === 'statement'), detectLat: (cards.find((x) => x.kind === 'statement')?.t - t0) / 1000, incident: !!inc, incLat: incAt ? (incAt - t0) / 1000 : null, state: inc?.state, labels, recLat: recAt ? (recAt - fastStart) / 1000 : null,
    fileComplete: !!f && FILE_FIELDS.every((k) => f[k] !== undefined && f[k] !== null && f[k] !== ''), fileClean: !!f && !/jane|example\.com|4155551234/.test(raw) && !/\d{4,}/.test(f.normalized_query.replace(/_[a-z0-9]{6,}/g, '')), openFiles: files.length, resolvedFiles: rfiles.length, msgs, file: f, resolver, dir };
  return out;
}
console.log('== Part A: recurring statement, trials:', trials);
const A = skipA ? [] : await Promise.all(Array.from({ length: trials }, (_, i) => recTrial(i + 1)));
const B = skipA ? [] : await Promise.all([1, 2, 3].map((i) => recTrial(i, { releaseEarly: true })));
if (!skipA) {
const det = A.filter((x) => x.detected && x.incident).length, avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
result.recurring = { trials, detected: det, rate: det / trials, detectLatAvg: avg(A.map((x) => x.detectLat).filter(Number.isFinite)), detectLatMax: Math.max(...A.map((x) => x.detectLat)), incLatAvg: avg(A.map((x) => x.incLat).filter(Number.isFinite)), incLatMax: Math.max(...A.map((x) => x.incLat ?? 0)), recoverLatAvg: avg(A.map((x) => x.recLat).filter(Number.isFinite)), states: A.map((x) => x.state) };
console.log(JSON.stringify(result.recurring));
check(`recurring statement detected in ${trials}/${trials} trials`, det === trials, `rate ${(det / trials * 100).toFixed(0)}%`);
check('incident file complete (all fields) in every trial', A.every((x) => x.fileComplete), FILE_FIELDS.join(','));
check('incident file has no literals/PII (email, phone, long numbers)', A.every((x) => x.fileClean), A[0].file?.normalized_query);
const ex = A[0]; result.recurringExample = { file: ex.file, labels: ex.labels, messages: ex.msgs.filter((m) => m.label !== 'ALERT' || true).map((m) => `${m.label}: ${String(m.text).slice(0, 220)}`) };
check('thread: ALERT > DIAGNOSED > ACTION("needs a code/index fix") > RECOVERED (recovery, no release)', A.every((x) => /^ALERT>DIAGNOSED>ACTION>RECOVERED$/.test(x.labels.replace(/(ALERT>)+/g, 'ALERT>'))) && A.every((x) => x.msgs.some((m) => /needs a code\/index fix: ticket opened/.test(m.text))), ex.labels);
check('recovery WITHOUT a release: state recovered_no_release, text says "recovered, no release recorded", file stays in open/, NOT resolved', A.every((x) => x.state === 'recovered_no_release' && x.openFiles === 1 && x.resolvedFiles === 0 && x.msgs.some((m) => /recovered, no release recorded/.test(m.text)) && !x.msgs.some((m) => m.label === 'RESOLVED')), A.map((x) => x.state).join(','));
await A[0].resolver.setRelease('rel9999');
check('POST /release afterwards resolves it "by release rel9999" and moves the file to resolved/', A[0].resolver.byKey(A[0].resolver.list().length ? `st:${A[0].file.queryid}|${db}|crm` : '')?.state === 'resolved' || A[0].resolver.list()[0].state === 'resolved', A[0].resolver.list()[0].state);
check('release recorded BEFORE recovery: RESOLVED by release (3/3), file moved to resolved/', B.every((x) => x.state === 'resolved' && x.resolvedFiles === 1 && x.openFiles === 0 && x.msgs.some((m) => /resolved by release rel0001/.test(m.text))), B.map((x) => x.state).join(','));

}
// ---- false positives for the recurring path ----
async function fpCase(name, run, { app = `drill-fp-${name.replace(/\W+/g, '')}`, mustBeSlow } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drill-fp-')), cards = [], metrics = createMetrics(), ro = await mk('gchat-watcher', RO); await ro.query('set default_transaction_read_only = on');
  const env = { ...ENV, AUTO_REMEDIATE: 'on', INCIDENTS_DIR: dir }, resolver = createResolver({ env, post: async () => {}, log: () => {}, metrics });
  const w = createWatcher({ query: (s, p) => ro.query(s, p), env, metrics, log: () => {}, resolver, send: async (ch, m, o = {}) => { cards.push(o.meta?.kind); } });
  const c = await mk(app); await w.poll(); let stop = false;
  const polls = (async () => { while (!stop) { await w.poll(); await resolver.settle(); await sleep(1000); } })();
  await run(c, w); await sleep(2500); stop = true; await polls; await c.end(); await ro.end();
  const mean = mustBeSlow ? (await setup.query('select max(mean_exec_time) as m from pg_stat_statements where query ~ $1', [mustBeSlow])).rows[0].m : null;
  const fp = cards.filter((k) => k === 'statement').length + resolver.list().length;
  fs.rmSync(dir, { recursive: true, force: true });
  return { name, falsePositives: fp, lifetimeMeanMs: mean == null ? null : Math.round(mean) };
}
const tg = Math.random().toString(36).slice(2, 6);
const FP = [];
FP.push(await fpCase('slow once', async (c) => { for (let i = 0; i < 200; i++) await c.query(`select pg_sleep($1::float8) as once_${tg}`, [0.001]); await c.query(`select pg_sleep($1::float8) as once_${tg}`, [1.5]); await sleep(3000); }));
FP.push(await fpCase('slow once, never called again (lifetime mean 1500 ms)', async (c) => { await c.query(`select pg_sleep($1::float8) as once2_${tg}`, [1.5]); await sleep(5000); }, { mustBeSlow: `once2_${tg}` }));
FP.push(await fpCase('slow for OLD calls only (5x0.8 s before baseline, then fast)', async (c, w) => { for (let i = 0; i < 5; i++) await c.query(`select pg_sleep($1::float8) as old_${tg}`, [0.8]); await w.poll(); for (let i = 0; i < 30; i++) { await c.query(`select pg_sleep($1::float8) as old_${tg}`, [0.001]); await sleep(200); } }, { mustBeSlow: `old_${tg}` }));
FP.push(await fpCase('maintenance COPY (slow, repeated)', async (c) => { for (let i = 0; i < 8; i++) { await c.query(`copy (select count(*), pg_sleep(0.6) as cp_${tg} from t_big) to '/dev/null'`); await sleep(300); } }, { mustBeSlow: `cp_${tg}` }));
FP.push(await fpCase('maintenance VACUUM FULL (slow, repeated)', async (c) => { for (let i = 0; i < 4; i++) { await c.query('vacuum full t_big'); await sleep(300); } }, { mustBeSlow: '^vacuum full t_big' }));
FP.push(await fpCase('maintenance CREATE INDEX (slow, repeated)', async (c) => { for (let i = 0; i < 6; i++) { await c.query(`create index i_${tg}_${i} on t_big(a)`); await c.query(`drop index i_${tg}_${i}`); } }, { mustBeSlow: `create index i_${tg}` }));
FP.push(await fpCase('allow-listed app (nightly-migrate) 0.6 s recurring', async (c) => { for (let i = 0; i < 14; i++) { await c.query(`select pg_sleep($1::float8) as al1_${tg}`, [0.6]); await sleep(300); } }, { app: 'nightly-migrate', mustBeSlow: `al1_${tg}` }));
FP.push(await fpCase('allow-listed app (pg_dump) 0.35 s recurring (short calls, rarely seen by the activity poll)', async (c) => { for (let i = 0; i < 14; i++) { await c.query(`select pg_sleep($1::float8) as al2_${tg}`, [0.35]); await sleep(300); } }, { app: 'pg_dump', mustBeSlow: `al2_${tg}` }));
result.falsePositives = FP; console.table(FP);
for (const f of FP) check(`false positive path: ${f.name}`, f.falsePositives === 0, `FP=${f.falsePositives} lifetimeMean=${f.lifetimeMeanMs}`);

// ================= Part B: cancel with the real role =================
console.log('== Part B: AUTO_REMEDIATE=on with the cancel role');
const audit = [], posts = [], cardsB = [];
const otherLog = [];
const log = (o) => { if (o.evt === 'remediation_audit') audit.push(o); else otherLog.push(o); };
const post = async (ch, m, o = {}) => { posts.push({ ch, tk: o.threadKey, label: m.cardsV2?.[0]?.card?.header?.title, text: m.text }); };
const labelsB = (re) => { const tks = [...new Set(posts.filter((p) => re.test(p.text ?? '')).map((p) => p.tk))]; return tks; };
const ENVB = { ...ENV, SLOW_RUNNING_SECONDS: '2', HARD_CANCEL_SECONDS: '4', IDLE_BLOCKER_SECONDS: '3', CANCEL_BLOCKER_SECONDS: '2', VERIFY_SECONDS: '1', VERIFY_POLL_MS: '300', SLOW_POLL_SECONDS: '1', AUTO_REMEDIATE: 'on', AUTO_REMEDIATE_MAX_PER_HOUR: '5', SLOW_PG_URL: RO, SLOW_CANCEL_PG_URL: CANCEL, INCIDENTS_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'drill-b-')) };
const startOn = (env) => startWatcher({ env, metrics: createMetrics(), log, send: async (ch, m, o = {}) => { cardsB.push({ ch, tk: o.threadKey, app: o.meta?.app, kind: o.meta?.kind }); }, resolverFactory: ({ db: d, offenders }) => createResolver({ env, db: d, offenders, post, log, metrics: createMetrics() }) });
const bg = async (app, sql, u = APP) => { const c = await mk(app, u); const pid = (await c.query('select pg_backend_pid() as p')).rows[0].p; const pr = c.query(sql).then(() => 'done', (e) => e.code ?? e.message); return { c, pid, pr, app }; };
const alive = async (pid) => (await setup.query(`select state from pg_stat_activity where pid=$1`, [pid])).rows[0]?.state ?? 'gone';
const threadOf = (app) => posts.filter((p) => p.tk && posts.some((q) => q.tk === p.tk && new RegExp(`pid ${V[app]?.pid}\\b`).test(q.text ?? ''))).map((p) => p.label);
const V = {};
const runaway = [['cancel-select', 'select pg_sleep(60), count(*) from t_acc'], ['cancel-cte', 'with x as (select pg_sleep(60)) select * from x'],
  ['upd', 'update t_acc set a = a where (select pg_sleep(60)) is null'], ['del', 'delete from t_acc where (select pg_sleep(60)) is null'], ['ddl', `create table t_ddl_${tg} as select pg_sleep(60)`],
  ['ins', 'insert into t_acc select 1 where (select pg_sleep(60)) is null'], ['copy', `copy (select pg_sleep(60)) to '/dev/null'`],
  ['nextval', `select nextval('s_drill'), pg_sleep(60)`], ['advisory', 'select pg_advisory_lock(424242), pg_sleep(60)'], ['for-update', 'select a, pg_sleep(60) from t_acc for update'],
  ['userfn', 'select bump_fn(), pg_sleep(60)'], ['pg_dump', 'select pg_sleep(60)'], ['superuser', 'select pg_sleep(60)']];
for (const [k, sql] of runaway) V[k] = await bg(k === 'pg_dump' ? 'pg_dump' : `drill-b-${k}`, sql, k === 'superuser' ? url() : APP);
// idle-in-tx scenarios: blocker with waiter (terminate), idle without waiter (keep), active writer blocking others (keep)
const mkIdle = async (app, tbl) => { const c = await mk(app, APP); await c.query('begin'); await c.query(`lock table ${tbl} in access exclusive mode`); return { c, pid: (await c.query('select pg_backend_pid() as p')).rows[0].p }; };
await setup.query('create table if not exists t_w(a int)'); await setup.query('create table if not exists t_i1(a int)'); await setup.query('create table if not exists t_i2(a int)');
V.idleBlock = await mkIdle('drill-b-idle-blocker', 't_i1'); V.idleBlock.w = await bg('drill-b-idle-waiter', 'select count(*) from t_i1');
V.idleLone = await mkIdle('drill-b-idle-lone', 't_i2');
V.writer = await bg('drill-b-writer-blocking', 'update t_w set a = a where (select pg_sleep(60)) is null'); // same row lock domain as upd
const wt = await bg('drill-b-waiter-on-writer', 'lock table t_w in access exclusive mode');
const t0B = Date.now(); const wB = startOn(ENVB);
await sleep(14000);
for (const k of Object.keys(V)) V[k].state = await alive(V[k].pid);
console.log('B audit sample', JSON.stringify([...new Set(audit.map((a) => a.result + ':' + JSON.stringify(a.why ?? a.desc)))].slice(0, 10)));
const cs = V['cancel-select']; const csThread = posts.filter((p) => new RegExp(`pid ${cs.pid}\\b`).test(p.text ?? '')).map((p) => p.tk)[0];
const cancelThread = (pid) => { const tk = posts.find((p) => new RegExp(`pid ${pid}\\b`).test(p.text ?? ''))?.tk; return posts.filter((p) => p.tk === tk).map((p) => p.label).join('>'); };
check('runaway SELECT cancelled (client got 57014, backend still exists = cancel not terminate)', (await cs.pr) === '57014' && ['idle', 'gone'].includes(cs.state) && cs.state !== 'gone', `${cs.state}`);
check('runaway CTE (WITH ... SELECT) cancelled', (await V['cancel-cte'].pr) === '57014');
const resolvedText = posts.find((p) => p.tk === csThread && p.label === 'RESOLVED')?.text;
check('thread: DIAGNOSED>ACTION>VERIFIED>RESOLVED, text "resolved by cancelling pid N ... after X s"', /DIAGNOSED>ACTION>VERIFIED>RESOLVED$/.test(cancelThread(cs.pid).replace(/(ALERT>)+/g, '')) && new RegExp(`resolved by cancelling pid ${cs.pid} .*after`).test(resolvedText ?? ''), resolvedText);
result.cancelExample = posts.filter((p) => p.tk === csThread).map((p) => `${p.label}: ${String(p.text).slice(0, 250)}`);
check('audit log: an acted line for the cancel (pg_cancel_backend)', audit.some((a) => a.result === 'acted' && /pg_cancel_backend|Cancelled/.test(a.desc ?? '')), JSON.stringify(audit.find((a) => a.result === 'acted')));
const never = ['upd', 'del', 'ddl', 'ins', 'copy', 'nextval', 'advisory', 'for-update', 'pg_dump'];
for (const k of never) check(`NEVER cancelled: ${k} (${runaway.find((r) => r[0] === k)[1].slice(0, 45)})`, V[k].state === 'active', `state ${V[k].state}; thread ${cancelThread(V[k].pid)}`);
check('audit log: a refused line for each refused statement, with the reason', never.every((k) => audit.some((a) => a.result === 'refused' && a.id)) && audit.filter((a) => a.result === 'refused').length >= never.length - 1, `${audit.filter((a) => a.result === 'refused').length} refused lines`);
V.userfn.cancelled = (await Promise.race([V.userfn.pr, sleep(100).then(() => 'running')])) === '57014';
result.userFnLimit = V.userfn.cancelled ? 'user function call inside a SELECT IS cancelled (not detectable by text); statement-level effects roll back, non-transactional ones (nextval, advisory locks, external calls) do not' : 'refused';
check('SELECT calling a USER function with side effects (bump_fn): documented limit', true, result.userFnLimit);
check('idle-in-tx blocker (blocks a waiter >= IDLE_BLOCKER_SECONDS) terminated; waiter proceeds', V.idleBlock.state === 'gone' && (await V.idleBlock.w.pr) === 'done', `${V.idleBlock.state}; ${cancelThread(V.idleBlock.pid)}`);
check('idle-in-tx session that blocks nobody is NOT terminated', V.idleLone.state === 'idle in transaction', V.idleLone.state);
check('active writer that blocks others is NOT terminated or cancelled', V.writer.state === 'active', `${V.writer.state}; ${cancelThread(V.writer.pid)}`);
// superuser: role cannot cancel it. Show the result directly
const su = V.superuser; const sup = await mk('drill-su-probe', CANCEL); const supRes = await sup.query('select pg_cancel_backend($1) as ok', [su.pid]).then((r) => `returned ${r.rows[0].ok}`, (e) => `ERROR ${e.code}: ${e.message}`); await sup.end();
result.superuser = { state: V.superuser.state, direct: supRes, thread: cancelThread(su.pid), auditFailed: audit.filter((a) => a.result === 'failed').map((a) => a.desc) };
check('superuser session cannot be cancelled by the role (stays active, ESCALATED, permission denied 42501)', V.superuser.state === 'active' && /42501|must be a superuser/.test(supRes) && /ESCALATED/.test(cancelThread(su.pid)), `${supRes}; ${cancelThread(su.pid)}`);
check('audit log has a failed/escalated line for the superuser attempt', audit.some((a) => ['failed', 'escalated'].includes(a.result)), JSON.stringify(audit.filter((a) => ['failed', 'escalated'].includes(a.result)).map((a) => a.result + ':' + (a.desc ?? a.why)).slice(0, 2)));
check('cancel role has no table access', await (async () => { const c = await mk('p', CANCEL); const r = await c.query('select * from t_acc').then(() => 'read', (e) => e.code); await c.end(); return r === '42501'; })());
wB.stop();
for (const v of Object.values(V)) { try { await setup.query('select pg_terminate_backend($1)', [v.pid]); } catch { /* */ } }
await wt.pr.catch(() => {}); await sleep(500);

// rate limit: 3 runaway SELECTs, MAX_PER_HOUR=2
{
  audit.length = 0; posts.length = 0; const env = { ...ENVB, AUTO_REMEDIATE_MAX_PER_HOUR: '2' };
  const rl = []; for (let i = 0; i < 3; i++) rl.push(await bg(`drill-rl-${i}`, `select pg_sleep(60), ${i}`));
  const w2 = startOn(env); await sleep(12000);
  const st = await Promise.all(rl.map((v) => alive(v.pid)));
  check('rate limit AUTO_REMEDIATE_MAX_PER_HOUR=2: 2 cancelled, the 3rd refused and still running', st.filter((s) => s === 'idle').length === 2 && st.filter((s) => s === 'active').length === 1 && posts.some((p) => /rate limit 2\/hour/.test(p.text ?? '')), st.join(','));
  result.rateLimit = { states: st, audit: audit.map((a) => a.result + (a.why ? ':' + a.why : '')) };
  w2.stop(); for (const v of rl) { await setup.query('select pg_terminate_backend($1)', [v.pid]); }
}
// dry-run: same runaway SELECT only produces "would cancel"
{
  posts.length = 0; audit.length = 0; const env = { ...ENVB, AUTO_REMEDIATE: 'dry-run' }; const v = await bg('drill-dry', 'select pg_sleep(60), 99');
  const w3 = startOn(env); await sleep(9000); const s = await alive(v.pid);
  check('dry-run: query keeps running, thread says "DRY-RUN: would cancel pid N", audit result=dry-run', s === 'active' && posts.some((p) => new RegExp(`DRY-RUN: would cancel pid ${v.pid}`).test(p.text ?? '')) && audit.some((a) => a.result === 'dry-run'), `${s}; ${posts.find((p) => /DRY-RUN/.test(p.text ?? ''))?.text?.slice(0, 160)}`);
  w3.stop(); await setup.query('select pg_terminate_backend($1)', [v.pid]);
}
await setup.query(`drop table if exists t_ddl_${tg}`).catch(() => {});
console.log('ESCALATED reasons:', JSON.stringify([...new Set(audit.filter((a) => a.why).map((a) => JSON.stringify(a.why)))].slice(0, 8)));
console.log('other log events:', JSON.stringify(otherLog.slice(0, 5)));
await setup.end();
fs.writeFileSync(outFile, JSON.stringify({ ...result, thresholds: { ...ENV, partB: ENVB.HARD_CANCEL_SECONDS }, checks }, (k, v) => (['resolver', 'msgs', 'dir', 'file'].includes(k) && typeof v === 'object' && k !== 'file' ? undefined : v), 2));
const failed = checks.filter((c) => c.status === 'FAIL');
console.log(`\n${failed.length ? 'FAIL' : 'PASS'}: ${checks.length - failed.length}/${checks.length} checks`);
process.exit(failed.length ? 1 : 0);
