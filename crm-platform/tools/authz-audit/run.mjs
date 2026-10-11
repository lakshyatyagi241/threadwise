#!/usr/bin/env node
// Authorization audit: one command, one report.
//
//   pnpm audit:authz                 static checks + route inventory + policy matrix (seconds, no Docker)
//   pnpm audit:authz -- --dynamic    + the generated e2e matrix and the deep authz specs (Docker Desktop must run; ~15 min)
//   pnpm audit:authz -- --strict     CONDITIONAL also exits non-zero (pre-release)
//
// Output: reports/authz-audit/<timestamp>/ (copied to latest/): authorization-route-inventory.json, authorization-policy-matrix.csv,
// authorization-test-results.json, authorization-security-findings.json, authorization-release-certification.json, report.md.
// Exit: 0 GO/CONDITIONAL, 20 NO-GO, 10 CONDITIONAL with --strict. See tools/authz-audit/README.md.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, scanRoutes } from './lib/routes.mjs';
import { runStaticChecks } from './lib/static-checks.mjs';
import { buildMatrix } from './lib/matrix.mjs';
import { CONTROLS } from './lib/controls.mjs';

const args = new Set(process.argv.slice(2));
const dynamic = args.has('--dynamic');
const strict = args.has('--strict');
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const OUT = join(REPO, 'reports/authz-audit', stamp);
const LATEST = join(REPO, 'reports/authz-audit/latest');
mkdirSync(OUT, { recursive: true });
writeFileSync(join(REPO, 'reports/authz-audit/.gitignore'), '*\n');

const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback);
const policy = readJson(join(import.meta.dirname, 'policy/self-service.json'), {});
const decisions = readJson(join(import.meta.dirname, 'decisions.json'), {});

// ---- 1. inventory + static checks -------------------------------------------------------------------------------------------------
const routes = scanRoutes();
const checks = runStaticChecks(routes, policy, decisions);
writeFileSync(join(OUT, 'authorization-route-inventory.json'), JSON.stringify({ routes: routes.length, routesList: routes }, null, 2));

// ---- 2. policy matrix -------------------------------------------------------------------------------------------------------------
const matrix = buildMatrix(routes, policy);
writeFileSync(join(OUT, 'authorization-policy-matrix.csv'), matrix.csv);

