import test from 'node:test';
import assert from 'node:assert/strict';
import { createResolver } from './resolver.mjs';
import { createChatApp } from './chat-app.mjs';
import { startSentryPoller } from './sentry-poller.mjs';

const TOKEN = 'sntrys_SECRET_TOKEN_123', T0 = Date.UTC(2026, 9, 23, 12, 0, 0);
const iso = (t) => new Date(t).toISOString();
const issue = (o = {}) => ({ id: '101', shortId: 'WEB-1', title: 'TypeError: x is undefined', culprit: 'src/a.ts in run', level: 'error', status: 'unresolved', substatus: 'ongoing', project: { slug: 'web' }, count: '5', userCount: 3, firstSeen: iso(T0 - 60e3), lastSeen: iso(T0), permalink: 'https://geta-ai-cj.sentry.io/issues/101/', stats: { '1h': [[1, 2], [2, 3]] }, ...o });
const EVENT = { entries: [{ type: 'exception', data: { values: [{ stacktrace: { frames: [{ filename: 'lib/x.js', lineNo: 1, function: 'lib', inApp: false }, { filename: 'src/a.ts', lineNo: 10, function: 'run', inApp: true }, { filename: 'src/<b>.ts', lineNo: 7, function: 'inner', inApp: true }] } }] } }] };

