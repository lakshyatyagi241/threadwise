'use strict';
// node --test tools/migration/pilot/test/cycle.test.cjs   (no network, no docker: ssh is a fake that runs the remote command in a sandbox)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const CYCLE = path.resolve(__dirname, '../staging/cycle.cjs');
const lib = require(CYCLE);
const FAKE = path.join(__dirname, 'fake-cycle-ssh.cjs');
const TEMPLATES = path.resolve(__dirname, '../staging/clients');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cyc-test-'));
test.after(() => fs.rmSync(base, { recursive: true, force: true }));

const root = path.join(base, 'server');
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, '.env'), 'DOMAIN=desk.wabo.ai\nSECRET_THING=hunter2hunter2\n');
const serverEnv = path.join(base, 'server.env');
fs.writeFileSync(
  serverEnv,
  'SERVER_HOST=stage.invalid\nSERVER_USER=root\nSSH_KEY=./k.pem\nSERVER_APP_DIR=/opt/desk\n',
);
const clients = path.join(base, 'clients');
fs.mkdirSync(clients);
const chan = path.join(base, 'channel-map.json');
fs.writeFileSync(chan, '{"a":1}');
const CFG = {
  orgName: `Acme "Quoted" $HOME it's`,
  orgSlug: 'acme',
  orgPlan: 'pro',
  ownerEmail: 'boss@example.invalid',
  ownerName: 'Ann `Owner` & Co',
  channelMap: chan,
  creditOpening: null,
  defaultCc: '91',
  batch: 250,
  roleMapApprovals: [],
  extraFlags: [],
};
const writeCfg = (o = {}) =>
  fs.writeFileSync(path.join(clients, 'acme.json'), JSON.stringify({ ...CFG, ...o }));
writeCfg();

