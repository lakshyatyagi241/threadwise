#!/usr/bin/env node
// Memory regression gate (Sheet3 #57). node tools/perf/memory-budget-check.mjs <memory-profile.json> [perf/memory-budget.json]
// Exit 0 = every budget met, 1 = at least one exceeded or a metric is missing from the profile, 2 = bad input.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);

/** budget.limits = [{ id, path, maxMb|max }]. Returns one row per limit; a missing or non-numeric metric fails (a silent skip would hide a broken profile). */
export function checkBudget(profile, budget) {
  return budget.limits.map((l) => {
    const actual = get(profile, l.path);
    const ok = typeof actual === 'number' && Number.isFinite(actual) && actual <= l.max;
    return { id: l.id, path: l.path, actual, max: l.max, ok };
  });
}

function main() {
  const [profilePath, budgetPath = join(here, '../../perf/memory-budget.json')] =
    process.argv.slice(2);
  if (!profilePath) {
    console.error('usage: memory-budget-check.mjs <memory-profile.json> [memory-budget.json]');
    process.exit(2);
  }
  let rows;
  try {
    rows = checkBudget(
      JSON.parse(readFileSync(resolve(profilePath), 'utf8')),
      JSON.parse(readFileSync(resolve(budgetPath), 'utf8')),
    );
  } catch (e) {
    console.error(`cannot read inputs: ${e.message}`);
    process.exit(2);
  }
  for (const r of rows)
    console.log(
      `${r.ok ? 'PASS' : 'FAIL'}  ${r.id.padEnd(34)} ${String(r.actual).padStart(9)} <= ${r.max}`,
    );
  const bad = rows.filter((r) => !r.ok).length;
  console.log(bad ? `\n${bad} budget(s) exceeded` : '\nall budgets met');
  process.exit(bad ? 1 : 0);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
