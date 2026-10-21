import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from './gate.mjs';

const route = (key, cls = 'credential') => ({ key, class: cls, public: true });
const rec = (key, cls, over = {}) => ({
  key,
  class: cls,
  limited: false,
  sent: 120,
  fiveXX: 0,
  ...over,
});
const decision = (route, over = {}) => ({
  route,
  severity: 'Medium',
  rationale: 'a token with 256 bits of entropy',
  owner: 'auth',
  expires: '2099-01-01',
  ...over,
});
const run = (o) => evaluate({ inventory: { deploy: { problems: [] } }, today: '2026-10-22', ...o });
const rules = (r) => r.findings.map((f) => `${f.rule}:${f.severity}`).sort();

test('R1: a public route with no census record blocks until it is measured', () => {
  const r = run({
    selected: [route('POST /v2/auth/new-login')],
    census: { results: [] },
    decisions: { decisions: [] },
  });
  assert.equal(r.verdict, 'NO-GO');
  assert.deepEqual(rules(r), ['R1:High']);
});

test('R2: an unlimited credential route with no decision blocks as Critical, an unlimited public read only as Medium', () => {
  const census = {
    results: [rec('POST /v2/auth/login', 'credential'), rec('GET /v2/public/blog', 'public-read')],
  };
  const r = run({ selected: [], census, decisions: { decisions: [] } });
  assert.deepEqual(rules(r), ['R2:Critical', 'R2:Medium']);
  assert.equal(r.verdict, 'NO-GO');
});

test('a limited route needs nothing', () => {
  const r = run({
    selected: [],
    census: { results: [rec('POST /v2/auth/login', 'credential', { limited: true })] },
    decisions: { decisions: [] },
  });
  assert.equal(r.verdict, 'GO');
  assert.deepEqual(r.findings, []);
});

test('a written Medium decision accepts an unlimited route, and is listed, not silent', () => {
  const r = run({
    selected: [],
    census: { results: [rec('POST /v2/auth/reset-password', 'credential')] },
    decisions: { decisions: [decision('POST /v2/auth/reset-password')] },
  });
  assert.equal(r.verdict, 'GO');
  assert.deepEqual(rules(r), ['accepted:Medium']);
});

test('R3: a Critical or High decision is never an acceptance', () => {
  for (const severity of ['Critical', 'High']) {
    const r = run({
      selected: [],
      census: { results: [rec('POST /v2/x', 'credential')] },
      decisions: { decisions: [decision('POST /v2/x', { severity })] },
    });
    assert.equal(r.verdict, 'NO-GO', severity);
    assert.deepEqual(rules(r), [`R3:${severity}`]);
  }
});

test('R2: a decision missing its owner, reason or expiry, or past its expiry, blocks', () => {
  const census = { results: [rec('POST /v2/x', 'public-write')] };
  assert.equal(
    run({ selected: [], census, decisions: { decisions: [decision('POST /v2/x', { owner: '' })] } })
      .verdict,
    'NO-GO',
  );
  assert.equal(
    run({
      selected: [],
      census,
      decisions: { decisions: [decision('POST /v2/x', { rationale: '' })] },
    }).verdict,
    'NO-GO',
  );
  assert.equal(
    run({
      selected: [],
      census,
      decisions: { decisions: [decision('POST /v2/x', { expires: '2026-01-01' })] },
    }).verdict,
    'NO-GO',
  );
});

test('R4: a decision for a route that is now limited, or gone, is stale and listed', () => {
  const census = { results: [rec('POST /v2/x', 'credential', { limited: true })] };
  const r = run({
    selected: [],
    census,
    decisions: { decisions: [decision('POST /v2/x'), decision('POST /v2/gone')] },
  });
  assert.deepEqual(rules(r), ['R4:Medium', 'R4:Medium']);
  assert.equal(r.verdict, 'GO');
});

test('R5: a route that answers 5xx under flood blocks as High', () => {
  const r = run({
    selected: [],
    census: {
      results: [rec('POST /v2/x', 'public-write', { limited: true, fiveXX: 3, firstFiveXX: 500 })],
    },
    decisions: { decisions: [] },
  });
  assert.deepEqual(rules(r), ['R5:High']);
  assert.equal(r.verdict, 'NO-GO');
});

test('R6: a failed probe blocks at its declared severity; a Low failure is only listed', () => {
  const probes = {
    results: [
      { id: 'a', status: 'FAIL', severityIfFails: 'Critical', detail: 'd' },
      { id: 'b', status: 'FAIL', severityIfFails: 'Low', detail: 'd' },
      { id: 'c', status: 'PASS' },
      { id: 'd', status: 'SKIP' },
    ],
  };
  const r = run({ selected: [], census: { results: [] }, decisions: { decisions: [] }, probes });
  assert.deepEqual(rules(r), ['R6:Critical', 'R6:Low']);
  assert.equal(r.blockers.length, 1);
});

test('R6: a probe that could not run (ERROR) blocks, and a known Medium failure is accepted but a known High is not', () => {
  const err = run({
    selected: [],
    census: { results: [] },
    decisions: { decisions: [] },
    probes: { results: [{ id: 'a', status: 'ERROR', severityIfFails: 'Low', detail: 'oracle' }] },
  });
  assert.equal(err.verdict, 'NO-GO');
  const known = {
    knownProbeFailures: [
      { id: 'm', rationale: 'tracked' },
      { id: 'h', rationale: 'tracked' },
    ],
    decisions: [],
  };
  const p = {
    results: [
      { id: 'm', status: 'FAIL', severityIfFails: 'Medium', detail: '' },
      { id: 'h', status: 'FAIL', severityIfFails: 'High', detail: '' },
    ],
  };
  const r = run({ selected: [], census: { results: [] }, decisions: known, probes: p });
  assert.deepEqual(rules(r), ['R6:High', 'accepted:Medium']);
});

test('R7: a deploy file that turns the limiter off blocks as Critical', () => {
  const r = evaluate({
    inventory: {
      deploy: {
        problems: [
          { file: 'a.yml', name: 'TRUST_PROXY', value: 'true', why: 'trusts every proxy' },
        ],
      },
    },
    selected: [],
    census: { results: [] },
    decisions: { decisions: [] },
  });
  assert.deepEqual(rules(r), ['R7:Critical']);
});
