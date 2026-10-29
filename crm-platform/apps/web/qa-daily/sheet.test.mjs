import { test, before, after } from 'node:test';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SHEET = join(import.meta.dirname, 'sheet.mjs');
const seen = [];
let server, url, dir;

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const r = JSON.parse(body);
      seen.push(r);
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          added: (r.bugs ?? []).length,
          reopened: 0,
          skipped: 0,
          ok: true,
          bugs: [],
          byStatus: {},
        }),
      );
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/exec`;
  dir = mkdtempSync(join(tmpdir(), 'sheet-'));
});
after(() => server.close());

const run = (args, env = {}) =>
  new Promise((resolve, reject) => {
    const p = spawn('node', [SHEET, ...args], {
      cwd: dir,
      env: { ...process.env, QA_SHEET_URL: url, QA_SHEET_TOKEN: 'tok', ...env },
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`exit ${code}: ${out}`)),
    );
  });

test('push batches by 5, sends token, env and base64 image', async () => {
  mkdirSync(join(dir, 'out/2026-01-01'), { recursive: true });
  writeFileSync(join(dir, 'out/2026-01-01/a.png'), 'PNGDATA');
  const bugs = Array.from({ length: 7 }, (_, i) => ({
    id: `id${i}`,
    screenshot: i === 0 ? '2026-01-01/a.png' : 'missing.png',
    env: 'prod',
    area: 'auth',
    test: 't',
  }));
  writeFileSync(join(dir, 'out/2026-01-01/bugs.json'), JSON.stringify(bugs));
  seen.length = 0;
  const out = await run(['push', 'out/2026-01-01/bugs.json']);
  assert.equal(seen.length, 2);
  assert.deepEqual(
    seen.map((r) => r.bugs.length),
    [5, 2],
  );
  assert.ok(seen.every((r) => r.token === 'tok' && r.action === 'add'));
  assert.equal(seen[0].bugs[0].imageB64, Buffer.from('PNGDATA').toString('base64'));
  assert.equal(seen[0].bugs[1].imageB64, '');
  assert.equal(seen[0].bugs[0].env, 'prod');
  assert.match(out, /7 added/);
});

test('resolve sends status, pr, note and the after image', async () => {
  writeFileSync(join(dir, 'after.png'), 'AFTER');
  seen.length = 0;
  await run([
    'resolve',
    'abc',
    'Verified',
    '--note',
    'ok',
    '--pr',
    'http://pr/1',
    '--after',
    'after.png',
  ]);
  assert.deepEqual(seen[0], {
    token: 'tok',
    action: 'resolve',
    id: 'abc',
    status: 'Verified',
    note: 'ok',
    prUrl: 'http://pr/1',
    afterImageB64: Buffer.from('AFTER').toString('base64'),
  });
});

test('summary and open (env filter) requests', async () => {
  seen.length = 0;
  await run(['summary']);
  await run(['open', '3', '--env', 'prod']);
  assert.equal(seen[0].action, 'summary');
  assert.deepEqual([seen[1].action, seen[1].limit, seen[1].env], ['open', 3, 'prod']);
});

test('dry-run sends nothing and prints the request', async () => {
  seen.length = 0;
  const out = await run(['mark', 'abc', 'Needs human', 'why', '--dry-run']);
  assert.equal(seen.length, 0);
  assert.match(out, /"action":"mark"/);
  assert.doesNotMatch(out, /"tok"/);
  const out2 = await run(['summary'], { QA_SHEET_DRY: '1' });
  assert.match(out2, /"action":"summary"/);
  assert.equal(seen.length, 0);
});
