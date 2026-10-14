#!/usr/bin/env node
// Edge-case catalogue checker (QA task 4).
// Validates docs/quality/edge-cases/*.json against the rules in schema.json, checks that
// every API module has a file, that every "covered" case points at tests that exist and
// really mention it, and prints covered/gap per module. Exit 1 on any error.
// Usage: node tools/quality/check-edge-cases.mjs [--strict] [--report docs/quality/edge-cases/REPORT.md]
// --strict turns "a P0 module has an untested P0 case" from a warning into an error.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENUMS = {
  tier: ['P0', 'P1', 'P2'],
  category: ['input', 'state', 'permission', 'time', 'concurrency', 'integration', 'data'],
  priority: ['P0', 'P1', 'P2'],
  status: ['covered', 'gap'],
};
const ID_RE = /^EC-[a-z0-9-]+-[0-9]{3}$/;

/** Returns a list of problems with one parsed catalogue file. Pure: no disk access. */
export function validateFile(doc, fileName) {
  const errs = [];
  const at = (m) => errs.push(`${fileName}: ${m}`);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [`${fileName}: not an object`];
  for (const k of Object.keys(doc))
    if (!['module', 'tier', 'owner', 'cases'].includes(k)) at(`unknown key "${k}"`);
  if (typeof doc.module !== 'string' || !doc.module) at('module is required');
  else if (`${doc.module}.json` !== fileName)
    at(`module "${doc.module}" does not match the file name`);
  if (!ENUMS.tier.includes(doc.tier)) at('tier must be P0, P1 or P2');
  if (!Array.isArray(doc.cases)) return [...errs, `${fileName}: cases must be an array`];
  const allowed = [
    'id',
    'feature',
    'category',
    'scenario',
    'expected',
    'priority',
    'status',
    'source',
    'tests',
    'note',
  ];
  doc.cases.forEach((c, i) => {
    const w = (m) => errs.push(`${fileName} case #${i + 1}${c && c.id ? ` (${c.id})` : ''}: ${m}`);
    if (!c || typeof c !== 'object') return w('not an object');
    for (const k of Object.keys(c)) if (!allowed.includes(k)) w(`unknown key "${k}"`);
    for (const k of ['id', 'feature', 'scenario', 'expected'])
      if (typeof c[k] !== 'string' || !c[k].trim()) w(`${k} is required`);
    if (typeof c.id === 'string' && !ID_RE.test(c.id)) w('id must look like EC-<module>-<nnn>');
    if (typeof c.id === 'string' && doc.module && !c.id.startsWith(`EC-${doc.module}-`))
      w(`id must start with EC-${doc.module}-`);
    for (const k of ['category', 'priority', 'status'])
      if (!ENUMS[k].includes(c[k])) w(`${k} must be one of ${ENUMS[k].join(', ')}`);
    if (c.status === 'covered' && !(Array.isArray(c.tests) && c.tests.length))
      w('covered needs at least one entry in tests');
    if (c.status === 'gap' && c.tests && c.tests.length)
      w('a gap must not list tests (mark it covered)');
    for (const t of c.tests ?? []) {
      if (!t || typeof t.file !== 'string' || !t.file) w('every test needs a file');
      else
        for (const k of Object.keys(t))
          if (!['file', 'match'].includes(k)) w(`unknown key "${k}" in a test entry`);
    }
  });
  return errs;
}

