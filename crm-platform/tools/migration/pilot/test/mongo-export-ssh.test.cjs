'use strict';
// node --test tools/migration/pilot/test   (no network: both ssh binaries are fakes)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const EXPORTER = path.resolve(
  __dirname,
  '../../../../../db-migration/geta-mongodb-read-replica-prod/geta-mongodb-read-replica-prod/bin/mongo-export.cjs',
);
const SRC = path.join(__dirname, 'fake-ssh.cjs');
const SINK = path.join(__dirname, 'fake-sink.cjs');
const TOOL = path.resolve(__dirname, '../..');
const PASSWORD = 'Sup3rS3cretPW';
const URI = `mongodb://dbuser:${PASSWORD}@replica.invalid:27017/?replicaSet=rs0`;

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mxs-test-'));
const envFile = path.join(base, 'fake.env');
fs.writeFileSync(
  envFile,
  `JUMP_HOST=jump.invalid\nJUMP_USER=ubuntu\nPEM_PATH=./nonexistent.pem\nMONGO_URI=${URI}\n`,
);
const serverEnv = path.join(base, 'server.env');
fs.writeFileSync(
  serverEnv,
  'SERVER_HOST=stage.invalid\nSERVER_USER=root\nSSH_KEY=./fake-key.pem\n',
);
test.after(() => fs.rmSync(base, { recursive: true, force: true }));

let n = 0;
function run(extra, { mode, sinkMode, env = {}, remote } = {}) {
  n++;
  const root = remote || path.join(base, `remote${n}`);
  const logDir = path.join(base, `logs${n}`);
  const sinkLog = path.join(base, `sink${n}.log`);
  const cwd = path.join(base, `cwd${n}`);
  fs.mkdirSync(cwd, { recursive: true });
  const r = spawnSync(
    process.execPath,
    [
      EXPORTER,
      '--db',
      'fakedb',
      '--client',
      'acme',
      '--to-ssh',
      '--i-confirm-server-is-staging',
      '--tool-dir',
      TOOL,
      '--log-dir',
      logDir,
      ...extra,
    ],
    {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        MONGO_EXPORT_ENV: envFile,
        STAGING_SERVER_ENV: serverEnv,
        SSH_BIN: SRC,
        STAGING_SSH_BIN: SINK,
        FAKE_MODE: mode || 'vm',
        FAKE_SINK_MODE: sinkMode || '',
        FAKE_REMOTE_ROOT: root,
        FAKE_SINK_LOG: sinkLog,
        ...env,
      },
    },
  );
  const dir = path.join(root, 'acme');
  const sinkCalls = fs.existsSync(sinkLog) ? fs.readFileSync(sinkLog, 'utf8') : '';
  return { ...r, root, dir, cwd, logDir, sinkCalls };
}
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const parts = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.part')) : []);

test('refusals: no staging confirmation, --out, bad remote dirs', () => {
  assert.equal(
    spawnSync(
      process.execPath,
      [EXPORTER, '--db', 'fakedb', '--client', 'acme', '--to-ssh', '--collections', 'contact_list'],
      {
        encoding: 'utf8',
        env: { ...process.env, MONGO_EXPORT_ENV: envFile },
      },
    ).status,
    2,
  );
  const c = ['--collections', 'contact_list'];
  assert.equal(run([...c, '--out', base]).status, 2);
  for (const d of [
    '/etc',
    '/opt/desk/migration/dumps/../x',
    '/opt/desk/migration/dumpsX',
    '/opt/desk/migration/dumps/a b',
    '/tmp/dumps',
  ])
    assert.equal(run([...c, '--remote-dir', d]).status, 2, d);
  assert.equal(run([...c, '--out', base]).sinkCalls, '', 'a refusal never reaches the server');
});

