import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSql, channelFor, formatAlertmanager, createGate, createSender, createMetrics } from './lib.mjs';
import { createWatcher } from './watcher.mjs';

test('sanitizer strips emails, phones, tokens, numbers, comments, dollar quotes', () => {
  const q = `SELECT * FROM contacts WHERE email = 'a.b@example.com' OR phone IN ('+919876543210', '+1 555 0100') AND token = E'sk_live_abc123' AND id = 42 AND x = $$secret body$$ AND y=$tag$tok$tag$ -- trailing tok_999\n AND z = 3.5e2 /* ghp_zzz */ AND w = 0xFF AND v = $1`;
  const s = sanitizeSql(q);
  for (const bad of ['example.com', '9876543210', '555', 'sk_live', 'abc123', '42', 'secret', 'tok_999', 'tag$tok', 'ghp_', '3.5', '0xFF', 'FF']) assert.ok(!s.includes(bad), `${bad} leaked: ${s}`);
  assert.match(s, /\$1/); assert.match(s, /contacts/);
});
test('sanitizer handles unterminated quote and truncates to 800', () => {
  assert.ok(!sanitizeSql(`select 'abc@x.io`).includes('abc'));
  assert.ok(sanitizeSql(`select ${'a'.repeat(2000)}`).length <= 800);
  assert.equal(sanitizeSql(`select 'it''s a secret'`), 'select ?');
  assert.match(sanitizeSql('select t1.c2 from t1 where a in (1,2,3)'), /t1\.c2.*\(\?\)/);
});
test('router: full matrix of slow_query x severity x test x group', () => {
  for (const severity of ['critical', 'warning', 'info', 'none', undefined]) for (const slow of [false, true]) for (const test of [false, true]) {
    const labels = { ...(severity ? { severity } : {}), ...(slow ? { group: 'slow_query' } : {}), ...(test ? { test: 'true' } : {}) };
    const want = test ? 'none' : slow ? 'slowquery' : severity === 'critical' ? 'critical' : 'none';
    assert.equal(channelFor({ labels }, {}), want, JSON.stringify(labels));
    assert.notEqual(channelFor({ labels }, {}), 'deploy');
    if (test) assert.equal(channelFor({ labels }, { TEST_ALERTS_CHANNEL: 'slowquery' }), 'slowquery', JSON.stringify(labels));
  }
  assert.equal(channelFor({ labels: { severity: 'warning', group: 'api' } }, { NON_CRITICAL_CHANNEL: 'slowquery' }), 'slowquery');
  assert.equal(channelFor({ labels: { severity: 'critical', group: 'api' } }, { NON_CRITICAL_CHANNEL: 'slowquery' }), 'critical');
  assert.equal(channelFor({ labels: { severity: 'warning', group: 'api' } }, { NON_CRITICAL_CHANNEL: 'bogus' }), 'none');
});
test('router: every real rule in deploy/observability lands where intended', () => {
  const dir = new URL('../../deploy/observability/', import.meta.url), count = {};
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.rules.yml'))) {
    const txt = fs.readFileSync(new URL(f, dir), 'utf8');
    for (const blk of txt.split(/\n\s*- alert: /).slice(1)) {
      const name = blk.split('\n')[0].trim(), lab = /labels:\s*\{([^}]*)\}/.exec(blk)?.[1] ?? '';
      const labels = Object.fromEntries(lab.split(',').map((kv) => kv.split(':').map((x) => x.trim())).filter((kv) => kv[0]));
      const ch = name === 'Watchdog' ? 'watchdog' : channelFor({ labels }, {});
      count[ch] = (count[ch] ?? 0) + 1;
      if (labels.group === 'slow_query') assert.equal(ch, 'slowquery', name);
      else if (labels.severity === 'critical') assert.equal(ch, 'critical', name);
      else if (name !== 'Watchdog') assert.equal(ch, 'none', name);
      if (/^ChatBridge/.test(name)) assert.equal(ch, 'critical', `${name}: pipeline alerts must never be dropped`);
      if (name === 'SlowQueryWatcherDown') assert.equal(ch, 'slowquery');
    }
  }
  console.log('routing matrix for real rules:', JSON.stringify(count));
  assert.ok(count.critical >= 21 && count.slowquery >= 2);
});
test('metrics: not_routed drop is counted with a reason label', () => {
  const m = createMetrics(); m.dropped('not_routed');
  assert.match(m.render(), /crm_chat_bridge_dropped_total\{reason="not_routed"\} 1/);
});
test('formatter drops Watchdog, splits large payloads, escapes html, keeps messages small', () => {
  const mk = (i, st = 'firing') => ({ status: st, labels: { alertname: `A${i}`, severity: 'critical', instance: 'x' }, annotations: { summary: '<b>' + 's'.repeat(3000), description: 'd'.repeat(3000), runbook_url: 'https://r/x' }, startsAt: '2026-01-01T00:00:00Z', endsAt: '0001-01-01T00:00:00Z' });
  const out = formatAlertmanager({ alerts: [{ status: 'firing', labels: { alertname: 'Watchdog' } }, ...Array.from({ length: 20 }, (_, i) => mk(i)), mk(99, 'resolved')] });
  assert.deepEqual(Object.keys(out), ['critical']);
  assert.ok(out.critical.length > 1);
  for (const m of out.critical) { assert.ok(JSON.stringify(m).length < 30000); assert.ok(m.text.length <= 300); }
  assert.ok(!JSON.stringify(out).includes('<b>sss'));
  assert.match(JSON.stringify(out.critical.at(-1)), /resolved/);
});
test('gate: cooldown, rate limit', () => {
  let t = 0; const g = createGate({ cooldownMs: 1000, perMinute: 2, now: () => t });
  assert.equal(g.allow('a'), 'send'); assert.equal(g.allow('a'), 'cooldown'); assert.equal(g.allow('b'), 'send'); assert.equal(g.allow('c'), 'limited');
  t = 61000; assert.equal(g.allow('a'), 'send');
});
test('sender retries 429/5xx, not 4xx, never leaks url', async () => {
  const calls = []; const logs = [];
  const mk = (codes) => createSender({ urls: { slowquery: 'https://chat.example/SECRETTOKEN' }, metrics: createMetrics(), log: (o) => logs.push(o), sleep: async () => {}, fetchImpl: async () => { calls.push(1); return { ok: codes[0] < 300, status: codes.shift(), headers: new Map() }; } });
  assert.equal((await mk([500, 429, 200])('slowquery', {})).attempts, 3);
  calls.length = 0; assert.equal((await mk([400])('slowquery', {})).ok, false); assert.equal(calls.length, 1);
  calls.length = 0; assert.equal((await mk([500, 500, 500, 500, 500])('slowquery', {})).ok, false); assert.equal(calls.length, 4);
  assert.ok(!JSON.stringify(logs).includes('SECRET'));
});
test('watcher: running query + statement delta + dedup + missing extension', async () => {
  const sent = []; const m = createMetrics(); let t = 0; let calls = 10; let ext = true;
  const query = async (sql) => {
    if (sql.includes('backend_type')) return { rows: [{ secs: 7, datname: 'd', usename: 'ro', application_name: '', query: "select pg_sleep(7) where e='a@b.co'" }] };
    if (!ext) throw Object.assign(new Error('x'), { code: '42P01' });
    return { rows: [{ queryid: '1', datname: 'd', rolname: 'r', calls, total_exec_time: calls * 900, mean_exec_time: 900, max_exec_time: 2000, rows: 5, query: 'select * from t where a = $1' }] };
  };
  const w = createWatcher({ query, metrics: m, send: async (c, msg) => sent.push([c, msg]), now: () => t, env: { SLOW_COOLDOWN_SECONDS: '60' } });
  await w.poll(); // baseline: only the running query posts
  assert.equal(sent.length, 1); assert.ok(!JSON.stringify(sent[0]).includes('a@b.co'));
  calls = 12; t = 1000; await w.poll(); assert.equal(sent.length, 2); // statement: delta 2
  assert.match(JSON.stringify(sent[1]), /Calls since last poll/);
  t = 2000; await w.poll(); assert.equal(sent.length, 2); // same calls, deduped
  ext = false; t = 200000; await w.poll(); assert.match(m.render(), /pg_stat_statements_available 0/);
});
test('watcher: rate limit then digest', async () => {
  const sent = []; const m = createMetrics(); let t = 0;
  const rows = Array.from({ length: 15 }, (_, i) => ({ secs: 9, datname: 'd', usename: 'u', application_name: '', query: `select c${i} from t` }));
  const w = createWatcher({ query: async (s) => (s.includes('backend_type') ? { rows } : { rows: [] }), metrics: m, send: async (c, x) => sent.push(x), now: () => t, env: {} });
  await w.poll(); assert.equal(sent.length, 10);
  t = 61000; await w.poll(); assert.ok(sent.some((x) => /held back/.test(x.text)));
});

