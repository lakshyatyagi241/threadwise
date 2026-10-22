// Live e2e for the Google Chat bridge + slow-query watcher against a FAKE Chat receiver and a throwaway Postgres database.
// Usage: node e2e.mjs <dbAdminUrlWithoutDb> <dbName> <roName> <outJson> [--quick]. Never contacts chat.googleapis.com.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const [admin, db, ro, outFile, flag] = process.argv.slice(2);
const quick = flag === '--quick';
const { Client } = createRequire(`${process.cwd()}/`)('pg');
const RP = 59611, BP = 59612, SECRET = 'SECRETTOKEN-9f3a';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, status: ok ? 'PASS' : 'FAIL', detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await sleep(150); } return false; };

const posts = []; let mode = { status: 200, hang: false, failFirst: 0 };
const recv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const channel = req.url.split('/')[1].split('?')[0];
    posts.push({ channel, token: req.url.includes(SECRET), body: b, t: Date.now() });
    if (mode.hang) return; // never answers
    if (mode.failFirst > 0) { mode.failFirst--; res.writeHead(mode.status, { 'retry-after': '0' }); return res.end('{}'); }
    res.writeHead(200); res.end('{}');
  });
}).listen(RP, '127.0.0.1');

const env = {
  ...process.env, PORT: String(BP), CHAT_ALLOW_ANY_HOST: '1', CHAT_RETRY_BASE_MS: '50',
  GCHAT_CRITICAL_URL: `http://127.0.0.1:${RP}/critical?token=${SECRET}`, GCHAT_OTHER_URL: `http://127.0.0.1:${RP}/other?token=${SECRET}`, GCHAT_SLOWQUERY_URL: `http://127.0.0.1:${RP}/slowquery?token=${SECRET}`,
  SLOW_PG_URL: `${admin.replace('postgres://crm:crm@', `postgres://${ro}:ropw@`)}/${db}`, SLOW_POLL_SECONDS: '2', SLOW_RUNNING_SECONDS: '5', SLOW_MEAN_MS: '300', SLOW_COOLDOWN_SECONDS: '600', SLOW_MAX_PER_MINUTE: '10',
};
const logs = [];
const child = spawn('node', [new URL('./index.mjs', import.meta.url).pathname], { env, cwd: process.cwd() });
child.stdout.on('data', (d) => logs.push(String(d))); child.stderr.on('data', (d) => logs.push(String(d)));
const base = `http://127.0.0.1:${BP}`;
const post = (p, body) => fetch(base + p, { method: 'POST', body: JSON.stringify(body) });
const metrics = async () => (await fetch(`${base}/metrics`)).text();
const mval = (m, re) => Number(new RegExp(`^${re} (\\S+)$`, 'm').exec(m)?.[1] ?? NaN);
const alert = (name, severity, status = 'firing', extra = {}) => ({ status, labels: { alertname: name, severity, instance: 'api:9464', job: 'crm-api', ...extra }, annotations: { summary: `${name} summary`, description: 'd', runbook_url: 'https://example.invalid/rb' }, startsAt: '2026-01-01T00:00:00Z', endsAt: '0001-01-01T00:00:00Z' });
const admin1 = new Client({ connectionString: `${admin}/${db}` });

