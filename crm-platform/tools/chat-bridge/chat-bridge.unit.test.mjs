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
test('watcher: statements on the migration tool schema (migration.*) are skipped, ordinary slow statements still alert', async () => {
  const sent = []; const m = createMetrics(); let t = 0; let calls = 10;
  const mig = 'DELETE FROM migration.id_map WHERE target_org_id = org OR source_client = current_setting($5)';
  const row = (queryid, rolname, q) => ({ queryid, datname: 'crm', rolname, calls, total_exec_time: calls * 900, mean_exec_time: 900, max_exec_time: 2000, rows: 5, query: q });
  const query = async (sql) => (sql.includes('backend_type') ? { rows: [] } : { rows: [row('1', 'crm', mig), row('2', 'r', 'select * from contacts where a = $1')] });
  const w = createWatcher({ query, metrics: m, send: async (c, msg) => sent.push([c, msg]), now: () => t, env: { SLOW_COOLDOWN_SECONDS: '60' } });
  await w.poll(); calls = 12; t = 1000; await w.poll();
  const text = JSON.stringify(sent);
  assert.ok(text.includes('contacts'), 'an ordinary slow statement still alerts');
  assert.ok(!text.includes('migration.id_map'), 'the migration tool bookkeeping is skipped');
  assert.match(m.render(), /kind="excluded"/);
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

test('resolver replies start only after the FIRING card post returned (parent first)', async () => {
  const { startBridge } = await import('./bridge.mjs');
  const order = [];
  const fetchImpl = async () => { await new Promise((r) => setTimeout(r, 50)); order.push('card-posted'); return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; };
  const br = startBridge({ env: { CHAT_ALLOW_ANY_HOST: '1', PROMETHEUS_URL: 'http://127.0.0.1:1' }, urls: { critical: 'http://x/c' }, fetchImpl, log: () => {}, resolverFactory: () => ({ handle: () => { order.push('resolver-started'); }, byKey: () => null }) });
  await br.server.listen(0); const port = br.server.address().port;
  await fetch(`http://127.0.0.1:${port}/alertmanager`, { method: 'POST', body: JSON.stringify({ alerts: [{ status: 'firing', fingerprint: 'f9', labels: { alertname: 'RedisDown', severity: 'critical' }, annotations: {} }] }) });
  br.server.close();
  assert.deepEqual(order, ['card-posted', 'resolver-started']);
});

import { createResolver } from './resolver.mjs';
test('code_fix: recovery without a release stays open ("recovered, no release recorded"); a later release resolves it', async () => {
  const dir = fs.mkdtempSync('/tmp/inc-unit-'), posts = [];
  const r = createResolver({ env: { AUTO_REMEDIATE: 'on', INCIDENTS_DIR: dir }, post: async (c, m) => posts.push(m.text) });
  await r.handle({ playbook: 'code_fix', key: 'st:a', threadKey: 't', file: { queryid: '1' } }); await r.settle();
  assert.equal(await r.statementRecovered('st:a'), true);
  assert.equal(r.byKey('st:a').state, 'recovered_no_release');
  assert.ok(posts.some((p) => /^RECOVERED: .*recovered, no release recorded/.test(p)) && !posts.some((p) => /^RESOLVED/.test(p)));
  assert.equal(fs.readdirSync(`${dir}/open`).length, 1);
  await r.setRelease('abc1234');
  assert.equal(r.byKey('st:a').state, 'resolved');
  assert.ok(posts.some((p) => /^RESOLVED: .*release abc1234/.test(p)));
  assert.equal(fs.readdirSync(`${dir}/resolved`).length, 1);
  fs.rmSync(dir, { recursive: true });
});

test('resolver: an escalated incident is not re-opened (and re-posted) on every poll of the same key', async () => {
  const posts = [], r = createResolver({ env: { AUTO_REMEDIATE: 'on' }, post: async (c, m) => posts.push(m.text), db: {} });
  const spec = { playbook: 'cancel_select', key: 'slow:1:x', threadKey: 't', row: { pid: 1, state: 'active', secs: 999, query: 'update t set a=1', application_name: 'api', usename: 'u' }, text: 'update' };
  for (let i = 0; i < 3; i++) await r.handle(spec);
  await r.settle();
  assert.equal(posts.filter((p) => /^ESCALATED/.test(p)).length, 1);
});

// ---- team incident flow
import { handleIncidents } from './incidents-api.mjs';
async function teamRig(env = {}) {
  const { startBridge } = await import('./bridge.mjs'), posts = [];
  const e = { INCIDENT_API_TOKEN: 'tok-test', AUTO_REMEDIATE: 'dry-run', ANNOUNCE_IN_SPACE: '0', ...env };
  let now = 1_700_000_000_000, resolver;
  const br = startBridge({ env: e, urls: {}, log: () => {}, resolverFactory: ({ post }) => (resolver = createResolver({ env: e, post: async (c, m, o) => { posts.push({ c, t: m.text, k: o?.threadKey, card: JSON.stringify(m.cardsV2) }); }, now: () => now })) });
  await new Promise((r) => br.server.listen(0, '127.0.0.1', r));
  await resolver.handle({ playbook: 'code_fix', key: 'st:1', threadKey: 'thr-1', channel: 'slowquery', file: { queryid: '1' }, diagnosis: 'd' });
  await resolver.settle(); posts.length = 0;
  const base = `http://127.0.0.1:${br.server.address().port}`, id = resolver.list()[0].id;
  const call = async (path, body, token = 'tok-test') => { const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(token ? { 'x-incident-token': token } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json() }; };
  return { br, resolver, posts, call, id, tick: (ms) => { now += ms; }, close: () => br.server.close() };
}
test('team flow: auth 401 without or with a wrong token, token never echoed', async () => {
  const t = await teamRig();
  for (const tok of [null, 'nope']) { const r = await t.call('/incidents', null, tok); assert.equal(r.s, 401); assert.ok(!JSON.stringify(r.j).includes('tok-test')); }
  assert.equal((await t.call(`/incidents/${t.id}/claim`, { who: 'a' }, 'nope')).s, 401);
  assert.equal((await t.call('/incidents')).s, 200); assert.equal((await t.call('/incidents?status=bogus')).s, 400);
  t.close();
});
test('team flow: claim, conflict 409, renew, release, thread replies', async () => {
  const t = await teamRig();
  assert.equal((await t.call(`/incidents/${t.id}/claim`, { who: 'vedant' })).j.status, 'claimed');
  assert.match(t.posts[0].t, /^\uD83D\uDC40 vedant is working on this \(claimed \d\d:\d\d UTC\)$/); assert.equal(t.posts[0].k, 'thr-1'); assert.equal(t.posts[0].c, 'slowquery');
  const c = await t.call(`/incidents/${t.id}/claim`, { who: 'asha' }); assert.equal(c.s, 409); assert.equal(c.j.owner, 'vedant');
  const n = t.posts.length; assert.equal((await t.call(`/incidents/${t.id}/claim`, { who: 'vedant' })).s, 200); assert.equal(t.posts.length, n); // renew is silent
  assert.equal((await t.call(`/incidents/${t.id}/release-claim`, { who: 'asha' })).s, 409);
  assert.equal((await t.call(`/incidents/${t.id}/release-claim`, { who: 'vedant' })).j.status, 'open');
  assert.match(t.posts.at(-1).t, /^\uD83E\uDD1D vedant released this incident$/);
  assert.equal((await t.call(`/incidents/${t.id}/claim`, { who: 'asha' })).s, 200);
  assert.equal((await t.call('/incidents?status=claimed')).j.incidents.length, 1); assert.equal((await t.call('/incidents?status=open')).j.incidents.length, 0);
  t.close();
});
test('team flow: racing claims, exactly one wins', async () => {
  const t = await teamRig();
  const rs = await Promise.all(['a', 'b', 'c'].map((who) => t.call(`/incidents/${t.id}/claim`, { who })));
  assert.deepEqual(rs.map((r) => r.s).sort(), [200, 409, 409]); t.close();
});
test('team flow: claim expiry posts the escalation, a note renews it', async () => {
  const t = await teamRig({ INCIDENT_CLAIM_TTL_HOURS: '1' });
  await t.call(`/incidents/${t.id}/claim`, { who: 'a' }); t.tick(40 * 60e3);
  assert.equal((await t.call(`/incidents/${t.id}/note`, { who: 'a', text: 'looking at the plan' })).s, 200);
  t.tick(40 * 60e3); assert.equal((await t.call(`/incidents/${t.id}`)).j.status, 'claimed'); // renewed by the note
  t.tick(30 * 60e3); const r = await t.call(`/incidents/${t.id}`);
  assert.equal(r.j.status, 'open'); assert.ok(t.posts.some((p) => p.t === '\u23F0 claim expired, incident is open again' && p.k === 'thr-1'));
  assert.equal((await t.call(`/incidents/${t.id}/claim`, { who: 'b' })).s, 200); t.close();
});
test('team flow: PR url allow-list, query strip, pr post, RESOLVED names PR and owner on release and on alert clear', async () => {
  const t = await teamRig(), U = 'https://github.com/lakshyatyagi241/threadwise/pull/901';
  for (const url of ['http://github.com/lakshyatyagi241/threadwise/pull/9', 'https://evil.com/lakshyatyagi241/threadwise/pull/9', 'https://github.com/lakshyatyagi241/threadwise/pull/9/files', 'https://github.com.evil.io/lakshyatyagi241/threadwise/pull/9', 'javascript:1', '']) assert.equal((await t.call(`/incidents/${t.id}/pr`, { who: 'a', url, summary: 's' })).s, 400, url);
  assert.equal((await t.call(`/incidents/${t.id}/pr`, { who: 'a', url: U, summary: 's\nx' })).s, 400);
  assert.equal((await t.call(`/incidents/${t.id}/pr`, { who: 'a', url: U, number: 5, summary: 's' })).s, 400);
  assert.equal((await t.call(`/incidents/${t.id}/note`, { who: 'a'.repeat(41), text: 'x' })).s, 400);
  await t.call(`/incidents/${t.id}/claim`, { who: 'vedant' });
  assert.equal((await t.call(`/incidents/${t.id}/pr`, { who: 'asha', url: U, summary: 's' })).s, 409);
  const r = await t.call(`/incidents/${t.id}/pr`, { who: 'vedant', url: `${U}?token=SECRET#x`, number: 901, summary: 'add index <b>' });
  assert.equal(r.j.status, 'pr_raised'); assert.equal(r.j.prUrl, U);
  assert.match(t.posts.at(-1).t, /^\uD83D\uDD27 PR #901 raised by vedant at \d\d:\d\d UTC: add index <b> https:\/\/github.com\/lakshyatyagi241\/threadwise\/pull\/901$/);
  assert.ok(t.posts.at(-1).card.includes('&lt;b>') && !t.posts.at(-1).card.includes('SECRET'));
  t.tick(5 * 3600e3); assert.equal((await t.call(`/incidents/${t.id}`)).j.status, 'pr_raised'); // a PR never expires
  await t.resolver.setRelease('abc1234', [901]); await t.resolver.statementRecovered('st:1'); await t.resolver.settle();
  assert.match(t.posts.at(-1).t, /^\u2705 RESOLVED by PR #901 \(owner vedant\), release abc1234/);
  assert.equal((await t.call(`/incidents/${t.id}/claim`, { who: 'x' })).s, 409);
  // alert-cleared path
  const t2 = await teamRig(); await t2.call(`/incidents/${t2.id}/pr`, { who: 'asha', url: U, summary: 's' });
  assert.equal(await t2.resolver.alertCleared('st:1'), true); assert.match(t2.posts.at(-1).t, /^\u2705 RESOLVED by PR #901 \(owner asha\)/);
  t.close(); t2.close();
});
import { run as cli } from './incident-cli.mjs';
test('incident-cli against a local bridge: list, claim, conflict exit 1, pr, note, config file mode, no secrets printed', async () => {
  const t = await teamRig(), home = fs.mkdtempSync('/tmp/cli-home-'), lines = [];
  const out = (s) => lines.push(s), base = { HOME: home, INCIDENT_API_URL: `http://127.0.0.1:${t.br.server.address().port}`, INCIDENT_API_TOKEN: 'tok-test' };
  assert.equal(await cli(['list'], { ...base, INCIDENT_WHO: 'vedant' }, out), 0); assert.match(lines.at(-1), new RegExp(`${t.id}  open`));
  assert.equal(await cli(['claim', t.id], { ...base, INCIDENT_WHO: 'vedant' }, out), 0);
  assert.equal(await cli(['claim', t.id], { ...base, INCIDENT_WHO: 'asha' }, out), 1); assert.match(lines.at(-1), /refused \(409\).*owner: vedant/);
  assert.equal(await cli(['pr', t.id, 'https://github.com/lakshyatyagi241/threadwise/pull/7?x=1', 'add index'], { ...base, INCIDENT_WHO: 'vedant' }, out), 0);
  assert.equal(await cli(['note', t.id, 'ping'], { ...base, INCIDENT_WHO: 'vedant' }, out), 0);
  assert.equal(await cli(['show', t.id], { ...base, INCIDENT_WHO: 'vedant' }, out), 0); assert.match(lines.at(-1), /"pr_raised"/);
  assert.equal(await cli(['list'], { ...base, INCIDENT_API_TOKEN: 'bad', INCIDENT_WHO: 'v' }, out), 1); assert.match(lines.at(-1), /401/);
  // token from a mode-600 file; a loose mode is refused
  fs.mkdirSync(`${home}/.config/threadwise`, { recursive: true }); const f = `${home}/.config/threadwise/incidents.env`;
  fs.writeFileSync(f, `INCIDENT_API_URL=${base.INCIDENT_API_URL}\nINCIDENT_API_TOKEN=tok-test\n`, { mode: 0o644 });
  assert.equal(await cli(['list'], { HOME: home, INCIDENT_WHO: 'v' }, out), 2);
  fs.chmodSync(f, 0o600); assert.equal(await cli(['list'], { HOME: home, INCIDENT_WHO: 'v' }, out), 0);
  assert.ok(!lines.join('\n').includes('tok-test')); t.close(); fs.rmSync(home, { recursive: true });
});

// ---- close the loop: release-aware verification, deploy_failure kind
async function loopRig(firing = () => false) {
  const posts = [], env = { AUTO_REMEDIATE: 'on', VERIFY_SECONDS: '0', VERIFY_POLL_MS: '1', INCIDENTS_DIR: fs.mkdtempSync('/tmp/inc-loop-') };
  const r = createResolver({ env, post: async (c, m, o) => posts.push({ c, t: m.text, k: o?.threadKey }), promQuery: async () => (firing() ? 1 : 0), sleep: async () => {} });
  await r.handle({ playbook: 'service', kind: 'critical_alert', alertname: 'HighErrorRate', key: 'am:f1', threadKey: 'am-f1', channel: 'critical', diagnosis: 'd', suggestion: 's' }); await r.settle();
  const id = r.list()[0].id; await r.claim(id, 'vedant'); await r.raisePr(id, 'vedant', { url: 'https://github.com/lakshyatyagi241/threadwise/pull/77', number: 77, summary: 'fix' });
  posts.length = 0; return { r, posts, id };
}
test('loop: release containing the PR + alert gone -> released -> RESOLVED names PR, owner, release, verification', async () => {
  const { r, posts, id } = await loopRig();
  assert.equal(r.get(id).kind, 'critical_alert');
  await r.setRelease('abc1234', [77]); assert.equal(r.get(id).status, 'released'); await r.settle();
  assert.equal(r.get(id).status, 'resolved');
  const th = posts.filter((p) => p.k); assert.match(th.at(-1).t, /^✅ RESOLVED by PR #77 \(owner vedant\), release abc1234, verified after \d+s; open for 0h \d+m$/); assert.equal(th.at(-1).k, 'am-f1');
});
test('loop: release NOT containing the PR changes nothing and posts nothing', async () => {
  const { r, posts, id } = await loopRig();
  await r.setRelease('def5678', [1, 2]); await r.setRelease('def5679'); await r.settle();
  assert.equal(r.get(id).status, 'pr_raised'); assert.equal(posts.length, 0);
});
test('loop: PR released but alert still firing -> warning + escalated in the same thread, never RESOLVED', async () => {
  const { r, posts, id } = await loopRig(() => true);
  await r.setRelease('abc1234', [77]); await r.settle();
  assert.equal(r.get(id).status, 'escalated'); assert.equal(r.get(id).prUrl, null);
  assert.ok(posts.some((p) => /^⚠️ Released PR #77 but the problem is still there/.test(p.t) && p.k === 'am-f1')); assert.ok(!posts.some((p) => /RESOLVED/.test(p.t)));
});
test('loop: deploy failure opens one incident (deduped), exposes kind, takes a PR, a later live release resolves it', async () => {
  const { r, posts } = await loopRig(); posts.length = 0;
  const spec = { attemptedSha: 'bbbbbbb1', liveSha: 'aaaaaaa1', prs: [5, 6], mergers: ['@bob'], durationSeconds: 90 };
  await r.openDeployFailure(spec); await r.openDeployFailure(spec); await r.settle();
  const inc = r.listFull().filter((i) => i.kind === 'deploy_failure'); assert.equal(inc.length, 1);
  assert.equal(posts.filter((p) => /Deploy failed or was refused: needs a human or a fix PR/.test(p.t)).length, 1);
  assert.match(posts.at(-1).t, /PRs: #5 #6\nMerged by: @bob/); assert.equal(posts.at(-1).c, 'deploy');
  await r.claim(inc[0].id, 'asha'); await r.raisePr(inc[0].id, 'asha', { url: 'https://github.com/lakshyatyagi241/threadwise/pull/80', number: 80, summary: 'fix build' });
  await r.setRelease('ccccccc1', [80]); await r.settle();
  assert.equal(r.get(inc[0].id).status, 'resolved'); assert.match(posts.at(-1).t, /RESOLVED by PR #80 \(owner asha\), release ccccccc1/);
});
test('loop: slow statement keeps kind, released PR resolves on recovered polls', async () => {
  const dir = fs.mkdtempSync('/tmp/inc-loop-'), posts = [];
  const r = createResolver({ env: { AUTO_REMEDIATE: 'on', INCIDENTS_DIR: dir }, post: async (c, m) => posts.push(m.text), sleep: async () => {} });
  await r.handle({ playbook: 'code_fix', key: 'st:z', threadKey: 't', file: { queryid: '9' } }); await r.settle();
  const id = r.list()[0].id; assert.equal(r.get(id).kind, 'slow_statement');
  await r.raisePr(id, 'asha', { url: 'https://github.com/lakshyatyagi241/threadwise/pull/5', number: 5, summary: 's' });
  await r.setRelease('abc1234', [9]); assert.equal(r.get(id).status, 'pr_raised');
  await r.setRelease('abc1235', [5]); assert.equal(r.get(id).status, 'released');
  await r.statementRecovered('st:z'); assert.equal(r.get(id).status, 'resolved'); assert.match(posts.at(-1), /RESOLVED by PR #5 \(owner asha\), release abc1235/);
});
test('api: POST /release and POST /incidents need the token and validate input', async () => {
  const t = await teamRig(), h = { 'x-incident-token': 'tok-test', 'content-type': 'application/json' };
  const post = async (p, body, headers = h) => { const x = await fetch(`http://127.0.0.1:${t.br.server.address().port}${p}`, { method: 'POST', headers, body: JSON.stringify(body) }); return { s: x.status, j: await x.json() }; };
  assert.equal((await post('/release', { sha: 'abc1234', prs: [1] }, {})).s, 401);
  assert.equal((await post('/release', { sha: 'zz', prs: [1] })).s, 400);
  assert.equal((await post('/release', { sha: 'abc1234', prs: ['x'] })).s, 400);
  assert.equal((await post('/release', { sha: 'abc1234', prs: [1], at: 'now' })).s, 200);
  assert.equal((await post('/incidents', { kind: 'deploy_failure', attemptedSha: 'bbbbbbb1' }, {})).s, 401);
  assert.equal((await post('/incidents', { kind: 'deploy_failure', attemptedSha: 'not sha' })).s, 400);
  assert.equal((await post('/incidents', { kind: 'deploy_failure', attemptedSha: 'bbbbbbb1', mergers: ['<@all>'] })).s, 400);
  const a = await post('/incidents', { kind: 'deploy_failure', attemptedSha: 'bbbbbbb1', liveSha: 'aaaaaaa1', prs: [3], mergers: ['bob'], durationSeconds: 5 });
  const b = await post('/incidents', { kind: 'deploy_failure', attemptedSha: 'bbbbbbb1' });
  assert.deepEqual([a.s, a.j.deduped, b.s, b.j.deduped, b.j.id === a.j.id], [201, false, 200, true, true]);
  const g = await t.call('/incidents'); assert.ok(g.j.incidents.some((i) => i.kind === 'deploy_failure') && g.j.incidents.some((i) => i.kind === 'slow_statement'));
  t.close();
});

test('a critical alert with NO runbook entry still opens an incident (so the team can claim it); an unmapped warning does not', async () => {
  const { startBridge } = await import('./bridge.mjs');
  const handled = []; const posts = [];
  const fetchImpl = async (u, o) => { posts.push(String(u)); return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; };
  const env = { CHAT_ALLOW_ANY_HOST: '1', GCHAT_CRITICAL_URL: 'http://x/c', GCHAT_SLOWQUERY_URL: 'http://x/s' };
  const br = startBridge({ env, urls: { slowquery: 'http://x/s', critical: 'http://x/c' }, fetchImpl, log: () => {}, resolverFactory: () => ({ handle: (s) => { handled.push(s); }, byKey: () => null }) });
  await br.server.listen(0); const port = br.server.address().port;
  const send = (alertname, severity, fp) => fetch(`http://127.0.0.1:${port}/alertmanager`, { method: 'POST', body: JSON.stringify({ alerts: [{ status: 'firing', labels: { alertname, severity }, annotations: { summary: 's' }, fingerprint: fp }] }) });
  await send('BrandNewUnmappedRule', 'critical', 'u1'); await send('BrandNewUnmappedWarning', 'warning', 'u2');
  br.server.close();
  assert.equal(handled.length, 1); assert.equal(handled[0].alertname, 'BrandNewUnmappedRule'); assert.equal(handled[0].playbook, 'service');
  assert.match(handled[0].suggestion, /No runbook entry/); assert.ok(posts.every((u) => u.startsWith('http://x/c')));
});

test('an alert with no runbook entry still gets a useful diagnosis (meaning from its own text, where to look, what to do) and nothing unsafe', async () => {
  const { diagnosisRows } = await import('./diagnosis.mjs');
  const rows = diagnosisRows({ labels: { alertname: 'Brand New; rm -rf /' }, annotations: { description: 'Disk fills\nup <b>fast</b>' } }, { entry: null, rows: [] });
  const txt = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
  assert.ok(rows.length >= 4); assert.match(txt, /What it means: Disk fills up/); assert.match(txt, /grep -rn "BrandNewrmrf" deploy\/observability/);
  assert.match(txt, /Claim it/); assert.ok(!/No runbook entry for this alert \(add one/.test(txt)); assert.ok(!txt.includes('; rm -rf'));
});

test('announce: claim, PR and RESOLVED are also posted top-level (no threadKey); notes are not', async () => {
  const { r, posts, id } = await loopRig();
  await r.releaseClaim(id, 'vedant'); await r.claim(id, 'asha'); await r.addNote(id, 'asha', 'looking at logs');
  await r.setRelease('abc1234', [77]); await r.settle();
  const top = posts.filter((p) => !p.k).map((p) => p.t);
  assert.ok(top.some((t) => t.includes('asha is working on this') && t.includes('HighErrorRate')), 'claim announced top-level');
  assert.ok(top.some((t) => t.includes('RESOLVED by PR #77')), 'RESOLVED announced top-level');
  assert.ok(!top.some((t) => t.includes('looking at logs')), 'notes stay in the thread');
  assert.ok(posts.some((p) => p.k === 'am-f1' && p.t.includes('asha is working on this')), 'thread reply kept');
});

test('watcher: the slow-statement card carries the incident key so the incident can edit that one card', async () => {
  const sent = []; let t = 0; let calls = 10;
  const query = async (sql) => (sql.includes('backend_type') ? { rows: [] } : { rows: [{ queryid: '7', datname: 'd', rolname: 'r', calls, total_exec_time: calls * 900, mean_exec_time: 900, max_exec_time: 2000, rows: 5, query: 'select * from t where a = $1' }] });
  const w = createWatcher({ query, metrics: createMetrics(), send: async (c, msg, o) => sent.push(o), now: () => t, env: {} });
  await w.poll(); calls = 12; t = 1000; await w.poll();
  assert.equal(sent.at(-1).interactive.incidentId, 'st:7|d|r');
});

test('other channel: non-critical alerts go to the Other space only when NON_CRITICAL_CHANNEL=other; the URL loads from the secret file', async () => {
  const w = { labels: { alertname: 'OutboxDeadRows', severity: 'warning' } };
  assert.equal(channelFor(w, {}), 'none');
  assert.equal(channelFor(w, { NON_CRITICAL_CHANNEL: 'other' }), 'other');
  assert.equal(channelFor({ labels: { alertname: 'X', severity: 'critical' } }, { NON_CRITICAL_CHANNEL: 'other' }), 'critical'); // critical never moves
  assert.equal(channelFor({ labels: { alertname: 'X', severity: 'warning', test: 'true' } }, { NON_CRITICAL_CHANNEL: 'other' }), 'none'); // tests stay out
  const { loadUrls } = await import('./bridge.mjs');
  const dir = fs.mkdtempSync('/tmp/gc-sec-'); fs.writeFileSync(`${dir}/gchat_other_url`, 'https://chat.googleapis.com/v1/spaces/OTHER/messages?key=k&token=t\n');
  assert.equal(loadUrls({ GCHAT_SECRETS_DIR: dir }).other, 'https://chat.googleapis.com/v1/spaces/OTHER/messages?key=k&token=t');
});

test('an alert that clears on its own closes an unowned incident (so loops stop seeing it); an owned one or one with a PR stays', async () => {
  const mk = async (key) => { const r = createResolver({ env: { ANNOUNCE_IN_SPACE: '0', INCIDENTS_DIR: fs.mkdtempSync('/tmp/inc-clr-') }, post: async () => {} }); await r.handle({ playbook: 'service', alertname: 'X', key, threadKey: 't', channel: 'critical', diagnosis: 'd', suggestion: 's' }); await r.settle(); return r; };
  const a = await mk('am:a'); assert.equal(a.markCleared('am:a', { measured: 'm' }), true);
  assert.equal(a.listFull()[0].status, 'resolved'); assert.equal(a.listFull()[0].resolution.kind, 'self');
  assert.equal(a.markCleared('am:a'), false, 'already closed');
  const b = await mk('am:b'); await b.claim(b.list()[0].id, 'asha'); assert.equal(b.markCleared('am:b'), false); assert.equal(b.listFull()[0].status, 'claimed');
  const c = await mk('am:c'); await c.raisePr(c.list()[0].id, 'asha', { url: 'https://github.com/lakshyatyagi241/threadwise/pull/5', number: 5, summary: 's' }); assert.equal(c.markCleared('am:c'), false);
  assert.equal(c.listFull()[0].status, 'pr_raised');
});
