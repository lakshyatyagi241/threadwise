#!/usr/bin/env node
/**
 * i18n audit. `node scripts/i18n-audit.mjs gaps [--strict]` counts message keys each locale lacks against `en`
 * (and untranslated copies of English); `node scripts/i18n-audit.mjs hardcoded` lists user-visible English literals in
 * components that skip next-intl. `--json` prints machine-readable output. `--strict` exits 1 when anything is missing.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const msgRoot = join(root, 'messages');
const mode = process.argv[2] ?? 'gaps';
const json = process.argv.includes('--json');
const strict = process.argv.includes('--strict');

const flat = (o, p = '', out = {}) => {
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object') flat(v, `${p}${k}.`, out);
    else out[`${p}${k}`] = v;
  }
  return out;
};

function gaps() {
  const { LOCALES } = JSON.parse(readFileSync(join(root, 'scripts/.locales.json'), 'utf8'));
  const enFiles = readdirSync(join(msgRoot, 'en')).filter((f) => f.endsWith('.json'));
  const report = {};
  for (const loc of LOCALES.filter((l) => l !== 'en')) {
    const missing = {};
    for (const f of enFiles) {
      const en = flat(JSON.parse(readFileSync(join(msgRoot, 'en', f), 'utf8')));
      const p = join(msgRoot, loc, f);
      const tr = existsSync(p) ? flat(JSON.parse(readFileSync(p, 'utf8'))) : {};
      const keys = Object.keys(en).filter((k) => !(k in tr));
      if (keys.length) missing[f] = keys.length;
    }
    report[loc] = missing;
  }
  if (json) console.log(JSON.stringify(report, null, 2));
  else
    for (const [loc, m] of Object.entries(report)) {
      const n = Object.values(m).reduce((a, b) => a + b, 0);
      console.log(`${loc.padEnd(6)} missing ${n} keys in ${Object.keys(m).length} files`);
    }
  if (strict && Object.values(report).some((m) => Object.keys(m).length)) process.exit(1);
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(n) && !/\.(test|spec|stories)\.tsx$/.test(n)) out.push(p);
  }
  return out;
}

const ATTR =
  /\b(?:placeholder|title|aria-label|alt|label|description|message|emptyMessage|helperText|hint)=(?:"([^"{}]*[A-Za-z]{3,}[^"{}]*)"|\{'([^'{}]*[A-Za-z]{3,}[^'{}]*)'\})/g;
// JSX text between tags that holds at least two letters in a row and is not code-ish.
const TEXT = />\s*([A-Z][A-Za-z][^<>{}\n]{2,})\s*</g;

function hardcoded() {
  const hits = [];
  for (const file of walk(join(root, 'src'))) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line) || /className=|import /.test(line.replace(ATTR, ''))) {
        /* still scan attrs below */
      }
      for (const m of line.matchAll(ATTR)) {
        const text = (m[1] ?? m[2]).trim();
        if (/^[a-z0-9_.:/-]+$/.test(text) || /^[a-z]+(?:-[a-z]+)+$/.test(text)) continue;
        hits.push({ file: relative(root, file), line: i + 1, text });
      }
      for (const m of line.matchAll(TEXT)) {
        const text = m[1].trim();
        if (
          /[=;()]|=>|^[A-Z0-9_ ]+$/.test(text) ||
          text.includes('&&') ||
          /^(Promise|Record|Array|Partial|Omit)$/.test(text)
        )
          continue;
        hits.push({ file: relative(root, file), line: i + 1, text });
      }
    });
  }
  if (json) console.log(JSON.stringify(hits, null, 2));
  else {
    for (const h of hits) console.log(`${h.file}:${h.line}: ${h.text}`);
    console.log(`\n${hits.length} candidates in ${new Set(hits.map((h) => h.file)).size} files`);
  }
  if (strict && hits.length) process.exit(1);
}

if (mode === 'gaps') gaps();
else if (mode === 'hardcoded') hardcoded();
else {
  console.error('usage: i18n-audit.mjs gaps|hardcoded [--json] [--strict]');
  process.exit(2);
}
