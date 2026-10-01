// Rebuild every finding of a run from its result files. Safe to call any number of times, and after partial re-runs.
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareScenario, summarise } from './diff.mjs';
import { loadSpec } from './spec.mjs';
import { readJson, writeJson } from './util.mjs';
import { writeReports, verdict } from './report.mjs';
import { makePairs } from './pairs.mjs';

function loadResults(runDir, side) {
  const dir = join(runDir, 'results', side);
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    out.set(r.scenario, r);
  }
  return out;
}

export async function compareRun(runDir, cfg) {
  const meta = readJson(join(runDir, 'run-meta.json'));
  if (!meta) throw new Error(`${runDir} has no run-meta.json: not a parity run directory`);
  const specs = [];
  for (const f of meta.specs) specs.push(await loadSpec(f, cfg, { depth: meta.depth }));
  const scenarioOf = new Map(
    specs.flatMap((s) => s.scenarios.map((sc) => [sc.id, { sc, spec: s }])),
  );
  const W = loadResults(runDir, 'wadesk');
  const O = loadResults(runDir, 'ours');
  const ids = [...new Set([...W.keys(), ...O.keys()])].sort();
  const findings = [];
  for (const id of ids) {
    const known = scenarioOf.get(id);
    const r = W.get(id) || O.get(id);
    const sc = known?.sc || { id, title: r.title, tags: r.tags, feature: r.feature };
    const spec = known?.spec;
    findings.push(
      ...compareScenario({
        scenario: sc,
        wadesk: W.get(id),
        ours: O.get(id),
        cfg,
        specIntended: spec?.intended || [],
        severityOverrides: spec?.severity || {},
      }),
    );
  }
  const summary = summarise(findings);
  writeJson(join(runDir, 'findings.json'), findings);
  writeJson(join(runDir, 'summary.json'), {
    verdict: verdict(summary),
    ...summary,
    scenarios: ids.length,
  });
  const pairs = await makePairs(runDir, findings).catch(() => []);
  const { clusters } = writeReports({ runDir, meta, specs, findings, summary, pairs });
  return { meta, specs, findings, summary, clusters, verdict: verdict(summary) };
}
