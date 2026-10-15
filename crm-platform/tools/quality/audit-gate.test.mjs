import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gate } from './audit-gate.mjs';

const adv = (id, severity, name = 'pkg') => ({
  github_advisory_id: id,
  severity,
  module_name: name,
  title: 't',
});
const report = (...list) => ({ advisories: Object.fromEntries(list.map((a, i) => [i, a])) });

test('a high advisory in a production dependency blocks', () => {
  const prod = report(adv('GHSA-1', 'high'));
  const r = gate({ prod, all: prod, accepted: [] });
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 1);
});

test('a critical advisory in a development dependency blocks, a high one only reports', () => {
  const prod = report();
  assert.equal(gate({ prod, all: report(adv('GHSA-2', 'critical')), accepted: [] }).ok, false);
  const high = gate({ prod, all: report(adv('GHSA-3', 'high')), accepted: [] });
  assert.equal(high.ok, true);
  assert.match(high.reported[0], /^reported/);
});

test('moderate and low never block', () => {
  const prod = report(adv('GHSA-4', 'moderate'), adv('GHSA-5', 'low'));
  assert.equal(gate({ prod, all: prod, accepted: [] }).ok, true);
});

test('an accepted finding passes while it is in date and fails once it has expired', () => {
  const all = report(adv('GHSA-6', 'critical'));
  const prod = report();
  const accepted = [{ id: 'GHSA-6', reason: 'dev only', expires: '2026-12-31' }];
  assert.equal(gate({ prod, all, accepted, today: '2026-10-09' }).ok, true);
  assert.equal(gate({ prod, all, accepted, today: '2027-01-01' }).ok, false);
});

test('an accepted entry with no reason or no end date is refused', () => {
  const r = gate({
    prod: report(),
    all: report(),
    accepted: [{ id: 'GHSA-7', reason: '', expires: '' }],
  });
  assert.equal(r.ok, false);
});
