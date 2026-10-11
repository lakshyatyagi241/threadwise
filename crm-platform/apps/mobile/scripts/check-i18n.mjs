// Fails when a locale file is missing, or has a key the English file does not, lacks a key, still carries the English text, is
// empty, or changed a {{placeholder}}. English is the source of truth. Run: pnpm --filter @crm/mobile i18n:check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'src/messages');
const allowPath = path.join(root, 'scripts/i18n-same-as-english.json');

const localesSource = fs.readFileSync(path.join(root, 'src/lib/i18n/locales.ts'), 'utf8');
const listed = [
  ...localesSource
    .slice(localesSource.indexOf('LOCALES = ['), localesSource.indexOf('] as const'))
    .matchAll(/'([A-Za-z-]+)'/g),
].map((m) => m[1]);

/** { "<locale>": ["auth.email"] }: keys whose translation is legitimately the English word (a brand, a loanword). */
const allow = fs.existsSync(allowPath) ? JSON.parse(fs.readFileSync(allowPath, 'utf8')) : {};

const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object'
      ? flatten(v, `${prefix}${k}.`)
      : [[`${prefix}${k}`, String(v)]],
  );
const load = (locale) =>
  new Map(flatten(JSON.parse(fs.readFileSync(path.join(dir, `${locale}.json`), 'utf8'))));
const placeholders = (s) =>
  [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');

const problems = [];
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -5));
for (const l of listed)
  if (!files.includes(l)) problems.push(`${l}: no file src/messages/${l}.json`);
for (const f of files)
  if (!listed.includes(f)) problems.push(`${f}: file is not listed in src/lib/i18n/locales.ts`);

const en = load('en');
for (const locale of listed.filter((l) => l !== 'en' && files.includes(l))) {
  const tr = load(locale);
  for (const [key, source] of en) {
    const value = tr.get(key);
    if (value === undefined) problems.push(`${locale}: missing ${key}`);
    else if (value.trim() === '') problems.push(`${locale}: empty ${key}`);
    else {
      if (value === source && !(allow[locale] ?? []).includes(key))
        problems.push(`${locale}: ${key} is still English`);
      if (placeholders(value) !== placeholders(source))
        problems.push(`${locale}: ${key} changed a {{placeholder}}`);
    }
  }
  for (const key of tr.keys())
    if (!en.has(key)) problems.push(`${locale}: ${key} does not exist in en`);
}

if (problems.length) {
  console.error(`i18n: ${problems.length} problem(s)\n  ` + problems.join('\n  '));
  process.exit(1);
}
console.log(`i18n: ${listed.length} locales, ${en.size} keys, all translated`);
