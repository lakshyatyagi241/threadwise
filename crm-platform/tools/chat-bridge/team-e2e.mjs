// Team-flow e2e: real bridge + real resolver + incident-cli as two separate processes against a local fake Chat receiver (random ports).
// Two identities race to claim: one wins. PR raised and RESOLVED-after-release are posted in the alert's thread. Exit 0 = pass.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { startBridge } from './bridge.mjs';
import { createResolver } from './resolver.mjs';

const got = [];
const chat = http.createServer(async (q, s) => { let b = ''; for await (const c of q) b += c; got.push({ thread: new URL(q.url, 'http://x').searchParams.get('threadKey'), text: JSON.parse(b).text }); s.end('{}'); });
await new Promise((r) => chat.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${chat.address().port}`, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-e2e-')), token = 'e2e-' + Math.random().toString(36).slice(2);
const env = { CHAT_ALLOW_ANY_HOST: '1', AUTO_REMEDIATE: 'on', VERIFY_SECONDS: '0', VERIFY_POLL_MS: '1', INCIDENTS_DIR: dir, INCIDENT_API_TOKEN: token, GCHAT_SLOWQUERY_URL: url, GCHAT_DEPLOY_URL: url };
const b = startBridge({ env, resolverFactory: ({ post }) => createResolver({ env, post, log: () => {} }), log: () => {} });
await new Promise((r) => b.server.listen(0, '127.0.0.1', r));
const api = `http://127.0.0.1:${b.server.address().port}`;
await b.resolver.handle({ playbook: 'code_fix', key: 'st:e2e', threadKey: 'am-e2e', channel: 'slowquery', file: { queryid: '1' }, diagnosis: 'slow statement' }); await b.resolver.settle();
const id = b.resolver.list()[0].id;
const cli = (who, ...a) => new Promise((res) => execFile('node', [new URL('./incident-cli.mjs', import.meta.url).pathname, ...a], { env: { PATH: process.env.PATH, HOME: dir, INCIDENT_API_URL: api, INCIDENT_API_TOKEN: token, INCIDENT_WHO: who } }, (e, out) => res({ code: e ? e.code : 0, out })));
try {
  const [x, y] = await Promise.all([cli('vedant', 'claim', id), cli('asha', 'claim', id)]);
  assert.deepEqual([x.code, y.code].sort(), [0, 1], 'exactly one claim wins');
  const winner = x.code === 0 ? 'vedant' : 'asha';
  assert.equal(got.filter((m) => /is working on this/.test(m.text)).length, 1);
  assert.ok(got.every((m) => m.thread === 'am-e2e'), 'every reply is in the alert thread');
  // loser of the race picks the next open incident instead (two teammates, two incidents)
  await b.resolver.handle({ playbook: 'code_fix', key: 'st:e2e2', threadKey: 'am-e2e2', channel: 'slowquery', file: { queryid: '2' }, diagnosis: 'second' }); await b.resolver.settle();
  const loser = winner === 'vedant' ? 'asha' : 'vedant', id2 = b.resolver.list().find((i) => i.id !== id).id;
  assert.equal((await cli(loser, 'claim', id2)).code, 0, 'loser claims the next incident');
  assert.equal((await cli(winner, 'claim', id2)).code, 1, 'and the winner cannot take that one');
  const p = await cli(winner, 'pr', id, 'https://github.com/lakshyatyagi241/threadwise/pull/4242?utm=x', 'add index on contacts');
  assert.equal(p.code, 0); assert.ok(got.some((m) => /PR #4242 raised by/.test(m.text) && !/utm/.test(m.text)));
  const rel = (sha, prs) => fetch(`${api}/release`, { method: 'POST', headers: { 'x-incident-token': token }, body: JSON.stringify({ sha, prs }) });
  const n0 = got.length; assert.equal((await rel('ffff000', [1, 2])).status, 200); await b.resolver.settle();
  assert.equal(got.length, n0, 'a release without the PR posts nothing'); assert.equal((await (await fetch(`${api}/incidents/${id}`, { headers: { 'x-incident-token': token } })).json()).status, 'pr_raised');
  assert.equal((await fetch(`${api}/release`, { method: 'POST', body: '{"sha":"abc1234","prs":[4242]}' })).status, 401);
  await rel('abc1234', [4242]); await b.resolver.statementRecovered('st:e2e'); await b.resolver.settle();
  const r = got.find((m) => /RESOLVED by PR #4242/.test(m.text));
  assert.ok(r && r.text.includes(`owner ${winner}`) && r.text.includes('abc1234') && r.thread === 'am-e2e', JSON.stringify(got.map((m) => m.text)));
  // deploy failure: one incident (deduped), a later live release resolves it
  const df = (body) => fetch(`${api}/incidents`, { method: 'POST', headers: { 'x-incident-token': token }, body: JSON.stringify({ kind: 'deploy_failure', attemptedSha: 'bad0001', liveSha: 'abc1234', prs: [7], mergers: ['bob'], durationSeconds: 60, ...body }) }).then((x) => x.json());
  const d1 = await df({}), d2 = await df({}); assert.equal(d1.id, d2.id); assert.equal(got.filter((m) => /Deploy failed or was refused/.test(m.text)).length, 1);
  await rel('fe00002', []); await b.resolver.settle(); await new Promise((r) => setTimeout(r, 200)); assert.ok(got.some((m) => /RESOLVED/.test(m.text) && /deploy-/.test(m.thread)), JSON.stringify(got.slice(-3)));
  console.log(`PASS team flow: winner=${winner}, ${got.length} thread replies`);
} catch (e) { console.log('FAIL', e.message); process.exitCode = 1; }
b.server.close(); chat.close(); fs.rmSync(dir, { recursive: true, force: true });
process.exit(process.exitCode ?? 0);
