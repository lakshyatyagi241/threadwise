// QA #53: judge a k6 load result (perf/load.js) and, when given, the sampler's readings taken during it.
//   node tools/perf/load-report.mjs perf/results/load-full.json [--samples perf/results/samples-load-full.json] [--budgets perf/budgets.json]
// Per stage of concurrent active users: requests per second, errors, p50/p95/p99 per class, and two verdicts:
//   inside the budgets  errors under the ceiling AND every class inside its p95 budget (the sheet's budgets)
//   usable              errors under the ceiling AND p95 of all requests under budgets.load.usableP95Ms
// The answer is the highest stage that holds each verdict, and whether the 500-user baseline does. Exit 1 when the baseline stage is not inside the budgets.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function judgeStage(stage, budgets) {
  const why = [];
  const err = stage.failedRate;
  if (err == null || err > budgets.errorRate)
    why.push(`errors ${err == null ? 'unknown' : (100 * err).toFixed(2) + '%'}`);
  const over = [];
  for (const [c, t] of Object.entries(stage.classes ?? {}))
    if (t.p95 > budgets.latency[c].p95) over.push(`${c} ${Math.round(t.p95)} ms`);
  const usable =
    err != null &&
    err <= budgets.errorRate &&
    (stage.all?.p95 ?? Infinity) <= budgets.load.usableP95Ms;
  const inBudget = err != null && err <= budgets.errorRate && over.length === 0;
  return {
    users: stage.users,
    inBudget,
    usable,
    why: [...why, ...(over.length ? [`over p95 budget: ${over.join(', ')}`] : [])],
  };
}

export function summarise(result, budgets) {
  const stages = Object.values(result.stages).sort((a, b) => a.users - b.users);
  const verdicts = stages.map((s) => judgeStage(s, budgets));
  const top = (key) => {
    let best = 0;
    for (const v of verdicts) {
      if (!v[key]) break;
      best = v.users;
    }
    return best;
  };
  const baseline = verdicts.find((v) => v.users === budgets.load.baselineUsers) ?? null;
  return { verdicts, maxInBudget: top('inBudget'), maxUsable: top('usable'), baseline };
}

/** Peak readings from the sampler for the window of one stage (the end of the run is known, the start is derived: accurate to about 30 s). */
export function samplesFor(samples, meta, index) {
  if (!samples?.length || !meta?.endedAt) return null;
  const stages = meta.users.length;
  const start = meta.endedAt - stages * meta.stageSeconds * 1000 + index * meta.stageSeconds * 1000;
  const win = samples.filter(
    (s) =>
      s.at >= start + (meta.ramp ?? 0) * 1000 && s.at <= start + (meta.ramp + meta.hold) * 1000,
  );
  if (!win.length) return null;
  const peak = (k) => {
    const v = win.map((s) => s[k]).filter((x) => x != null);
    return v.length ? Math.max(...v) : null;
  };
  return {
    systemCpuPct: peak('systemCpuPct'),
    apiCpuPct: peak('apiCpuPct'),
    rssMb: peak('rssMb'),
    pgConns: peak('pgConns'),
    queueDepth: peak('queueDepth'),
  };
}

const f0 = (x) => (x == null ? 'n/a' : Math.round(x));
export function markdown(result, budgets, samples) {
  const s = summarise(result, budgets);
  const m = result.meta;
  const L = [
    `# Load test: ${m.mix} mix, ${m.think[0]} to ${m.think[1]} s between actions`,
    '',
    `Stages of concurrent active users, each ramped ${m.ramp} s and held ${m.hold} s. Times in ms.`,
    '',
    '| Users | Req/s | Errors | A p95 | B p95 | C p95 | All p50 | All p95 | All p99 | Inside the budgets | Usable |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  Object.values(result.stages)
    .sort((a, b) => a.users - b.users)
    .forEach((st, i) => {
      const v = s.verdicts[i];
      L.push(
        `| ${st.users} | ${st.rps.toFixed(1)} | ${st.failedRate == null ? 'n/a' : (100 * st.failedRate).toFixed(2) + '%'} | ${f0(st.classes.A?.p95)} | ${f0(st.classes.B?.p95)} | ${f0(st.classes.C?.p95)} | ${f0(st.all?.p50)} | ${f0(st.all?.p95)} | ${f0(st.all?.p99)} | ${v.inBudget ? 'yes' : 'no'} | ${v.usable ? 'yes' : 'no'} |`,
      );
    });
  const peaks = Object.values(result.stages)
    .sort((a, b) => a.users - b.users)
    .map((st, i) => [st.users, samplesFor(samples, m, i)])
    .filter(([, p]) => p);
  if (peaks.length) {
    L.push(
      '',
      '## Server side (peak readings while each stage was held)',
      '',
      '| Users | Machine CPU % | API CPU % (100 = one core) | API memory MB | DB connections | Queue depth |',
      '|---|---|---|---|---|---|',
    );
    for (const [u, p] of peaks)
      L.push(
        `| ${u} | ${f0(p.systemCpuPct)} | ${f0(p.apiCpuPct)} | ${f0(p.rssMb)} | ${f0(p.pgConns)} | ${f0(p.queueDepth)} |`,
      );
  }
  L.push(
    '',
    `Highest stage inside the budgets: **${s.maxInBudget || 'none'}** users. Highest stage that stays usable: **${s.maxUsable || 'none'}** users.`,
  );
  if (s.baseline)
    L.push(
      `The ${budgets.load.baselineUsers}-user baseline is ${s.baseline.inBudget ? 'inside the budgets' : 'NOT inside the budgets'} (${s.baseline.inBudget ? 'ok' : s.baseline.why.join('; ')}) and ${s.baseline.usable ? 'usable' : 'NOT usable'}.`,
    );
  return L.join('\n') + '\n';
}

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: load-report.mjs <load.json> [--samples f] [--budgets f]');
    process.exit(2);
  }
  const budgets = JSON.parse(
    readFileSync(arg('--budgets', join(ROOT, 'perf/budgets.json')), 'utf8'),
  );
  const result = JSON.parse(readFileSync(file, 'utf8'));
  const samples = arg('--samples') ? JSON.parse(readFileSync(arg('--samples'), 'utf8')) : null;
  process.stdout.write(markdown(result, budgets, samples));
  const s = summarise(result, budgets);
  if (s.baseline && !s.baseline.inBudget) process.exit(1);
}
