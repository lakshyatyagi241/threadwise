// API + SQL report. Lists every route with its latency class and budget, every SQL statement that matches a known slow shape (static
// suspicion), and - when a run's results are passed - the measured p95 of every GET route and the measured time of every SQL statement.
//   node tools/api-inventory/build.mjs [--results perf/results] [--before perf/results-before] [--out docs/quality/api-inventory] [--api-ms 300] [--watch-ms 200] [--query-ms 50]
// results dir = the output of measure.mjs (api-timings.json, query-timings.json, not-run.json).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiSrc, read, rel } from '../qa-suite/lib/core.mjs';
import { routes } from '../qa-suite/lib/routes.mjs';
import { sqlShapes } from './sql-shapes.mjs';
import { verdict } from './verdict.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const OUT = resolve(ROOT, arg('--out', 'docs/quality/api-inventory'));
const BUDGET_MS = { A: 50, B: 150, C: 300 }; // perf/budgets.json (QA 50): the class sets the p95 budget
const API_MS = Number(arg('--api-ms', 300)); // critical above this
const WATCH_MS = Number(arg('--watch-ms', 200)); // watch list above this
const QUERY_MS = Number(arg('--query-ms', 50));
const resDir = arg('--results', '') ? resolve(ROOT, arg('--results')) : null;
const load = (f, d) =>
  resDir && existsSync(join(resDir, f)) ? JSON.parse(readFileSync(join(resDir, f), 'utf8')) : d;
const timings = load('api-timings.json', null);
// an earlier run of the same routes, to show what a fix changed
const beforeDir = arg('--before', '') ? resolve(ROOT, arg('--before')) : null;
const before =
  beforeDir && existsSync(join(beforeDir, 'api-timings.json'))
    ? JSON.parse(readFileSync(join(beforeDir, 'api-timings.json'), 'utf8'))
    : null;
const queryTimings = load('query-timings.json', null);
const classes = new Map(
  JSON.parse(readFileSync(join(ROOT, 'perf/endpoint-classes.json'), 'utf8')).endpoints.map((e) => [
    e.route,
    e,
  ]),
);

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
    t,
    v: verdict(t, r.method === 'GET' && !!timings),
  });
}
const shapeQueries = [];
for (const f of apiSrc())
  for (const s of sqlShapes(read(f)))
    shapeQueries.push({ ...s, file: rel(f), module: moduleOf(rel(f)) });

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
const timed = rows.filter((r) => r.v.kind === 'timed');
const critical = timed.filter((r) => r.t.p95 > API_MS).sort((a, b) => b.t.p95 - a.t.p95);
const watch = timed
  .filter((r) => r.t.p95 > WATCH_MS && r.t.p95 <= API_MS)
  .sort((a, b) => b.t.p95 - a.t.p95);
const ok = timed.filter((r) => r.t.p95 <= WATCH_MS).sort((a, b) => b.t.p95 - a.t.p95);
const overBudget = timed
  .filter((r) => r.budgetMs && r.t.p95 > r.budgetMs && r.t.p95 <= WATCH_MS)
  .sort((a, b) => b.t.p95 - a.t.p95);
const unmeasured = rows.filter((r) => r.v.kind !== 'timed');
const byKind = unmeasured.reduce((m, r) => m.set(r.v.kind, (m.get(r.v.kind) ?? 0) + 1), new Map());
const slowQ = (queryTimings ?? []).filter((q) => q.meanMs > QUERY_MS);
const maxQ = (queryTimings ?? []).filter((q) => q.meanMs <= QUERY_MS && q.maxMs > QUERY_MS);

const head = `<tr><th>Module</th><th>Method</th><th>URL</th><th>Class</th><th>Budget p95 ms</th><th>p95 ms</th>${before ? '<th>before ms</th>' : ''}<th>p50 ms</th><th>KB</th><th>Why no figure</th></tr>`;
const tr = (r, cls = '') =>
  `<tr${cls ? ` class="${cls}"` : ''} data-q="${esc((r.route + ' ' + r.module).toLowerCase())}"><td>${esc(r.module)}</td><td>${r.method}</td><td>${esc(r.url)}</td><td>${r.class}</td><td>${r.budgetMs ?? ''}</td><td>${r.t?.p95 != null && r.v.kind === 'timed' ? Math.round(r.t.p95) : ''}</td>${before ? `<td>${before[r.route]?.p95 != null ? Math.round(before[r.route].p95) : ''}</td>` : ''}<td>${r.t?.p50 != null && r.v.kind === 'timed' ? Math.round(r.t.p50) : ''}</td><td>${r.t?.bytes != null ? (r.t.bytes / 1024).toFixed(1) : ''}</td><td>${esc(r.v.why)}</td></tr>`;
const qHead =
  '<tr><th>Mean ms</th><th>Max ms</th><th>Calls</th><th>Rows</th><th>Statement</th></tr>';
const qr = (q, cls = '') =>
  `<tr${cls ? ` class="${cls}"` : ''}><td>${q.meanMs}</td><td>${q.maxMs}</td><td>${q.calls}</td><td>${q.rows}</td><td>${esc(q.query)}</td></tr>`;
const card = (n, l, c = '') => `<div class="card ${c}"><b>${n}</b><span>${l}</span></div>`;

