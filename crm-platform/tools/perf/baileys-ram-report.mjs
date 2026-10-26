#!/usr/bin/env node
// Builds the V-01 report (HTML) from the JSON files baileys-ram.mjs wrote. node tools/perf/baileys-ram-report.mjs [resultsDir] [outFile]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = resolve(process.argv[2] ?? join(root, 'docs/performance/baileys-ram/results'));
const out = resolve(
  process.argv[3] ?? join(root, 'docs/performance/baileys-ram/V01-baileys-ram-REPORT.html'),
);
const read = (n) => JSON.parse(readFileSync(join(dir, n), 'utf8'));
const churn = { before: read('before-churn.json'), after: read('after-churn.json') };
const per = { before: read('before-per-session.json'), after: read('after-per-session.json') };
const soak = { before: read('before-soak.json'), after: read('after-soak.json') };
const f = (x, d = 1) => (Number.isFinite(x) ? Number(x).toFixed(d) : 'n/a');
const THRESHOLD = 5;
const verdict = (s) =>
  s.rssGrowthPct12hUpper < THRESHOLD
    ? 'PASS'
    : s.heapSlopeMbPerH.slope < 1 && s.rssGrowthPctOverWindow < 1
      ? 'NOT PROVEN'
      : 'FAIL';
const svg = (rows, key, color) => {
  const w = 520,
    h = 120,
    xs = rows.map((r) => r.t),
    ys = rows.map((r) => r[key]);
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs),
    y0 = Math.min(...ys),
    y1 = Math.max(...ys) || 1;
  const px = (x) => 8 + ((x - x0) / (x1 - x0 || 1)) * (w - 16);
  const py = (y) => h - 8 - ((y - y0) / (y1 - y0 || 1)) * (h - 16);
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${key} over time"><polyline fill="none" stroke="${color}" stroke-width="2" points="${rows.map((r) => `${px(r.t)},${py(r[key])}`).join(' ')}"/><text x="8" y="12" font-size="11" fill="#555">${f(y1)} max</text><text x="8" y="${h - 1}" font-size="11" fill="#555">${f(y0)} min</text></svg>`;
};
const row = (k, a, b, unit = '') =>
  `<tr><td>${k}</td><td>${a}${unit}</td><td>${b}${unit}</td></tr>`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>V-01 RAM per WhatsApp session</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#1b1f23}table{border-collapse:collapse;width:100%;margin:.5rem 0 1.2rem}td,th{border:1px solid #d0d7de;padding:6px 10px;text-align:left}th{background:#f6f8fa}code,pre{background:#f6f8fa;border-radius:4px}pre{padding:10px;overflow:auto}code{padding:1px 4px}.pass{color:#1a7f37;font-weight:700}.fail{color:#cf222e;font-weight:700}.note{border-left:4px solid #d4a72c;background:#fff8c5;padding:8px 12px}</style></head><body>
