'use strict';
// node --test tools/migration/pilot/test   (no database, no network: SSH_BIN is a fake)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const EXPORTER = path.resolve(
  __dirname,
  '../../../../../db-migration/geta-mongodb-read-replica-prod/geta-mongodb-read-replica-prod/bin/mongo-export.cjs',
);
const STUB = path.join(__dirname, 'fake-ssh.cjs');
const TOOL = path.resolve(__dirname, '../..');
const PASSWORD = 'Sup3rS3cretPW';
const URI = `mongodb://dbuser:${PASSWORD}@replica.invalid:27017/?replicaSet=rs0`;

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mx-test-'));
const envFile = path.join(base, 'fake.env');
fs.writeFileSync(
  envFile,
  `JUMP_HOST=jump.invalid\nJUMP_USER=ubuntu\nPEM_PATH=./nonexistent.pem\nMONGO_URI=${URI}\n`,
);
test.after(() => fs.rmSync(base, { recursive: true, force: true }));

let n = 0;
function run(extra, { mode, env = {}, out } = {}) {
  const outDir = out || path.join(base, `out${++n}`);
  const log = path.join(base, `ssh${n}-${Math.random().toString(36).slice(2)}.log`);
  const r = spawnSync(
    process.execPath,
    [
      EXPORTER,
      '--db',
      'fakedb',
      '--client',
      'acme',
      '--out',
      outDir,
      '--i-confirm-encrypted-volume',
      '--no-manifest',
      '--tool-dir',
      TOOL,
      ...extra,
    ],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        MONGO_EXPORT_ENV: envFile,
        SSH_BIN: STUB,
        FAKE_LOG: log,
        FAKE_MODE: mode || 'vm',
        ...env,
      },
    },
  );
  const calls = fs.existsSync(log)
    ? fs
        .readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
  return { ...r, outDir, calls, dir: path.join(outDir, 'acme') };
}
const lines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
const noSecret = (r) => {
  const all = r.stdout + r.stderr + JSON.stringify(r.calls.map((c) => c.argv));
  assert.ok(!all.includes(PASSWORD), 'password leaked');
  assert.ok(!all.includes(URI), 'uri leaked');
  const side = path.join(r.dir, '.export');
  for (const f of fs.readdirSync(side).filter((x) => x.endsWith('.log'))) {
    assert.ok(!fs.readFileSync(path.join(side, f), 'utf8').includes(PASSWORD));
  }
};