/** Checks the whole catalogue. `fs` lets the unit tests run without a disk. */
export function checkCatalogue({
  strict = false,
  root,
  catalogueDir,
  modulesDir,
  readJson,
  listDir,
  exists,
  readText,
}) {
  const errors = [];
  const warnings = [];
  const files = listDir(catalogueDir).filter((f) => f.endsWith('.json') && f !== 'schema.json');
  const modules = listDir(modulesDir);
  const seen = new Map();
  const rows = [];
  for (const m of modules) {
    if (!files.includes(`${m}.json`))
      errors.push(`module "${m}" has no ${m}.json in the catalogue`);
  }
  for (const f of files) {
    let doc;
    try {
      doc = readJson(join(catalogueDir, f));
    } catch (e) {
      errors.push(`${f}: not valid JSON (${e.message})`);
      continue;
    }
    errors.push(...validateFile(doc, f));
    if (!modules.includes(f.replace(/\.json$/, '')))
      errors.push(`${f}: no such module under ${modulesDir}`);
    let covered = 0;
    let gaps = 0;
    let p0gaps = 0;
    for (const c of Array.isArray(doc?.cases) ? doc.cases : []) {
      if (!c || typeof c.id !== 'string') continue;
      if (seen.has(c.id)) errors.push(`${f}: duplicate id ${c.id} (also in ${seen.get(c.id)})`);
      seen.set(c.id, f);
      if (c.status === 'covered') {
        covered++;
        for (const t of c.tests ?? []) {
          const path = join(root, t.file);
          if (!exists(path)) {
            errors.push(`${c.id}: test file ${t.file} does not exist`);
            continue;
          }
          const text = readText(path);
          const needle = t.match ?? c.id;
          if (!text.includes(needle))
            errors.push(
              `${c.id}: ${t.file} does not contain ${t.match ? `the title "${t.match}"` : 'the id'}`,
            );
        }
      } else if (c.status === 'gap') {
        gaps++;
        if (c.priority === 'P0') p0gaps++;
      }
    }
    if (doc?.tier === 'P0' && p0gaps > 0)
      (strict ? errors : warnings).push(`${f}: P0 module has ${p0gaps} untested P0 case(s)`);
    rows.push({
      module: doc?.module ?? f,
      tier: doc?.tier ?? '?',
      total: covered + gaps,
      covered,
      gaps,
      p0gaps,
    });
  }
  return { errors, warnings, rows };
}

export function renderReport(rows) {
  const lines = [
    '# Edge-case catalogue coverage',
    '',
    '_Generated by `tools/quality/check-edge-cases.mjs`. Do not edit by hand._',
    '',
    '| Module | Tier | Cases | Covered | Gaps | P0 gaps |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
  ];
  const sorted = [...rows].sort(
    (a, b) => a.tier.localeCompare(b.tier) || a.module.localeCompare(b.module),
  );
  for (const r of sorted)
    lines.push(`| ${r.module} | ${r.tier} | ${r.total} | ${r.covered} | ${r.gaps} | ${r.p0gaps} |`);
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
  lines.push(
    `| **Total (${rows.length} modules)** | | **${sum('total')}** | **${sum('covered')}** | **${sum('gaps')}** | **${sum('p0gaps')}** |`,
    '',
  );
  return lines.join('\n');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const catalogueDir = join(root, 'docs/quality/edge-cases');
  const res = checkCatalogue({
    strict: process.argv.includes('--strict'),
    root,
    catalogueDir,
    modulesDir: join(root, 'apps/api/src/modules'),
    readJson: (p) => JSON.parse(readFileSync(p, 'utf8')),
    listDir: (d) =>
      readdirSync(d).filter(
        (n) => !n.startsWith('.') && (n.endsWith('.json') || statSync(join(d, n)).isDirectory()),
      ),
    exists: existsSync,
    readText: (p) => readFileSync(p, 'utf8'),
  });
  const report = renderReport(res.rows);
  const i = process.argv.indexOf('--report');
  if (i > -1) writeFileSync(resolve(process.argv[i + 1]), report);
  else console.log(report);
  if (res.warnings.length)
    console.warn(
      `\n${res.warnings.length} warning(s) (errors with --strict):\n- ${res.warnings.join('\n- ')}`,
    );
  if (res.errors.length) {
    console.error(`\n${res.errors.length} problem(s):\n- ${res.errors.join('\n- ')}`);
    process.exit(1);
  }
  console.log('edge-case catalogue: pass');
}