const sshLog = path.join(base, 'ssh.log');
const dockerLog = path.join(base, 'docker.log');
function cycle(args, env = {}, clientsDir = clients) {
  const r = spawnSync(process.execPath, [CYCLE, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      STAGING_SERVER_ENV: serverEnv,
      STAGING_SSH_BIN: FAKE,
      CYCLE_CLIENTS_DIR: clientsDir,
      CYCLE_RUNS_DIR: path.join(base, 'runs'),
      FAKE_REMOTE_ROOT: root,
      FAKE_SSH_LOG: sshLog,
      FAKE_DOCKER_LOG: dockerLog,
      ...env,
    },
  });
  return r;
}
const dockerCalls = () =>
  fs.existsSync(dockerLog)
    ? fs
        .readFileSync(dockerLog, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

test('shq round-trips quotes, dollars, spaces and backticks through a real shell', () => {
  for (const v of [`a b`, `it's`, `"q" $HOME \`x\``, `$(touch /tmp/pwned)`, `;rm -rf /`, `ünï ☃`]) {
    const r = spawnSync('sh', ['-c', `printf %s ${lib.shq(v)}`], { encoding: 'utf8' });
    assert.equal(r.stdout, v);
  }
  assert.equal(
    lib.maskPII('mail boss@example.com tel +91 98765 43210 ok'),
    'mail ***@example.com tel *** ok',
  );
});

test('refusals: usage, missing/placeholder config, load without the flag', () => {
  assert.equal(cycle(['nope']).status, 2);
  assert.equal(cycle(['dry', '--client', 'ghost']).status, 2);
  assert.equal(
    cycle(['dry', '--client', 'iskm'], {}, TEMPLATES).status,
    2,
    'the shipped templates still hold placeholders',
  );
  assert.equal(cycle(['load', '--client', 'acme']).status, 2);
  assert.equal(cycle(['dry', '--client', 'acme', '--whatever']).status, 2);
  fs.writeFileSync(path.join(root, '.env'), 'DOMAIN=desk.prod.example\n');
  const r = cycle(['ship', '--client', 'acme']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not desk\.wabo\.ai/);
  fs.writeFileSync(path.join(root, '.env'), 'DOMAIN=desk.wabo.ai\nSECRET_THING=hunter2hunter2\n');
});

test('ship: files arrive with matching sha256, channel map goes to dumps/<client>', () => {
  const r = cycle(['ship', '--client', 'acme']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const dist = path.resolve(__dirname, '../staging/dist');
  for (const f of ['waboo-migrate.cjs', 'waboo-preflight.cjs', 'BUILD-INFO.json'])
    assert.equal(sha(path.join(root, 'migration/bundle', f)), sha(path.join(dist, f)), f);
  assert.equal(
    fs.readFileSync(path.join(root, 'migration/dumps/acme/channel-map.json'), 'utf8'),
    '{"a":1}',
  );
  assert.deepEqual(
    fs.readdirSync(path.join(root, 'migration/bundle')).filter((f) => f.endsWith('.part')),
    [],
  );
});

test('dry: the container command runs the bundle with exactly the configured arguments (quoting survives two shells)', () => {
  fs.writeFileSync(dockerLog, '');
  const r = cycle(['dry', '--client', 'acme']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const [call] = dockerCalls();
  assert.deepEqual(call.slice(0, 9), [
    'compose',
    '--env-file',
    '.env',
    'run',
    '--rm',
    '--no-deps',
    '-T',
    '--user',
    '10001:10001',
  ]);
  assert.equal(call[call.length - 4], 'worker');
  assert.equal(call[call.length - 3], 'sh');
  // run the container-side line for real, with a node shim that prints its arguments one per line
  const shim = path.join(base, 'nodeshim');
  fs.mkdirSync(shim, { recursive: true });
  fs.writeFileSync(
    path.join(shim, 'node'),
    '#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done\n',
    { mode: 0o755 },
  );
  const inner = call[call.length - 1];
  assert.ok(!inner.includes('postgres://'));
  const e = spawnSync('sh', ['-c', inner], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: shim + path.delimiter + process.env.PATH,
      DATABASE_URL: 'postgres://SECRET',
    },
  });
  assert.deepEqual(e.stdout.split('\n').slice(0, -1), [
    '/mig/bundle/waboo-migrate.cjs',
    ...lib.runArgs({ ...CFG, client: 'acme' }, { dry: true }),
  ]);
  assert.ok(
    e.stdout.includes(`Acme "Quoted" $HOME it's`) &&
      e.stdout.includes('--no-wallet') &&
      e.stdout.includes('/mig/dumps/acme/channel-map.json'),
  );
  assert.ok(
    e.stdout.includes('--dry-run') &&
      e.stdout.includes('--confirm-db-name') &&
      e.stdout.includes('postgres'),
  );
  // status file recorded on the server; nothing secret anywhere
  const st = JSON.parse(fs.readFileSync(path.join(root, 'migration/out/status-acme.json'), 'utf8'));
  assert.equal(st.ok, true);
  assert.equal(st.unaccounted, 0);
  const all = r.stdout + r.stderr + fs.readFileSync(sshLog, 'utf8');
  assert.ok(!all.includes('hunter2') && !all.includes('postgres://') && !all.includes('SECRET'));
});

test('load guards: flag, fresh backup, successful dry with unaccounted 0, unchanged config', () => {
  const L = ['load', '--client', 'acme', '--yes-load-into-staging'];
  let r = cycle(L);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no backup from today/);
  assert.equal(cycle(['backup', '--client', 'acme']).status, 0);
  assert.ok(
    fs
      .readdirSync(path.join(root, 'backups'))
      .some((f) => f.startsWith('desk-pre-migration-acme-')),
  );

  // a dry run with unaccounted rows blocks the load
  r = cycle(['dry', '--client', 'acme'], {
    FAKE_DOCKER_OUT: 'unaccounted: 3\ndone: org 1 (dry run, rolled back)\nboss@example.invalid',
  });
  assert.equal(r.status, 1);
  assert.ok(!r.stdout.includes('boss@example.invalid'), 'e-mail masked');
  r = cycle(L);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unaccounted 0/);

  // a failed dry run (exit code) blocks it too
  assert.equal(cycle(['dry', '--client', 'acme'], { FAKE_DOCKER_RC: '1' }).status, 1);
  assert.equal(cycle(L).status, 2);

  // good dry run: the load goes through, without --dry-run
  assert.equal(cycle(['dry', '--client', 'acme']).status, 0);
  fs.writeFileSync(dockerLog, '');
  r = cycle(L);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const call = dockerCalls().pop();
  assert.ok(!call[call.length - 1].includes('--dry-run'));
  assert.ok(call[call.length - 1].includes("'run' '--client' 'acme'"));

  // config changed after the dry run: refused
  writeCfg({ batch: 100 });
  r = cycle(L);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /config changed/);
  writeCfg();
});

test('reconcile and report: runs the bundle, copies the masked reports back', () => {
  fs.mkdirSync(path.join(root, 'migration/out/acme'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'migration/out/acme/reconcile.json'),
    JSON.stringify({ result: 'PASS', notPresent: { collectionsGap: ['x'], droppedFields: [] } }),
  );
  fs.writeFileSync(path.join(root, 'migration/out/acme/reconcile.md'), '# reconcile');
  fs.writeFileSync(dockerLog, '');
  assert.equal(cycle(['reconcile', '--client', 'acme']).status, 0);
  const c = dockerCalls().pop();
  assert.ok(c[c.length - 1].includes("'reconcile' '--client' 'acme' '--out' '/mig/out'"));
  const r = cycle(['report', '--client', 'acme']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /reconcile result: PASS; NOT PRESENT: collectionsGap=1, droppedFields=0/);
  const runs = path.join(base, 'runs/acme');
  const dir = path.join(runs, fs.readdirSync(runs)[0]);
  assert.ok(
    fs.existsSync(path.join(dir, 'reconcile.json')) &&
      fs.existsSync(path.join(dir, 'reconcile.md')),
  );
});

