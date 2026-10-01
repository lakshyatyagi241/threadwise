#!/usr/bin/env node
// Rebuild findings, report.md, parity-rows.md, clusters.json and gallery.html from the result files of a run.
//   node compare.mjs <runDir> [--json]
// Run it again after re-running a subset of scenarios (run.mjs --into <runDir>): the findings always reflect the
// newest result file of every scenario.
import { resolve, join } from 'node:path';
import { loadConfig } from './lib/config.mjs';
import { compareRun } from './lib/compare.mjs';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node compare.mjs <runDir> [--json]');
  process.exit(2);
}
const runDir = resolve(dir);
const res = await compareRun(runDir, loadConfig());
const s = res.summary;
if (process.argv.includes('--json'))
  console.log(
    JSON.stringify({
      verdict: res.verdict,
      ...s,
      clusters: res.clusters.length,
      report: join(runDir, 'report.md'),
    }),
  );
else {
  console.log(
    `VERDICT ${res.verdict}: same ${s.same}, intended ${s.intended}, DEFECT ${s.defect} in ${s.defectScenarios} scenario(s) (blocker ${s.defectScenariosBySeverity.blocker}, major ${s.defectScenariosBySeverity.major}, minor ${s.defectScenariosBySeverity.minor}), review ${s.review}, skipped ${s.skipped}, spec-issue ${s['spec-issue']}`,
  );
  console.log(
    `report: ${join(runDir, 'report.md')}\nclusters: ${join(runDir, 'clusters.json')} (${res.clusters.length})`,
  );
}
process.exit(s.defect || s.review ? 1 : 0);
