import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cpuPct, cpuTicks, read, rssMb, watch } from './proc-sample.mjs';

// field 14 and 15 (utime, stime) are 120 and 30; the name holds a space and a bracket on purpose
const STAT =
  '4242 (node (api) x) S 1 4242 4242 0 -1 4194560 100 0 0 0 120 30 0 0 20 0 9 0 5000 1000000 2000 18446744073709551615';

test('cpuTicks adds utime and stime, even when the command name has spaces and brackets', () => {
  assert.equal(cpuTicks(STAT), 150);
});
test('rssMb reads VmRSS in kB as MB', () => {
  assert.equal(rssMb('Name:\tnode\nVmRSS:\t  204800 kB\nThreads:\t9\n'), 200);
  assert.ok(Number.isNaN(rssMb('Name:\tnode\n')));
});
test('cpuPct: 100 ticks in one second is one full core', () => {
  assert.equal(cpuPct({ at: 0, ticks: 0 }, { at: 1000, ticks: 100 }), 100);
  assert.equal(cpuPct({ at: 0, ticks: 0 }, { at: 2000, ticks: 50 }), 25);
});
test('read and watch measure a real process (this one)', async () => {
  assert.ok(read(process.pid).rssMb > 10);
  const w = watch(process.pid, 100);
  await new Promise((r) => setTimeout(r, 450)); // a busy loop would block the sampler's own timer
  const r = w.stop();
  assert.ok(r.samples >= 2);
  assert.ok(Number.isFinite(r.cpuAvgPct));
  assert.ok(r.rssMaxMb > 10);
});
test('read of a process that is gone is null', () => {
  const max = Number(readFileSync('/proc/sys/kernel/pid_max', 'utf8'));
  assert.equal(read(max + 1), null);
});