test('happy path: canonical EJSON, chunked, noisy, CRLF; types kept; connection string never in argv/stdout/log', () => {
  const r = run(['--collections', 'contact_list'], {
    env: { FAKE_N: '5', FAKE_CHUNK: '7', FAKE_NOISE: '1' },
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const ls = lines(path.join(r.dir, 'contact_list.ndjson'));
  assert.equal(ls.length, 5);
  const d = JSON.parse(ls[0]);
  assert.deepEqual(d._id, { $oid: '000000000000000000000001' });
  assert.deepEqual(d.createdAt, { $date: { $numberLong: String(Date.UTC(2024, 0, 1)) } });
  assert.deepEqual(d.amount, { $numberDecimal: '1.50' });
  assert.deepEqual(d.big, { $numberLong: String(2 ** 40 + 1) });
  assert.ok(
    d.name.includes('☃') && d.name.includes('😀'),
    'unicode and emoji survive chunk splits',
  );
  assert.ok(ls[0].includes('\\u0000'), 'NUL stays escaped');
  assert.ok(ls[0].includes('\\ud800'), 'lone surrogate stays escaped');
  assert.ok(!fs.existsSync(path.join(r.dir, 'contact_list.ndjson.part')));
  noSecret(r);
  const argv = r.calls[0].argv.join(' ');
  assert.match(argv, /StrictHostKeyChecking=accept-new/);
  assert.doesNotMatch(argv, /StrictHostKeyChecking=no|UserKnownHostsFile/);
  assert.match(argv, /mongosh --nodb --quiet$/);
  assert.match(r.calls[0].stdin, /connect\(<URI>\)/);
  assert.match(r.calls[0].stdin, /\.sort\(\{ _id: 1 \}\)/);
});

test('2 MB document and large chunks', () => {
  const r = run(['--collections', 'contact_list'], {
    env: { FAKE_N: '2', FAKE_BIG: '1', FAKE_CHUNK: '4093' },
  });
  assert.equal(r.status, 0, r.stderr);
  const ls = lines(path.join(r.dir, 'contact_list.ndjson'));
  assert.equal(ls.length, 3);
  assert.ok(ls[2].length > 2 * 1024 * 1024);
});

test('user: password hash is projected out and credential-named keys are stripped on the jump host', () => {
  const r = run(['--collections', 'user']);
  assert.equal(r.status, 0, r.stderr);
  const txt = fs.readFileSync(path.join(r.dir, 'user.ndjson'), 'utf8');
  assert.ok(
    !/HASHHASH|passwordHash|"password|reset_token|T0K|api_key|password_changed_at/.test(txt),
    txt.slice(0, 400),
  );
  assert.ok(txt.includes('u1@example.invalid') && txt.includes('"theme":"dark"'));
  assert.match(r.calls[0].stdin, /"password":0/);
  const rec = JSON.parse(fs.readFileSync(path.join(r.dir, '.export', 'user.json'), 'utf8'));
  assert.ok(rec.strippedKeys >= 3);
});

test('denylist: chatbot_misc_config, auth_logs, registry EXCLUDE refused; override needs a reason; system.* never', () => {
  for (const c of ['chatbot_misc_config', 'auth_logs', 'project']) {
    const r = run(['--collections', c]);
    assert.equal(r.status, 2, c);
    assert.match(r.stderr, /denylist/);
    assert.equal(r.calls.length, 0, 'no ssh call before refusing');
  }
  assert.equal(run(['--collections', 'chatbot_misc_config', '--i-know-what-i-am-doing']).status, 2);
  assert.equal(
    run(['--collections', 'chatbot_misc_config', '--i-know-what-i-am-doing', '--reason', 'short'])
      .status,
    2,
  );
  const ok = run([
    '--collections',
    'chatbot_misc_config',
    '--i-know-what-i-am-doing',
    '--reason',
    'owner approved channel map check 2026-10',
  ]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stderr, /OVERRIDE/);
  assert.equal(
    run([
      '--collections',
      'system.profile',
      '--i-know-what-i-am-doing',
      '--reason',
      'a long enough reason here',
    ]).status,
    2,
  );
  assert.equal(run(['--collections', 'a;b']).status, 2);
  assert.equal(run(['--collections', 'x$y']).status, 2);
});

test('registry classes: discovers, exports MIGRATE only, skips denylisted, never unknown or system', () => {
  const r = run(['--registry-classes', 'MIGRATE,MIGRATE_LATER'], { env: { FAKE_N: '2' } });
  assert.equal(r.status, 0, r.stderr);
  const got = fs
    .readdirSync(r.dir)
    .filter((f) => f.endsWith('.ndjson'))
    .sort();
  assert.deepEqual(got, ['contact_list.ndjson', 'contact_notes.ndjson', 'user.ndjson']);
  assert.match(r.stderr, /skipped chatbot_misc_config/);
});

test('resume: second run skips; changed file or --limit re-exports', () => {
  const r1 = run(['--collections', 'contact_list']);
  assert.equal(r1.status, 0);
  const r2 = run(['--collections', 'contact_list'], { out: r1.outDir });
  assert.match(r2.stdout, /skipped/);
  assert.equal(r2.calls.length, 0, 'no ssh call on resume');
  fs.appendFileSync(path.join(r1.dir, 'contact_list.ndjson'), '{"x":1}\n');
  const r3 = run(['--collections', 'contact_list'], { out: r1.outDir });
  assert.match(r3.stdout, /5 documents/);
  const r4 = run(['--collections', 'contact_list', '--limit', '2'], { out: r1.outDir });
  assert.match(r4.stdout, /2 documents/);
  assert.match(r4.stdout, /smoke export/);
});

test('count check: mismatch is loud (exit 3, no final file); tolerance accepts lag', () => {
  const bad = run(['--collections', 'contact_list'], { mode: 'short' });
  assert.equal(bad.status, 3);
  assert.match(bad.stdout, /COUNT MISMATCH: wrote 2, source countDocuments\(\) says 10/);
  assert.ok(!fs.existsSync(path.join(bad.dir, 'contact_list.ndjson')));
  assert.ok(!fs.existsSync(path.join(bad.dir, 'contact_list.ndjson.part')));
  const lag = run(['--collections', 'contact_list'], { env: { FAKE_N: '5', FAKE_COUNT: '6' } });
  assert.equal(lag.status, 3);
  const ok = run(['--collections', 'contact_list', '--tolerance', '1'], {
    env: { FAKE_N: '5', FAKE_COUNT: '6' },
  });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /within tolerance/);
});

test('failures: error midway, truncated last line, nonzero exit, corrupt line, byte limit; nothing left as final', () => {
  for (const mode of ['error-mid', 'truncated', 'nonzero', 'corrupt']) {
    const r = run(['--collections', 'contact_list'], { mode });
    assert.equal(r.status, 1, mode + r.stdout);
    assert.ok(!fs.existsSync(path.join(r.dir, 'contact_list.ndjson')), mode);
    assert.ok(!fs.existsSync(path.join(r.dir, 'contact_list.ndjson.part')), mode);
  }
  const big = run(['--collections', 'contact_list', '--max-gb', '0.0005'], {
    env: { FAKE_N: '1', FAKE_BIG: '1' },
  });
  assert.equal(big.status, 5);
  assert.ok(!fs.existsSync(path.join(big.dir, 'contact_list.ndjson')));
});

test('a secret printed by the remote side is redacted from stderr and logs', () => {
  const r = run(['--collections', 'contact_list'], { mode: 'leak' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\*\*\*/);
  noSecret(r);
});

test('host key failure: exit 4 with the OpenSSH message and a do-not-bypass text', () => {
  const r = run(['--collections', 'contact_list'], { mode: 'hostkey' });
  assert.equal(r.status, 4);
  assert.match(r.stderr, /Host key verification failed\./);
  assert.match(r.stderr, /Do NOT bypass/);
  const d = run(['--registry-classes', 'MIGRATE'], { mode: 'hostkey' });
  assert.equal(d.status, 4, 'also in the discovery call');
});

test('missing collection is reported, not an error', () => {
  const r = run(['--collections', 'contact_tag']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /not present/);
});

test('output directory rules', () => {
  const repo = path.join(base, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  const g = run(['--collections', 'contact_list'], { out: path.join(repo, 'dumps') });
  assert.equal(g.status, 2);
  assert.match(g.stderr, /git repository/);
  for (const d of ['OneDrive - Acme', 'Dropbox', 'Google Drive', 'iCloudDrive', 'Box']) {
    const r = run(['--collections', 'contact_list'], { out: path.join(base, d, 'dumps') });
    assert.equal(r.status, 2, d);
    assert.match(r.stderr, /synced-cloud/);
  }
  const u = run(['--collections', 'contact_list'], { out: '\\\\fileserver\\share\\dumps' });
  assert.equal(u.status, 2);
  assert.match(u.stderr, /network/);
  assert.equal(g.calls.length + u.calls.length, 0);
  const c = spawnSync(
    process.execPath,
    [
      EXPORTER,
      '--db',
      'fakedb',
      '--client',
      'acme',
      '--out',
      path.join(base, 'o'),
      '--collections',
      'contact_list',
    ],
    { encoding: 'utf8', env: { ...process.env, MONGO_EXPORT_ENV: envFile, SSH_BIN: STUB } },
  );
  assert.equal(c.status, 2);
  assert.match(c.stderr, /ENCRYPTED volume/);
});

test("manifest: the migration tool's own manifest command accepts the export", () => {
  const out = path.join(base, 'outm');
  const r = spawnSync(
    process.execPath,
    [
      EXPORTER,
      '--db',
      'fakedb',
      '--client',
      'acme',
      '--out',
      out,
      '--i-confirm-encrypted-volume',
      '--collections',
      'contact_list',
      '--tool-dir',
      TOOL,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, MONGO_EXPORT_ENV: envFile, SSH_BIN: STUB, FAKE_N: '3' },
    },
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /acme: 1 collections, 3 documents/);
  assert.ok(fs.existsSync(path.join(out, 'acme', 'manifest.json')));
});
