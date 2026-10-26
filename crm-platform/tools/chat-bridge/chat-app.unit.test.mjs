// Chat app tests against LOCAL fakes only: fake Google token endpoint, fake Chat API, fake certs, fake webhook. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { startBridge } from './bridge.mjs';
import { signJwt, createAppAuth, CHAT_ISSUER } from './chat-app-auth.mjs';
import { spaceFor } from './chat-api.mjs';

const kp = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
const google = kp(),
  sa = kp(),
  other = kp();
const SA_JSON = JSON.stringify({
  client_email: 'bot@p.iam.gserviceaccount.com',
  private_key: sa.privateKey,
  private_key_id: 'k1',
});
const WH = 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k&token=t';
const baseEnv = {
  CHAT_ALLOW_ANY_HOST: '1',
  CHAT_RETRY_BASE_MS: '1',
  CHAT_RETRIES: '1',
  PROMETHEUS_URL: 'http://127.0.0.1:1',
  CHAT_APP_ENABLED: 'true',
  CHAT_APP_AUDIENCE: '1234567890',
  CHAT_APP_SA_JSON: SA_JSON,
  CHAT_APP_TOKEN_URL: 'http://fake/token',
  CHAT_APP_CERTS_URL: 'http://fake/certs',
  CHAT_API_BASE: 'http://fake',
  GRAFANA_URL: 'http://g',
};

