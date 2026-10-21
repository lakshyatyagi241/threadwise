#!/usr/bin/env node
// Merge the step results of tools/security/vapt.sh into reports/vapt/summary.{json,md} and set the exit code:
// non-zero when any Critical/High is open (DAST finding, failing VAPT test, auth audit NO-GO, authz audit failure, dependency
// advisory at high with no repo-recorded ignore, or a generated tenancy scenario that FAILED outside the known team_members probe gap).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const dir = process.argv[2] ?? 'reports/vapt';
const rd = (f) =>
  existsSync(`${dir}/${f}`) ? JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) : null;
const steps = rd('steps.json') ?? {}; // { name: exitCode }
const dast = rd('dast.json');
const zap = rd('zap/zap-report.json');
const blockers = [];
const rows = Object.entries(steps).map(([name, exit]) => ({ name, exit }));

if (dast)
  for (const f of dast.findings)
    if (/^(Critical|High)$/.test(f.severity)) blockers.push(`DAST ${f.id}: ${f.title}`);
if (zap)
  for (const a of (zap.site ?? [])
    .flatMap((s) => s.alerts ?? [])
    .filter((x) => Number(x.riskcode) >= 3))
    blockers.push(`ZAP High: ${a.name} (${a.instances?.length ?? 0} instances)`);
if (steps.vapt_tests) blockers.push('VAPT live tests failed');
if (steps.audit_auth === 20) blockers.push('auth audit verdict NO-GO');
if (steps.audit_authz) blockers.push('authz audit failed');
if (steps.audit_deps)
  blockers.push('dependency audit reports a high/critical advisory not in auditConfig.ignoreGhsas');
if (steps.tenancy_failed_scenarios)
  blockers.push(`${steps.tenancy_failed_scenarios} generated cross-tenant scenario(s) failed`);

const out = {
  blockers,
  steps: rows,
  dast: dast?.counts ?? null,
  zap: zap ? 'ran' : 'not run (fallback DAST only)',
};
writeFileSync(`${dir}/summary.json`, JSON.stringify(out, null, 2));
writeFileSync(
  `${dir}/summary.md`,
  `# VAPT summary\n\nBlockers (Critical/High): ${blockers.length}\n${blockers.map((b) => `- ${b}`).join('\n')}\n\n| step | exit |\n|---|---|\n${rows.map((r) => `| ${r.name} | ${r.exit} |`).join('\n')}\n\nDAST: ${JSON.stringify(out.dast)}; ZAP: ${out.zap}\n`,
);
console.log(`VAPT: ${blockers.length} Critical/High blocker(s). ${dir}/summary.md`);
process.exit(blockers.length ? 1 : 0);
