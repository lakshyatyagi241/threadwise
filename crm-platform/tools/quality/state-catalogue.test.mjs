import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baselineOf,
  buildFeature,
  factsOf,
  problems,
  renderReport,
  statsOf,
  titlesOf,
} from './state-catalogue.mjs';

const src = (text, file = 'apps/web/src/features/x/a.tsx') => [{ file, text }];
const listScreen = `
  const q = useQuery({ queryFn: () => apiFetch('/things') });
  if (q.isError) return <LoadError />;
  if (q.isPending) return <Spinner />;
  if (q.data.length === 0) return <EmptyState title="none" />;
  return <table><tbody /></table>;
`;

test('titlesOf reads test titles, not comments or imports', () => {
  const t = titlesOf(
    `// it('in a comment')\nimport x from 'empty'\nit('shows an empty state', () => {})\ndescribe("group", () => {})`,
  );
  assert.ok(t.includes('shows an empty state'));
  assert.ok(!t.includes('empty'));
});

test('factsOf: a read-only list is not a form and has no id route', () => {
  const f = factsOf(listScreen);
  assert.equal(f.read, true);
  assert.equal(f.list, true);
  assert.equal(f.form, false);
  assert.equal(f.byId, false);
});

test('a feature with no API call is not applicable, with a reason', () => {
  const d = buildFeature('error', {
    feature: 'x',
    sources: src('export const a = 1;'),
    tests: [],
    tier: 'P1',
  });
  assert.equal(d.applicable, false);
  assert.match(d.reason, /no API call/);
  assert.deepEqual(d.cases, []);
});

test('error cases: LOAD is handled, ids are stable, priority follows the tier', () => {
  const d = buildFeature('error', {
    feature: 'x',
    sources: src(listScreen),
    tests: [],
    tier: 'P0',
  });
  const load = d.cases.find((x) => x.key === 'LOAD');
  assert.equal(load.id, 'ES-x-001');
  assert.equal(load.handled, 'yes');
  assert.equal(load.priority, 'P0');
  assert.equal(load.status, 'gap');
  assert.equal(d.cases.find((x) => x.key === 'FORBIDDEN').priority, 'P1');
});

test('a test title that matches makes the case covered and is recorded', () => {
  const tests = [
    { file: 'apps/web/src/features/x/a.test.tsx', titles: ['shows an error state with a retry'] },
  ];
  const d = buildFeature('error', { feature: 'x', sources: src(listScreen), tests, tier: 'P1' });
  const load = d.cases.find((x) => x.key === 'LOAD');
  assert.equal(load.status, 'covered');
  assert.deepEqual(load.tests, [{ file: tests[0].file, match: tests[0].titles[0] }]);
});

test('empty cases: FILTERED needs a filter, and a missing branch reads "no"', () => {
  const plain = buildFeature('empty', {
    feature: 'x',
    sources: src(listScreen),
    tests: [],
    tier: 'P1',
  });
  assert.ok(!plain.cases.some((x) => x.key === 'FILTERED'));
  const bare = buildFeature('empty', {
    feature: 'x',
    sources: src(`const q = useQuery({}); return <SearchBox /><table><tbody /></table>;`),
    tests: [],
    tier: 'P1',
  });
  assert.equal(bare.cases.find((x) => x.key === 'FIRST').handled, 'no');
  assert.ok(bare.cases.some((x) => x.key === 'FILTERED'));
});

test('problems: stale file, missing file, bad trace and a grown gap are all reported', () => {
  const d = buildFeature('error', {
    feature: 'x',
    sources: src(listScreen),
    tests: [],
    tier: 'P1',
  });
  const text = JSON.stringify(d, null, 2) + '\n';
  assert.deepEqual(
    problems(
      'error',
      [d],
      { 'x.json': text },
      baselineOf([d]),
      () => true,
      () => '',
    ),
    [],
  );
  assert.match(
    problems(
      'error',
      [d],
      {},
      null,
      () => true,
      () => '',
    )[0],
    /missing/,
  );
  assert.match(
    problems(
      'error',
      [d],
      { 'x.json': text + ' ' },
      null,
      () => true,
      () => '',
    )[0],
    /out of date/,
  );
  const covered = {
    ...d,
    cases: [{ ...d.cases[0], status: 'covered', tests: [{ file: 'f.test.ts', match: 'a title' }] }],
  };
  const ct = JSON.stringify(covered, null, 2) + '\n';
  assert.match(
    problems(
      'error',
      [covered],
      { 'x.json': ct },
      null,
      () => false,
      () => '',
    )[0],
    /does not exist/,
  );
  assert.match(
    problems(
      'error',
      [covered],
      { 'x.json': ct },
      null,
      () => true,
      () => 'other',
    )[0],
    /no title/,
  );
  const worse = { gaps: { x: 0 }, notHandled: { x: 99 } };
  assert.match(
    problems(
      'error',
      [d],
      { 'x.json': text },
      worse,
      () => true,
      () => '',
    )[0],
    /grew/,
  );
});

test('renderReport lists every feature, applicable or not', () => {
  const a = buildFeature('empty', {
    feature: 'a',
    sources: src(listScreen),
    tests: [],
    tier: 'P1',
  });
  const b = buildFeature('empty', {
    feature: 'b',
    sources: src('export const z = 1;'),
    tests: [],
    tier: 'P1',
  });
  const md = renderReport('empty', [a, b]);
  assert.match(md, /2 web features: 1 applicable, 1 not applicable/);
  assert.match(md, /\| b \| The feature shows no list/);
  assert.equal(statsOf(a).cases, a.cases.length);
});

test('a covered case listed as partial carries the reason; a gap never does', () => {
  const tests = [
    {
      file: 'a.test.tsx',
      titles: ['shows an error state with a retry when the list fails to load'],
    },
  ];
  const partial = { 'ES-x-001': 'only the helper is tested', 'ES-x-002': 'no test, so no partial' };
  const d = buildFeature('error', {
    feature: 'x',
    sources: src(listScreen),
    tests,
    tier: 'P1',
    partial,
  });
  assert.equal(d.cases.find((x) => x.id === 'ES-x-001').partial, 'only the helper is tested');
  assert.equal(d.cases.find((x) => x.id === 'ES-x-002')?.partial, undefined);
  assert.equal(statsOf(d).partial, 1);
});