test('streams: bytes identical to the local export, sha256 and manifest right, nothing local, no secret anywhere', () => {
  const r = run(['--collections', 'contact_list,user']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const loc = path.join(base, 'localcmp');
  const l = spawnSync(
    process.execPath,
    [
      EXPORTER,
      '--db',
      'fakedb',
      '--client',
      'acme',
      '--out',
      loc,
      '--i-confirm-encrypted-volume',
      '--no-manifest',
      '--tool-dir',
      TOOL,
      '--collections',
      'contact_list,user',
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, MONGO_EXPORT_ENV: envFile, SSH_BIN: SRC, FAKE_MODE: 'vm' },
    },
  );
  assert.equal(l.status, 0, l.stderr);
  for (const c of ['contact_list', 'user']) {
    const a = path.join(r.dir, `${c}.ndjson`);
    assert.ok(
      fs.readFileSync(a).equals(fs.readFileSync(path.join(loc, 'acme', `${c}.ndjson`))),
      `${c} bytes`,
    );
    const rec = JSON.parse(fs.readFileSync(path.join(r.dir, '.export', `${c}.json`), 'utf8'));
    assert.equal(rec.sha256, sha(a));
    assert.equal(rec.bytes, fs.statSync(a).size);
  }
  assert.deepEqual(parts(r.dir), []);
  const m = JSON.parse(fs.readFileSync(path.join(r.dir, 'manifest.json'), 'utf8'));
  assert.equal(m.client, 'acme');
  assert.deepEqual(
    m.collections.map((c) => c.collection),
    ['contact_list', 'user'],
  );
  for (const e of m.collections) {
    assert.deepEqual(Object.keys(e).sort(), ['badLines', 'bytes', 'collection', 'docs', 'sha256']);
    assert.equal(e.badLines, 0);
    assert.equal(e.docs, 5);
    assert.equal(e.sha256, sha(path.join(r.dir, `${e.collection}.ndjson`)));
  }
  assert.ok(!fs.readFileSync(path.join(r.dir, 'user.ndjson'), 'utf8').includes('HASHHASH'));
  // nothing on the laptop but a counts-only log
  assert.deepEqual(fs.readdirSync(r.cwd), []);
  const logs = fs.readdirSync(r.logDir);
  assert.equal(logs.length, 1);
  const logText = fs.readFileSync(path.join(r.logDir, logs[0]), 'utf8');
  assert.ok(!logText.includes('Contact 1') && /5 documents/.test(logText));
  for (const text of [r.stdout, r.stderr, logText, r.sinkCalls]) {
    assert.ok(!text.includes(PASSWORD) && !text.includes('replica.invalid'));
  }
  assert.ok(r.sinkCalls.includes('stage.invalid') && r.sinkCalls.includes('umask 077; cat >'));
});

test('resume: a second run skips what the server already holds', () => {
  const r1 = run(['--collections', 'contact_list']);
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  const r2 = run(['--collections', 'contact_list'], { remote: r1.root });
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /contact_list: skipped/);
  assert.ok(!/cat > '[^']*\.part'/.test(r2.sinkCalls), 'no new stream was opened');
});

test('staging ssh dies mid-stream: .part removed, nonzero, no final file', () => {
  const r = run(['--collections', 'contact_list'], {
    sinkMode: 'die-mid',
    env: { FAKE_N: '20000' },
  });
  assert.notEqual(r.status, 0);
  assert.deepEqual(parts(r.dir), []);
  assert.ok(!fs.existsSync(path.join(r.dir, 'contact_list.ndjson')));
  assert.ok(!fs.existsSync(path.join(r.dir, 'manifest.json')));
});

test('source dies mid-stream: .part removed, exit 1', () => {
  const r = run(['--collections', 'contact_list'], { mode: 'error-mid' });
  assert.equal(r.status, 1);
  assert.deepEqual(parts(r.dir), []);
  assert.ok(!fs.existsSync(path.join(r.dir, 'contact_list.ndjson')));
});

test('count mismatch: exit 3, .part removed', () => {
  const r = run(['--collections', 'contact_list'], { env: { FAKE_COUNT: '99' } });
  assert.equal(r.status, 3);
  assert.deepEqual(parts(r.dir), []);
  assert.ok(!fs.existsSync(path.join(r.dir, 'contact_list.ndjson')));
});

test('server receives different bytes than were sent: not renamed, exit 1', () => {
  const r = run(['--collections', 'contact_list'], { sinkMode: 'corrupt' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(parts(r.dir), []);
  assert.ok(!fs.existsSync(path.join(r.dir, 'contact_list.ndjson')));
});

test('denylist still refused in --to-ssh mode', () => {
  const r = run(['--collections', 'auth_logs']);
  assert.equal(r.status, 2);
  assert.equal(r.sinkCalls, '');
});
