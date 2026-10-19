// Run: node --test tools/api-inventory/verdict.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verdict } from './verdict.mjs';

test('a 2xx with a p95 is a latency result', () => {
  assert.equal(verdict({ status: 200, p95: 40 }, true).kind, 'timed');
});

test('an error status is never a latency result, and says why', () => {
  assert.equal(verdict({ status: 404, resolved: false }, true).kind, 'nodata');
  assert.match(verdict({ status: 404, resolved: false }, true).why, /no sample record/);
  assert.equal(verdict({ status: 404, resolved: true }, true).why, '404: no such record');
  assert.equal(verdict({ status: 401 }, true).kind, 'auth');
  assert.equal(verdict({ status: 403 }, true).kind, 'gated');
  assert.equal(verdict({ status: 422 }, true).kind, 'input');
  assert.equal(verdict({ status: 429 }, true).kind, 'throttled');
  assert.equal(verdict({ status: 500 }, true).kind, 'error');
});

test('a write is not run, and a GET with no timing is "not called"', () => {
  assert.equal(verdict(undefined, false).kind, 'write');
  assert.equal(verdict(undefined, true).kind, 'none');
});
