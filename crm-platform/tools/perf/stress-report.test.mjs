import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (dir, extra = []) =>
  execFileSync(process.execPath, [
    new URL('./stress-report.mjs', import.meta.url).pathname,
    join(dir, 'a.json'),
    '--out',
    join(dir, 'r.html'),
    '--md',
    join(dir, 'r.md'),
    ...extra,
  ]);
const result = (p95, cpu, rss) => ({
  api: 'http://x',
  stepSeconds: 5,
  pid: 1,
  p95LimitMs: 500,
  mix: [['/a', 1]],
  limitVus: 5,
  results: [
    {
      vus: 5,
      requests: 10,
      rps: 50,
      p50: 10,
      p95,
      p99: 40,
      errorRate: 0,
      process: { cpuAvgPct: cpu, cpuMaxPct: cpu + 10, rssMaxMb: rss },
      routes: { '/<a>': { n: 10, p50: 10, p95, p99: 40 } },
    },
  ],
});

test('the PR block has one row per step with CPU and RSS', () => {
  const d = mkdtempSync(join(tmpdir(), 'sr-'));
  writeFileSync(join(d, 'a.json'), JSON.stringify(result(30, 55, 300)));
  run(d);
  const md = readFileSync(join(d, 'r.md'), 'utf8');
  assert.match(md, /\| 5 \| 50 \| 10 \| 30 \| 40 \| 0\.00 \| 55\.0 \| 65\.0 \| 300\.0 \|/);
});
test('with --base it shows the change per step', () => {
  const d = mkdtempSync(join(tmpdir(), 'sr-'));
  writeFileSync(join(d, 'a.json'), JSON.stringify(result(30, 55, 300)));
  writeFileSync(join(d, 'b.json'), JSON.stringify(result(50, 70, 320)));
  run(d, ['--base', join(d, 'b.json')]);
  assert.match(readFileSync(join(d, 'r.md'), 'utf8'), /\| 5 \| -20 \| -15\.0 \| -20\.0 \|/);
});
test('a run without --pid says CPU and RSS were not recorded, and route names are escaped in the HTML', () => {
  const d = mkdtempSync(join(tmpdir(), 'sr-'));
  const r = result(30, 0, 0);
  delete r.results[0].process;
  writeFileSync(join(d, 'a.json'), JSON.stringify(r));
  run(d);
  assert.match(readFileSync(join(d, 'r.md'), 'utf8'), /not recorded/);
  assert.ok(!readFileSync(join(d, 'r.html'), 'utf8').includes('/<a>'));
});

test('CPU under 1% at every step warns that --pid may be a wrapper', () => {
  const d = mkdtempSync(join(tmpdir(), 'sr-'));
  writeFileSync(join(d, 'a.json'), JSON.stringify(result(30, 0.2, 40)));
  run(d);
  assert.match(readFileSync(join(d, 'r.md'), 'utf8'), /probably not the API process/);
});
