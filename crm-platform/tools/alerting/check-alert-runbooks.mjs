#!/usr/bin/env node
// Ratchet for Sheet3 #76: every alert has an existing runbook, and docs/performance/alerting/failure-modes.json agrees with the rules.
//   node tools/alerting/check-alert-runbooks.mjs [repoRoot]        exit 1 with the list of problems
// Rules checked (see check() below): alert missing from the matrix, matrix alert missing from the rules, alert with no runbook
// annotation (required in p0-failure-modes.rules.yml, otherwise the matrix runbook counts), runbook file or #anchor missing,
// "tested" status without a promtool case or live result, "gap" without a named missing metric.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const slug = (h) =>
  h
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .trim()
    .replace(/ /g, '-');

export function check(root) {
  const problems = [];
  const obs = path.join(root, 'deploy/observability');
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const matrix = JSON.parse(read('docs/performance/alerting/failure-modes.json'));
  const ruleFiles = fs.readdirSync(obs).filter((f) => f.endsWith('.rules.yml'));
  const testText = fs
    .readdirSync(obs)
    .filter((f) => f.endsWith('.rules.test.yml'))
    .map((f) => fs.readFileSync(path.join(obs, f), 'utf8'))
    .join('\n');

  const alerts = new Map(); // name -> { file, runbook }
  for (const f of ruleFiles) {
    const blocks = fs
      .readFileSync(path.join(obs, f), 'utf8')
      .split(/^\s*- (?=alert:|record:)/m)
      .slice(1);
    for (const b of blocks) {
      const name = /^alert:\s*(\w+)/.exec(b)?.[1];
      if (!name) continue;
      alerts.set(name, {
        file: f,
        runbook: /^\s*runbook:\s*'?"?([^'"\n]+)/m.exec(b)?.[1]?.trim() ?? null,
      });
    }
  }

  const inMatrix = new Map();
  for (const m of matrix.modes) for (const a of m.alerts) inMatrix.set(a, m);

  const runbookOk = (ref, who) => {
    const [file, anchor] = ref.split('#');
    const p = path.join(root, file);
    if (!fs.existsSync(p)) return problems.push(`${who}: runbook file ${file} does not exist`);
    if (
      anchor &&
      !read(file)
        .split('\n')
        .filter((l) => /^#{1,6} /.test(l))
        .map((l) => slug(l.replace(/^#+ /, '')))
        .includes(anchor)
    ) {
      problems.push(`${who}: runbook anchor #${anchor} not found in ${file}`);
    }
  };

  for (const [name, a] of alerts) {
    const m = inMatrix.get(name);
    if (!m) problems.push(`${name} (${a.file}): not in failure-modes.json`);
    const ref = a.runbook ?? (a.file === 'p0-failure-modes.rules.yml' ? null : m?.runbook);
    if (!ref)
      problems.push(
        `${name} (${a.file}): no runbook annotation${a.file === 'p0-failure-modes.rules.yml' ? '' : ' and no runbook in the matrix'}`,
      );
    else runbookOk(ref, name);
  }
  const live = fs.existsSync(path.join(root, 'docs/performance/alerting/live-test-results.json'))
    ? JSON.parse(read('docs/performance/alerting/live-test-results.json')).results
    : [];
  for (const m of matrix.modes) {
    for (const a of m.alerts)
      if (!alerts.has(a)) problems.push(`mode ${m.id}: alert ${a} is not in any rules file`);
    if (m.status === 'gap') {
      if (!m.gap?.missingMetric) problems.push(`mode ${m.id}: gap without gap.missingMetric`);
      if (m.alerts.length) problems.push(`mode ${m.id}: status gap but alerts listed`);
      continue;
    }
    if (!m.alerts.length) problems.push(`mode ${m.id}: not a gap but no alert`);
    if (!m.runbook) problems.push(`mode ${m.id}: no runbook`);
    else if (!m.runbook.startsWith('deploy/')) runbookOk(m.runbook, `mode ${m.id}`);
    else if (!fs.existsSync(path.join(root, m.runbook)))
      problems.push(`mode ${m.id}: ${m.runbook} does not exist`);
    if (m.status === 'tested-promtool' || m.status === 'tested-live') {
      for (const a of m.alerts)
        if (!new RegExp(`alertname:\\s*${a}\\b`).test(testText))
          problems.push(`mode ${m.id}: ${a} claimed tested but has no promtool case`);
    }
    if (m.status === 'tested-live') {
      for (const c of m.liveCase ?? []) {
        const r = live.find((x) => x.id === c);
        if (!r?.fired)
          problems.push(
            `mode ${m.id}: live case ${c} missing or did not fire in live-test-results.json`,
          );
      }
      if (!m.liveCase?.length) problems.push(`mode ${m.id}: tested-live without liveCase`);
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(
    process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  );
  const problems = check(root);
  if (problems.length) {
    console.error(`alert runbook ratchet FAILED (${problems.length}):\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log('alert runbook ratchet: ok');
}
