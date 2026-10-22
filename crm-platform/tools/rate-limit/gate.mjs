#!/usr/bin/env node
// Rate-limit release gate (QA sheet 3, item 33): "zero Critical/High release blockers", enforced instead of claimed.
//
//   node tools/rate-limit/gate.mjs [--census file] [--probes file] [--json file] [--no-census]
//
// Inputs: the static inventory (audit.mjs), the census evidence (census.mjs, committed so a pull request can be judged without
// booting an API), the decisions register (policy/decisions.json) and, in a full run, the live probe results.
// Rules, each a way a release could ship an unprotected route:
//   R1  every public route the census sends has a census record (a NEW public route must be measured, or limited, before it merges)
//   R2  a route that was never limited needs a written decision with a severity, a reason, an owner and an expiry date
//   R3  Critical and High can never be accepted: they are fixed, or they block
//   R4  a decision that no longer matches the census (the route is now limited, or gone) is stale and must be deleted
//   R5  a route that answered 5xx while being flooded blocks as High
//   R6  a live probe that failed blocks at the severity the probe declared
//   R7  a deploy file that switches the limiter off, or trusts every proxy, blocks as Critical
// Medium and Low are listed, never silent, and never block.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BLOCKING = new Set(['Critical', 'High']);
const RANK = { Critical: 0, High: 1, Medium: 2, Low: 3, Info: 4 };

/** The default severity of an unlimited route when nobody has judged it: the class's, so an unjudged route blocks until someone does. */
const DEFAULT_SEVERITY = {
  credential: 'Critical',
  'public-write': 'High',
  webhook: 'High',
  'public-read': 'Medium',
};

/** Pure: inputs in, findings out. `today` is injected for the expiry check. */
export function evaluate({
  inventory,
  census,
  decisions,
  probes,
  today = new Date().toISOString().slice(0, 10),
  selected,
}) {
  const findings = [];
  const add = (rule, severity, subject, detail) =>
    findings.push({ rule, severity, subject, detail });
  const bySubject = new Map((decisions?.decisions ?? []).map((d) => [d.route, d]));
  const measured = new Map((census?.results ?? []).map((r) => [r.key, r]));

  // R1: every route the census would send has a record
  if (census) {
    for (const r of selected) {
      if (!measured.has(r.key))
        add(
          'R1',
          'High',
          r.key,
          `new public ${r.class} route with no census record: limit it, or run the census and record it`,
        );
    }
  }

  for (const r of census?.results ?? []) {
    // R5
    if (r.fiveXX > 0)
      add(
        'R5',
        'High',
        r.key,
        `answered ${r.firstFiveXX} while being flooded (${r.fiveXX} of ${r.sent})`,
      );
    if (r.limited) {
      const d = bySubject.get(r.key);
      if (d)
        add(
          'R4',
          'Medium',
          r.key,
          'has a decision but is now limited: delete the decision (the register only shrinks)',
        );
      continue;
    }
    // R2 and R3
    const d = bySubject.get(r.key);
    if (!d) {
      add(
        'R2',
        DEFAULT_SEVERITY[r.class] ?? 'Medium',
        r.key,
        `never limited in ${r.sent} requests and no decision is written for it`,
      );
      continue;
    }
    for (const k of ['severity', 'rationale', 'owner', 'expires']) {
      if (!d[k]) add('R2', 'High', r.key, `its decision has no ${k}`);
    }
    if (d.expires && d.expires < today)
      add('R2', 'High', r.key, `its decision expired on ${d.expires}`);
    if (BLOCKING.has(d.severity) && d.status !== 'fixed-pending')
      add('R3', d.severity, r.key, `${d.severity} cannot be accepted: ${d.rationale}`);
    else if (d.severity) add('accepted', d.severity, r.key, d.rationale);
  }

  // R4 for routes that disappeared
  for (const d of decisions?.decisions ?? []) {
    if (census && !measured.has(d.route))
      add(
        'R4',
        'Medium',
        d.route,
        'has a decision but is no longer in the census: delete the decision',
      );
  }

  // R6
  for (const p of probes?.results ?? []) {
    if (p.status === 'FAIL' || p.status === 'ERROR') {
      const known = (decisions?.knownProbeFailures ?? []).find((k) => k.id === p.id);
      const severity = p.status === 'ERROR' ? 'High' : p.severityIfFails;
      if (known && !BLOCKING.has(severity))
        add('accepted', severity, `probe:${p.id}`, `${known.rationale} (${p.detail})`);
      else add('R6', severity, `probe:${p.id}`, p.detail);
    }
  }

  // R7
  for (const p of inventory?.deploy?.problems ?? [])
    add('R7', 'Critical', `${p.file}: ${p.name}`, p.why);

  findings.sort(
    (a, b) => RANK[a.severity] - RANK[b.severity] || a.subject.localeCompare(b.subject),
  );
  const blockers = findings.filter((f) => BLOCKING.has(f.severity) && f.rule !== 'accepted');
  return { findings, blockers, verdict: blockers.length ? 'NO-GO' : 'GO' };
}

/** The routes a census sends (kept in step with census.selectRoutes). */
export const selectedRoutes = (inventory) =>
  inventory.routes.filter(
    (r) =>
      r.public &&
      ['credential', 'public-write', 'webhook', 'public-read'].includes(r.class) &&
      !r.key.includes('/api/v1/'),
  );

function main() {
  const args = process.argv.slice(2);
  const val = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
  const inventory = read(join(ROOT, 'docs/security/rate-limiting/route-inventory.json'));
  const census = args.includes('--no-census')
    ? null
    : read(val('--census', join(ROOT, 'docs/security/rate-limiting/census.json')));
  const decisions = read(join(ROOT, 'tools/rate-limit/policy/decisions.json'));
  const probes = val('--probes') ? read(val('--probes')) : null;
  const out = evaluate({
    inventory,
    census,
    decisions,
    probes,
    selected: selectedRoutes(inventory),
  });
  const count = (s) => out.findings.filter((f) => f.severity === s && f.rule !== 'accepted').length;
  console.log(
    `rate-limit gate: ${out.verdict}. Critical ${count('Critical')}, High ${count('High')}, Medium ${count('Medium')}, Low ${count('Low')}; accepted ${out.findings.filter((f) => f.rule === 'accepted').length}.`,
  );
  for (const f of out.blockers)
    console.error(`  ${f.severity.toUpperCase()} ${f.rule} ${f.subject}: ${f.detail}`);
  if (val('--json'))
    writeFileSync(
      val('--json'),
      JSON.stringify({ verdict: out.verdict, findings: out.findings }, null, 2) + '\n',
    );
  process.exit(out.verdict === 'GO' ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
