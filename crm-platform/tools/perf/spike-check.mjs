// QA #55: the pass rule for "no cascading failure", applied to a k6 spike result (and, when given, the sampler's readings).
//   node tools/perf/spike-check.mjs perf/results/spike-http.json [--samples perf/results/samples-http.json] [--budgets perf/budgets.json]
// Passes when: errors during the ramp and hold stay under the ceiling; errors after the drop and in recovery stay under the recovery ceiling;
// the canary (/health and a light authenticated read) stays healthy in every phase; recovery latency returns close to normal;
// and, from the samples, the API never restarted and the queues drained within the agreed time.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function checkSpike(result, budgets, samples = null) {
  const s = budgets.spike;
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass, detail });
  const ph = result.phases;
  const pct = (x) => (x == null ? 'n/a' : `${(x * 100).toFixed(2)}%`);

  for (const name of ['ramp', 'hold']) {
    const r = ph[name]?.failedRate;
    add(`errors during ${name} stay under ${pct(s.maxErrorRateDuring)}`, r != null && r <= s.maxErrorRateDuring, pct(r));
  }
  for (const name of ['drop', 'recovery']) {
    const r = ph[name]?.failedRate;
    add(`errors in ${name} stay under ${pct(s.maxErrorRateAfter)}`, r != null && r <= s.maxErrorRateAfter, pct(r));
  }
  if (s.healthMustStayUp) {
    for (const name of Object.keys(ph)) {
      const r = ph[name].canary?.failedRate;
      add(`canary healthy in ${name}`, r != null && r <= budgets.errorRate, pct(r));
    }
  }
  const n = ph.normal?.p95;
  const rec = ph.recovery?.p95;
  if (n != null && rec != null) add('recovery p95 is back within twice normal (or +50 ms)', rec <= Math.max(2 * n, n + 50), `normal ${n.toFixed(0)} ms, recovery ${rec.toFixed(0)} ms`);
  if (ph.recovery) add('no iterations dropped in recovery', (ph.recovery.dropped ?? 0) === 0, String(ph.recovery.dropped ?? 0));

  if (samples?.length) {
    let restarts = 0;
    for (let i = 1; i < samples.length; i++) if (samples[i].uptime != null && samples[i - 1].uptime != null && samples[i].uptime < samples[i - 1].uptime) restarts++;
    add('the API did not restart', restarts === 0, `${restarts} restart(s)`);
    const depth = samples.map((x) => x.queueDepth).filter((x) => x != null);
    if (depth.length) {
      const peak = Math.max(...depth);
      const last = samples[samples.length - 1];
      add('queues are empty at the end of recovery', last.queueDepth === 0, `peak ${peak}, last ${last.queueDepth}`);
    }
    const mem = samples.map((x) => x.rssMb).filter((x) => x != null);
    if (mem.length) add('memory did not grow without bound (end under 1.5x the peak of the first quarter)', mem[mem.length - 1] <= 1.5 * Math.max(...mem.slice(0, Math.max(1, mem.length >> 2))), `start ${mem[0]} MB, peak ${Math.max(...mem)} MB, end ${mem[mem.length - 1]} MB`);
  }
  return { pass: checks.every((c) => c.pass), checks };
}

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.error('usage: spike-check.mjs <spike.json> [--samples f] [--budgets f]'); process.exit(2); }
  const budgets = JSON.parse(readFileSync(arg('--budgets', join(ROOT, 'perf/budgets.json')), 'utf8'));
  const result = JSON.parse(readFileSync(file, 'utf8'));
  const samples = arg('--samples') ? JSON.parse(readFileSync(arg('--samples'), 'utf8')) : null;
  const v = checkSpike(result, budgets, samples);
  console.log(`Spike ${result.meta?.spike}: ${result.meta?.normal} -> ${result.meta?.peak} per second\n`);
  for (const c of v.checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}  [${c.detail}]`);
  if (!v.pass) process.exit(1);
}
