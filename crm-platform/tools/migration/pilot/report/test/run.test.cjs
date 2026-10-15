// node pilot/report/test/run.test.cjs  (from tools/migration). Hand-made input in test/sample; output goes to a temp dir only.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build, piiHits, pct } = require('../migration-complete.cjs');

const S = path.join(__dirname, 'sample');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-'));
const runs = path.join(out, 'runs'); // copied so the per-run files do not land in the checked-in sample
fs.cpSync(path.join(S, 'runs'), runs, { recursive: true });
const res = build({
  runsDir: runs,
  outDir: out,
  clients: ['iskm', 'rhythm', 'ghost'],
  workDir: path.join(S, 'work'),
});
const combined = res[0];
const feat = (cl, id) =>
  combined.json.clients.find((c) => c.client === cl).features.find((f) => f.id === id);

test('percent formula and n/a', () => {
  assert.strictEqual(pct(4487, 4488), '100.0%');
  assert.strictEqual(pct(95, 200), '47.5%');
  assert.strictEqual(pct(0, 0), 'n/a');
});

test('contacts numbers come from the newest report', () => {
  const f = feat('iskm', 'contacts');
  assert.deepStrictEqual(
    [f.read, f.migrated, f.quarantined, f.excluded, f.unaccounted],
    [4488, 4487, 1, 0, 0],
  );
  assert.strictEqual(f.postgresRows, 4487);
  assert.strictEqual(f.status, 'PARTIAL');
  assert.deepStrictEqual(f.quarantineReasons, { INVALID_PHONE: 1 });
  assert.strictEqual(f.verifier, 'PASS');
  assert.match(combined.md, /4,487 of 4,488 loadable documents were migrated \(100\.0%\)/);
});

test('denominator is read minus excluded; migrated/read shown too', () => {
  const f = feat('iskm', 'inbox'); // read 200, migrated 190, excluded 10
  assert.strictEqual(f.migratedPercent, 100);
  assert.strictEqual(f.migratedOfReadPercent, 95);
  assert.deepStrictEqual(f.excludedReasons, { 'chathistory: WEBCHAT_NO_CHANNEL': 10 });
});

test('alarms make the feature FAIL with codes and the client HAS ALARMS', () => {
  assert.match(feat('iskm', 'inbox').verifier, /^FAIL \(.*ORACLE_MISMATCH.*\)/);
  assert.match(feat('iskm', 'inbox').verifier, /EXTRA_ROWS/);
  assert.strictEqual(combined.json.clients[0].verdict, 'HAS ALARMS');
  assert.match(combined.md, /- ORACLE_MISMATCH: chathistory conversations differ for 2 threads/);
});

test('NOT RUN, NOT BUILT, ON HOLD, missing client', () => {
  assert.strictEqual(feat('rhythm', 'inbox').status, 'NOT RUN');
  assert.strictEqual(feat('rhythm', 'inbox').verifier, 'NOT RUN');
  assert.strictEqual(feat('iskm', 'files').status, 'NOT BUILT');
  assert.strictEqual(feat('iskm', 'rag').status, 'ON HOLD');
  assert.strictEqual(feat('iskm', 'decision').status, 'NOT MIGRATED BY DECISION');
  assert.strictEqual(combined.json.clients.find((c) => c.client === 'ghost').verdict, 'NOT RUN');
  assert.strictEqual(combined.json.clients[1].verdict, 'COMPLETE FOR BUILT FEATURES');
});

test('fallbacks print "not available in this run"', () => {
  assert.match(combined.md, /Log: not available in this run/); // no missing-in-wadesk-log.md in the sample work dir
  assert.match(combined.md, /not available in this run/);
  assert.match(combined.md, /Tool build: git sha abc1234/);
  assert.match(combined.md, /loader step NOT RUN: credits opening file missing/);
});

test('files are written for the combined and the newest per-run document only', () => {
  assert.ok(fs.existsSync(path.join(out, 'migration-complete.md')));
  assert.ok(fs.existsSync(path.join(out, 'migration-complete.json')));
  assert.ok(
    fs.existsSync(path.join(runs, 'iskm', '2026-10-12T10-00-00Z', 'migration-complete.md')),
  );
  assert.ok(
    !fs.existsSync(path.join(runs, 'iskm', '2026-10-11T09-00-00Z', 'migration-complete.md')),
  );
});

test('no email or phone-like strings are written, and the generator fails if one appears', () => {
  assert.deepStrictEqual(piiHits(combined.md + JSON.stringify(combined.json)), []);
  assert.ok(piiHits('mail a.b@example.com').length);
  assert.ok(piiHits('call +91 98765 43210').length);
  assert.ok(piiHits('919876543210').length);
  const bad = path.join(out, 'bad');
  fs.cpSync(runs, bad, { recursive: true });
  const p = path.join(bad, 'iskm', '2026-10-12T10-00-00Z', 'reconcile.json');
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  j.warnings.push('leaked jane.doe@example.com');
  fs.writeFileSync(p, JSON.stringify(j));
  assert.throws(
    () =>
      build({
        runsDir: bad,
        outDir: path.join(out, 'bad-out'),
        clients: ['iskm'],
        workDir: path.join(S, 'work'),
      }),
    /PII-like/,
  );
  assert.ok(!fs.existsSync(path.join(out, 'bad-out', 'migration-complete.md')));
});