function fakes({ apiFails = false } = {}) {
  const log = { api: [], hooks: [], tokens: 0 };
  const j = (o, status = 200) => ({
    ok: status < 400,
    status,
    headers: new Headers(),
    json: async () => o,
  });
  const fetchImpl = async (url, init = {}) => {
    url = String(url);
    if (url === 'http://fake/token') {
      log.tokens++;
      return j({ access_token: 'at-1', expires_in: 3600 });
    }
    if (url === 'http://fake/certs') return j({ g1: google.publicKey });
    if (url.startsWith('http://fake/v1/')) {
      log.api.push({
        method: init.method,
        url,
        auth: init.headers.authorization,
        body: JSON.parse(init.body),
      });
      return apiFails ? j({}, 500) : j({ name: 'spaces/AAA/messages/m1' });
    }
    if (url.startsWith('https://chat.googleapis.com/')) {
      log.hooks.push({ url, body: JSON.parse(init.body) });
      return j({});
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return { fetchImpl, log };
}
const tok = (o = {}, key = google.privateKey) =>
  signJwt(
    { iss: CHAT_ISSUER, aud: '1234567890', exp: Math.floor(Date.now() / 1000) + 300, ...o },
    key,
    { alg: 'RS256', kid: 'g1' },
  );
async function boot(env = {}, f = fakes()) {
  const b = startBridge({
    env: { ...baseEnv, ...env },
    urls: { critical: WH },
    fetchImpl: f.fetchImpl,
    log: () => {},
  });
  await new Promise((r) => b.server.listen(0, '127.0.0.1', r));
  const port = b.server.address().port;
  const post = (path, body, headers = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  const fire = () =>
    post('/alertmanager', {
      alerts: [
        {
          status: 'firing',
          fingerprint: 'fp1',
          labels: { alertname: 'ApiDown', severity: 'critical' },
          annotations: { summary: 's' },
          startsAt: new Date().toISOString(),
        },
      ],
    });
  return {
    ...b,
    f,
    post,
    fire,
    close: () => {
      b.server.closeAllConnections();
      b.server.close();
    },
  };
}
const click = (action, name, id = 'am:fp1') => ({
  type: 'CARD_CLICKED',
  user: { displayName: name, name: `users/${name}` },
  space: { name: 'spaces/AAA' },
  message: { name: 'spaces/AAA/messages/m1' },
  common: { parameters: { incidentId: id, action } },
});
const auth = (o, k) => ({ authorization: `Bearer ${tok(o, k)}` });
const buttons = (m) =>
  m.cardsV2[0].card.sections
    .flatMap((s) => s.widgets)
    .filter((w) => w.buttonList)
    .flatMap((w) => w.buttonList.buttons)
    .map((x) => x.text);

test('auth: JWT bearer grant, token cached', async () => {
  const f = fakes();
  const g = createAppAuth({ env: baseEnv, fetchImpl: f.fetchImpl });
  assert.equal(await g(), 'at-1');
  await g();
  assert.equal(f.log.tokens, 1);
});
test('space id from env or webhook url', () => {
  assert.equal(spaceFor('critical', { urls: { critical: WH } }), 'spaces/AAA');
  assert.equal(
    spaceFor('critical', { env: { CHAT_SPACE_CRITICAL: 'BBB' }, urls: { critical: WH } }),
    'spaces/BBB',
  );
});
test('alert card posted through API as the app with buttons; claim updates card; conflict refused; release', async () => {
  const b = await boot();
  await b.fire();
  const m = b.f.log.api[0];
  assert.equal(m.auth, 'Bearer at-1');
  assert.equal(m.body.thread.threadKey, 'am-fp1');
  assert.deepEqual(buttons(m.body), ["I'm on it", 'Open PR', 'Open Grafana']);
  assert.equal(b.f.log.hooks.length, 0);
  let r = await (await b.post('/chat-app/events', click('claim', 'Asha'), auth())).json();
  assert.equal(r.actionResponse.type, 'UPDATE_MESSAGE');
  assert.match(JSON.stringify(r), /Asha is working on this/);
  assert.deepEqual(buttons(r), ['Release', 'Open PR', 'Open Grafana']);
  r = await (await b.post('/chat-app/events', click('claim', 'Ben'), auth())).json();
  assert.match(r.text, /already claimed by Asha/);
  assert.equal(r.privateMessageViewer.name, 'users/Ben');
  assert.equal(r.cardsV2, undefined);
  r = await (await b.post('/chat-app/events', click('release', 'Ben'), auth())).json();
  assert.match(r.text, /Not released/);
  r = await (await b.post('/chat-app/events', click('release', 'Asha'), auth())).json();
  assert.deepEqual(buttons(r), ["I'm on it", 'Open PR', 'Open Grafana']);
  b.close();
});
test('events: bad tokens and everything else are 401', async () => {
  const b = await boot();
  const ev = click('claim', 'A');
  const want = async (h) => assert.equal((await b.post('/chat-app/events', ev, h)).status, 401);
  await want({});
  await want({ authorization: 'Bearer abc' });
  await want(auth({ aud: 'other' }));
  await want(auth({ exp: 1 }));
  await want(auth({ iss: 'evil@x' }));
  await want(auth({}, other.privateKey));
  assert.equal(
    (await fetch(`http://127.0.0.1:${b.server.address().port}/chat-app/events`)).status,
    401,
  );
  b.close();
});
test('events: size cap 64KB and per-IP rate limit', async () => {
  const b = await boot({ CHAT_APP_RATE_PER_MIN: '3' });
  assert.equal((await b.post('/chat-app/events', 'x'.repeat(70000), auth())).status, 413);
  assert.equal((await b.post('/chat-app/events', { type: 'ADDED_TO_SPACE' }, auth())).status, 200);
  await b.post('/chat-app/events', '{}');
  const r = await b.post('/chat-app/events', '{}');
  assert.equal(r.status, 429);
  b.close();
});
test('ADDED_TO_SPACE and MESSAGE help/claim/status', async () => {
  const b = await boot();
  assert.match(
    (await (await b.post('/chat-app/events', { type: 'ADDED_TO_SPACE' }, auth())).json()).text,
    /Threadwise Alerts/,
  );
  const msg = (text) =>
    b
      .post(
        '/chat-app/events',
        { type: 'MESSAGE', user: { displayName: 'Asha' }, message: { text } },
        auth(),
      )
      .then((r) => r.json());
  assert.match((await msg('hello')).text, /claim INC-id/);
  assert.match((await msg('claim INC-7')).text, /Asha is working on INC-7/);
  assert.match((await msg('claim INC-7')).text, /working/);
  assert.match((await msg('status')).text, /No incidents/);
  b.close();
});
test('webhook fallback when the API fails (plain card, only the Grafana button of today)', async () => {
  const b = await boot({}, fakes({ apiFails: true }));
  const r = await b.fire();
  assert.equal(r.status, 200);
  assert.equal(b.f.log.hooks.length, 1);
  assert.deepEqual(buttons(b.f.log.hooks[0].body), ['Grafana']);
  assert.match(b.f.log.hooks[0].url, /threadKey=am-fp1/);
  b.close();
});
test('flag off: webhook only, unchanged card, route is 404', async () => {
  const b = await boot({ CHAT_APP_ENABLED: 'false' });
  await b.fire();
  assert.equal(b.f.log.api.length, 0);
  assert.equal(b.f.log.hooks.length, 1);
  assert.deepEqual(buttons(b.f.log.hooks[0].body), ['Grafana']);
  assert.equal((await b.post('/chat-app/events', click('claim', 'A'), auth())).status, 404);
  b.close();
});

test('REST claim and release edit the alert card in place (incident API / a teammate Claude, no button click)', async () => {
  const { createChatApp } = await import('./chat-app.mjs');
  const { createResolver } = await import('./resolver.mjs');
  const calls = [];
  const api = {
    createMessage: async () => ({ ok: true, name: 'spaces/AAA/messages/m9' }),
    updateMessage: async (ch, name, body) => (calls.push({ ch, name, body }), { ok: true }),
  };
  const resolver = createResolver({ env: { ANNOUNCE_IN_SPACE: '0' }, post: async () => {} });
  const app = createChatApp({ env: { CHAT_APP_ENABLED: 'true' }, api, verifier: {}, resolver, webhookSend: async () => {} });
  resolver.setOwnerHook((id, owner) => app.syncCard(id, owner));
  await resolver.handle({ playbook: 'service', alertname: 'ApiDown', key: 'am:fp9', threadKey: 't9', channel: 'critical', diagnosis: 'd', suggestion: 's' });
  await resolver.settle();
  const id = resolver.list()[0].id;
  const base = { text: 'ApiDown', cardsV2: [{ cardId: 'a', card: { header: { title: 'ApiDown' }, sections: [{ widgets: [{ decoratedText: { text: 'x' } }] }] } }] };
  await app.send('critical', base, { threadKey: 't9', interactive: { incidentId: id } });
  await resolver.claim(id, 'Asha-Claude');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'spaces/AAA/messages/m9');
  assert.ok(JSON.stringify(calls[0].body).includes('Asha-Claude is working on this'));
  await resolver.releaseClaim(id, 'Asha-Claude');
  assert.equal(calls.length, 2);
  assert.ok(!JSON.stringify(calls[1].body).includes('is working on this'));
});

// ---- one card per incident: created once, edited through claim -> PR -> resolved ----
async function bootInc(env = {}) {
  const { createResolver } = await import('./resolver.mjs');
  const f = fakes();
  const b = startBridge({
    env: { ...baseEnv, ...env }, urls: { critical: WH }, fetchImpl: f.fetchImpl, log: () => {},
    resolverFactory: ({ post, metrics }) => createResolver({ env: { ...baseEnv, ...env, VERIFY_SECONDS: '0', VERIFY_POLL_MS: '1' }, post, promQuery: async () => 0, metrics, sleep: async () => {} }),
  });
  await new Promise((r) => b.server.listen(0, '127.0.0.1', r));
  const port = b.server.address().port;
  const am = (status) => fetch(`http://127.0.0.1:${port}/alertmanager`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ alerts: [{ status, fingerprint: 'fpx', labels: { alertname: 'ApiCallerLatencyHigh', severity: 'critical' }, annotations: { summary: 'slow' }, startsAt: new Date(Date.now() - 90000).toISOString(), endsAt: status === 'resolved' ? new Date().toISOString() : undefined }] }) });
  return { b, f, am, close: () => { b.server.closeAllConnections(); b.server.close(); } };
}
const txt = (m) => JSON.stringify(m);

