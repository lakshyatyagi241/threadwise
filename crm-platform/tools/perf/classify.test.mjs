import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build, check, classify, summary } from './classify.mjs';

const r = (method, url, pub = false) => ({ method, url, public: pub, file: 'x.controller.ts' });

test('a single-record read is class A', () =>
  assert.equal(classify(r('GET', '/v2/contacts/:id')).class, 'A'));
test('a plain list read is class A', () =>
  assert.equal(classify(r('GET', '/v2/contacts')).class, 'A'));
test('a search is class B', () =>
  assert.equal(classify(r('GET', '/v2/contacts/search')).class, 'B'));
test('a write is class B', () => assert.equal(classify(r('PATCH', '/v2/contacts/:id')).class, 'B'));
test('a report is class C even as a GET', () =>
  assert.equal(classify(r('GET', '/v2/reports/messages')).class, 'C'));
test('an export or bulk call is class C', () => {
  assert.equal(classify(r('POST', '/v2/contacts/export')).class, 'C');
  assert.equal(classify(r('POST', '/v2/contacts/bulk-delete')).class, 'C');
});
test('a send that reaches a provider is class C', () =>
  assert.equal(classify(r('POST', '/v2/messages/send')).class, 'C'));
test('an override beats the rules and is marked reviewed', () => {
  const c = classify(r('GET', '/v2/reports/x'), {
    'GET /v2/reports/x': { class: 'A', reason: 'one cached row' },
  });
  assert.deepEqual([c.class, c.reviewed], ['A', true]);
});
test('duplicates collapse and the list is sorted', () => {
  const e = build([r('GET', '/b'), r('GET', '/a'), r('GET', '/a')]);
  assert.deepEqual(
    e.map((x) => x.route),
    ['GET /a', 'GET /b'],
  );
});
test('check finds an unclassified route, a gone route and a bad class', () => {
  const e = [
    { route: 'GET /gone', class: 'A' },
    { route: 'GET /bad', class: 'Z' },
  ];
  const errors = check(e, [r('GET', '/new'), r('GET', '/bad')]);
  assert.ok(errors.some((x) => x.includes('no class for GET /new')));
  assert.ok(errors.some((x) => x.includes('GET /gone')));
  assert.ok(errors.some((x) => x.includes('"Z"')));
});
test('check refuses an override without a reason', () => {
  assert.ok(
    check([{ route: 'GET /a', class: 'A' }], [r('GET', '/a')], { 'GET /a': { class: 'B' } })
      .length > 0,
  );
});
test('summary counts per class', () =>
  assert.deepEqual(summary([{ class: 'A' }, { class: 'C' }, { class: 'A' }]), {
    A: 2,
    B: 0,
    C: 1,
  }));