import fsx from 'node:fs';
import { DIAG, ruleNames, diagnose, diagnosisRows } from './diagnosis.mjs';
import { createThreads, fmtDur } from './threads.mjs';
test('every alert rule has a diagnosis entry', () => {
  const dir = new URL('../../deploy/observability/', import.meta.url);
  const names = fsx.readdirSync(dir).filter((f) => f.endsWith('.rules.yml')).flatMap((f) => ruleNames(fsx.readFileSync(new URL(f, dir), 'utf8'))).filter((n) => n !== 'Watchdog');
  assert.ok(names.length > 40);
  const missing = names.filter((n) => !DIAG[n]);
  assert.deepEqual(missing, [], `rules without a diagnosis entry: ${missing}`);
  for (const n of names) { const d = DIAG[n]; assert.ok(d.meaning && d.causes.length >= 2 && d.check.length && d.action && d.rb && d.q.length, n); }
  const stale = Object.keys(DIAG).filter((n) => !names.includes(n));
  assert.deepEqual(stale, [], 'diagnosis entries without a rule');
});
test('diagnose: evidence + trend, and timeouts never block', async () => {
  const f = async (u) => ({ json: async () => ({ data: { result: [{ value: [0, /offset/.test(decodeURIComponent(u)) ? '10' : '20'] }] } }) });
  const ev = await diagnose({ labels: { alertname: 'DbPoolExhausted' } }, { fetchImpl: f, env: {} });
  assert.match(JSON.stringify(ev.rows), /trend up/); assert.equal(ev.value, 20);
  const t = Date.now(); const hang = await diagnose({ labels: { alertname: 'RedisDown' } }, { fetchImpl: () => new Promise(() => {}), env: {} });
  assert.ok(Date.now() - t < 3000); assert.deepEqual(hang.rows, []); assert.match(JSON.stringify(diagnosisRows({}, hang)), /unavailable/);
});
test('threads: bounded and TTL', () => {
  let t = 0; const th = createThreads({ max: 2, ttlMs: 100, now: () => t });
  th.put('a', {}); th.put('b', {}); th.put('c', {}); assert.equal(th.size, 2); assert.ok(!th.get('a'));
  t = 500; assert.ok(!th.get('b')); assert.equal(fmtDur(252000), '4m 12s');
});

