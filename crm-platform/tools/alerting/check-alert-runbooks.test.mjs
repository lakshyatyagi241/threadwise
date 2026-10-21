// Run: node --test tools/alerting/check-alert-runbooks.test.mjs
// Proves the ratchet passes on the repo and FAILS on each kind of bad example (made in a temp copy of the files it reads).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from './check-alert-runbooks.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILES = ['deploy/observability', 'docs/performance/alerting', 'docs/runbooks', 'docs/performance/event-loop', 'docs/performance/queue-capacity', 'docs/performance/resource-limits', 'deploy/hostinger/README.md'];

function copy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-'));
  for (const f of FILES) fs.cpSync(path.join(REPO, f), path.join(dir, f), { recursive: true, filter: (s) => !s.includes('/grafana') });
  return dir;
}
const edit = (dir, f, fn) => { const p = path.join(dir, f); fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8'))); };
const P0 = 'deploy/observability/p0-failure-modes.rules.yml';
const MX = 'docs/performance/alerting/failure-modes.json';

test('the repo passes', () => assert.deepEqual(check(REPO), []));

test('fails: alert without a runbook annotation', () => {
  const d = copy();
  edit(d, P0, (s) => s.replace(/ {10}runbook: 'docs\/runbooks\/p0-failure-modes.md#redisdown'\n/, ''));
  assert.match(check(d).join('\n'), /RedisDown .*no runbook annotation/);
});

test('fails: runbook anchor does not exist', () => {
  const d = copy();
  edit(d, P0, (s) => s.replace('#redisdown', '#no-such-section'));
  assert.match(check(d).join('\n'), /anchor #no-such-section not found/);
});

test('fails: runbook file does not exist', () => {
  const d = copy();
  edit(d, P0, (s) => s.replace('p0-failure-modes.md#redisdown', 'missing-file.md#x'));
  assert.match(check(d).join('\n'), /missing-file.md does not exist/);
});

test('fails: new alert not in the matrix', () => {
  const d = copy();
  edit(d, P0, (s) => `${s}\n      - alert: BrandNewAlert\n        expr: up == 0\n        annotations:\n          runbook: 'docs/runbooks/p0-failure-modes.md#redisdown'\n`);
  assert.match(check(d).join('\n'), /BrandNewAlert .*not in failure-modes.json/);
});

test('fails: matrix points at an alert that is in no rules file', () => {
  const d = copy();
  edit(d, MX, (s) => s.replace('"RedisDown", "CacheErrorRatioHigh"', '"RedisDown", "GhostAlert"'));
  assert.match(check(d).join('\n'), /GhostAlert is not in any rules file/);
});

test('fails: a gap without the missing metric name', () => {
  const d = copy();
  edit(d, MX, (s) => s.replace(/"missingMetric": "pg_replication_lag_seconds[^"]*"/, '"missingMetric": ""'));
  assert.match(check(d).join('\n'), /pg-replica-lag: gap without gap.missingMetric/);
});

test('fails: claimed tested but no promtool case', () => {
  const d = copy();
  edit(d, 'deploy/observability/p0-failure-modes.rules.test.yml', (s) => s.replaceAll('alertname: RedisMemoryNearMax', 'alertname: Other'));
  assert.match(check(d).join('\n'), /RedisMemoryNearMax claimed tested but has no promtool case/);
});