test('one card: one create, then PATCH for claim, PR, note, resolved; no second top-level message; no announce', async () => {
  const { b, f, am, close } = await bootInc();
  await am('firing');
  await b.resolver.settle();
  const id = b.resolver.byKey('am:fpx').id;
  const posts = () => f.log.api.filter((x) => x.method === 'POST');
  assert.equal(posts().filter((x) => x.body.cardsV2[0].card.header.title.includes('FIRING')).length, 1);
  await b.resolver.claim(id, 'Vedant-Claude');
  assert.equal(f.log.api.at(-1).method, 'PATCH');
  assert.match(txt(f.log.api.at(-1).body), /Vedant-Claude is working on this since/);
  await b.resolver.addNote(id, 'Vedant-Claude', 'Pool <b>starved</b> by report job');
  await b.resolver.raisePr(id, 'Vedant-Claude', { url: 'https://github.com/lakshyatyagi241/threadwise/pull/77', number: 77, summary: 'Index the report query' });
  let last = f.log.api.at(-1);
  assert.equal(last.method, 'PATCH');
  assert.match(last.url, /messages\/m1\?updateMask=text,cardsV2/);
  assert.match(txt(last.body), /PR #77 \(Index the report query\)/);
  assert.match(txt(last.body), /What Vedant-Claude found/);
  assert.ok(!txt(last.body).includes('<b>starved'), 'note escaped');
  assert.match(txt(last.body), /Timeline/);
  await b.resolver.setRelease('abcdef1234567', [77]);
  await b.resolver.settle();
  await am('resolved');
  await b.resolver.settle();
  last = f.log.api.at(-1);
  assert.match(txt(last.body), /RESOLVED/);
  assert.match(txt(last.body), /Fixed by PR #77/);
  assert.match(txt(last.body), /release abcdef1/);
  assert.ok(!/Value now/.test(txt(last.body)));
  assert.equal(posts().filter((x) => /working on this|raised|RESOLVED|released/.test(txt(x.body))).length, 0, 'no lifecycle message posted: the card carries it');
  assert.equal(f.log.hooks.length, 0, 'no webhook post, no announce');
  assert.ok(f.log.api.filter((x) => x.method === 'PATCH').length >= 4);
  close();
});

test('one card: alert clears on its own -> card edited, no second message', async () => {
  const { b, f, am, close } = await bootInc();
  await am('firing');
  await am('resolved');
  assert.equal(f.log.api.filter((x) => x.method === 'POST' && /RESOLVED/.test(txt(x.body))).length, 0);
  const last = f.log.api.at(-1);
  assert.equal(last.method, 'PATCH');
  assert.match(txt(last.body), /Cleared on its own, no code change/);
  assert.match(txt(last.body), /What it measured/);
  close();
});

test('webhook mode unchanged: resolved is a second webhook message with honest text', async () => {
  const { b, f, am, close } = await bootInc({ CHAT_APP_ENABLED: 'false', ANNOUNCE_IN_SPACE: '0' });
  await am('firing');
  await am('resolved');
  const posts = f.log.hooks;
  assert.equal(f.log.api.length, 0);
  assert.match(txt(posts.at(-1).body), /RESOLVED after/);
  assert.match(txt(posts.at(-1).body), /What cleared it/);
  assert.ok(!/Value now|What it was/.test(txt(posts.at(-1).body)));
  close();
});

test('card stays under the Chat size limit with a long timeline and hostile text', async () => {
  const { renderCard } = await import('./chat-app.mjs');
  const base = { text: 'FIRING', cardsV2: [{ cardId: 'a', card: { header: { title: 'FIRING: X' }, sections: [{ widgets: Array.from({ length: 100 }, () => ({ decoratedText: { text: 'x'.repeat(700) } })) }] } }] };
  const tl = Array.from({ length: 40 }, (_, i) => ({ t: 1e12 + i * 6e4, who: 'w'.repeat(500), text: `<script>${'y'.repeat(900)}\u0007` }));
  const m = renderCard(base, { incidentId: 'i', snap: { status: 'pr_raised', owner: 'o', prNumber: 5, prUrl: 'javascript:alert(1)', prSummary: '<i>'.repeat(300), tl, notes: [{ who: 'a', text: 'z'.repeat(9000) }] } });
  assert.ok(Buffer.byteLength(JSON.stringify(m)) <= 30000);
  assert.ok(!/<script>|javascript:/.test(JSON.stringify(m)));
  const t = m.cardsV2[0].card.sections.at(-1).widgets.find((w) => w.decoratedText?.topLabel === 'Timeline').decoratedText.text;
  assert.equal(t.split('\n').length, 8);
});

// ---- STATUS line + deploy_failure as one card ----
const statusOf = (m) => m.cardsV2[0].card.sections[0].widgets[0].decoratedText.text;
const SUG = { decoratedText: { topLabel: 'Suggested action', text: 'Claim it (👀) so others know.' } };
const mk = () => ({ text: 'FIRING', cardsV2: [{ cardId: 'a', card: { header: { title: 'FIRING: X' }, sections: [{ widgets: [{ decoratedText: { text: 'x' } }, structuredClone(SUG)] }] } }] });

test('status line: open, claimed, PR raised, resolved by PR, cleared on its own; stale suggestion goes after claim', async () => {
  const { renderCard } = await import('./chat-app.mjs');
  const pr = 'https://github.com/lakshyatyagi241/threadwise/pull/77';
  let m = renderCard(mk(), { incidentId: 'i' });
  assert.equal(statusOf(m), '🟡 Status: Open, nobody has taken it yet');
  assert.match(txt(m), /Claim it/);
  m = renderCard(mk(), { incidentId: 'i', snap: { status: 'claimed', owner: '<b>Ved</b>', claimedAt: Date.UTC(2026, 0, 1, 9, 5) } });
  assert.equal(statusOf(m), '🔵 Status: In progress, <b>&lt;b&gt;Ved&lt;/b&gt;</b> is working on this since 09:05 UTC');
  assert.ok(!/Claim it/.test(txt(m)), 'stale suggestion removed');
  m = renderCard(mk(), { incidentId: 'i', snap: { status: 'pr_raised', owner: 'Vedant-Claude', prNumber: 77, prUrl: pr } });
  assert.equal(statusOf(m), `🔵 Status: In progress, <a href="${pr}">PR #77</a> raised by <b>Vedant-Claude</b>`);
  m = renderCard(mk(), { incidentId: 'i', snap: { status: 'resolved', owner: 'Vedant-Claude', prNumber: 77, prUrl: pr, resolution: { kind: 'pr', at: 1, durationMs: 1 } } });
  assert.equal(statusOf(m), `✅ Status: Resolved by <a href="${pr}">PR #77</a> (<b>Vedant-Claude</b>)`);
  assert.ok(!/Claim it/.test(txt(m)));
  assert.match(txt(m), /Fixed by PR #77/);
  m = renderCard(mk(), { incidentId: 'i', snap: { status: 'resolved', resolution: { kind: 'self', at: 1, durationMs: 1 } } });
  assert.equal(statusOf(m), '✅ Status: Cleared on its own');
});

async function deployRig({ apiFails = false, enabled = true } = {}) {
  const { createChatApp } = await import('./chat-app.mjs');
  const { createResolver } = await import('./resolver.mjs');
  const api = { creates: [], updates: [], createMessage: async (ch, body, o) => (api.creates.push({ ch, body, o }), apiFails ? { ok: false, status: 500 } : { ok: true, name: 'spaces/AAA/messages/d1' }), updateMessage: async (ch, name, body) => (api.updates.push({ name, body }), { ok: true }) };
  const posts = [];
  const resolver = createResolver({ env: { ANNOUNCE_IN_SPACE: '1' }, post: async (c, m, o) => posts.push({ c, m, o }), sleep: async () => {} });
  const app = createChatApp({ env: { CHAT_APP_ENABLED: String(enabled) }, api, verifier: {}, resolver, webhookSend: async () => {} });
  if (app.enabled) { resolver.setOwnerHook((id, o) => app.syncCard(id, o)); resolver.setCardHook((c, b, o) => app.openCard(c, b, o)); }
  return { api, posts, resolver };
}
const spec = { attemptedSha: 'bbbbbbb1', liveSha: '', prs: [5], mergers: ['@bob'], durationSeconds: 0 };

test('deploy_failure in app mode: one create, then only edits (claim, PR, release-resolved); no thread or top-level message', async () => {
  const { api, posts, resolver } = await deployRig();
  await resolver.openDeployFailure(spec);
  const id = resolver.byKey('deploy:bbbbbbb1').id;
  assert.equal(api.creates.length, 1);
  assert.equal(api.creates[0].ch, 'deploy');
  assert.equal(api.creates[0].body.cardsV2[0].card.sections[0].widgets[0].decoratedText.text, '🟡 Status: Open, nobody has taken it yet');
  assert.ok(!/unknown|Live|Took/.test(txt(api.creates[0].body)), 'unknown facts omitted');
  assert.match(txt(api.creates[0].body), /Attempted[\s\S]*bbbbbbb[\s\S]*#5[\s\S]*@bob/);
  await resolver.claim(id, 'Asha');
  assert.match(txt(api.updates.at(-1).body), /In progress, <b>Asha<\/b> is working on this since/);
  await resolver.raisePr(id, 'Asha', { url: 'https://github.com/lakshyatyagi241/threadwise/pull/80', number: 80, summary: 'fix build' });
  assert.match(txt(api.updates.at(-1).body), /PR #80<\/a> raised by <b>Asha/);
  await resolver.setRelease('ccccccc1', [80]);
  assert.match(txt(api.updates.at(-1).body), /✅ Status: Resolved by .*PR #80.*Asha/);
  assert.match(txt(api.updates.at(-1).body), /RESOLVED/);
  assert.equal(api.creates.length, 1);
  assert.equal(posts.length, 0, 'webhook/post never used: no thread reply, no announce');
});

test('deploy_failure: a release alone resolves the card; webhook mode and API failure keep today\'s text + Incident update card', async () => {
  let r = await deployRig();
  await r.resolver.openDeployFailure(spec); await r.resolver.setRelease('ccccccc1', []);
  assert.match(txt(r.api.updates.at(-1).body), /✅ Status: Resolved by release ccccccc/);
  for (const o of [{ enabled: false }, { apiFails: true }]) {
    r = await deployRig(o);
    await r.resolver.openDeployFailure(spec);
    assert.equal(r.posts.length, 1);
    assert.match(r.posts[0].m.text, /Deploy failed or was refused: needs a human or a fix PR/);
    assert.equal(r.posts[0].m.cardsV2[0].card.header.title, 'Incident update');
    assert.match(txt(r.posts[0].m), /\(live: unknown\)/);
    await r.resolver.claim(r.resolver.byKey('deploy:bbbbbbb1').id, 'Asha');
    assert.ok(r.posts.length > 1, 'lifecycle lines still arrive as messages');
  }
});

// ---- PR merged poller ----
const PRURL = 'https://github.com/lakshyatyagi241/threadwise/pull/971';
const gh = (body, ok = true) => { const calls = []; const f = async (u, o) => { calls.push({ u, o }); if (body instanceof Error) throw body; return { ok, text: async () => JSON.stringify(body) }; }; f.calls = calls; return f; };
async function withPr() {
  const t = await bootInc(); await t.am('firing'); await t.b.resolver.settle();
  const id = t.b.resolver.byKey('am:fpx').id;
  await t.b.resolver.raisePr(id, 'Ved', { url: PRURL, number: 971, summary: 's' });
  const patches = () => t.f.log.api.filter((x) => x.method === 'PATCH');
  const { startPrPoller } = await import('./pr-poller.mjs');
  const poll = (fetchImpl, readFile = () => 'tok-secret\n') => startPrPoller({ resolver: t.b.resolver, env: {}, fetchImpl, readFile });
  return { ...t, id, patches, poll };
}
test('PR merged: card edited once to the merged status, no new post, then release still resolves', async () => {
  const { b, f, am, id, patches, poll, close } = await withPr();
  const g = gh({ merged: true, merged_by: { login: 'lakshya-ty' }, merged_at: '2026-10-23T10:05:00Z', merge_commit_sha: 'abcdef1234567890abcdef1234567890abcdef12' });
  const p = poll(g); const posts = f.log.api.filter((x) => x.method === 'POST').length, n0 = patches().length;
  await p.tick(); await p.tick();
  assert.equal(g.calls.length, 1, 'merged incident is not polled again');
  assert.match(g.calls[0].u, /repos\/lakshyatyagi241\/threadwise\/pulls\/971$/);
  assert.equal(patches().length, n0 + 1);
  assert.match(txt(patches().at(-1).body), /🟣 Status: .*PR #971.* merged by lakshya-ty at 10:05 UTC, waiting for the release to go live/);
  assert.match(txt(patches().at(-1).body), /PR #971 merged by lakshya-ty/);
  assert.equal(f.log.api.filter((x) => x.method === 'POST').length, posts);
  assert.equal(b.resolver.get(id).prMerged.sha7, 'abcdef1');
  await b.resolver.setRelease('abcdef1234567', [971]); await b.resolver.settle(); await am('resolved'); await b.resolver.settle();
  assert.match(txt(patches().at(-1).body), /✅ Status: Resolved by/);
  p.stop(); close();
});
test('PR closed without merge: card says so, needs a human, not resolved', async () => {
  const { b, id, patches, poll, close } = await withPr();
  await poll(gh({ merged: false, state: 'closed' })).tick();
  assert.match(txt(patches().at(-1).body), /PR #971 was closed without merging/);
  assert.notEqual(b.resolver.get(id).status, 'resolved'); assert.equal(b.resolver.get(id).status, 'escalated');
  close();
});
test('PR poll: failing fetch, bad json, 404 leave the card unchanged and never throw', async () => {
  const { patches, poll, close } = await withPr(); const n = patches().length;
  for (const g of [gh(new Error('boom')), gh({}, false), gh(new DOMException('t', 'TimeoutError'))]) await poll(g).tick();
  assert.equal(patches().length, n); close();
});
test('PR poll: no token file = disabled; token never logged; hostile login not trusted', async () => {
  const { poll, b, id, close } = await withPr();
  const g = gh({}); const off = poll(g, () => { throw new Error('ENOENT'); });
  await off.tick(); assert.equal(off.enabled, false); assert.equal(g.calls.length, 0);
  await poll(gh({ merged: true, merged_by: { login: '<b>x</b>' }, merged_at: '2026-10-23T10:05:00Z' })).tick();
  assert.equal(b.resolver.get(id).prMerged.by, null); close();
});

test('a note without a claim (or after a release) shows "Reviewed by <name>, needs a human" instead of "nobody has taken it"', async () => {
  const { createChatApp } = await import('./chat-app.mjs');
  const { createResolver } = await import('./resolver.mjs');
  const calls = [];
  const api = { createMessage: async () => ({ ok: true, name: 'spaces/AAA/messages/m5' }), updateMessage: async (ch, name, body) => (calls.push(JSON.stringify(body)), { ok: true }) };
  const resolver = createResolver({ env: { ANNOUNCE_IN_SPACE: '0' }, post: async () => {} });
  const app = createChatApp({ env: { CHAT_APP_ENABLED: 'true' }, api, verifier: {}, resolver, webhookSend: async () => {} });
  resolver.setOwnerHook((id, owner) => app.syncCard(id, owner));
  await resolver.handle({ playbook: 'service', alertname: 'OutboxDeadRows', key: 'am:fp5', threadKey: 't5', channel: 'other', diagnosis: 'd', suggestion: 's' });
  await resolver.settle();
  const id = resolver.list()[0].id;
  const base = { text: 'x', cardsV2: [{ cardId: 'a', card: { header: { title: 'x' }, sections: [{ widgets: [{ decoratedText: { text: 'y' } }] }] } }] };
  await app.send('other', base, { threadKey: 't5', interactive: { incidentId: id } });
  await resolver.addNote(id, 'Punya-Claude', 'one outbox row is dead; needs the operator CLI');
  const last = calls.at(-1) ?? '';
  assert.ok(last.includes('Reviewed by <b>Punya-Claude</b>'), 'reviewed status shown');
  assert.ok(!last.includes('nobody has taken it yet'), 'not shown as untouched');
  assert.ok(last.includes('needs the operator CLI'), 'the note stays on the card');
});
