#!/usr/bin/env node
// Turns a stress-ramp.mjs result (run with --pid) into the stress report a performance PR attaches (Sheet4 V-06): an HTML file and a
// short Markdown block to paste into the PR. node tools/perf/stress-report.mjs <stress.json> [--out report.html] [--md report.md] [--title "..."] [--base base.json]
// With --base (a result from main) the PR block shows the change in p95, CPU and RSS per step.
import { readFileSync, writeFileSync } from 'node:fs';

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const src = process.argv[2];
if (!src || src.startsWith('--')) {
  console.error(
    'usage: stress-report.mjs <stress.json> [--out f.html] [--md f.md] [--title t] [--base base.json]',
  );
  process.exit(2);
}
const cur = JSON.parse(readFileSync(src, 'utf8'));
const base = arg('--base', null) ? JSON.parse(readFileSync(arg('--base'), 'utf8')) : null;
const title = arg('--title', 'Stress report');
const f = (x, d = 0) => (Number.isFinite(x) ? Number(x).toFixed(d) : '-');
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
const at = (r, vus) => r?.results.find((x) => x.vus === vus);
const delta = (a, b, d = 0) =>
  Number.isFinite(a) && Number.isFinite(b) ? `${a - b >= 0 ? '+' : ''}${(a - b).toFixed(d)}` : '-';

const head = [
  'Users',
  'req/s',
  'p50 ms',
  'p95 ms',
  'p99 ms',
  'errors %',
  'CPU avg %',
  'CPU max %',
  'RSS max MB',
];
const cells = (r) => [
  r.vus,
  f(r.rps),
  f(r.p50),
  f(r.p95),
  f(r.p99),
  f(r.errorRate * 100, 2),
  f(r.process?.cpuAvgPct, 1),
  f(r.process?.cpuMaxPct, 1),
  f(r.process?.rssMaxMb, 1),
];
const table = (hs, rows) =>
  `<table><tr>${hs.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
const noProc = cur.results.every((r) => !r.process);
const idle = !noProc && cur.results.every((r) => !(r.process.cpuAvgPct >= 1));

const md = [
  `**${title}**: ${cur.results.length} steps of ${cur.stepSeconds} s, limit ${cur.limitVus ?? 'below the first step'} users (p95 <= ${cur.p95LimitMs} ms, errors < 1%).`,
  '',
  `| ${head.join(' | ')} |`,
  `| ${head.map(() => '---').join(' | ')} |`,
  ...cur.results.map((r) => `| ${cells(r).join(' | ')} |`),
  ...(base
    ? [
        '',
        `Change against the base run (limit ${base.limitVus ?? 'below the first step'} users):`,
        '',
        '| Users | p95 ms | CPU avg % | RSS max MB |',
        '| --- | --- | --- | --- |',
        ...cur.results
          .filter((r) => at(base, r.vus))
          .map((r) => {
            const b = at(base, r.vus);
            return `| ${r.vus} | ${delta(r.p95, b.p95)} | ${delta(r.process?.cpuAvgPct, b.process?.cpuAvgPct, 1)} | ${delta(r.process?.rssMaxMb, b.process?.rssMaxMb, 1)} |`;
          }),
      ]
    : []),
  ...(noProc ? ['', 'CPU and RSS were not recorded (run stress-ramp with --pid).'] : []),
  ...(idle
    ? [
        '',
        'CPU stayed under 1% at every step: --pid is probably not the API process (a wrapper such as pnpm or sh). Do not read the CPU and RSS columns.',
      ]
    : []),
].join('\n');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#1b1f23}table{border-collapse:collapse;width:100%;margin:.5rem 0 1.2rem}td,th{border:1px solid #d0d7de;padding:5px 9px;text-align:right}th{background:#f6f8fa}td:first-child,th:first-child{text-align:left}pre{background:#f6f8fa;padding:10px;overflow:auto}.note{border-left:4px solid #d4a72c;background:#fff8c5;padding:8px 12px}</style></head><body>
<h1>${esc(title)}</h1>
<p>API ${esc(cur.api)}, process ${cur.pid ?? 'not sampled'}. Closed loop: each user sends the next request as soon as the last answered, a read mix of ${cur.mix.length} routes. Limit: the last step whose p95 stays at or under ${cur.p95LimitMs} ms with errors under 1%: <b>${cur.limitVus ?? 'below the first step'} users</b>.</p>
<div class="note">One machine drives and serves, so this is a ceiling for this box, not for production. CPU 100% is one core.</div>
<h2>Steps</h2>${table(head, cur.results.map(cells))}
${
  base
    ? `<h2>Against the base run</h2>${table(
        ['Users', 'p95 ms', 'CPU avg %', 'RSS max MB'],
        cur.results
          .filter((r) => at(base, r.vus))
          .map((r) => {
            const b = at(base, r.vus);
            return [
              r.vus,
              delta(r.p95, b.p95),
              delta(r.process?.cpuAvgPct, b.process?.cpuAvgPct, 1),
              delta(r.process?.rssMaxMb, b.process?.rssMaxMb, 1),
            ];
          }),
      )}`
    : ''
}
<h2>Slowest routes at the last step (p95 ms)</h2>${table(
  ['Route', 'n', 'p50', 'p95', 'p99'],
  Object.entries(cur.results.at(-1).routes)
    .sort((a, b) => b[1].p95 - a[1].p95)
    .slice(0, 10)
    .map(([u, r]) => [u, r.n, f(r.p50), f(r.p95), f(r.p99)]),
)}
<h2>For the pull request</h2><pre>${esc(md)}</pre>
<h2>Run</h2><pre>bash script-testing/stress-report/run.sh            # boots a throwaway stack, runs, writes this report
node tools/perf/stress-ramp.mjs --pid &lt;api pid&gt; --out stress.json   # against a stack you started
node tools/perf/stress-report.mjs stress.json --base main-stress.json</pre>
</body></html>`;
writeFileSync(arg('--out', 'stress-report.html'), html);
writeFileSync(arg('--md', 'stress-report.md'), md + '\n');
console.log(`written ${arg('--out', 'stress-report.html')} and ${arg('--md', 'stress-report.md')}`);
