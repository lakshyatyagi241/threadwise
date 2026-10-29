import test from 'node:test';
import assert from 'node:assert/strict';
import { writeKey } from './compare-engines.mjs';

const recorder = () => {
  const calls = [];
  const p = new Proxy(
    {},
    {
      get:
        (_, cmd) =>
        (...a) =>
          calls.push([cmd, ...a]),
    },
  );
  return { calls, p };
};

test('writeKey rebuilds each type with the matching command', () => {
  const { calls, p } = recorder();
  writeKey(p, 's', 'string', 'v');
  writeKey(p, 'h', 'hash', { f: '1' });
  writeKey(p, 'l', 'list', ['a', 'b']);
  writeKey(p, 'z', 'zset', ['m1', '1', 'm2', '2']);
  writeKey(p, 'x', 'stream', [['1-0', ['k', 'v']]]);
  assert.deepEqual(calls, [
    ['set', 's', 'v'],
    ['hset', 'h', { f: '1' }],
    ['rpush', 'l', 'a', 'b'],
    ['zadd', 'z', '1', 'm1', '2', 'm2'], // ZRANGE WITHSCORES gives member, score pairs; ZADD wants score, member
    ['xadd', 'x', '1-0', 'k', 'v'],
  ]);
});
test('empty hashes, lists and sets queue nothing (Redis does not keep them)', () => {
  const { calls, p } = recorder();
  writeKey(p, 'h', 'hash', {});
  writeKey(p, 'l', 'list', []);
  writeKey(p, 'z', 'zset', []);
  assert.deepEqual(calls, []);
});
