import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCpu, parseProcTicks, parseRss } from './sample.mjs';

test('reads resident memory from /proc status text', () =>
  assert.equal(parseRss('Name:\tnode\nVmRSS:\t  204800 kB\nThreads:\t9\n'), 200));
test('gives null when the line is missing', () => assert.equal(parseRss('Name:\tnode\n'), null));
test('gives null for no text', () => assert.equal(parseRss(undefined), null));

test('whole-machine CPU: busy is everything except idle and iowait', () => {
  assert.deepEqual(parseCpu('cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 1 1 1 1 1 1 1 1 1 1\n'), {
    busy: 150,
    total: 1000,
  });
  assert.equal(parseCpu('nothing'), null);
});
test('process CPU ticks: user + system time, even when the command name holds spaces', () => {
  const line =
    '1234 (node my app) S 1 1234 1234 0 -1 4194560 100 0 0 0 700 300 0 0 20 0 9 0 1000 1000000 5000 18446744073709551615';
  assert.equal(parseProcTicks(line), 1000);
  assert.equal(parseProcTicks(undefined), null);
});
