import test from 'node:test';
import assert from 'node:assert/strict';
import { watch } from './incident-watch.mjs';

// Drives watch() with scripted API answers and a fake clock; the sleeps advance time and end the run when the script is used up.
const run = async (script, opts = {}) => {
  const lines = [];
  let t = 0,
    i = 0;
  const code = await watch({
    fetchOpen: async () => {
      const s = script[i++];
      if (s instanceof Error) throw s;
      return s;
    },
    out: (l) => lines.push(l),
    sleep: async (ms) => {
      t += ms;
    },
    now: () => t,
    stop: () => i >= script.length,
    pollMs: 20_000,
    remindMs: 30 * 60_000,
    maxPollMs: 120_000,
    ...opts,
  });
  return { lines, code };
};
const inc = (id, extra = {}) => ({ id, kind: 'critical_alert', owner: null, ...extra });

test('emits NEW once per unowned open incident, not again on later polls', async () => {
  const { lines, code } = await run([
    [inc('inc-a-1')],
    [inc('inc-a-1')],
    [inc('inc-a-1'), inc('inc-b-2', { kind: 'deploy_failure' })],
  ]);
  assert.deepEqual(lines, ['NEW inc-a-1 critical_alert', 'NEW inc-b-2 deploy_failure']);
  assert.equal(code, 0);
});

test('ignores claimed incidents and quiet polls', async () => {
  const { lines } = await run([[], [inc('inc-a-1', { owner: 'Vedant-Claude' })]]);
  assert.deepEqual(lines, []);
});

test('an incident released back to open is only reminded after remindMs, not re-announced every poll', async () => {
  const { lines } = await run(
    [[inc('inc-a-1')], [inc('inc-a-1', { owner: 'X' })], [inc('inc-a-1')]],
    { remindMs: 10 * 60_000 },
  );
  assert.deepEqual(lines, ['NEW inc-a-1 critical_alert']);
  const long = await run(
    [[inc('inc-a-1')], ...Array.from({ length: 90 }, () => [inc('inc-a-1')])],
    { remindMs: 10 * 60_000 },
  );
  assert.ok(
    long.lines.length >= 2 && long.lines.every((l, k) => l.startsWith(k === 0 ? 'NEW' : 'REMIND')),
    long.lines.join('|'),
  );
});

test('untrusted fields cannot inject text into the event line', async () => {
  const { lines } = await run([
    [
      inc('inc-a-1', { kind: 'x\nNEW inc-evil-9 critical_alert' }),
      inc('bad id\nNEW inc-evil-9 critical_alert'),
    ],
  ]);
  assert.deepEqual(lines, ['NEW inc-a-1 unknown']);
});

test('API errors are reported once, recovery once, and polling backs off', async () => {
  const sleeps = [];
  const { lines, code } = await run(
    [
      new Error('cannot reach the incident API'),
      new Error('cannot reach the incident API'),
      [inc('inc-a-1')],
    ],
    {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    },
  );
  assert.deepEqual(lines, [
    'ERROR cannot reach the incident API',
    'OK incident API reachable again',
    'NEW inc-a-1 critical_alert',
  ]);
  assert.deepEqual(sleeps, [40_000, 80_000, 20_000]);
  assert.equal(code, 0);
});

test('a wrong login or token ends the watch with exit 1 instead of retrying forever', async () => {
  const fatal = Object.assign(new Error('refused (401): unauthorized'), { fatal: true });
  const { lines, code } = await run([fatal, [inc('inc-a-1')]]);
  assert.deepEqual(lines, ['ERROR refused (401): unauthorized']);
  assert.equal(code, 1);
});