<h1>V-01: RAM per WhatsApp session</h1>
<p>Sheet4 task V-01 (owner Vishal). Engine: Baileys ${'6.7.24'}, Node ${per.after.node}. Run ${per.after.at.slice(0, 10)}. All numbers come from the real <code>BaileysSocketFactory</code> against a local fake WhatsApp endpoint.</p>
<h2>Verdict</h2>
<p><b>Leak found and fixed.</b> Every socket Baileys builds starts 5 cache timers that nothing stops, so an ended socket (every reconnect or restart of a device) stayed in memory. Before: ${f(churn.before.perCycleTimers, 0)} timers and ${f(churn.before.perCycleNodeCaches, 0)} caches kept per reconnect. After: ${f(churn.after.perCycleTimers, 0)} and ${f(churn.after.perCycleNodeCaches, 0)}.</p>
<p>Soak (${soak.after.sessions} sessions, ${soak.after.reconnects} reconnects, ${f((soak.after.rows.at(-1)?.t ?? 0) / 60, 0)} min): RSS growth extrapolated to 12 h, upper bound of the 95% interval: before <b class="fail">${f(soak.before.rssGrowthPct12hUpper)}% ${verdict(soak.before)}</b>, after <b class="${verdict(soak.after) === 'PASS' ? 'pass' : 'fail'}">${f(soak.after.rssGrowthPct12hUpper)}% ${verdict(soak.after)}</b> (target under ${THRESHOLD}%). A short window keeps the start-up settling in the slope, so a flat series (after: ${f(soak.after.rssGrowthPctOverWindow, 2)}% over the window, heap ${f(soak.after.heapSlopeMbPerH.slope)} MB/h) can still extrapolate high: NOT PROVEN means only a longer run can settle it.</p>
<div class="note"><b>What this does not prove.</b> The fake endpoint never completes the WhatsApp handshake, so every session is "connecting": this is the cost of the socket's own structures, not of a connected number with thousands of chats. A 12 h run on a real number is still needed for the sheet target; the same command does it (below). The 12 h figure here is an extrapolation from ${f((soak.after.rows.at(-1)?.t ?? 0) / 60, 0)} minutes, not a measurement.</div>
<h2>1. Per session (idle, connecting)</h2>
<table><tr><th></th><th>Before</th><th>After</th></tr>
${row('RSS per session', f(per.before.perSessionRssMb, 3), f(per.after.perSessionRssMb, 3), ' MB')}
${row('Heap per session', f(per.before.perSessionHeapMb, 3), f(per.after.perSessionHeapMb, 3), ' MB')}
${row('Timers per session', f(per.before.perSessionTimers, 1), f(per.after.perSessionTimers, 1))}
${row('Caches still alive after all ended', per.before.retainedNodeCaches, per.after.retainedNodeCaches)}
${row('Timers still alive after all ended', per.before.retainedTimers, per.after.retainedTimers)}</table>
<p>Levels: ${per.after.rows.map((r) => r.sessions).join(', ')} sessions, forced GC twice before each reading. The ${per.after.retainedTimers} timers left after the fix are the 60 s connect timeouts of the last sessions, which clear themselves.</p>
<h2>2. Churn (one session ended and rebuilt ${churn.after.rows.at(-1)?.cycles} times)</h2>
<table><tr><th></th><th>Before</th><th>After</th></tr>
${row('Heap per reconnect', f(churn.before.perCycleHeapKb), f(churn.after.perCycleHeapKb), ' KB')}
${row('Timers kept per reconnect', f(churn.before.perCycleTimers, 2), f(churn.after.perCycleTimers, 2))}
${row('Caches kept per reconnect', f(churn.before.perCycleNodeCaches, 2), f(churn.after.perCycleNodeCaches, 2))}</table>
<p>The caches here are empty. On a real number each one also holds signal keys, device lists and retry counters for up to an hour, so the real cost of a kept socket is larger than the heap figure above.</p>
<h2>3. Soak</h2>
<table><tr><th></th><th>Before</th><th>After</th></tr>
${row('RSS slope', `${f(soak.before.rssSlopeMbPerH.slope)} (${f(soak.before.rssSlopeMbPerH.lo)} to ${f(soak.before.rssSlopeMbPerH.hi)})`, `${f(soak.after.rssSlopeMbPerH.slope)} (${f(soak.after.rssSlopeMbPerH.lo)} to ${f(soak.after.rssSlopeMbPerH.hi)})`, ' MB/h')}
${row('Heap slope', `${f(soak.before.heapSlopeMbPerH.slope)} (${f(soak.before.heapSlopeMbPerH.lo)} to ${f(soak.before.heapSlopeMbPerH.hi)})`, `${f(soak.after.heapSlopeMbPerH.slope)} (${f(soak.after.heapSlopeMbPerH.lo)} to ${f(soak.after.heapSlopeMbPerH.hi)})`, ' MB/h')}
${row('RSS growth over the window', f(soak.before.rssGrowthPctOverWindow, 2), f(soak.after.rssGrowthPctOverWindow, 2), ' %')}
${row('RSS growth, 12 h, upper bound', f(soak.before.rssGrowthPct12hUpper), f(soak.after.rssGrowthPct12hUpper), ' %')}
${row('Timers at the end', soak.before.rows.at(-1).timers, soak.after.rows.at(-1).timers)}
${row('Caches at the end', soak.before.rows.at(-1).nodeCaches, soak.after.rows.at(-1).nodeCaches)}</table>
<p>Before: timers over time.<br>${svg(soak.before.rows, 'timers', '#cf222e')}</p><p>After: timers over time.<br>${svg(soak.after.rows, 'timers', '#1a7f37')}</p>
<h2>The fix</h2>
<p>The factory gives each socket its own five caches (<code>apps/api/src/infra/providers/node-bridge-runtime/ttl-cache.ts</code>): same lifetimes as Baileys' (5 min for signal keys, device lists and call offers; 1 h for retry counters and placeholder resends), a size cap each, no timer, and <code>end()</code> empties them. An evicted signal key is read again from the database, so the cap costs a read, not correctness.</p>
<h2>Scripts</h2>
<pre>cd apps/api
# per session, churn, soak (needs --expose-gc; no database, no network)
node --expose-gc --import tsx ../../tools/perf/baileys-ram.mjs --mode per-session --sessions 1,5,10,25,50,100 --label after
node --expose-gc --import tsx ../../tools/perf/baileys-ram.mjs --mode churn --cycles 300 --label after
node --expose-gc --import tsx ../../tools/perf/baileys-ram.mjs --mode soak --sessions 10 --minutes 720 --interval 30 --reconnect 60 --label after
# this report
node ../../tools/perf/baileys-ram-report.mjs
# the test that pins the fix (fails without it: 100 timers left)
npx vitest run test/unit/node-bridge-runtime/baileys-socket-lifecycle.spec.ts test/unit/node-bridge-runtime/ttl-cache.spec.ts</pre>
<h2>Next</h2>
<ul><li>Run the 12 h soak above on a real number (needs a linked device) and put its measured figure in this table.</li><li>V-02 uses the per-session figure here for the unload decision.</li><li>No production gauge of open sessions exists yet; with one, production RSS per session can be read from Prometheus.</li></ul>
</body></html>`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`written ${out}`);
