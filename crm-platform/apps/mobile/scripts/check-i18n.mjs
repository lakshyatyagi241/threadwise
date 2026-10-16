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

// Counts use i18next plurals (`key_one`, `key_other`, ...). English has two forms, but a language may need more (Arabic has six,
// Russian and Polish four) or fewer (Japanese, Korean, Chinese, Vietnamese, Thai and Indonesian have only "other"), so a plural key
// is checked against the categories that language really has (`Intl.PluralRules`), not against the English key names.
const PLURAL = /^(.*)_(zero|one|two|few|many|other)$/;
const enPlurals = new Set();
const enPlain = new Map();
for (const [key, value] of en) {
  const m = PLURAL.exec(key);
  if (m) enPlurals.add(m[1]);
  else enPlain.set(key, value);
}
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

for (const locale of listed.filter(
  (l) => l !== 'en' && files.includes(l) && (!only || l === only),
)) {
  const tr = load(locale);
  const expected = new Map(enPlain);
  const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  for (const base of enPlurals) {
    const other = en.get(`${base}_other`) ?? en.get(`${base}_one`);
    for (const c of categories) expected.set(`${base}_${c}`, en.get(`${base}_${c}`) ?? other);
  }
  for (const [key, source] of expected) {
    const value = tr.get(key);
    if (value === undefined) problems.push(`${locale}: missing ${key}`);
    else if (value.trim() === '') problems.push(`${locale}: empty ${key}`);
    else {
      if (value === source && !(allow[locale] ?? []).includes(key))
        problems.push(`${locale}: ${key} is still English`);
      // "one" and "two" forms may spell the number out instead of using {{count}}; every other text keeps its placeholders.
      const spelledOut = /_(zero|one|two)$/.test(key) && PLURAL.test(key);
      const want = placeholders(source);
      const got = placeholders(value);
      const same = spelledOut
        ? got.split(',').every((p) => p === '' || want.includes(p))
        : got === want;
      if (!same) problems.push(`${locale}: ${key} changed a {{placeholder}}`);
    }
  }
  for (const key of tr.keys())
    if (!expected.has(key))
      problems.push(`${locale}: ${key} is not a key (or plural form) ${locale} needs`);
}

if (problems.length) {
  console.error(`i18n: ${problems.length} problem(s)\n  ` + problems.join('\n  '));
  process.exit(1);
}
console.log(`i18n: ${listed.length} locales, ${en.size} keys, all translated`);
