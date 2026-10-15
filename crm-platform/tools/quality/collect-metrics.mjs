#!/usr/bin/env node
// Test and coverage metrics (QA task 5). Reads the JSON that vitest writes and the coverage summary, adds static
// counts of the suites that need a database (which cannot be run everywhere), and writes one file with the date:
//   docs/quality/metrics/metrics.json
//
//   pnpm --filter @crm/api exec vitest run --dir test/unit --coverage --reporter=json --outputFile=/tmp/api.json
//   node tools/quality/collect-metrics.mjs --suite api-unit=/tmp/api.json --coverage apps/api/coverage/coverage-summary.json
//
// Options: --suite <name>=<vitest json> (repeatable), --coverage <coverage-summary.json>, --coverage-root <dir>,
//          --out <file> (default docs/quality/metrics/metrics.json), --date YYYY-MM-DD, --check-targets
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Totals of one vitest JSON report. `it.each` rows are counted individually by vitest, so they are counted here. */
export function summariseVitest(report) {
  const files = report.testResults?.length ?? 0;
  const failedFiles = (report.testResults ?? []).filter((f) => f.status !== 'passed').length;
  return {
    files,
    failedFiles,
    tests: report.numTotalTests ?? 0,
    passed: report.numPassedTests ?? 0,
    failed: report.numFailedTests ?? 0,
    skipped: (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0),
  };
}

/**
 * Where a source file sits in the layering, so coverage can be read per kind of code.
 * "rules" are the pure decision modules; they are the business logic a unit test can reach on its own.
 */
export function groupOf(file) {
  const f = file.replace(/\\/g, '/');
  if (/(^|\/)[^/]*[-.]rules?\.ts$/.test(f)) return 'rules';
  if (/\.mapper\.ts$/.test(f)) return 'mappers';
  if (/(^|\/)src\/common\//.test(f)) return 'common';
  if (/\.(repository|repo)\.ts$/.test(f)) return 'repositories';
  if (/\.service\.ts$/.test(f)) return 'services';
  if (/\.(processor|consumer|worker|job|runner|publisher)\.ts$/.test(f)) return 'workers';
  return 'other';
}

/** Lines and branches per group from an istanbul coverage-summary.json. Pure. */
export function coverageByGroup(summary, root = '') {
  const groups = {};
  for (const [file, c] of Object.entries(summary)) {
    if (file === 'total') continue;
    const rel = root ? relative(root, file) : file;
    const g = (groups[groupOf(rel)] ??= {
      files: 0,
      lines: { total: 0, covered: 0 },
      branches: { total: 0, covered: 0 },
    });
    g.files += 1;
    g.lines.total += c.lines.total;
    g.lines.covered += c.lines.covered;
    g.branches.total += c.branches.total;
    g.branches.covered += c.branches.covered;
  }
  const pct = (a, b) => (b === 0 ? null : Math.round((1000 * a) / b) / 10);
  return Object.fromEntries(
    Object.entries(groups).map(([k, g]) => [
      k,
      {
        files: g.files,
        linePct: pct(g.lines.covered, g.lines.total),
        branchPct: pct(g.branches.covered, g.branches.total),
        lines: g.lines.total,
        branches: g.branches.total,
      },
    ]),
  );
}

const BLOCK = /^\s*(?:it|test)(?:\.(?:each|fails|skip|only|concurrent|todo))*\s*[(`[<]/;
/** Number of test blocks in a source text; `it.each` counts as ONE block here (the rows are only known at run time). */
export const countBlocks = (text) => text.split('\n').filter((l) => BLOCK.test(l)).length;

export function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'dist' || n.startsWith('.')) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(spec|test)\.(ts|tsx|mjs)$/.test(n)) out.push(p);
  }
  return out;
}

/** Static block counts of the suites that need a database or a browser, by folder. */
export function staticCounts(root) {
  const count = (dir) =>
    walk(join(root, dir)).reduce((n, f) => n + countBlocks(readFileSync(f, 'utf8')), 0);
  return {
    'api-e2e': count('apps/api/test/e2e'),
    'api-integration': count('apps/api/test/integration'),
    'api-unit-blocks': count('apps/api/test/unit'),
    'web-unit-blocks': count('apps/web/src'),
    'web-playwright': count('apps/web/e2e'),
    'contracts-blocks': count('packages/contracts'),
    'tools-node-tests': count('tools'),
  };
}

export const TARGETS = {
  unitTests: 30000,
  integrationTests: 4500,
  e2eJourneys: 1200,
  functionalScenarios: 10000,
  contractAssertions: 5000,
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const args = process.argv.slice(2);
  const all = (flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));
  const one = (flag, d) => all(flag)[0] ?? d;
  const suites = {};
  for (const s of all('--suite')) {
    const [name, file] = s.split('=');
    suites[name] = summariseVitest(JSON.parse(readFileSync(resolve(file), 'utf8')));
  }
  const cov = one('--coverage');
  const metrics = {
    date: one('--date', new Date().toISOString().slice(0, 10)),
    suites,
    runTotal: Object.values(suites).reduce((n, s) => n + s.tests, 0),
    coverageByGroup: cov
      ? coverageByGroup(
          JSON.parse(readFileSync(resolve(cov), 'utf8')),
          one('--coverage-root', join(root, 'apps/api')),
        )
      : null,
    staticBlocks: staticCounts(root),
    targets: TARGETS,
  };
  const out = resolve(root, one('--out', 'docs/quality/metrics/metrics.json'));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(metrics, null, 2) + '\n');
  console.log(`unit tests run: ${metrics.runTotal} (target ${TARGETS.unitTests})`);
  for (const [k, v] of Object.entries(metrics.staticBlocks))
    console.log(`  ${k.padEnd(18)} ${v} blocks`);
  if (metrics.coverageByGroup)
    for (const [k, g] of Object.entries(metrics.coverageByGroup))
      console.log(
        `  coverage ${k.padEnd(13)} lines ${g.linePct}%  branches ${g.branchPct}%  (${g.files} files)`,
      );
  console.log(`-> ${relative(root, out)}`);
}