test('set-owner-password: password goes over stdin, never into argv or output', () => {
  assert.equal(cycle(['set-owner-password', '--client', 'acme']).status, 2);
  fs.writeFileSync(dockerLog, '');
  const r = cycle(['set-owner-password', '--client', 'acme'], {
    OWNER_NEW_PASSWORD: 'Zx9!pwPWpw-secretvalue',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const all =
    r.stdout + r.stderr + fs.readFileSync(sshLog, 'utf8') + fs.readFileSync(dockerLog, 'utf8');
  assert.ok(!all.includes('secretvalue'));
});

// ====================================================================================================================================
// migrate / batch / new-client / timings (fake ssh, fake exporter, fake migration-complete: nothing leaves this machine)
// ====================================================================================================================================
const exportLog = path.join(base, 'export.log');
const completeLog = path.join(base, 'complete.log');
const fakeExport = path.join(base, 'fake-export.cjs');
fs.writeFileSync(
  fakeExport,
  `const fs=require('fs'),path=require('path');const a=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(exportLog)},JSON.stringify(a)+'\\n');
if(Number(process.env.FAKE_EXPORT_RC||0))process.exit(Number(process.env.FAKE_EXPORT_RC));
const c=a[a.indexOf('--client')+1];const d=path.join(process.env.FAKE_REMOTE_ROOT,'migration/dumps',c);
fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'x.ndjson'),'abc');
fs.writeFileSync(path.join(d,'manifest.json'),JSON.stringify({client:c,generatedAt:new Date().toISOString(),collections:[{collection:'x',docs:5,bytes:3,sha256:'a'}]}));
console.log('exported boss@example.com');`,
);
const fakeComplete = path.join(base, 'fake-complete.cjs');
fs.writeFileSync(
  fakeComplete,
  `require('fs').appendFileSync(${JSON.stringify(completeLog)},JSON.stringify(process.argv.slice(2))+'\\n');console.log('wrote it');`,
);
const STEPOUT =
  'unaccounted: 0\ndone: org 1 (dry run, rolled back)\n  fields             {"read":20,"migrated":18,"quarantined":2,"excluded":0}\n  contacts           {"read":10,"migrated":9,"quarantined":0,"excluded":1}';
const M_ENV = {
  MONGO_EXPORT_BIN: fakeExport,
  CYCLE_COMPLETE_BIN: fakeComplete,
  CYCLE_MEM_CMD: 'echo 5000',
  CYCLE_CONFIG_DIR: path.join(base, 'cfg'),
  FAKE_DOCKER_OUT: STEPOUT,
};
const lines = (f) =>
  fs.existsSync(f)
    ? fs
        .readFileSync(f, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
const reset = () => [exportLog, completeLog, dockerLog, sshLog].forEach((f) => fs.writeFileSync(f, ''));
const innerOf = (c) => c[c.length - 1];
const newestRun = (client) => {
  const runs = path.join(base, 'runs', client);
  const d = fs
    .readdirSync(runs)
    .filter((x) => fs.statSync(path.join(runs, x)).isDirectory())
    .sort()
    .pop();
  return path.join(runs, d);
};
const MIG = ['migrate', '--client', 'acme', '--db', 'acme_waboo', '--yes-load-into-staging'];
fs.mkdirSync(path.join(root, 'migration/out/acme'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'migration/out/acme/reconcile.json'),
  JSON.stringify({ result: 'PASS', notPresent: {} }),
);

test('stepStats: per-step seconds from line arrival, resumed steps cost 0', () => {
  const L = (t, line) => ({ t, line });
  const s = lib.stepStats(
    [
      L(0, 'noise'),
      L(5000, '  fields             {"read":20,"migrated":18,"quarantined":2,"excluded":0}'),
      L(7000, '  contacts           already done ({"read":3,"migrated":3,"quarantined":0,"excluded":0})'),
      L(10000, '  broadcasts         {"read":4,"migrated":4,"quarantined":0,"excluded":0}'),
    ],
    0,
  );
  assert.deepEqual(
    s.map((x) => [x.step, x.seconds, x.migrated, x.quarantined]),
    [
      ['fields', 5, 18, 2],
      ['contacts', 0, 3, 0],
      ['broadcasts', 5, 4, 0],
    ],
  );
});

test('migrate refusals: flag, override pair, bad --from, low memory, no db', () => {
  reset();
  let r = cycle(['migrate', '--client', 'acme', '--db', 'x'], M_ENV);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /pass --yes-load-into-staging/);
  r = cycle([...MIG, '--skip-dry-run-check'], M_ENV);
  assert.match(r.stdout, /--i-accept-no-dry-run/);
  r = cycle([...MIG, '--from', 'bogus'], M_ENV);
  assert.match(r.stdout, /--from must be one of export, core-snapshot, ship/);
  r = cycle(MIG, { ...M_ENV, CYCLE_MEM_CMD: 'echo 300' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /only 300 MB of memory available.*700 MB needed/);
  assert.equal(lines(exportLog).length, 0, 'nothing ran after the memory refusal');
  fs.rmSync(path.join(root, 'migration/dumps/acme/manifest.json'), { force: true });
  r = cycle(['migrate', '--client', 'acme', '--yes-load-into-staging'], M_ENV);
  assert.match(r.stdout, /no Mongo database name/);
  assert.match(r.stdout, /--from export/);
});

test('migrate: full chain, exporter flags, reuse of a fresh export, timings.json and summary', () => {
  reset();
  fs.rmSync(path.join(root, 'migration/dumps/acme/manifest.json'), { force: true });
  const r = cycle([...MIG, '--with-dry-run'], M_ENV);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(lines(exportLog), [
    [
      '--db',
      'acme_waboo',
      '--client',
      'acme',
      '--to-ssh',
      '--i-confirm-server-is-staging',
      '--registry-classes',
      'MIGRATE,MIGRATE_LATER',
    ],
  ]);
  assert.ok(!r.stdout.includes('boss@example.com'), 'exporter output is masked');
  const order = ['export', 'ship', 'preflight', 'dry', 'backup', 'load', 'files', 'flow-state', 'reconcile', 'report', 'complete'];
  assert.deepEqual([...r.stdout.matchAll(/^migrate: ([\w-]+) ok/gm)].map((m) => m[1]), order);
  const inners = dockerCalls().map(innerOf);
  const idx = (re) => inners.findIndex((x) => re.test(x));
  assert.ok(
    idx(/waboo-preflight/) < idx(/--dry-run/) && idx(/--dry-run/) < idx(/'run' '--client' 'acme' '--batch'/),
  );
  assert.ok(inners.some((x) => x.includes("'reconcile'")));
  assert.match(r.stdout, /summary acme: OK/);
  assert.match(r.stdout, /fields\s+[\d.]+\s+18\s+2\s+0/);
  assert.match(r.stdout, /timing: migrate [\d.]+s/);
  const t = JSON.parse(fs.readFileSync(path.join(newestRun('acme'), 'timings.json'), 'utf8'));
  assert.equal(t.ok, true);
  assert.deepEqual(
    t.steps.map((s) => s.step),
    order,
  );
  assert.equal(t.totals.rows, 27);
  assert.equal(t.totals.quarantined, 2);
  assert.equal(t.totals.excluded, 1);
  assert.deepEqual(lines(completeLog), [['--runs', path.join(base, 'runs'), '--out', base, '--clients', 'acme']]);

  // a second run reuses the fresh export on the server
  reset();
  const r2 = cycle([...MIG, '--with-dry-run'], M_ENV);
  assert.equal(r2.status, 0, r2.stdout);
  assert.equal(lines(exportLog).length, 0);
  assert.match(r2.stdout, /export: skipped, the server already has it: 1 collections, 5 documents/);
  // a changed file invalidates it; this run also uses the explicit override instead of a dry run
  fs.writeFileSync(path.join(root, 'migration/dumps/acme/x.ndjson'), 'abcdef');
  const r3 = cycle([...MIG, '--skip-dry-run-check', '--i-accept-no-dry-run'], M_ENV);
  assert.equal(lines(exportLog).length, 1);
  assert.equal(r3.status, 0, r3.stdout);
  assert.match(r3.stdout, /NO DRY RUN CHECK/);
  // --force-export and --skip-export
  reset();
  cycle([...MIG, '--force-export', '--with-dry-run'], M_ENV);
  assert.equal(lines(exportLog).length, 1);
  reset();
  cycle([...MIG, '--skip-export', '--with-dry-run'], M_ENV);
  assert.equal(lines(exportLog).length, 0);
});

test('migrate: init runs when the preflight says the migration schema is absent', () => {
  reset();
  const r = cycle([...MIG, '--skip-export', '--with-dry-run', '--from', 'preflight'], {
    ...M_ENV,
    FAKE_DOCKER_OUT:
      'PASS g migration-schema\n       absent: needs `init` (owner URL, once) before the first run\n' + STEPOUT,
  });
  assert.equal(r.status, 0, r.stdout);
  const inners = dockerCalls().map(innerOf);
  const k = inners.findIndex((x) => x.includes("'init'"));
  assert.ok(k > 0 && inners[k - 1].includes('waboo-preflight'));
  assert.ok(inners[k + 1].includes('waboo-preflight') && inners[k + 1].includes("'--after-init'"));
});

test('migrate stops at the first failure, prints the exact resume command, and --from continues there', () => {
  reset();
  // the dry run reports unaccounted rows: preflight passes, dry fails, nothing after it runs
  let r = cycle([...MIG, '--skip-export', '--with-dry-run', '--steps', 'access,fields'], {
    ...M_ENV,
    FAKE_DOCKER_OUT: 'unaccounted: 3\ndone: org 1 (dry run, rolled back)',
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /STOPPED at dry \(exit 1\)/);
  assert.ok(!/migrate: backup|migrate: load/.test(r.stdout));
  const resume = r.stdout.match(/resume with: (node pilot\/staging\/cycle\.cjs migrate .*)$/m)[1];
  assert.equal(
    resume,
    'node pilot/staging/cycle.cjs migrate --client acme --db acme_waboo --steps access,fields --yes-load-into-staging --with-dry-run --from dry',
  );
  assert.ok(
    dockerCalls().every((c) => !/'run' '--client' 'acme' '--batch'/.test(innerOf(c)) || innerOf(c).includes('--dry-run')),
    'no real load happened',
  );
  const tdir = path.join(base, 'runs/_timings');
  const tf = fs.readdirSync(tdir).sort().pop();
  assert.equal(JSON.parse(fs.readFileSync(path.join(tdir, tf), 'utf8')).stoppedAt, 'dry');

  // run the printed command (the data is fine now): it starts AT dry, no export / ship / preflight
  reset();
  r = cycle(resume.replace('node pilot/staging/cycle.cjs ', '').split(' '), M_ENV);
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(
    [...r.stdout.matchAll(/^migrate: (\w+) ok/gm)].map((m) => m[1]),
    ['dry', 'backup', 'load', 'files', 'reconcile', 'report', 'complete'],
  );
  const inners = dockerCalls().map(innerOf);
  assert.ok(
    inners.some((x) => x.includes("'--steps' 'access,fields'") && !x.includes('--dry-run') && x.includes("'--batch'")),
    '--steps honoured by the load',
  );
  assert.ok(!inners.some((x) => x.includes('waboo-preflight')));

  // a failing exporter stops the chain before anything is shipped
  reset();
  r = cycle([...MIG, '--force-export'], { ...M_ENV, FAKE_EXPORT_RC: '3' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /STOPPED at export \(exit 1\)/);
  assert.match(r.stdout, /--from export/);
  assert.equal(dockerCalls().length, 0);

  // every container command fails here: stops at preflight and the resume command keeps the explicit flags
  r = cycle([...MIG, '--skip-export', '--skip-dry-run-check', '--i-accept-no-dry-run', '--skip-steps', 'chat'], {
    ...M_ENV,
    FAKE_DOCKER_RC: '1',
  });
  assert.match(r.stdout, /STOPPED at preflight/);
  assert.match(
    r.stdout,
    /--skip-steps chat --yes-load-into-staging --skip-dry-run-check --i-accept-no-dry-run --from preflight/,
  );
});

test('migrate: the load gate still applies (no dry run and no override: stops at load)', () => {
  fs.rmSync(path.join(root, 'migration/out/status-acme.json'), { force: true });
  const r = cycle([...MIG, '--skip-export', '--from', 'load'], M_ENV);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no dry run recorded for this client/);
  assert.match(r.stdout, /STOPPED at load/);
});

test('new-client: writes config + channel map, validates, refuses duplicates and secrets', () => {
  const cdir = path.join(base, 'clients2');
  const E = { ...M_ENV };
  const NC = [
    'new-client',
    '--client',
    'newco',
    '--name',
    'New Co',
    '--slug',
    'new-co',
    '--owner-email',
    'o@newco.example',
    '--owner-name',
    'Nina Owner',
  ];
  let r = cycle([...NC, '--channel-id', 'bot1=123456789012345,bot2=555555555', '--db', 'newco_waboo'], E, cdir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const cfg = JSON.parse(fs.readFileSync(path.join(cdir, 'newco.json'), 'utf8'));
  assert.equal(cfg.orgPlan, 'enterprise');
  assert.equal(cfg.creditOpening, null);
  assert.equal(cfg.mongoDb, 'newco_waboo');
  const map = JSON.parse(fs.readFileSync(cfg.channelMap, 'utf8'));
  assert.equal(map.bot1.externalId, '123456789012345');
  assert.equal(map.bot2.kind, 'whatsapp_cloud');
  // the written config loads in every other command (the load gate refuses only for the missing flag)
  assert.equal(cycle(['load', '--client', 'newco'], E, cdir).status, 2);
  assert.doesNotMatch(cycle(['load', '--client', 'newco'], E, cdir).stderr, /placeholder|no config/);
  // no channel id: a clearly marked placeholder
  r = cycle(
    ['new-client', '--client', 'two', '--name', 'Two', '--slug', 'two-co', '--owner-email', 'o@two.example', '--owner-name', 'Tom'],
    E,
    cdir,
  );
  assert.equal(r.status, 0, r.stderr);
  const m2 = JSON.parse(fs.readFileSync(path.join(base, 'cfg/two-channel-map.json'), 'utf8'));
  assert.match(JSON.stringify(m2), /REPLACE-WITH-BOT-ID.*PLACEHOLDER/);
  assert.match(r.stdout, /still needs a person/);
  // refusals
  const ok = ['--name', 'N', '--slug', 'fresh-slug', '--owner-email', 'a@b.example', '--owner-name', 'O'];
  const w = (k, v) => {
    const c = [...ok];
    c[c.indexOf(k) + 1] = v;
    return c;
  };
  let n = 0;
  const bad = (extra, re) => {
    const x = cycle(['new-client', '--client', 'k' + n++, ...extra], E, cdir);
    assert.equal(x.status, 2, extra.join(' '));
    assert.match(x.stderr, re);
  };
  bad(w('--slug', 'new-co'), /already used by newco\.json/);
  bad(w('--slug', 'Bad Slug'), /--slug must be/);
  bad(w('--owner-email', 'not-an-email'), /not an e-mail/);
  bad(w('--name', 'postgres://u:p@h/db'), /secret or a URL/);
  bad(w('--owner-name', 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'), /secret or a URL/);
  bad([...ok, '--channel-id', 'bot1=abc'], /--channel-id must be/);
  bad([...ok, '--plan', 'Bad Plan'], /--plan must be/);
  bad(ok.slice(2), /--name is required/);
  r = cycle(NC, E, cdir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /already exists/);
});

test('batch: concurrency and memory refusals, shared bundle, one aggregated summary, one client failing', () => {
  reset();
  const B = [
    'batch',
    '--clients',
    'acme,beta',
    '--yes-load-into-staging',
    '--skip-build',
    '--skip-export',
    '--skip-dry-run-check',
    '--i-accept-no-dry-run',
  ];
  fs.writeFileSync(path.join(clients, 'beta.json'), JSON.stringify({ ...CFG, orgSlug: 'beta-co', orgName: 'Beta' }));
  fs.writeFileSync(
    path.join(clients, 'gamma.json'),
    JSON.stringify({ ...CFG, orgSlug: 'gamma-co', orgName: 'Gamma', channelMap: path.join(base, 'missing-map.json') }),
  );
  fs.mkdirSync(path.join(root, 'migration/out/beta'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'migration/out/beta/reconcile.json'),
    JSON.stringify({ result: 'PASS', notPresent: {} }),
  );
  let r = cycle([...B, '--concurrency', '3'], M_ENV);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--concurrency must be 1 or 2.*1 GB/);
  assert.equal(cycle([...B, '--concurrency', '0'], M_ENV).status, 2);
  assert.equal(cycle([...B, '--concurrency', 'two'], M_ENV).status, 2);
  assert.equal(cycle(['batch', '--clients', 'acme,acme', '--yes-load-into-staging'], M_ENV).status, 2);
  assert.equal(cycle(['batch', '--clients', 'acme,ghost', '--yes-load-into-staging'], M_ENV).status, 2);
  assert.equal(cycle(['batch', '--clients', 'acme'], M_ENV).status, 2, 'needs --yes-load-into-staging');
  assert.equal(lines(sshLog).length, 0, 'every refusal happens before the server is touched');
  // memory: 1000 MB is enough for one at a time, not for two
  r = cycle([...B, '--concurrency', '2'], { ...M_ENV, CYCLE_MEM_CMD: 'echo 1000' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /only 1000 MB.*1200 MB needed for 2/);
  assert.equal(lib.MIN_FREE_MB[2], 1200);
  assert.equal(lib.MAX_CONCURRENCY, 2);
  assert.equal(dockerCalls().length, 0);

  // two at a time with enough memory
  reset();
  r = cycle([...B, '--concurrency', '2'], M_ENV);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /batch summary \(2 client\(s\), concurrency 2/);
  assert.match(r.stdout, /\[acme\] migrate: load ok/);
  assert.match(r.stdout, /\[beta\] migrate: load ok/);
  assert.match(r.stdout, /acme\s+OK\s+[\d.]+\s+27\s+2\s+1/);
  assert.match(r.stdout, /beta\s+OK/);
  assert.match(r.stdout, /total\s+[\d.]+\s+54\s+4\s+2/);
  const bundleUploads = lines(sshLog).filter((l) =>
    l.argv[l.argv.length - 1].includes('bundle/waboo-migrate.cjs.part'),
  ).length;
  assert.equal(bundleUploads, 1, 'the bundle is shipped once for the whole batch');
  assert.ok(fs.existsSync(path.join(newestRun('acme'), 'timings.json')));
  assert.ok(fs.existsSync(path.join(newestRun('beta'), 'timings.json')));
  const bdir = path.join(base, 'runs/_batch');
  assert.equal(JSON.parse(fs.readFileSync(path.join(bdir, fs.readdirSync(bdir).sort().pop()), 'utf8')).clients.length, 2);

  // one client cannot ship (missing channel map): the other still completes, exit 1, resume line for the failed one
  reset();
  r = cycle(['batch', '--clients', 'gamma,acme', '--yes-load-into-staging', '--skip-build', '--skip-export', '--skip-dry-run-check', '--i-accept-no-dry-run'], M_ENV);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /gamma\s+STOPPED ship/);
  assert.match(r.stdout, /acme\s+OK/);
  assert.match(r.stdout, /resume: node pilot\/staging\/cycle\.cjs migrate --client gamma .* --from ship/);
});

test('existing commands print a timing line', () => {
  const r = cycle(['backup', '--client', 'acme'], M_ENV);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /timing: backup [\d.]+s/);
});

test('migrate --catch-up: forced export, load without credits, update, files; no flow-state; preflight WARN proceeds', () => {
  reset();
  const warnOut = 'WARN a migrations   2 applied migration(s) with no file here (database is ahead of this checkout)\n' + STEPOUT;
  const r = cycle([...MIG, '--catch-up'], { ...M_ENV, FAKE_DOCKER_OUT: warnOut });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(
    [...r.stdout.matchAll(/^migrate: (\w+) ok/gm)].map((m) => m[1]),
    ['export', 'ship', 'preflight', 'dry', 'backup', 'load', 'update', 'files', 'reconcile', 'report', 'complete'],
  );
  assert.equal(lines(exportLog).length, 1);
  assert.ok(lines(exportLog)[0].includes('--force'), 'catch-up forces the export');
  const inners = dockerCalls().map(innerOf);
  const load = inners.find((x) => /'run' '--client' 'acme' '--batch'/.test(x) && !x.includes('--dry-run'));
  assert.match(load, /'--skip-steps' 'credits,lead_sources,lead_events,lead_events_leads'/); // leads are off unless the client config says "leads": "on"
  assert.ok(inners.some((x) => x.includes("'update'") && x.includes("'--apply'")), 'update applied');
  assert.ok(!inners.some((x) => x.includes("'flow-state'")), 'no flow-state in a catch-up');
  // a fresh (non catch-up) chain never runs update
  reset();
  const f = cycle([...MIG, '--with-dry-run'], M_ENV);
  assert.doesNotMatch(f.stdout, /migrate: update/);
  // refusals and the resume command keeps --catch-up
  const bad = cycle([...MIG, '--catch-up', '--steps', 'access'], M_ENV);
  assert.match(bad.stdout, /do not combine it with --steps/);
  assert.match(lib.resumeCmd({ client: 'acme', 'catch-up': true }, 'update'), /--catch-up --from update/);
});

// geta_core reader stand-in for core-snapshot: writes <client>-core.json into --out with the readAt the test chose
const coreLog = path.join(base, 'core-opening.log');
const fakeCore = path.join(base, 'fake-core-opening.cjs');
fs.writeFileSync(
  fakeCore,
  `const fs=require('fs'),path=require('path');const a=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(coreLog)},JSON.stringify(a)+'\\n');
if(Number(process.env.FAKE_CORE_RC||0))process.exit(Number(process.env.FAKE_CORE_RC));
const c=a[a.indexOf('--client')+1];const out=a[a.indexOf('--out')+1];
fs.writeFileSync(path.join(out,c+'-core.json'),JSON.stringify({readOn:'2026-10-21',readAt:process.env.FAKE_CORE_READAT,workspace:{}}));
fs.writeFileSync(path.join(out,c+'-credit-opening.json'),'{}');
console.log('core-opening: '+c+': balance 1.00 INR');`,
);

test('migrate with a geta_core snapshot: export forced, snapshot read right after it and shipped with the dump', () => {
  reset();
  const coreFile = path.join(base, 'acmecore-core.json');
  fs.writeFileSync(coreFile, JSON.stringify({ readOn: '2026-10-19', readAt: '2026-10-19T13:18:00.000Z', stale: true }));
  fs.writeFileSync(path.join(clients, 'acmecore.json'), JSON.stringify({ ...CFG, orgSlug: 'acme-core', coreFile }));
  fs.writeFileSync(coreLog, '');
  const env = { ...M_ENV, CORE_OPENING_BIN: fakeCore, FAKE_CORE_READAT: '2026-10-21T13:59:00.000Z' };
  const MIG_CORE = ['migrate', '--client', 'acmecore', '--db', 'acme_waboo', '--yes-load-into-staging', '--with-dry-run'];
  let r = cycle([...MIG_CORE, '--stop-after', 'ship'], env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(
    [...r.stdout.matchAll(/^migrate: ([\w-]+) ok/gm)].map((m) => m[1]),
    ['export', 'core-snapshot', 'ship'],
  );
  assert.match(r.stdout, /export: forced, the geta_core snapshot is taken right after it/);
  assert.ok(lines(exportLog)[0].includes('--force'), 'a client with a snapshot never reuses its dump');
  const [call] = lines(coreLog);
  assert.equal(call[call.indexOf('--workspace') + 1], 'acme_waboo');
  assert.equal(call[call.indexOf('--client') + 1], 'acmecore');
  const shipped = JSON.parse(fs.readFileSync(path.join(root, 'migration/dumps/acmecore/core.json'), 'utf8'));
  assert.equal(shipped.readAt, '2026-10-21T13:59:00.000Z', 'the shipped core.json is the fresh snapshot');
  assert.equal(shipped.stale, undefined);

  // --skip-export keeps the snapshot the config names: nothing is read from geta_core
  reset();
  fs.writeFileSync(coreLog, '');
  fs.writeFileSync(coreFile, JSON.stringify({ readOn: '2026-10-19', readAt: '2026-10-19T13:18:00.000Z', stale: true }));
  r = cycle([...MIG_CORE, '--skip-export', '--stop-after', 'ship'], env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /core-snapshot: skipped \(--skip-export\)/);
  assert.equal(lines(coreLog).length, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'migration/dumps/acmecore/core.json'), 'utf8')).stale, true);

  // a failing reader stops the run before anything is shipped
  reset();
  r = cycle([...MIG_CORE, '--stop-after', 'ship'], { ...env, FAKE_CORE_RC: '1' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /core-snapshot: geta_core was not read \(core-opening exit 1\)/);
  assert.doesNotMatch(r.stdout, /migrate: ship ok/);

  // a reader that writes no readAt is refused and the operator's core.json stays as it was
  reset();
  r = cycle([...MIG_CORE, '--stop-after', 'ship'], { ...env, FAKE_CORE_READAT: '' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /core-snapshot: core-opening wrote no readAt; core\.json is not replaced/);
  assert.equal(JSON.parse(fs.readFileSync(coreFile, 'utf8')).stale, true);
});

test('new-client --channel-map-file: the real number is the channel map; bad entries are refused', () => {
  const cdir = path.join(base, 'clients3');
  const mapFile = path.join(base, 'real-map.json');
  fs.writeFileSync(mapFile, JSON.stringify({ 'bot-1': { kind: 'whatsapp_cloud', externalId: '1068225693034592', displayAddress: '+6562502280', name: 'Real Name' } }));
  const NC = ['new-client', '--client', 'realco', '--name', 'Real Co', '--slug', 'real-co', '--owner-email', 'o@real.example', '--owner-name', 'Rae'];
  let r = cycle([...NC, '--channel-map-file', mapFile], { ...M_ENV }, cdir);
  assert.equal(r.status, 0, r.stderr);
  const cfg = JSON.parse(fs.readFileSync(path.join(cdir, 'realco.json'), 'utf8'));
  const map = JSON.parse(fs.readFileSync(cfg.channelMap, 'utf8'));
  assert.equal(map['bot-1'].externalId, '1068225693034592');
  assert.equal(map['bot-1'].displayAddress, '+6562502280');
  assert.doesNotMatch(JSON.stringify(map) + cfg._comment, /PLACEHOLDER/);
  fs.writeFileSync(mapFile, JSON.stringify({ b: { kind: 'whatsapp_cloud', externalId: 'abc', name: 'x' } }));
  r = cycle([...NC.map((x) => (x === 'realco' ? 'realco2' : x === 'real-co' ? 'real-co2' : x)), '--channel-map-file', mapFile], { ...M_ENV }, cdir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /numeric externalId/);
});

test('wa-numbers buildMap: pairs by chatbot_id, falls back to the single number, never guesses', () => {
  const { buildMap } = require(path.resolve(__dirname, '../staging/wa-numbers.cjs'));
  const doc = (bot, id, extra = {}) => ({ chatbot_id: bot, config_value: { phoneID: id, display_number: '+65 6250 2280', display_name: 'ISKM' }, ...extra });
  let r = buildMap({ botids: ['a'], docs: [doc('a', '1068225693034592')] }, 'Org');
  assert.deepEqual(r.map.a, { kind: 'whatsapp_cloud', externalId: '1068225693034592', name: 'ISKM', displayAddress: '+6562502280' });
  assert.deepEqual(r.unresolved, []);
  r = buildMap({ botids: ['a'], docs: [doc('other', '1068225693034592')] }, 'Org'); // one botid, one number
  assert.equal(r.map.a.externalId, '1068225693034592');
  r = buildMap({ botids: ['a', 'b'], docs: [doc('x', '1068225693034592')] }, 'Org'); // ambiguous: not guessed
  assert.deepEqual([r.map, r.unresolved], [{}, ['a', 'b']]);
  r = buildMap({ botids: ['a'], docs: [doc('a', '1068225693034592', { is_active: false })] }, 'Org'); // inactive is ignored
  assert.deepEqual(r.unresolved, ['a']);
  r = buildMap({ botids: ['a'], docs: [doc('a', '1068225693034592'), doc('a', '1068225693034599')] }, 'Org'); // two live numbers
  assert.deepEqual(r.unresolved, ['a']);
});