test('test=true alerts: TEST card, slowquery only, never an incident or escalation', async () => {
  const { alertCard, isTest } = await import('./lib.mjs');
  const { startBridge } = await import('./bridge.mjs');
  const a = { status: 'firing', labels: { alertname: 'DeployTest', severity: 'critical', test: 'true' }, annotations: { summary: 's' } };
  assert.ok(isTest(a)); assert.equal(channelFor(a), 'none'); assert.equal(channelFor(a, { TEST_ALERTS_CHANNEL: 'slowquery' }), 'slowquery');
  const c = alertCard(a).cardsV2[0].card;
  assert.ok(c.header.title.startsWith('🧪 TEST - ')); assert.match(c.sections[0].widgets[0].textParagraph.text, /Test message, not a real alert/);
  assert.ok(!alertCard({ ...a, labels: { alertname: 'X', test: 'false' } }).cardsV2[0].card.header.title.includes('TEST'));
  const posts = []; let handled = 0;
  const fetchImpl = async (u, o) => { posts.push({ u: String(u), b: o?.body }); return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; };
  const env = { TEST_ALERTS_CHANNEL: 'slowquery', CHAT_ALLOW_ANY_HOST: '1', GCHAT_SLOWQUERY_URL: 'http://x/s', GCHAT_CRITICAL_URL: 'http://x/c' };
  const br = startBridge({ env, urls: { slowquery: 'http://x/s', critical: 'http://x/c' }, fetchImpl, log: () => {}, resolverFactory: () => ({ handle: () => { handled++; }, byKey: () => null }) });
  await br.server.listen(0); const port = br.server.address().port;
  for (const st of ['firing', 'resolved']) await fetch(`http://127.0.0.1:${port}/alertmanager`, { method: 'POST', body: JSON.stringify({ alerts: [{ ...a, status: st, fingerprint: 'f1' }] }) });
  br.server.close();
  assert.equal(handled, 0); assert.equal(posts.length, 2);
  assert.ok(posts.every((p) => p.u.startsWith('http://x/s') && /TEST - /.test(p.b)));
});

test('test=true alerts are dropped by default: nothing posted, counted reason=test, no resolver', async () => {
  const { startBridge } = await import('./bridge.mjs');
  const posts = []; let handled = 0;
  const fetchImpl = async (u) => { posts.push(String(u)); return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; };
  const br = startBridge({ env: { CHAT_ALLOW_ANY_HOST: '1' }, urls: { slowquery: 'http://x/s', critical: 'http://x/c' }, fetchImpl, log: () => {}, resolverFactory: () => ({ handle: () => { handled++; }, byKey: () => null }) });
  await br.server.listen(0); const port = br.server.address().port;
  const a = { status: 'firing', labels: { alertname: 'DeployTest', severity: 'critical', test: 'true' }, annotations: {} };
  const r = await fetch(`http://127.0.0.1:${port}/alertmanager`, { method: 'POST', body: JSON.stringify({ alerts: [a] }) });
  const rc = await (await fetch(`http://127.0.0.1:${port}/route-check`, { method: 'POST', body: '{"test":true,"severity":"critical"}' })).json();
  br.server.close();
  assert.equal(r.status, 200); assert.equal(posts.length, 0); assert.equal(handled, 0); assert.equal(rc.channel, 'none');
  assert.match(br.metrics.render(), /crm_chat_bridge_dropped_total\{reason="test"\} 1/);
});