const html = `<!doctype html><meta charset="utf-8"><title>API and query timing report</title>
<style>body{font:14px system-ui;margin:24px;max-width:1350px}table{border-collapse:collapse;width:100%;margin-bottom:24px}td,th{border:1px solid #ccc;padding:3px 6px;text-align:left;font-size:12px;vertical-align:top}th{background:#f3f3f3;position:sticky;top:0}.crit{background:#fde8e8}.watch{background:#fff4d6}.cards{display:flex;gap:12px;flex-wrap:wrap}.card{border:1px solid #ccc;padding:10px 16px;border-radius:6px;display:flex;flex-direction:column}.card b{font-size:22px}.card.bad{border-color:#c00}input{padding:6px;width:360px}code{background:#f3f3f3;padding:1px 4px}td:last-child{word-break:break-word}</style>
<h1>API and query timing report</h1>
<p>${rows.length} API routes, ${new Set(rows.map((r) => r.module)).size} modules. ${timings ? `Measured: every GET route that could be called against a seeded organisation (100,000 contacts, 1,000,000 messages) on one machine, one user at a time, 7 timed calls per route after one warm-up; p95 is the nearest-rank value of those calls.` : 'No timing run was passed, so only the inventory is shown.'}</p>
<div class="cards">${card(timed.length, 'routes timed')}${card(critical.length, `critical: p95 over ${API_MS} ms`, critical.length ? 'bad' : '')}${card(watch.length, `watch: ${WATCH_MS} to ${API_MS} ms`)}${card(ok.length, `OK: under ${WATCH_MS} ms`)}${card(slowQ.length, `statements over ${QUERY_MS} ms mean`, slowQ.length ? 'bad' : '')}${card(unmeasured.length, 'routes without a latency figure')}</div>
<h2>1. Critical APIs: p95 over ${API_MS} ms</h2>
${critical.length ? `<table>${head}${critical.map((r) => tr(r, 'crit')).join('')}</table>` : '<p>None.</p>'}
<h2>2. Watch: ${WATCH_MS} to ${API_MS} ms</h2>
${watch.length ? `<table>${head}${watch.map((r) => tr(r, 'watch')).join('')}</table>` : '<p>None.</p>'}
<h2>3. DB statements over ${QUERY_MS} ms (mean)</h2>
<p>From <code>pg_stat_statements</code> during the run. Every statement the API ran is listed in section 6; these are the ones whose mean is over the limit. ${maxQ.length} more have a mean under ${QUERY_MS} ms but a slowest call over it (section 4).</p>
${queryTimings ? (slowQ.length ? `<table>${qHead}${slowQ.map((q) => qr(q, 'crit')).join('')}</table>` : '<p>None.</p>') : '<p>No query timings.</p>'}
<h2>4. DB statements with a slow worst case (mean under ${QUERY_MS} ms, max over)</h2>
${maxQ.length ? `<table>${qHead}${maxQ.map((q) => qr(q, 'watch')).join('')}</table>` : '<p>None.</p>'}
<h2>5. OK APIs: under ${WATCH_MS} ms (${ok.length})</h2>
<p>${overBudget.length} of these are over their class budget from <code>perf/budgets.json</code> (A 50, B 150, C 300 ms) without being over ${WATCH_MS} ms.</p>
<input id="f" placeholder="filter: module, method or url"><table id="t">${head}${ok.map((r) => tr(r, r.budgetMs && r.t.p95 > r.budgetMs ? 'watch' : '')).join('')}</table>
<h2>6. All DB statements measured (${queryTimings?.length ?? 0})</h2>
<table>${qHead}${(queryTimings ?? []).map((q) => qr(q, q.meanMs > QUERY_MS ? 'crit' : '')).join('')}</table>
<h2>7. Routes without a latency figure (${unmeasured.length}): ${[...byKind].map(([k, n]) => `${k} ${n}`).join(', ')}</h2>
<p>Not counted as fast. Most need data for a path parameter that the seeded organisation does not have, or a request body (writes), or a feature the test workspace does not have switched on.</p>
<table>${head}${unmeasured.map((r) => tr(r)).join('')}</table>
<h2>8. SQL statements with a slow shape in the source (${shapeQueries.length})</h2>
<p>Found by pattern: ${[...shapeQueries.reduce((m, q) => m.set(q.shape, (m.get(q.shape) ?? 0) + 1), new Map())].map(([k, n]) => `${esc(k)} ${n}`).join(', ')}. A suspicion to measure, not a finding; the measured statements are in sections 3 to 6.</p>
<table><tr><th>Shape</th><th>Module</th><th>File:line</th><th>Statement start</th></tr>${shapeQueries.map((q) => `<tr><td>${esc(q.shape)}</td><td>${esc(q.module)}</td><td>${esc(q.file)}:${q.line}</td><td>${esc(q.text)}</td></tr>`).join('')}</table>
<script>f.oninput=()=>{const v=f.value.toLowerCase();for(const r of document.querySelectorAll('#t tr[data-q]'))r.hidden=!r.dataset.q.includes(v)}</script>`;
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'index.html'), html);
writeFileSync(
  join(OUT, 'routes.json'),
  JSON.stringify(
    rows.map(({ t, v, ...r }) => ({
      ...r,
      p95: t?.p95 ?? null,
      p50: t?.p50 ?? null,
      status: t?.status ?? null,
      note: v.why,
    })),
    null,
    1,
  ) + '\n',
);
writeFileSync(join(OUT, 'slow-shape-queries.json'), JSON.stringify(shapeQueries, null, 1) + '\n');
console.log(
  `${rows.length} routes (${timed.length} timed: ${critical.length} critical, ${watch.length} watch, ${ok.length} ok; ${unmeasured.length} without a figure), ${queryTimings?.length ?? 0} statements (${slowQ.length} over ${QUERY_MS} ms) -> ${rel(join(OUT, 'index.html'))}`,
);
