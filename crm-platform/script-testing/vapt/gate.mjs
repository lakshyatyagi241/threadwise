#!/usr/bin/env node
// Judge the logs/reports a run.sh run produced against known-baseline.json; write result.json; print the summary; exit 0/1.
// usage: node gate.mjs <outDir> <mode> <startedAtIso> <zapState> <rerunCommand>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [OUT, MODE, STARTED, ZAP, RERUN] = process.argv.slice(2);
const HERE = dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(readFileSync(join(HERE, 'known-baseline.json'), 'utf8'));
const txt = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const json = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const exit = (n) => {
  const t = txt(`${OUT}/logs/${n}.exit`).trim();
  return t === '' ? null : Number(t);
};
const checks = [];
const add = (name, ok, detail) => checks.push({ name, status: ok === 'warn' ? 'WARN' : ok ? 'PASS' : 'FAIL', detail });
const log = (n) => txt(`${OUT}/logs/${n}.log`);

// audits that must at least have run
for (const n of ['migrate', 'seed', 'seed_auth', 'api_boot']) if (exit(n) !== 0 && exit(n) !== null) add(`setup:${n}`, false, `exit ${exit(n)}`);

// authz: exit code + any High/Critical id outside the baseline
{
  const ids = [...log('audit_authz').matchAll(/\*\*(CRITICAL|HIGH)\*\*\s*\[[^\]]*\]\s*([\w-]+)/g)].map((m) => [m[1], m[2]]);
  const fresh = ids.filter(([, id]) => !base.highs[id]);
  add('audit:authz', exit('audit_authz') === 0 && !fresh.length, `exit ${exit('audit_authz')}; High/Critical ${ids.map((x) => x[1]).join(',') || 'none'}${fresh.length ? `; NEW ${fresh.map((x) => x[1])}` : ''}`);
}
// auth: verdict NO-GO is exit 20; open critical/high must be 0 (owner-accepted ones are not counted open by the tool)
{
  const m = log('audit_auth').match(/open findings:\s*(\d+) critical\D+(\d+) high/);
  const open = m ? Number(m[1]) + Number(m[2]) : null;
  add('audit:auth', exit('audit_auth') === 0 && open === 0, `exit ${exit('audit_auth')}; open critical+high ${open ?? 'unparsed'}; accepted: ${Object.keys(base.acceptedByOwner).join(', ')}`);
}
// sast: counts may not exceed the baseline
{
  const m = log('audit_sast').match(/SAST: (\d+) critical, (\d+) high/);
  const ok = m && Number(m[1]) <= base.sastMax.critical && Number(m[2]) <= base.sastMax.high;
  add('audit:sast', !!ok, m ? `${m[1]} critical, ${m[2]} high (baseline ${base.sastMax.critical}/${base.sastMax.high})` : 'output not parsed');
}
add('dependency audit (prod, high)', exit('audit_deps') === 0, `exit ${exit('audit_deps')}`);
// tenancy: judged from the JSON artefacts, not from the tool's own NO-GO verdict
{
  const R = 'reports/tenancy-audit/latest';
  const res = json(`${R}/tenant-isolation-test-results.json`);
  const failed = (res?.results ?? []).filter((x) => x.status === 'FAILED' && !base.tenancyProbeGapTables[x.table]);
  const finds = json(`${R}/tenant-security-findings.json`) ?? [];
  const list = Array.isArray(finds) ? finds : Object.values(finds);
  const newHigh = list.filter((f) => /^(Critical|High)$/i.test(f.severity) && !/fixed/i.test(f.status ?? '') && !base.highs[f.id]);
  const unclassified = txt(`${R}/tenant-entity-inventory.csv`).split('\n').filter((l) => l.includes(',UNCLASSIFIED,')).map((l) => l.split(',')[0]).filter((t) => !base.tenancyUnclassifiedTables[t]);
  const q = json(`${R}/tenant-cache-queue-audit.json`);
  const priv = (q?.privileged?.files ?? []).filter((f) => !f.reviewed && !base.tenancyPrivilegedFiles[f.file]).map((f) => f.file);
  const raw = (q?.sqlRawInterpolation?.files ?? []).filter((f) => !f.reviewed && !base.tenancySqlRawFiles[f.file]).map((f) => f.file);
  const ran = !!res;
  add('audit:tenancy', ran && !failed.length && !newHigh.length && !unclassified.length && !priv.length && !raw.length,
    ran ? `scenarios failed outside known gap ${failed.length}; new High/Critical ${newHigh.map((f) => f.id)}; new unclassified tables ${unclassified}; new privileged files ${priv}; new sql.raw files ${raw}` : 'tenancy results missing (DB checks did not run)');
}
// DAST walker
{
  const d = json(`${OUT}/dast.json`);
  const bad = (d?.findings ?? []).filter((f) => /^(Critical|High)$/.test(f.severity));
  add('DAST walker', !!d && !bad.length, d ? `${d.routes} operations; ${JSON.stringify(d.counts)}${bad.length ? `; NEW ${bad.map((f) => f.id)}` : ''}` : 'no dast.json');
}
// live attack tests
{
  const t = log('vapt_tests');
  const p = t.match(/Tests\s+(?:(\d+) failed \| )?(\d+) passed/);
  const failedN = p?.[1] ? Number(p[1]) : 0;
  add('live attack tests', exit('vapt_tests') === 0 && !!p && !failedN, p ? `${p[2]} passed, ${failedN} failed` : 'output not parsed');
}
// ZAP (full mode only)
if (MODE === 'full') {
  const z = json(`${OUT}/zap/zap-report.json`);
  if (z) {
    const high = (z.site ?? []).flatMap((s) => s.alerts ?? []).filter((a) => Number(a.riskcode) >= 3);
    add('OWASP ZAP', !high.length, `${high.length} High alert(s)`);
  } else add('OWASP ZAP', false, `${ZAP}: no report produced, so the scan is NOT verified (treated as FAIL, never as a pass)`);
} else checks.push({ name: 'OWASP ZAP', status: 'SKIPPED', detail: 'quick mode (use the full profile)' });

const failedChecks = checks.filter((c) => c.status === 'FAIL');
const status = failedChecks.length ? 'FAIL' : 'PASS';
const finished = new Date();
const result = {
  id: 'vapt', sheetItem: 25, title: 'VAPT baseline', mode: MODE, status,
  startedAt: STARTED, finishedAt: finished.toISOString(), durationSeconds: Math.round((finished - new Date(STARTED)) / 1000),
  checks,
  counts: { checks: checks.length, passed: checks.filter((c) => c.status === 'PASS').length, failed: failedChecks.length, skipped: checks.filter((c) => c.status === 'SKIPPED').length },
  knownOpenBaseline: { highs: Object.keys(base.highs), acceptedByOwner: Object.keys(base.acceptedByOwner) },
  artifacts: [`${OUT}/logs`, `${OUT}/dast.json`],
  commands: [RERUN],
};
writeFileSync(`${OUT}/result.json`, JSON.stringify(result, null, 2));
console.log('\n=== VAPT result ===');
for (const c of checks) console.log(`${c.status.padEnd(8)} ${c.name.padEnd(30)} ${c.detail}`);
console.log(`\nKnown open items tolerated (known-baseline.json): ${[...result.knownOpenBaseline.highs, ...result.knownOpenBaseline.acceptedByOwner].join(', ')}`);
console.log(`STATUS ${status} | ${result.counts.passed}/${result.counts.checks} checks passed | ${result.durationSeconds}s`);
console.log(`result: ${OUT}/result.json\nre-run: ${RERUN}`);
process.exit(status === 'PASS' ? 0 : 1);
