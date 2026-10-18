// QA #52: read a k6 throughput result and say what the system sustains.
//   node tools/perf/capacity.mjs perf/results/throughput.json [--baseline perf/baseline-throughput.json] [--write-baseline file] [--budgets perf/budgets.json]
// A step is sustained when its error rate is under the budget, nothing was dropped (k6 could keep the arrival rate) and every class that
// was measured stays inside its p95 budget. The capacity is the highest sustained step below the first step that is not.
// Exit 1 when capacity fell more than the agreed share against the baseline.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function judgeStage(stage, budgets) {
  const reasons = [];
  if (stage.failedRate == null || stage.failedRate > budgets.errorRate) reasons.push(`errors ${(100 * (stage.failedRate ?? 1)).toFixed(2)}% over ${(100 * budgets.errorRate).toFixed(0)}%`);
  if (stage.dropped > 0 && stage.dropped > 0.01 * (stage.requests + stage.dropped)) reasons.push(`${stage.dropped} iterations dropped: the system could not take the arrival rate`);
  for (const [c, t] of Object.entries(stage.classes ?? {})) if (t.p95 > budgets.latency[c].p95) reasons.push(`class ${c} p95 ${t.p95.toFixed(0)} ms over ${budgets.latency[c].p95}`);
  return { target: stage.target, achieved: stage.achieved, sustained: reasons.length === 0, reasons };
}

export function capacity(result, budgets) {
  const stages = Object.values(result.stages).sort((a, b) => a.target - b.target).map((s) => judgeStage(s, budgets));
  let best = 0;
  let firstFail = null;
  for (const s of stages) {
    if (!s.sustained) { firstFail = s; break; }
    best = s.target;
  }
  return { sustainedRps: best, firstFailing: firstFail, stages };
}

export function dropped(now, baseline, budgets) {
  if (!baseline || !baseline.sustainedRps) return null;
  const change = (baseline.sustainedRps - now.sustainedRps) / baseline.sustainedRps;
  return change > budgets.regression.throughputDropShare ? { baseline: baseline.sustainedRps, now: now.sustainedRps, change } : null;
}

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.error('usage: capacity.mjs <throughput.json> [--baseline f] [--write-baseline f]'); process.exit(2); }
  const budgets = JSON.parse(readFileSync(arg('--budgets', join(ROOT, 'perf/budgets.json')), 'utf8'));
  const result = JSON.parse(readFileSync(file, 'utf8'));
  const cap = capacity(result, budgets);
  console.log('| Target rps | Achieved rps | Sustained | Why not |\n|---|---|---|---|');
  for (const s of cap.stages) console.log(`| ${s.target} | ${s.achieved.toFixed(1)} | ${s.sustained ? 'yes' : 'no'} | ${s.reasons.join('; ') || ''} |`);
  console.log(`\nSustained: ${cap.sustainedRps} requests/second${cap.firstFailing ? ` (first step that fails: ${cap.firstFailing.target})` : ' (no step failed: raise RATES)'}`);
  if (arg('--write-baseline')) writeFileSync(arg('--write-baseline'), JSON.stringify({ writtenAt: new Date().toISOString(), mix: result.meta?.mix, sustainedRps: cap.sustainedRps }, null, 1) + '\n');
  const base = arg('--baseline') ? JSON.parse(readFileSync(arg('--baseline'), 'utf8')) : null;
  const drop = dropped(cap, base, budgets);
  if (drop) { console.error(`FAIL: capacity fell from ${drop.baseline} to ${drop.now} rps (${(drop.change * 100).toFixed(0)}% drop, limit ${budgets.regression.throughputDropShare * 100}%)`); process.exit(1); }
}
