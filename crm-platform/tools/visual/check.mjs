#!/usr/bin/env node
// Visual regression gate (QA task 21).
//
//   node tools/visual/check.mjs                                  coverage of the committed baselines (no browser; the PR check)
//   node tools/visual/check.mjs --reports a.json b.json ...      also judge Playwright JSON reports: verified coverage and flakiness
//   node tools/visual/check.mjs --json out.json                  write the verdict
//
// Fails (exit 1) on: P0 or P1 baseline coverage under 95%, a P0 or P1 scenario that was not compared and matched in the given reports,
// any flaky P0 or P1 scenario, any failed comparison, a baseline with no page (stale). Medium findings are listed and never block.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { coverage, coverageGate, flakeGate, flakiness } from './lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = join(ROOT, 'apps/web');
const BLOCKING = new Set(['Critical', 'High']);

async function main() {
  const args = process.argv.slice(2);
  const val = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const reportsAt = args.indexOf('--reports');
  const reportFiles =
    reportsAt < 0
      ? []
      : args
          .slice(reportsAt + 1)
          .filter(
            (a, i, all) =>
              !a.startsWith('--') &&
              !all.slice(0, i).some((x) => x.startsWith('--') && x !== '--reports'),
          );
  const { buildScenarios, loadConfig, discoverPages, scenarioId } = await import(
    pathToFileURL(join(WEB, 'e2e/visual/scenarios.mjs')).href
  );
  const cfg = loadConfig(WEB);
  const scenarios = buildScenarios(WEB);
  const dir = join(WEB, 'e2e/visual/__baselines__');
  const baselines = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')) : [];

  let passed;
  let fl = null;
  if (reportFiles.length) {
    const reports = reportFiles.map((f) => JSON.parse(readFileSync(f, 'utf8')));
    fl = flakiness(reports);
    passed = new Set();
    for (const t of fl.passedIds) {
      const m = /^P[012] (\S+) @ (\S+)$/.exec(t);
      if (m) passed.add(scenarioId(m[1], m[2]));
    }
  }
  const cov = coverage({ scenarios, baselines, passed, known: cfg.known, target: 0.95 });
  const findings = [...coverageGate(cov)];
  if (fl) {
    findings.push(...flakeGate(fl));
    for (const x of fl.failed)
      findings.push({
        severity: x.priority === 'P0' ? 'Critical' : x.priority === 'P1' ? 'High' : 'Medium',
        subject: x.title,
        detail: 'the screenshot does not match its baseline, or the page failed to render',
      });
  }
  const { dynamic, skipped } = discoverPages(WEB, cfg);
  const blockers = findings.filter((f) => BLOCKING.has(f.severity));
  const verdict = blockers.length ? 'NO-GO' : 'GO';
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  console.log(
    `visual gate: ${verdict}. ${scenarios.length} scenarios (${['P0', 'P1', 'P2'].map((p) => `${p} ${cov.byPriority[p].scenarios}`).join(', ')}); ` +
      `baseline coverage P0 ${pct(cov.byPriority.P0.coverage)}, P1 ${pct(cov.byPriority.P1.coverage)}` +
      (fl
        ? `; verified P0 ${pct(cov.byPriority.P0.verifiedCoverage)}, P1 ${pct(cov.byPriority.P1.verifiedCoverage)}; flaky ${fl.flaky.length} over ${fl.runs} run(s)`
        : '') +
      `. Left out: ${dynamic} pages that need data, ${skipped} not in the staff app.`,
  );
  for (const f of findings.slice(0, 40))
    console.error(`  ${f.severity.toUpperCase()} ${f.subject}: ${f.detail}`);
  if (val('--json'))
    writeFileSync(
      val('--json'),
      JSON.stringify(
        {
          verdict,
          coverage: cov,
          flaky: fl?.flaky ?? [],
          runs: fl?.runs ?? 0,
          left: { dynamic, skipped },
          findings,
        },
        null,
        2,
      ) + '\n',
    );
  process.exit(verdict === 'GO' ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
