// QA #50: put every API route into a latency class and keep perf/endpoint-classes.json in step with the controllers.
//   A  single-record reads, sessions, small lists          (p95 < 50 ms)
//   B  writes, validated mutations, filtered lists/search  (p95 < 150 ms)
//   C  reports, analytics, exports, imports, bulk, anything that calls a provider (p95 < 300 ms)
// Usage: node tools/perf/classify.mjs            rewrite perf/endpoint-classes.json
//        node tools/perf/classify.mjs --check    fail when a route has no class, or the file lists a route that is gone
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routes } from '../qa-suite/lib/routes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const FILE = join(ROOT, 'perf/endpoint-classes.json');
export const OVERRIDES = join(ROOT, 'perf/endpoint-class-overrides.json');

// Order matters: the first matching rule wins. Each rule says why, so a reviewer can argue with the reason.
export const RULES = [
  {
    class: 'C',
    reason: 'report, analytics or export: aggregates many rows',
    test: (r) => /(report|analytic|export|insight|dashboard|summary|statistics|stats|leaderboard)/i.test(r.url),
  },
  {
    class: 'C',
    reason: 'import, bulk or batch: touches many rows in one call',
    test: (r) => /(import|bulk|batch|merge|dedup|migrate|backfill|recalculate|rebuild)/i.test(r.url),
  },
  {
    class: 'C',
    reason: 'calls a provider, sends a message or runs a model',
    test: (r) =>
      r.method !== 'GET' &&
      /(\/send|broadcast|campaign|blast|dispatch|publish|sync|connect|verify|webhook-test|generate|ai\/|llm|embed|transcri|call|voice|payment|checkout|invoice|refund|charge|payout)/i.test(
        r.url,
      ),
  },
  {
    class: 'B',
    reason: 'search or filtered list',
    test: (r) => r.method === 'GET' && /(search|filter|query|lookup|find|autocomplete|suggest)/i.test(r.url),
  },
  { class: 'B', reason: 'write: validates, writes, audits and emits an event', test: (r) => r.method !== 'GET' },
  {
    class: 'A',
    reason: 'single-record read',
    test: (r) => r.method === 'GET' && /:[A-Za-z]+\w*$/.test(r.url),
  },
  { class: 'A', reason: 'small list or lookup read', test: (r) => r.method === 'GET' },
];

export const keyOf = (r) => `${r.method} ${r.url}`;

export function classify(r, overrides = {}) {
  const o = overrides[keyOf(r)];
  if (o) return { class: o.class, reason: `reviewed: ${o.reason}`, reviewed: true };
  const rule = RULES.find((x) => x.test(r));
  return { class: rule.class, reason: rule.reason, reviewed: false };
}

export function build(routeList, overrides = {}) {
  const seen = new Set();
  const endpoints = [];
  for (const r of routeList) {
    const key = keyOf(r);
    if (seen.has(key)) continue;
    seen.add(key);
    const c = classify(r, overrides);
    endpoints.push({ route: key, class: c.class, reason: c.reason, public: r.public, ...(c.reviewed ? { reviewed: true } : {}) });
  }
  endpoints.sort((a, b) => a.route.localeCompare(b.route));
  return endpoints;
}

export function check(endpoints, routeList, overrides = {}) {
  const errors = [];
  const listed = new Map(endpoints.map((e) => [e.route, e]));
  const live = new Set(routeList.map(keyOf));
  for (const k of live) if (!listed.has(k)) errors.push(`no class for ${k}`);
  for (const k of listed.keys()) if (!live.has(k)) errors.push(`${k} is listed but no controller declares it`);
  for (const e of endpoints) if (!['A', 'B', 'C'].includes(e.class)) errors.push(`${e.route}: class "${e.class}" is not A, B or C`);
  for (const [k, o] of Object.entries(overrides)) {
    if (!live.has(k)) errors.push(`override ${k} names a route that is gone`);
    if (!['A', 'B', 'C'].includes(o.class) || !o.reason) errors.push(`override ${k} needs a class A, B or C and a reason`);
  }
  return errors;
}

export function summary(endpoints) {
  const n = { A: 0, B: 0, C: 0 };
  for (const e of endpoints) n[e.class]++;
  return n;
}

function loadOverrides() {
  try {
    return JSON.parse(readFileSync(OVERRIDES, 'utf8')).overrides ?? {};
  } catch {
    return {};
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const overrides = loadOverrides();
  const list = routes();
  if (process.argv.includes('--check')) {
    const current = JSON.parse(readFileSync(FILE, 'utf8')).endpoints;
    const errors = check(current, list, overrides);
    // A route whose rule result changed (or whose override was added) must be regenerated, not silently stale.
    const fresh = new Map(build(list, overrides).map((e) => [e.route, e.class]));
    for (const e of current) if (fresh.has(e.route) && fresh.get(e.route) !== e.class) errors.push(`${e.route}: file says ${e.class}, rules say ${fresh.get(e.route)} (run without --check)`);
    const s = summary(current);
    console.log(`${current.length} endpoints classified: ${s.A} A, ${s.B} B, ${s.C} C`);
    if (errors.length) {
      console.error(errors.slice(0, 40).join('\n') + (errors.length > 40 ? `\n... and ${errors.length - 40} more` : ''));
      process.exit(1);
    }
  } else {
    const endpoints = build(list, overrides);
    writeFileSync(FILE, JSON.stringify({ _: 'Generated by tools/perf/classify.mjs. Change a class in endpoint-class-overrides.json, not here.', endpoints }, null, 1) + '\n');
    const s = summary(endpoints);
    console.log(`wrote ${endpoints.length} endpoints: ${s.A} A, ${s.B} B, ${s.C} C`);
  }
}
