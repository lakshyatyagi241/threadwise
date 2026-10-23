#!/usr/bin/env node
// Pagination audit (QA task 45).
//   node tools/pagination-audit/scan.mjs            check: exit 1 on a new OFFSET site or an uncapped page size (the pull request gate)
//   node tools/pagination-audit/scan.mjs --write    regenerate docs/performance/pagination/inventory.json
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  capOfSchema,
  checkRegister,
  maxPageOf,
  countSites,
  offsetSites,
  queryRoutesOf,
  schemasOf,
  styleOfSchema,
} from './lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'docs/performance/pagination/inventory.json');
const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? (n === 'node_modules' || n === 'dist' ? [] : walk(p)) : [p];
  });
const read = (f) => readFileSync(f, 'utf8');

export function scan() {
  const schemas = {};
  const consts = {};
  for (const f of walk(join(ROOT, 'packages/contracts/src')).filter((f) => f.endsWith('.ts'))) {
    const t = read(f);
    Object.assign(schemas, schemasOf(t));
    for (const m of t.matchAll(/^const (\w+) = (z\.coerce\.number\(\)[^;]*);/gm))
      consts[m[1]] = m[2];
  }
  const routes = [];
  const sites = [];
  let counts = 0;
  for (const f of walk(join(ROOT, 'apps/api/src')).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'),
  )) {
    const rel = relative(ROOT, f);
    const src = read(f);
    if (f.endsWith('.controller.ts'))
      for (const r of queryRoutesOf(src)) {
        const body = schemas[r.schema];
        if (!body) continue;
        const style = styleOfSchema(body);
        if (style !== 'none')
          routes.push({
            file: rel,
            ...r,
            style,
            cap: capOfSchema(body) === undefined ? 'fixed' : capOfSchema(body),
            maxPage: style === 'page' ? maxPageOf(body, consts) : undefined,
          });
      }
    for (const s of offsetSites(src)) sites.push({ file: rel, ...s });
    counts += countSites(src).length;
  }
  routes.sort((a, b) => (a.file + a.route).localeCompare(b.file + b.route));
  const by = (k) => routes.filter((r) => r.style === k).length;
  return {
    summary: {
      listRoutes: routes.length,
      cursor: by('cursor'),
      page: by('page'),
      offset: by('offset'),
      limitOnly: by('limit-only'),
      uncapped: routes.filter((r) => r.cap === null).length,
      offsetSites: sites.length,
      offsetFiles: new Set(sites.map((s) => s.file)).size,
      countStarSites: counts,
    },
    routes,
    offsetSites: sites,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const inv = scan();
  const register = JSON.parse(
    read(join(ROOT, 'tools/pagination-audit/policy/offset-register.json')),
  ).decisions;
  const findings = checkRegister({ sites: inv.offsetSites, register });
  for (const r of inv.routes.filter((r) => r.cap === null))
    findings.push({
      severity: 'Medium',
      subject: `${r.file} ${r.handler}`,
      detail: `query schema ${r.schema} pages by ${r.style} with no max on the size`,
    });
  const text =
    JSON.stringify({ generatedBy: 'tools/pagination-audit/scan.mjs', ...inv }, null, 2) + '\n';
  if (process.argv.includes('--write')) {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, text);
    console.log(`wrote ${relative(ROOT, OUT)}`);
  }
  const s = inv.summary;
  console.log(
    `pagination audit: ${s.listRoutes} paged list routes (${s.cursor} cursor, ${s.page} page number, ${s.offset} offset, ${s.limitOnly} limit only; ${s.uncapped} with no size cap); ${s.offsetSites} OFFSET sites in ${s.offsetFiles} files; ${s.countStarSites} count(*) sites`,
  );
  for (const r of inv.routes.filter((r) => r.style === 'page' && r.maxPage === null))
    findings.push({
      severity: 'Medium',
      subject: `${r.file} ${r.handler}`,
      detail: `${r.schema} accepts any page number: a request for page 9007199254740991 asks the database to skip that many rows`,
    });
  const blockers = findings.filter((f) => f.severity === 'High' || f.severity === 'Critical');
  for (const f of findings)
    console.error(`  ${f.severity.toUpperCase()} ${f.subject}: ${f.detail}`);
  if (!process.argv.includes('--write') && existsSync(OUT) && read(OUT) !== text) {
    console.error(
      'docs/performance/pagination/inventory.json is out of date. Run: node tools/pagination-audit/scan.mjs --write',
    );
    process.exit(1);
  }
  process.exit(blockers.length ? 1 : 0);
}