// ---- 3. dynamic suites ------------------------------------------------------------------------------------------------------------
const suites = [];
if (dynamic) {
  const env = { ...process.env, AUTHZ_REPORT_DIR: OUT, SWC_NATIVE_BINDING_CACHE: process.env.SWC_NATIVE_BINDING_CACHE ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.cache/swc-native') };
  const vitest = join(REPO, 'apps/api/node_modules/vitest/vitest.mjs');
  const r = spawnSync(process.execPath, [vitest, 'run', '--dir', 'test/e2e', 'authz', '--testTimeout=1800000', '--maxWorkers=2', '--reporter=json', `--outputFile=${join(OUT, 'vitest-authz.json')}`], {
    cwd: join(REPO, 'apps/api'),
    env,
    stdio: 'inherit',
  });
  suites.push({ name: 'e2e/authz', exitCode: r.status });
}
const vitestJson = readJson(join(OUT, 'vitest-authz.json'), null);
const matrixResults = readJson(join(OUT, 'matrix-results.json'), null);

// ---- 4. findings + controls -------------------------------------------------------------------------------------------------------
const findings = [];
for (const c of checks) {
  if (c.status === 'fail' || c.status === 'error') findings.push({ id: `AZ-${c.id}`, severity: c.severity, title: c.title, summary: c.summary, evidence: c.evidence.slice(0, 50), status: 'open' });
  if (c.status === 'needs-decision') findings.push({ id: `AZ-${c.id}`, severity: c.severity, title: c.title, summary: c.summary, evidence: c.evidence.slice(0, 50), status: 'needs-decision' });
}
if (vitestJson) {
  for (const f of vitestJson.testResults ?? []) {
    for (const t of f.assertionResults ?? []) {
      if (t.status === 'failed') {
        findings.push({ id: `AZ-dyn-${createHash('sha1').update(t.fullName).digest('hex').slice(0, 8)}`, severity: 'critical', title: t.fullName, summary: (t.failureMessages?.[0] ?? '').slice(0, 1500), evidence: [f.name], status: 'open' });
      }
    }
  }
}
for (const [id, d] of Object.entries(decisions)) {
  const f = findings.find((x) => x.id === `AZ-${id}`);
  if (f && d.decision === 'accepted') f.status = 'accepted';
}

const controlStatus = CONTROLS.map((c) => {
  const supporting = checks.filter((k) => k.controls.includes(c.id));
  const failed = supporting.filter((k) => ['fail', 'error'].includes(k.status));
  const decide = supporting.filter((k) => k.status === 'needs-decision' && !(decisions[k.id]?.decision === 'accepted'));
  // A spec counts as evidence only if its file ran, had tests, and every test passed.
  const specState = c.specs.map((s) => {
    const files = (vitestJson?.testResults ?? []).filter((f) => f.name.replace(/\\/g, '/').includes(`/authz/${s}`));
    if (!files.length) return 'missing';
    const tests = files.flatMap((f) => f.assertionResults ?? []);
    if (!tests.length) return 'missing';
    return tests.every((t) => t.status === 'passed') ? 'pass' : 'fail';
  });
  const dynamicFail = specState.includes('fail');
  const dynamicPass = c.dynamic && specState.every((s) => s === 'pass');
  let status = 'Not assessed';
  if (failed.length || dynamicFail) status = 'Fail';
  else if (decide.length) status = 'Needs decision';
  else if (supporting.some((k) => k.status === 'pass') || dynamicPass) status = 'Pass';
  else if (specState.some((s) => s === 'pass')) status = 'Partial';
  else if (supporting.length || c.dynamic) status = dynamic ? 'Not run' : 'Not run';
  return { ...c, status, checks: supporting.map((k) => k.id) };
});
writeFileSync(join(OUT, 'authorization-control-matrix.csv'), ['id,priority,status,requirement,checks', ...controlStatus.map((c) => `${c.id},${c.priority},${c.status},"${c.title.replace(/"/g, '""')}","${c.checks.join(' ')}"`)].join('\n'));

const open = findings.filter((f) => f.status === 'open');
const blockers = open.filter((f) => ['critical', 'high'].includes(f.severity));
const p0Unproven = controlStatus.filter((c) => c.priority === 'P0' && !['Pass', 'Not applicable'].includes(c.status));
const verdict = blockers.length ? 'NO-GO' : p0Unproven.length || !dynamic ? 'CONDITIONAL' : 'GO';

writeFileSync(join(OUT, 'authorization-security-findings.json'), JSON.stringify(findings, null, 2));
writeFileSync(join(OUT, 'authorization-test-results.json'), JSON.stringify({ suites, vitest: vitestJson && { passed: vitestJson.numPassedTests, failed: vitestJson.numFailedTests, total: vitestJson.numTotalTests }, matrix: matrixResults && { routes: matrixResults.routes, notTested: matrixResults.results?.idorNotTested?.length ?? 0 } }, null, 2));
writeFileSync(
  join(OUT, 'authorization-release-certification.json'),
  JSON.stringify(
    {
      verdict,
      generatedAt: new Date().toISOString(),
      dynamicRan: dynamic,
      routes: routes.length,
      openBlockers: blockers.map((f) => f.id),
      needsDecision: findings.filter((f) => f.status === 'needs-decision').map((f) => f.id),
      p0ControlsNotProven: p0Unproven.map((c) => `${c.id} ${c.status}`),
      note: 'NOT READY means a blocker or an unproven P0 control remains; never read CONDITIONAL as passed.',
    },
    null,
    2,
  ),
);

const byStatus = controlStatus.reduce((a, c) => ((a[c.status] = (a[c.status] ?? 0) + 1), a), {});
const md = [
  `# Authorization audit — ${verdict}`,
  '',
  `Routes: ${routes.length} · dynamic suites ${dynamic ? 'ran' : 'did NOT run (use --dynamic)'} · controls: ${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(', ')}`,
  '',
  '## Findings',
  ...(findings.length ? findings.map((f) => `- **${f.severity.toUpperCase()}** [${f.status}] ${f.id}: ${f.title}\n  ${f.summary.split('\n')[0]}`) : ['- none']),
  '',
  '## Checks',
  ...checks.map((c) => `- ${c.status.toUpperCase()} ${c.id}: ${c.summary}`),
  '',
  '## Matrix coverage',
  `- Policy rows: ${matrix.rows}; classes: ${JSON.stringify(matrix.byDecision)}`,
  ...(matrixResults ? [`- IDOR cross-tenant probes: ${matrixResults.results.idor.length} tested, ${matrixResults.results.idorNotTested.length} routes without a tenant-A fixture (NOT tested)`] : []),
  '',
].join('\n');
writeFileSync(join(OUT, 'report.md'), md);

cpSync(OUT, LATEST, { recursive: true });
console.log(md);
console.log(`\nreport: ${OUT}`);
process.exit(verdict === 'NO-GO' ? 20 : verdict === 'CONDITIONAL' && strict ? 10 : 0);
