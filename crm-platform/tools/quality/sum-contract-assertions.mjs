#!/usr/bin/env node
// Adds up the contract assertions a test run recorded (QA task 8).
//   QA_CONTRACT_OUT=/tmp/contract.jsonl pnpm --filter @crm/api exec vitest run test/e2e/contract
//   node tools/quality/sum-contract-assertions.mjs /tmp/contract.jsonl [--min 5000]
// Each line is { label, assertions, undeclared } written by apps/api/test/support/contract.ts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Totals for the lines of a recorded run. Pure; a malformed line is counted, not fatal. */
export function sum(text) {
  const out = { responses: 0, assertions: 0, undeclaredFields: 0, malformed: 0, byLabel: {} };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      out.responses += 1;
      out.assertions += Number(r.assertions) || 0;
      out.undeclaredFields += Number(r.undeclared) || 0;
      const k = r.label || '(unlabelled)';
      out.byLabel[k] = (out.byLabel[k] ?? 0) + (Number(r.assertions) || 0);
    } catch {
      out.malformed += 1;
    }
  }
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) {
    console.error('usage: sum-contract-assertions.mjs <contract.jsonl> [--min N]');
    process.exit(2);
  }
  const t = sum(readFileSync(file, 'utf8'));
  console.log(
    `responses checked: ${t.responses}\nassertions:        ${t.assertions}\nundeclared fields: ${t.undeclaredFields}${t.malformed ? `\nmalformed lines:   ${t.malformed}` : ''}`,
  );
  const top = Object.entries(t.byLabel)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  if (top.length)
    console.log(
      '\nlargest contributors:\n' +
        top.map(([k, v]) => `  ${String(v).padStart(6)}  ${k}`).join('\n'),
    );
  const m = process.argv.indexOf('--min');
  if (m > -1 && t.assertions < Number(process.argv[m + 1])) {
    console.error(`\n${t.assertions} assertions is below the required ${process.argv[m + 1]}`);
    process.exit(1);
  }
}