async function rig({ token = TOKEN, env = {} } = {}) {
  let clock = T0, list = [], failList = false, detail = {}; const urls = [], logs = [], creates = [], updates = [], posts = [];
  const fetchImpl = async (url, o) => {
    urls.push({ url, auth: o?.headers?.authorization });
    const ok = (j, link) => ({ ok: true, status: 200, headers: { get: () => link ?? '' }, text: async () => JSON.stringify(j) });
    if (/\/events\/latest\//.test(url)) return ok(EVENT);
    if (/\/organizations\//.test(url)) return failList ? { ok: false, status: 500, headers: { get: () => '' }, text: async () => '' } : ok(list);
    const id = /issues\/(\d+)\/$/.exec(url)?.[1]; return ok(detail[id] ?? { status: 'unresolved', lastSeen: iso(T0) });
  };
  const api = { createMessage: async (ch, body) => (creates.push({ ch, body }), { ok: true, name: `spaces/A/messages/${creates.length}` }), updateMessage: async (ch, name, body) => (updates.push(body), { ok: true }) };
  const resolver = createResolver({ env: { ...env, ANNOUNCE_IN_SPACE: '1', SENTRY_ORG: 'geta-ai-cj' }, post: async (c, m) => posts.push({ c, m }), now: () => clock, sleep: async () => {}, log: (o) => logs.push(o) });
  const app = createChatApp({ env: { CHAT_APP_ENABLED: 'true' }, api, verifier: {}, resolver, webhookSend: async () => {} });
  resolver.setOwnerHook((id, o) => app.syncCard(id, o)); resolver.setCardHook((c, b, o) => app.openCard(c, b, o));
  const poller = startSentryPoller({ resolver, env: { SENTRY_ORG: 'geta-ai-cj', ...env }, fetchImpl, log: (o) => logs.push(o), now: () => clock, readFile: () => { if (token == null) throw new Error('nofile'); return `${token}\n`; } });
  const incs = () => resolver.listFull().filter((i) => i.kind === 'sentry_issue');
  return { resolver, poller, urls, logs, creates, updates, posts, incs, set: (l) => { list = l; }, fail: (v) => { failList = v; }, detail, time: (t) => { clock = t; }, now: () => clock };
}

test('no token file or empty token: feature off, nothing fetched', async () => {
  for (const token of [null, '  ']) { const r = await rig({ token }); assert.equal(r.poller.enabled, false); await r.poller.tick(); assert.equal(r.urls.length, 0); }
});
test('baseline skips old issues but opens fatal / >=10 events/h ones', async () => {
  const r = await rig(); const old = (o) => issue({ firstSeen: iso(T0 - 5 * 3600e3), ...o });
  r.set([old({ id: '1' }), old({ id: '2', level: 'fatal' }), old({ id: '3', stats: { '1h': [[1, 12]] } })]);
  await r.poller.tick(); await r.resolver.settle();
  assert.deepEqual(r.incs().map((i) => i.meta.issueId).sort(), ['2', '3']);
  assert.equal(r.incs().find((i) => i.meta.issueId === '2').meta.title, 'TypeError: x is undefined');
});
test('new fatal -> critical, one card with frames and allow-listed link; new error -> other; dedupe on 2nd poll', async () => {
  const r = await rig(); r.set([]); await r.poller.tick();
  r.set([issue({ id: '7', level: 'fatal' }), issue({ id: '8' })]);
  await r.poller.tick(); await r.poller.tick(); await r.resolver.settle();
  assert.equal(r.incs().length, 2); assert.equal(r.creates.length, 2);
  assert.deepEqual(r.creates.map((c) => c.ch).sort(), ['critical', 'other']);
  const txt = JSON.stringify(r.creates[0].body);
  assert.match(txt, /src\/a\.ts:10 run/); assert.ok(!/lib\/x\.js/.test(txt), 'non in-app frame left out');
  assert.match(txt, /href=\\"https:\/\/geta-ai-cj\.sentry\.io\/issues\/101\/\\"|href=\\"https:\/\/geta-ai-cj\.sentry\.io\/issues\//);
  assert.ok(r.incs()[0].meta.frames.some((f) => f.includes('<b>')), 'evidence kept as plain text for the CLI');
});
test('spike on a known issue goes to critical; a quiet known issue does nothing', async () => {
  const r = await rig(); r.set([issue({ id: '9', firstSeen: iso(T0 - 3 * 3600e3) })]); await r.poller.tick(); await r.resolver.settle();
  assert.equal(r.incs().length, 0);
  r.set([issue({ id: '9', firstSeen: iso(T0 - 3 * 3600e3), stats: { '1h': [[1, 25]] } })]); await r.poller.tick(); await r.resolver.settle();
  assert.equal(r.incs().length, 1); assert.equal(r.creates[0].ch, 'critical'); assert.equal(r.incs()[0].meta.rule, 'spike');
});
test('token never in logs, cards or incident view; sent only as Bearer', async () => {
  const r = await rig(); r.set([]); await r.poller.tick(); r.set([issue()]); await r.poller.tick(); r.fail(true); await r.poller.tick(); await r.resolver.settle();
  const all = JSON.stringify([r.logs, r.creates, r.updates, r.posts, r.resolver.listFull()]);
  assert.ok(!all.includes(TOKEN)); assert.ok(r.urls.every((u) => u.auth === `Bearer ${TOKEN}`));
  assert.ok(r.logs.some((l) => l.evt === 'sentry_poll_failed' && l.err === 500));
});
test('hostile title/culprit/frames are escaped in the card; foreign link dropped', async () => {
  const r = await rig(); r.set([]); await r.poller.tick();
  r.set([issue({ title: '<a href="http://evil">x</a> @all\u0007', culprit: '<script>', permalink: 'https://evil.example/issues/1/' })]);
  await r.poller.tick(); await r.resolver.settle();
  const txt = JSON.stringify(r.creates[0].body);
  assert.ok(!txt.includes('<script>') && !txt.includes('<a href=\\"http://evil') && !txt.includes('evil.example') && !txt.includes('\u0007'));
  assert.match(txt, /&lt;script&gt;/); assert.equal(r.incs()[0].meta.url, '');
});
test('failing fetch leaves state unchanged (no baseline, no incident)', async () => {
  const r = await rig(); r.fail(true); await r.poller.tick();
  r.fail(false); r.set([issue({ id: '5', firstSeen: iso(T0 - 5 * 3600e3) })]); await r.poller.tick(); await r.resolver.settle();
  assert.equal(r.incs().length, 0, 'first successful poll is still the baseline');
});
test('resolve flow: PR + release live, Sentry quiet 15 min -> RESOLVED; regression then reopens', async () => {
  const r = await rig(); r.set([]); await r.poller.tick(); r.set([issue()]); await r.poller.tick(); await r.resolver.settle();
  const id = r.incs()[0].id; await r.resolver.claim(id, 'asha'); await r.resolver.raisePr(id, 'asha', { url: 'https://github.com/lakshyatyagi241/threadwise/pull/9', number: 9, summary: 'fix' });
  await r.resolver.setRelease('abc1234', [9]); assert.equal(r.resolver.get(id).status, 'released');
  r.time(T0 + 5 * 60e3); await r.poller.tick(); assert.equal(r.resolver.get(id).status, 'released', 'not quiet long enough');
  r.detail['101'] = { status: 'unresolved', lastSeen: iso(T0) }; r.time(T0 + 16 * 60e3); await r.poller.tick();
  assert.equal(r.resolver.get(id).status, 'resolved'); assert.equal(r.resolver.get(id).resolution.kind, 'pr');
  assert.match(JSON.stringify(r.updates.at(-1)), /RESOLVED/);
  // same issue regresses after resolution: new incident
  r.set([issue({ substatus: 'regressed', lastSeen: iso(T0 + 17 * 60e3), firstSeen: iso(T0 - 3600e3) })]); r.time(T0 + 18 * 60e3);
  await r.poller.tick(); await r.resolver.settle();
  assert.equal(r.incs().length, 2); await r.poller.tick(); await r.resolver.settle(); assert.equal(r.incs().length, 2, 'still deduped while open');
});
test('Sentry shows it resolved right after release -> RESOLVED; resolved in Sentry with no PR -> says by whom', async () => {
  const r = await rig(); r.set([]); await r.poller.tick(); r.set([issue(), issue({ id: '102', shortId: 'WEB-2', permalink: 'https://geta-ai-cj.sentry.io/issues/102/' })]); await r.poller.tick(); await r.resolver.settle();
  const [a, b] = r.incs(); await r.resolver.claim(a.id, 'asha'); await r.resolver.raisePr(a.id, 'asha', { url: 'https://github.com/lakshyatyagi241/threadwise/pull/9', number: 9, summary: 'fix' });
  await r.resolver.setRelease('abc1234', [9]);
  r.detail['101'] = { status: 'resolved', lastSeen: iso(T0 + 1e3) }; r.detail['102'] = { status: 'resolved', lastSeen: iso(T0), activity: [{ type: 'set_resolved', user: { name: 'Priya' } }] };
  r.time(T0 + 60e3); r.set([]); await r.poller.tick();
  assert.equal(r.resolver.get(a.id).status, 'resolved'); assert.equal(r.resolver.get(b.id).resolution.by, 'Priya');
  assert.match(JSON.stringify(r.updates.at(-1)), /Resolved in Sentry by Priya|RESOLVED/);
});