try {
  await until(async () => (await fetch(`${base}/health`).catch(() => null))?.ok, 8000);
  check('health', (await (await fetch(`${base}/health`)).json()).ok === true);
  await admin1.connect();
  // baseline for pg_stat_statements delta
  await admin1.query("select pg_sleep(0.4) as delta_probe, 'seed-value-1'"); await sleep(2500);

  // (2) routing
  let n = posts.length;
  await post('/alertmanager', { alerts: [alert('CritA', 'critical')] });
  check('critical goes to Critical space only', posts.slice(n).length === 1 && posts[n].channel === 'critical');
  n = posts.length; await post('/alertmanager', { alerts: [alert('WarnA', 'warning')] });
  check('warning goes to Other space only', posts.slice(n).length === 1 && posts[n].channel === 'other');
  n = posts.length; await post('/alertmanager', { alerts: [alert('WarnA', 'warning', 'resolved')] });
  check('resolved is posted', posts.slice(n).length === 1 && /resolved/.test(posts[n].body));
  n = posts.length; const wd = await post('/alertmanager', { alerts: [alert('Watchdog', 'none')] });
  check('Watchdog dropped but counted', wd.status === 200 && posts.length === n && mval(await metrics(), 'crm_chat_bridge_last_watchdog_timestamp_seconds') > 0);
  n = posts.length; await post('/alertmanager', { alerts: [alert('SlowQueryBurst', 'warning', 'firing', { group: 'slow_query' })] });
  check('group=slow_query goes to Slow Queries', posts[n]?.channel === 'slowquery');
  check('big payload split under limits', await (async () => { n = posts.length; await post('/alertmanager', { alerts: Array.from({ length: 30 }, (_, i) => alert(`Big${i}`, 'warning')) }); const p = posts.slice(n); return p.length >= 4 && p.every((x) => x.body.length < 30000); })());

  // (4) retry / failure
  n = posts.length; mode = { status: 500, failFirst: 2 }; let r = await post('/alertmanager', { alerts: [alert('Retry500', 'warning')] });
  check('5xx retried then delivered', r.status === 200 && posts.length - n === 3);
  n = posts.length; mode = { status: 429, failFirst: 1 }; r = await post('/alertmanager', { alerts: [alert('Retry429', 'warning')] });
  check('429 retried then delivered', r.status === 200 && posts.length - n === 2);
  n = posts.length; mode = { status: 500, failFirst: 99 }; r = await post('/alertmanager', { alerts: [alert('Perm500', 'warning')] });
  check('permanent 500 -> 502 after 4 attempts, bridge alive', r.status === 502 && posts.length - n === 4 && (await fetch(`${base}/health`)).ok && mval(await metrics(), 'crm_chat_bridge_failed_total\\{channel="other"\\}') >= 1);
  mode = { status: 200, failFirst: 0 };

  // (1) slow running query: sanitized text, no literals
  n = posts.length;
  const slow = new Client({ connectionString: `${admin}/${db}` }); await slow.connect();
  const sp = slow.query("select pg_sleep(7), 'victim@example.com' as e, '+919876543210' as ph, 'tok_live_ABC123' as t, 4242 as n");
  const got = await until(() => posts.slice(n).some((p) => p.channel === 'slowquery' && /Slow query running/.test(p.body)), 25000);
  const sq = posts.slice(n).find((p) => p.channel === 'slowquery' && /Slow query running/.test(p.body));
  check('pg_sleep(7) -> Slow Queries post', got);
  check('slow post has no literal values', !!sq && !/victim|example\.com|919876|tok_live|ABC123|4242/.test(sq.body), sq ? '' : 'no post');
  check('slow post shows duration, database, role', !!sq && /Duration/.test(sq.body) && sq.body.includes(db) && sq.body.includes('Role'));
  await sp.catch(() => {}); await slow.end();
  // statement path
  n = posts.length; await admin1.query("select pg_sleep(0.4) as delta_probe, 'seed-value-2'"); await admin1.query("select pg_sleep(0.4) as delta_probe, 'seed-value-3'");
  const stmt = await until(() => posts.slice(n).some((p) => /Slow statement/.test(p.body)), 12000);
  check('pg_stat_statements delta -> statement post (no literal)', stmt && !posts.slice(n).some((p) => /seed-value/.test(p.body)), stmt ? '' : logs.slice(-6).join('').slice(-600));
  const m = await metrics();
  check('watcher metrics exported', mval(m, 'pg_stat_statements_available') === 1 && mval(m, 'crm_slow_query_watcher_last_poll_timestamp') > 0 && /crm_slow_query_events_total\{kind="running"\}/.test(m));

  // (3) burst -> rate limit + digest (full only: waits for the 1-minute window)
  if (!quick) {
    n = posts.length; const cs = [];
    for (let i = 0; i < 14; i++) { const c = new Client({ connectionString: `${admin}/${db}` }); await c.connect(); cs.push(c); c.query(`select pg_sleep(8) as burst_col_${String.fromCharCode(97 + i)}`).catch(() => {}); }
    await sleep(12000);
    const first = posts.slice(n).filter((p) => p.channel === 'slowquery').length;
    check('burst limited to <=10 per minute', first <= 10 && first > 0, `sent=${first}`);
    check('digest message follows', await until(() => posts.slice(n).some((p) => /held back/.test(p.body)), 80000));
    for (const c of cs) c.end().catch(() => {});
  }

  // (5) secrets
  const all = logs.join('') + (await metrics());
  check('secrets absent from logs and /metrics', !all.includes(SECRET) && !/ropw/.test(all) && !all.includes('127.0.0.1:' + RP));
  check('receiver got the secret token (url used correctly)', posts.every((p) => p.token));
} catch (e) {
  check('e2e crashed', false, String(e?.message ?? e));
} finally {
  child.kill('SIGTERM'); recv.close(); await admin1.end().catch(() => {});
  fs.writeFileSync(outFile, JSON.stringify({ results, posts: posts.length }, null, 2));
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
}
