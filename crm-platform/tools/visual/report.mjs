#!/usr/bin/env node
// Writes the HTML report of a visual regression run: node tools/visual/report.mjs <run dir> [out.html]
// The run dir is qa-results/visual-regression/<stamp> (result.json and gate-live.json come from run.sh).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = resolve(process.argv[2] ?? '');
const out = resolve(
  process.argv[3] ?? join(ROOT, 'docs/quality/visual-regression/visual-regression-REPORT.html'),
);
const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const result = read('result.json');
const gate = read('gate-live.json');
const cfg = JSON.parse(readFileSync(join(ROOT, 'apps/web/e2e/visual/visual.config.json'), 'utf8'));
const e = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const row = (cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
const pct = (x) => (x === undefined ? '-' : `${(x * 100).toFixed(1)}%`);
const cov = gate.coverage;
const note = process.argv.includes('--note')
  ? process.argv[process.argv.indexOf('--note') + 1]
  : '';
const blockers = gate.findings.filter((f) => ['Critical', 'High'].includes(f.severity));

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Visual regression report</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#1b1f24}table{border-collapse:collapse;width:100%;margin:.5rem 0 1.5rem}td,th{border:1px solid #d0d7de;padding:6px 8px;text-align:left;vertical-align:top;font-size:13px}th{background:#f6f8fa}code{background:#f6f8fa;padding:2px 5px;border-radius:4px}.go{background:#1a7f37;color:#fff;padding:2px 10px;border-radius:12px}.no{background:#cf222e;color:#fff;padding:2px 10px;border-radius:12px}.p{color:#1a7f37;font-weight:600}.f{color:#cf222e;font-weight:600}</style></head><body>
<h1>Visual regression: test report</h1>
<p>Target: an automated suite with at least 95% of the P0 and P1 scenarios covered and zero flaky P0 tests. Verdict: <span class="${gate.verdict === 'GO' ? 'go' : 'no'}">${gate.verdict}</span>
(${blockers.length} Critical or High findings). Local only: a scratch API on its own database, the production web build, Chromium.</p>
<h2>Result</h2><table><tr><th>Measure</th><th>Result</th></tr>
${row(['Scenarios (one page at one viewport)', ['P0', 'P1', 'P2'].map((p) => `${p} ${cov.byPriority[p].scenarios}`).join(', ')])}
${row(['Baseline coverage', `P0 ${pct(cov.byPriority.P0.coverage)}, P1 ${pct(cov.byPriority.P1.coverage)} (target ${pct(cov.target)})`])}
${row(['Verified in this run (compared and matched)', `P0 ${pct(cov.byPriority.P0.verifiedCoverage)}, P1 ${pct(cov.byPriority.P1.verifiedCoverage)}`])}
${row(['Flaky scenarios', `${gate.flaky.length} over ${gate.runs} run(s) of each P0 scenario`])}
${row(['Left out', `${gate.left.dynamic} pages that need data ([id], [token]), ${gate.left.skipped} pages outside the staff app (admin, embedded, setup, site preview)`])}
${row(['Known defects (not baselined)', Object.keys(cfg.known).length ? Object.keys(cfg.known).join(', ') : 'none'])}</table>
<h2>Checks of the run</h2><table><tr><th>Check</th><th>Result</th><th>Detail</th></tr>${result.checks.map((c) => row([e(c.name), `<span class="${c.status === 'PASS' ? 'p' : 'f'}">${c.status}</span>`, e(c.detail ?? '')])).join('')}</table>
${note ? `<h2>After the full run</h2><p>${e(note)}</p>` : ''}
<h2>Findings</h2>${gate.findings.length ? `<table><tr><th>Severity</th><th>Subject</th><th>Detail</th></tr>${gate.findings.map((f) => row([f.severity, e(f.subject), e(f.detail)])).join('')}</table>` : '<p>None.</p>'}
<h2>Defects the suite found in the product</h2><table><tr><th>Page</th><th>Defect</th></tr>${Object.entries(
  cfg.known,
)
  .map(([u, why]) => row([`<code>${e(u)}</code>`, e(why)]))
  .join('')}</table>
<h2>How it avoids flakiness</h2><p>Everything that changes between two runs of the same page is removed, not tolerated: the browser clock is fixed (${e(cfg.fixedTime)}), language en-US, time zone UTC, reduced motion, animation and caret off, <code>Math.random</code> seeded, cookie consent pre-set, and text that is a date, a clock time or a relative time is rewritten to one fixed string. The page is measured until it stops changing (no data request in flight, every image decoded, no spinner, the same text and height on four polls in a row) instead of waiting a fixed time. The comparison allows ${cfg.diff.maxDiffPixelRatio * 100}% of pixels to differ, as a last resort. Every P0 scenario runs three times and any that does not give the same answer each time fails the run. A canary (a red band added to the login page) must fail the comparison, so the suite cannot go blind.</p>
<h2>Scripts</h2><table><tr><th>Script</th><th>Purpose</th></tr>
${row(['<code>bash script-testing/visual-regression/run.sh --quick</code>', 'Pull request run: tool tests and baseline coverage, no browser (seconds)'])}
${row(['<code>bash script-testing/visual-regression/run.sh</code>', 'Daily and pre-release: scratch stack, every scenario, P0 repeated, canary, gate (about 40 minutes)'])}
${row(['<code>pnpm qa:visual[:quick]</code>, <code>pnpm audit:visual</code>', 'Package shortcuts'])}
${row(['<code>pnpm --filter @crm/web exec playwright test --project=visual [--update-snapshots]</code>', 'Compare or record against a stack you already run (see apps/web/e2e/visual/README.md)'])}
${row(['<code>node tools/visual/check.mjs [--reports ...]</code>', 'Coverage, verified coverage and flakiness gate; exit 1 on Critical or High'])}
${row(['<code>node tools/visual/report.mjs &lt;run dir&gt;</code>', 'This report'])}
${row(['<code>.github/workflows/visual-regression.yml</code>', 'Pull request quick, daily full, manual pre-release'])}</table>
<h2>Limits</h2><p>Chromium only (cross-browser is a separate suite); baselines belong to Linux Chromium and must be recorded there; the first paint of each page is compared, not interactions or open dialogs; the seeded workspace is mostly empty, so pages are compared in their empty and default states; GitHub Actions does not start on this account, so the workflow has not run in CI.</p>
</body></html>`;
writeFileSync(out, html);
console.log(`wrote ${out}`);
