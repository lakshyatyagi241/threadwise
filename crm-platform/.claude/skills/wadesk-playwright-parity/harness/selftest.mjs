#!/usr/bin/env node
// Harness self-test. Proves the engine can tell a faithful copy from a broken one:
//   1. A/A: WaDesk against a second copy of itself must report ZERO defects (no false positives).
//   2. A/B: for each planted defect (lib/mutants.mjs) the comparator must report it (no false negatives).
// Needs the WaDesk reference running. Takes about 3 minutes (use --quick for a 1 minute subset).
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUTANTS } from './lib/mutants.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC = join(HERE, 'specs', 'selftest.contacts.twin.mjs');
const quick = process.argv.includes('--quick');
const only = process.argv
  .find((a) => a.startsWith('--mutant='))
  ?.slice(9)
  ?.split(',');

function run(env, onlyRx, extra = []) {
  const r = spawnSync(
    'node',
    [join(HERE, 'run.mjs'), SPEC, '--depth', 'quick', '--no-teardown', '--only', onlyRx, ...extra],
    { env: { ...process.env, PARITY_AA: '1', ...env }, encoding: 'utf8', timeout: 6 * 60 * 1000 },
  );
  const m = /run dir: (.+)/.exec(r.stdout || '');
  const dir = m?.[1]?.trim();
  const findings =
    dir && existsSync(join(dir, 'findings.json'))
      ? JSON.parse(readFileSync(join(dir, 'findings.json'), 'utf8'))
      : null;
  return { code: r.status, out: r.stdout + r.stderr, dir, findings };
}

let failed = 0;
const row = (ok, name, detail) => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

// 1. A/A
const aaOnly = quick
  ? 'contacts-page\\.load|contact-create\\.(structure|happy|all-empty)$'
  : 'contacts-page\\.|contact-create\\.(structure|happy|all-empty|mobile\\.(letters|too-short)|email\\.no-at|first_name\\.(required|html|max\\+1|spaces))$|contact-delete\\.';
const aa = run({}, aaOnly);
if (!aa.findings)
  row(
    false,
    'A/A baseline',
    'run produced no findings (is WaDesk running?)\n' + aa.out.slice(-600),
  );
else {
  const bad = aa.findings.filter((f) => ['defect', 'spec-issue'].includes(f.result));
  const n = new Set(aa.findings.map((f) => f.scenario)).size;
  row(
    bad.length === 0,
    `A/A baseline: ${n} scenarios, ${aa.findings.length} comparisons`,
    bad.length
      ? 'false positives: ' +
          bad
            .slice(0, 4)
            .map((f) => `${f.scenario}:${f.key}`)
            .join(', ')
      : 'zero defects',
  );
}

// 2. A/B, one planted defect at a time
for (const [name, m] of Object.entries(MUTANTS)) {
  if (only && !only.includes(name)) continue;
  if (quick && !['accept-invalid', 'drop-field', 'console-error', 'page-error'].includes(name))
    continue;
  const r = run({ PARITY_MUTATE: name }, m.only);
  if (!r.findings) {
    row(false, `A/B ${name}`, 'run produced no findings\n' + r.out.slice(-400));
    continue;
  }
  const defects = r.findings.filter((f) => f.result === 'defect');
  const hit = defects.find((f) => m.expect.some((rx) => rx.test(f.key)));
  row(
    !!hit,
    `A/B ${name}: ${m.describe}`,
    hit
      ? `caught by ${hit.scenario} -> ${hit.key} (${hit.severity})`
      : `NOT caught; defects seen: ${defects.map((f) => f.key).join(', ') || 'none'}`,
  );
}

// the runs above keep their test data (--no-teardown) so findings can be inspected; remove it once, at the end
const td = spawnSync('node', [join(HERE, 'run.mjs'), SPEC, '--teardown-only'], {
  env: { ...process.env, PARITY_AA: '1' },
  encoding: 'utf8',
  timeout: 5 * 60 * 1000,
});
console.log(
  /teardown ok/.test(td.stdout)
    ? 'cleanup: test contacts removed from the WaDesk reference'
    : 'cleanup: FAILED, delete contacts whose name starts with "pwp-" in WaDesk by hand\n' +
        (td.stdout + td.stderr).slice(-300),
);

console.log(failed ? `\nSELFTEST FAILED (${failed})` : '\nSELFTEST OK');
process.exit(failed ? 1 : 0);
