// Memory profile helpers (Sheet3 #57): percentiles over the load window, heap snapshot grouping. Used by soak.mjs --profile.
import { readFileSync } from 'node:fs';

/** Nearest-rank percentile (p in 0..100) of a number array; NaN for an empty one. */
export function percentile(xs, p) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const dist = (xs) => ({
  n: xs.length,
  min: r1(Math.min(...xs)),
  p50: r1(percentile(xs, 50)),
  p95: r1(percentile(xs, 95)),
  p99: r1(percentile(xs, 99)),
  max: r1(Math.max(...xs)),
});

/** Per-process p50/p95/p99 of rss (all samples) and heapUsed (non-GC samples, the real working level) after warm-up. */
export function summarize(rows, warmupSec) {
  const out = {};
  for (const proc of [...new Set(rows.map((r) => r.proc))]) {
    const w = rows.filter((r) => r.proc === proc && r.t >= warmupSec);
    out[proc] = {
      rssMb: dist(w.map((r) => r.rssMb)),
      heapUsedMb: dist(w.filter((r) => !r.gc).map((r) => r.heapUsedMb)),
      heapTotalMb: dist(w.map((r) => r.heapTotalMb)),
      externalMb: dist(w.map((r) => r.externalMb)),
      arrayBuffersMb: dist(w.map((r) => r.arrayBuffersMb)),
      heapUsedAfterGcMb: dist(w.filter((r) => r.gc).map((r) => r.heapUsedMb)),
    };
  }
  return out;
}

// Constructor-name groups for "where does it go". Heuristic (names, not ownership): see the report.
const GROUPS = [
  ['metrics registries (prom-client)', /^(Registry|Counter|Histogram|Gauge|Summary|Metric)$|prom/i],
  [
    'Nest providers/DI',
    /InstanceWrapper|Injector|NestContainer|Module$|Reflect|DependenciesScanner/,
  ],
  ['caches / maps', /^(Map|Set|WeakMap|LRUCache|Cache)$|cache/i],
];

/** Self-size totals by V8 node type, top constructors, and heuristic groups from a .heapsnapshot file. */
export function analyzeSnapshot(path, top = 12) {
  const s = JSON.parse(readFileSync(path, 'utf8'));
  const nf = s.snapshot.meta.node_fields,
    w = nf.length,
    ti = nf.indexOf('type'),
    ni = nf.indexOf('name'),
    si = nf.indexOf('self_size');
  const types = s.snapshot.meta.node_types[0],
    byType = {},
    byName = new Map(),
    groups = {};
  for (let i = 0; i < s.nodes.length; i += w) {
    const ty = types[s.nodes[i + ti]],
      sz = s.nodes[i + si],
      nm = s.strings[s.nodes[i + ni]] || '';
    byType[ty] = (byType[ty] || 0) + sz;
    const k = `${ty === 'object' ? '' : ty + ':'}${nm}`.slice(0, 70);
    const e = byName.get(k) || { n: 0, bytes: 0 };
    e.n++;
    e.bytes += sz;
    byName.set(k, e);
    if (ty === 'object' || ty === 'closure')
      for (const [g, re] of GROUPS) if (re.test(nm)) groups[g] = (groups[g] || 0) + sz;
  }
  const mb = (x) => Math.round((x / 1048576) * 100) / 100;
  return {
    totalMb: mb(Object.values(byType).reduce((a, b) => a + b, 0)),
    byTypeMb: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, mb(v)])),
    groupsMb: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, mb(v)])),
    topConstructors: [...byName]
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .slice(0, top)
      .map(([name, e]) => ({ name, count: e.n, mb: mb(e.bytes) })),
  };
}
