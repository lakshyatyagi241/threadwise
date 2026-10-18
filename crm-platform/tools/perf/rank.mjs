// QA #51: turn k6 latency results into a short ranked list, and guard against regressions.
//   node tools/perf/rank.mjs perf/results/latency-1.json [more runs...] [--top 20] [--baseline perf/baseline.json]
//        [--budgets perf/budgets.json] [--out perf/results/ranked.md] [--write-baseline perf/baseline.json]
// Several result files are the repeat runs of one measurement: the median of each figure is used (a single slow run does not decide).
// Exit 1 when a class passes its p95 budget, or when an endpoint's p95 is worse than the baseline by more than the share AND the minimum ms.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const median = (xs) => {
  const v = xs.filter((x) => typeof x === 'number' && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

const STATS = ['p50', 'p95', 'p99', 'avg', 'max', 'count'];
const mergeTrend = (list) => Object.fromEntries(STATS.map((k) => [k, median(list.map((t) => t?.[k]))]));

/** Median of repeat runs, per class and per endpoint. */
export function mergeRuns(runs) {
  const out = { runs: runs.length, classes: {}, endpoints: {}, failedRate: median(runs.map((r) => r.http?.failedRate)) };
  for (const c of ['A', 'B', 'C']) {
    const list = runs.map((r) => r.classes?.[c]).filter(Boolean);
    if (list.length) out.classes[c] = mergeTrend(list);
  }
  const names = new Set(runs.flatMap((r) => Object.keys(r.endpoints ?? {})));
  for (const n of names) {
    const list = runs.map((r) => r.endpoints?.[n]).filter(Boolean);
    out.endpoints[n] = { class: list.find((t) => t.class)?.class ?? null, ...mergeTrend(list) };
  }
  return out;
}

/** Endpoints ranked by how far p95 is over its class budget (ratio > 1 is over). */
export function rank(merged, budgets) {
  return Object.entries(merged.endpoints)
    .map(([route, t]) => {
      const b = budgets.latency[t.class];
      return { route, class: t.class, p50: t.p50, p95: t.p95, p99: t.p99, count: t.count, budget: b?.p95 ?? null, ratio: b && t.p95 != null ? t.p95 / b.p95 : null };
    })
    .filter((e) => e.ratio !== null)
    .sort((a, b) => b.ratio - a.ratio);
}

/** Class budgets that are passed (p95), with the p99 reported against its tracking figure. */
export function classVerdicts(merged, budgets) {
  return Object.entries(merged.classes).map(([c, t]) => ({
    class: c,
    p50: t.p50,
    p95: t.p95,
    p99: t.p99,
    budgetP95: budgets.latency[c].p95,
    budgetP99: budgets.latency[c].p99,
    p95Pass: t.p95 <= budgets.latency[c].p95,
    p99Over: t.p99 > budgets.latency[c].p99,
  }));
}

/** Endpoints whose p95 is worse than the baseline by more than the share and the minimum ms. */
export function regressions(merged, baseline, budgets) {
  const { share, minMs } = budgets.regression;
  const out = [];
  for (const [route, t] of Object.entries(merged.endpoints)) {
    const b = baseline.endpoints?.[route];
    if (!b || b.p95 == null || t.p95 == null) continue;
    const diff = t.p95 - b.p95;
    if (diff > minMs && t.p95 > b.p95 * (1 + share)) out.push({ route, class: t.class, baseline: b.p95, now: t.p95, diff, share: diff / b.p95 });
  }
  return out.sort((a, b) => b.diff - a.diff);
}

const f1 = (x) => (x == null ? 'n/a' : x.toFixed(1));

export function markdown({ merged, ranked, classes, regs, top }) {
  const lines = [`# Latency ranking`, '', `Median of ${merged.runs} run(s). p95 in ms. Ratio is p95 over the class budget (above 1.00 is over budget).`, '', '## By class', '', '| Class | p50 | p95 | p99 | p95 budget | p95 | p99 vs budget |', '|---|---|---|---|---|---|---|'];
  for (const c of classes) lines.push(`| ${c.class} | ${f1(c.p50)} | ${f1(c.p95)} | ${f1(c.p99)} | ${c.budgetP95} | ${c.p95Pass ? 'pass' : 'OVER'} | ${c.p99Over ? `over ${c.budgetP99}` : 'ok'} |`);
  lines.push('', `## Top ${top} endpoints by distance over budget`, '', '| # | Route | Class | p50 | p95 | p99 | Budget | Ratio |', '|---|---|---|---|---|---|---|---|');
  ranked.slice(0, top).forEach((e, i) => lines.push(`| ${i + 1} | \`${e.route}\` | ${e.class} | ${f1(e.p50)} | ${f1(e.p95)} | ${f1(e.p99)} | ${e.budget} | ${e.ratio.toFixed(2)} |`));
  if (regs) {
    lines.push('', '## Regressions against the baseline', '');
    if (!regs.length) lines.push('None.');
    else {
      lines.push('| Route | Class | Baseline p95 | Now p95 | Change |', '|---|---|---|---|---|');
      for (const r of regs) lines.push(`| \`${r.route}\` | ${r.class} | ${f1(r.baseline)} | ${f1(r.now)} | +${f1(r.diff)} ms (+${(r.share * 100).toFixed(0)}%) |`);
    }
  }
  return lines.join('\n') + '\n';
}

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : def;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const valueFlags = new Set(['--top', '--baseline', '--budgets', '--out', '--write-baseline']);
  const files = [];
  for (let i = 2; i < process.argv.length; i++) {
    if (valueFlags.has(process.argv[i])) i++;
    else if (!process.argv[i].startsWith('--')) files.push(process.argv[i]);
  }
  if (!files.length) {
    console.error('usage: rank.mjs <latency.json> [...] [--top N] [--baseline file] [--out file] [--write-baseline file]');
    process.exit(2);
  }
  const budgets = JSON.parse(readFileSync(arg('--budgets', join(ROOT, 'perf/budgets.json')), 'utf8'));
  const merged = mergeRuns(files.map((f) => JSON.parse(readFileSync(f, 'utf8'))));
  const top = Number(arg('--top', 20));
  const ranked = rank(merged, budgets);
  const classes = classVerdicts(merged, budgets);
  const baselinePath = arg('--baseline');
  const regs = baselinePath ? regressions(merged, JSON.parse(readFileSync(baselinePath, 'utf8')), budgets) : null;
  const md = markdown({ merged, ranked, classes, regs, top });
  process.stdout.write(md);
  if (arg('--out')) writeFileSync(arg('--out'), md);
  if (arg('--write-baseline')) writeFileSync(arg('--write-baseline'), JSON.stringify({ writtenAt: new Date().toISOString(), runs: merged.runs, classes: merged.classes, endpoints: merged.endpoints }, null, 1) + '\n');
  const failed = classes.some((c) => !c.p95Pass) || (regs && regs.length > 0);
  if (failed) {
    console.error(`FAIL: ${classes.filter((c) => !c.p95Pass).map((c) => `class ${c.class} p95 ${f1(c.p95)} > ${c.budgetP95} ms`).join('; ')}${regs?.length ? ` ${regs.length} regression(s)` : ''}`);
    process.exit(1);
  }
}
