#!/usr/bin/env node
// Browser-test priority check (QA task 19): every folder of apps/web/e2e that holds a spec must be classed P0, P1 or P2 in
// apps/web/e2e/priority.json, and every class must name a folder that still has specs. The cross-browser run
// (CROSS_BROWSER=1 E2E_PRIORITY=p0,p1) selects folders from that file, so an unclassified folder would silently never run on Firefox or WebKit.
// Usage: node tools/quality/check-browser-priority.mjs
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LEVELS = ['P0', 'P1', 'P2'];

/** Top-level folders of `dir` that contain at least one *.spec.ts anywhere below them. Pure over the injected file system. */
export function specFolders(dir, fs) {
  const hasSpec = (d) =>
    fs.list(d).some((n) => (fs.isDir(join(d, n)) ? hasSpec(join(d, n)) : n.endsWith('.spec.ts')));
  return fs
    .list(dir)
    .filter((n) => fs.isDir(join(dir, n)) && !n.startsWith('.') && hasSpec(join(dir, n)))
    .sort();
}

/** Problems with the classification; empty when it is complete and current. Pure. */
export function check(folders, classes) {
  const errs = [];
  for (const f of folders)
    if (!(f in classes)) errs.push(`e2e/${f} has specs but no priority in priority.json`);
  for (const [f, p] of Object.entries(classes)) {
    if (!LEVELS.includes(p)) errs.push(`e2e/${f}: priority "${p}" is not P0, P1 or P2`);
    if (!folders.includes(f))
      errs.push(`e2e/${f} is classed but has no specs (remove it from priority.json)`);
  }
  if (!Object.values(classes).includes('P0')) errs.push('no folder is classed P0');
  return errs;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps/web/e2e');
  const fs = { list: (d) => readdirSync(d), isDir: (p) => statSync(p).isDirectory() };
  const classes = JSON.parse(readFileSync(join(root, 'priority.json'), 'utf8')).folders;
  const folders = existsSync(root) ? specFolders(root, fs) : [];
  const errs = check(folders, classes);
  const count = (p) => Object.values(classes).filter((x) => x === p).length;
  console.log(
    `${folders.length} e2e folders with specs: ${count('P0')} P0, ${count('P1')} P1, ${count('P2')} P2`,
  );
  if (errs.length) {
    console.error(`\n${errs.length} problem(s):\n- ${errs.join('\n- ')}`);
    process.exit(1);
  }
}
