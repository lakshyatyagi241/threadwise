import test from 'node:test';
import assert from 'node:assert/strict';
import { judge, parseDockerSize, parseKeyValue, parseNumber, sizeCheck, usage } from './cgroup.mjs';

test('parseKeyValue reads cpu.stat lines and ignores anything else', () => {
  assert.deepEqual(
    parseKeyValue(
      'usage_usec 5000000\nnr_periods 100\nnr_throttled 4\nthrottled_usec 120000\nnote x\n',
    ),
    {
      usage_usec: 5000000,
      nr_periods: 100,
      nr_throttled: 4,
      throttled_usec: 120000,
    },
  );
});
test('parseNumber: a count, and "max" for no limit', () => {
  assert.equal(parseNumber('42\n'), 42);
  assert.equal(parseNumber('max\n'), Infinity);
});
const base = {
  cpuStart: { usage_usec: 0, nr_periods: 0, nr_throttled: 0, throttled_usec: 0 },
  memoryEvents: {},
  seconds: 10,
};
test('usage: average cores, share of throttled periods, MB', () => {
  const u = usage({
    ...base,
    cpuEnd: { usage_usec: 12_000_000, nr_periods: 200, nr_throttled: 10, throttled_usec: 500_000 },
    memoryPeak: 524288000,
    pidsPeak: 31,
  });
  assert.equal(u.cpuAvgCores, 1.2);
  assert.equal(u.throttledPct, 5);
  assert.equal(u.throttledSeconds, 0.5);
  assert.equal(u.memoryPeakMb, 500);
  assert.equal(u.pidsPeak, 31);
});
test('judge passes a quiet run and fails each limit that is hit', () => {
  const quiet = usage({
    ...base,
    cpuEnd: { usage_usec: 8_000_000, nr_periods: 200, nr_throttled: 0, throttled_usec: 0 },
    memoryPeak: 400 * 1048576,
    pidsPeak: 40,
  });
  const lim = { memoryBytes: 1536 * 1048576, pids: 512, cpus: 1.5 };
  assert.ok(judge(quiet, lim).every((c) => c.ok));
  const hot = usage({
    ...base,
    cpuEnd: {
      usage_usec: 15_000_000,
      nr_periods: 200,
      nr_throttled: 150,
      throttled_usec: 4_000_000,
    },
    memoryPeak: 1500 * 1048576,
    memoryEvents: { oom_kill: 1 },
    pidsPeak: 400,
  });
  const bad = judge(hot, lim)
    .filter((c) => !c.ok)
    .map((c) => c.name)
    .sort();
  assert.deepEqual(bad, ['cpu-throttling', 'memory-peak', 'no-oom-kill', 'pids-peak']);
});
test('sizeCheck', () => {
  assert.equal(sizeCheck(500, 600).ok, true);
  assert.equal(sizeCheck(700, 600).ok, false);
});

test('parseDockerSize reads what docker image ls prints', () => {
  assert.equal(parseDockerSize('479MB'), 479e6);
  assert.equal(parseDockerSize('1.2GB'), 1.2e9);
  assert.equal(parseDockerSize('92.4kB'), 92400);
  assert.ok(Number.isNaN(parseDockerSize('big')));
});
