// API + SQL inventory report. Static: reads the NestJS controllers and the SQL in the services. It lists every route with its latency
// class and budget, and every SQL statement that matches a known slow shape. Nothing here is a measurement: timings come from
// tools/api-inventory/measure.mjs (routes) and pg_stat_statements (queries) and are merged in when a results file is passed.
//   node tools/api-inventory/build.mjs [--results perf/results/api-timings.json] [--out docs/quality/api-inventory]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiSrc, read, rel } from '../qa-suite/lib/core.mjs';
import { routes } from '../qa-suite/lib/routes.mjs';
import { sqlShapes } from './sql-shapes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const OUT = resolve(ROOT, arg('--out', 'docs/quality/api-inventory'));
const BUDGET_MS = { A: 50, B: 150, C: 300 }; // perf/budgets.json (QA 50): the class sets the p95 budget
const API_LIMIT_MS = Number(arg('--api-ms', 300)); // "critical" above this
const classes = new Map(
  JSON.parse(readFileSync(join(ROOT, 'perf/endpoint-classes.json'), 'utf8')).endpoints.map((e) => [
    e.route,
    e,
  ]),
);
const timings = arg('--results', '')
  ? JSON.parse(readFileSync(resolve(ROOT, arg('--results')), 'utf8'))
  : null;

const moduleOf = (file) =>
  file.split('/modules/')[1]?.split('/')[0] ?? file.split('/src/')[1]?.split('/')[0] ?? 'other';
const seen = new Set();
const rows = [];
for (const r of routes()) {
  const route = `${r.method} ${r.url}`;
  if (seen.has(route)) continue;
  seen.add(route);
  const c = classes.get(route);
  const t = timings?.[route];
  rows.push({
    route,
    method: r.method,
    url: r.url,
    module: moduleOf(r.file),
    public: r.public,
    class: c?.class ?? '?',
    budgetMs: BUDGET_MS[c?.class] ?? null,
    file: r.file,
    t,
  });
}
const queries = [];
for (const f of apiSrc()) {
  const text = read(f);
  for (const s of sqlShapes(text)) queries.push({ ...s, file: rel(f), module: moduleOf(rel(f)) });
}
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
const over = (r) => r.t && r.t.p95 > API_LIMIT_MS;
const critical = rows.filter(over).sort((a, b) => b.t.p95 - a.t.p95);
const measured = rows.filter((r) => r.t);
const byModule = [
  ...rows.reduce((m, r) => m.set(r.module, (m.get(r.module) ?? 0) + 1), new Map()),
].sort((a, b) => b[1] - a[1]);
const tr = (r) =>
  `<tr data-q="${esc(r.route.toLowerCase())} ${esc(r.module)}"><td>${esc(r.module)}</td><td>${r.method}</td><td>${esc(r.url)}</td><td>${r.class}</td><td>${r.budgetMs ?? ''}</td><td>${r.public ? 'public' : ''}</td><td>${r.t ? Math.round(r.t.p95) : 'not measured'}</td><td>${r.t ? Math.round(r.t.p50) : ''}</td><td>${r.t?.status ?? ''}</td></tr>`;
const head =
  '<tr><th>Module</th><th>Method</th><th>URL</th><th>Class</th><th>Budget p95 ms</th><th>Auth</th><th>p95 ms</th><th>p50 ms</th><th>Status</th></tr>';
const html = `<!doctype html><meta charset="utf-8"><title>API and query inventory</title>
<style>body{font:14px system-ui;margin:24px;max-width:1300px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:3px 6px;text-align:left;font-size:12px}th{background:#f3f3f3;position:sticky;top:0}.crit{background:#fde8e8}input{padding:6px;width:360px}code{background:#f3f3f3;padding:1px 4px}</style>
<h1>API and query inventory</h1>
<p><b>${rows.length}</b> API routes in <b>${byModule.length}</b> modules (${rows.filter((r) => r.public).length} public). ${measured.length ? `<b>${measured.length}</b> measured, <b>${critical.length}</b> over ${API_LIMIT_MS} ms p95.` : '<b>No route has been timed yet.</b> The p95 column is empty until <code>measure.mjs</code> has run.'} ${queries.length} SQL statements match a slow shape (static suspicion, not a measurement).</p>
<h2>1. Critical: over ${API_LIMIT_MS} ms p95</h2>
${measured.length ? `<table>${head}${critical.map((r) => tr(r).replace('<tr ', '<tr class="crit" ')).join('')}</table>` : '<p>Waiting for a timing run.</p>'}
<h2>2. SQL statements with a slow shape (every query must stay under 50 ms)</h2>
<p>Found by pattern in the source: ${[...queries.reduce((m, q) => m.set(q.shape, (m.get(q.shape) ?? 0) + 1), new Map())].map(([k, n]) => `${esc(k)}: ${n}`).join(', ')}. Measured query times come from <code>pg_stat_statements</code> after a run.</p>
<table><tr><th>Shape</th><th>Module</th><th>File:line</th><th>Statement start</th></tr>${queries.map((q) => `<tr><td>${esc(q.shape)}</td><td>${esc(q.module)}</td><td>${esc(q.file)}:${q.line}</td><td>${esc(q.text)}</td></tr>`).join('')}</table>
<h2>3. All APIs (${rows.length})</h2>
<input id="f" placeholder="filter: module, method or url"><table id="t">${head}${rows.map(tr).join('')}</table>
<script>f.oninput=()=>{const v=f.value.toLowerCase();for(const r of document.querySelectorAll('#t tr[data-q]'))r.hidden=!r.dataset.q.includes(v)}</script>`;
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'index.html'), html);
writeFileSync(
  join(OUT, 'routes.json'),
  JSON.stringify(
    rows.map(({ t, ...r }) => r),
    null,
    1,
  ) + '\n',
);
writeFileSync(join(OUT, 'slow-shape-queries.json'), JSON.stringify(queries, null, 1) + '\n');
console.log(
  `${rows.length} routes, ${queries.length} slow-shape statements -> ${rel(join(OUT, 'index.html'))}`,
);
