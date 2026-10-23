import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeName, normalizeUrl, doctor, init, validName } from './incident-setup.mjs';

const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'setup-'));
const writeCfg = (h, text, mode = 0o600) => { const f = path.join(h, '.config/threadwise/incidents.env'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); fs.chmodSync(f, mode); return f; };
const fake = (handler) => new Promise((r) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => r({ s, url: `http://127.0.0.1:${s.address().port}` })); });
const SECRET = 'S3cr3t-pw', TOKEN = 'T0k3n-xyz';

test('sanitizeName / validName / normalizeUrl', () => {
  assert.equal(sanitizeName('Vedant (Claude)'), 'Vedant-Claude');
  assert.equal(sanitizeName('Asha Rao'), 'Asha-Rao-Claude');
  assert.equal(sanitizeName(''), 'me-Claude');
  assert.ok(validName(sanitizeName('x'.repeat(80))) && sanitizeName('x'.repeat(80)).length <= 40);
  assert.equal(validName('Vedant (Claude)'), false);
  assert.deepEqual(normalizeUrl('https://h.example/incidents/'), { url: 'https://h.example', stripped: true });
  assert.deepEqual(normalizeUrl('https://h.example/'), { url: 'https://h.example', stripped: false });
});

test('doctor: ok path counts owners, warns on mode and /incidents, never prints secrets', async () => {
  const h = home(), seen = [];
  const { s, url } = await fake((q, res) => { seen.push(q.headers); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ incidents: [{ id: 'a', status: 'open' }, { id: 'b', status: 'claimed', owner: 'Asha-Claude' }] })); });
  writeCfg(h, `INCIDENT_API_URL=${url}/incidents\nINCIDENT_API_USER=incidents\nINCIDENT_API_PASSWORD=${SECRET}\nINCIDENT_API_TOKEN=${TOKEN}\nINCIDENT_WHO=Vedant-Claude\n`, 0o644);
  const lines = []; const code = await doctor({ HOME: h }, (l) => lines.push(l));
  const text = lines.join('\n');
  assert.equal(code, 0); assert.match(text, /chmod 600/); assert.match(text, /host only/); assert.match(text, /1 open, 1 claimed/); assert.match(text, /b {2}claimed {2}owner=Asha-Claude/);
  assert.ok(!text.includes(SECRET) && !text.includes(TOKEN));
  assert.equal(seen[0]['x-incident-token'], TOKEN);
  s.close();
});

test('doctor: 401 vs 403 vs network error vs bad name', async () => {
  const h = home(); let status = 401;
  const { s, url } = await fake((q, res) => { res.statusCode = status; res.end('{}'); });
  writeCfg(h, `INCIDENT_API_URL=${url}\nINCIDENT_API_PASSWORD=${SECRET}\nINCIDENT_API_TOKEN=${TOKEN}\nINCIDENT_WHO=Vedant (Claude)\n`);
  const run = async () => { const l = []; const c = await doctor({ HOME: h }, (x) => l.push(x)); return { c, t: l.join('\n') }; };
  let r = await run(); assert.equal(r.c, 1); assert.match(r.t, /401: the login/); assert.match(r.t, /Suggestion: INCIDENT_WHO=Vedant-Claude/);
  status = 403; r = await run(); assert.match(r.t, /403: the login passed but INCIDENT_API_TOKEN/);
  s.close();
  r = await run(); assert.match(r.t, /cannot reach .*not a password problem/); assert.ok(!r.t.includes(SECRET) && !r.t.includes(TOKEN));
});

test('init writes mode 600, strips /incidents, sanitizes name, prints no secret', async () => {
  const h = home(), lines = [];
  const answers = ['https://x.example/incidents', 'Bad (Name)', ''];
  const code = await init({ HOME: h }, (l) => lines.push(l), async () => answers.shift(), async (q) => (/password/.test(q) ? SECRET : TOKEN));
  const f = path.join(h, '.config/threadwise/incidents.env'), body = fs.readFileSync(f, 'utf8');
  assert.equal(code, 0); assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  assert.match(body, /INCIDENT_API_URL=https:\/\/x\.example\n/); assert.match(body, /INCIDENT_WHO=Bad-Name-Claude\n/); assert.match(body, /INCIDENT_API_USER=incidents\n/);
  assert.ok(!lines.join('\n').includes(SECRET) && !lines.join('\n').includes(TOKEN));
});
