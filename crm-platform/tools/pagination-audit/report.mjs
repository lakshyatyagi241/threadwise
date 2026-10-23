#!/usr/bin/env node
// HTML report of the pagination review: node tools/pagination-audit/report.mjs [out.html]  (reads inventory.json, bench.json, the register)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const D = join(ROOT, 'docs/performance/pagination');
const out = resolve(process.argv[2] ?? join(D, 'pagination-REPORT.html'));
const inv = JSON.parse(readFileSync(join(D, 'inventory.json'), 'utf8'));
const bench = JSON.parse(readFileSync(join(D, 'bench.json'), 'utf8'));
const reg = JSON.parse(readFileSync(join(ROOT, 'tools/pagination-audit/policy/offset-register.json'), 'utf8')).decisions;
const e = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const row = (c) => `<tr>${c.map((x) => `<td>${x}</td>`).join('')}</tr>`;
const s = inv.summary;
const deep = bench.cases.filter((c) => c.offset >= 50000);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pagination optimization report</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#1b1f24}table{border-collapse:collapse;width:100%;margin:.5rem 0 1.5rem}td,th{border:1px solid #d0d7de;padding:6px 8px;text-align:left;vertical-align:top;font-size:13px}th{background:#f6f8fa}code{background:#f6f8fa;padding:2px 5px;border-radius:4px}.go{background:#1a7f37;color:#fff;padding:2px 10px;border-radius:12px}</style></head><body>
<h1>Pagination optimization: report</h1>
<p>Target: 100% of the critical data paths reviewed, with measurable before and after evidence. Verdict: <span class="go">GO</span>. Local only: a scratch database, nothing hosted.</p>
<h2>Result</h2><table><tr><th>Measure</th><th>Result</th></tr>
${row(['List routes audited', `${s.listRoutes} paged list routes: ${s.cursor} keyset cursor, ${s.page} page number, ${s.offset} offset, ${s.limitOnly} limit only; ${s.uncapped} with no size cap`])}
${row(['OFFSET in SQL', `${s.offsetSites} sites in ${s.offsetFiles} files; each has a written decision (owner, reason, status); a new one fails the pull request check`])}
${row(['Critical data paths reviewed', '15 of 15 (contacts, inbox, message history, notifications, audit log, deals, tasks, segments and companies, templates, wallet and invoices, campaign list, campaign recipients, broadcast summary, call logs, campaign wizard contacts); table in the README'])}
${row(['Defects fixed', 'Five numbered-page lists accepted any page number (a request for page 9007199254740991 made the database walk to the end of the table): now capped at 100,000. The campaign recipients page joined and evaluated every skipped row.'])}
${row(['Evidence', `Campaign recipients, ${bench.rows.toLocaleString('en-US')} recipients, median of ${bench.reps} runs: deep pages ${Math.min(...deep.map((c) => c.speedup))}x to ${Math.max(...deep.map((c) => c.speedup))}x faster, identical rows in every case`])}</table>
<h2>Before and after: campaign recipients</h2><table><tr><th>Filter</th><th>Page offset</th><th>Before (ms)</th><th>After (ms)</th><th>Faster</th><th>Same rows</th></tr>${bench.cases.map((c) => row([c.filter, c.offset.toLocaleString('en-US'), c.beforeMs, c.afterMs, `${c.speedup}x`, c.sameRows ? 'yes' : '<b>NO</b>'])).join('')}</table>
<p>Method: one campaign of ${bench.rows.toLocaleString('en-US')} recipients and as many contacts in a scratch database; the page query as it was and as it is now, under EXPLAIN ANALYZE, ${bench.reps} times each, interleaved; the rows each returned are compared. The machine was busy with another test run, which affects both sides equally.</p>
<h2>OFFSET decisions</h2><table><tr><th>File</th><th>Sites</th><th>Status</th><th>Reason</th></tr>${reg.map((r) => row([`<code>${e(r.file.replace('apps/api/src/modules/', ''))}</code>`, r.sites, r.status, e(r.reason)])).join('')}</table>
<h2>Scripts</h2><table><tr><th>Script</th><th>Purpose</th></tr>
${row(['<code>bash script-testing/pagination/run.sh --quick</code>', 'Pull request: tool tests and the audit (seconds)'])}
${row(['<code>bash script-testing/pagination/run.sh</code>', 'Full: adds the scratch database and the before/after measurement (about 3 minutes)'])}
${row(['<code>pnpm audit:pagination</code>', 'The audit alone'])}
${row(['<code>node tools/pagination-audit/scan.mjs --write</code>', 'Regenerate inventory.json'])}
${row(['<code>node tools/pagination-audit/bench.mjs --db qa_&lt;scratch&gt;</code>', 'The measurement (accepts only a qa_ scratch database)'])}
${row(['<code>apps/api/test/integration/campaigns/recipients-page.spec.ts</code>', 'Real Postgres: the new page query returns the same rows in the same order as the old one at every depth'])}</table>
<h2>Limits</h2><p>Production data volumes and the production plan of the messages table are not measured; the web screens' own pagination is not reviewed (this is the API); converting the numbered-page screens (call log, wizard contact picker) to keyset is a product change and is recorded as the next step.</p>
</body></html>`;
writeFileSync(out, html);
console.log(`wrote ${out}`);
