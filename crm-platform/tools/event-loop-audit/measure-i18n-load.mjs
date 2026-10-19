#!/usr/bin/env node
// How long does one `loadMessages(locale)` (apps/web/src/i18n/messages.ts, called from i18n/request.ts on every request) hold the
// event loop of the Next.js server? (EL-B11)
//
//   node tools/event-loop-audit/measure-i18n-load.mjs
//
// The function is 20 lines (readdir, read and JSON.parse every `messages/<locale>/*.json`, deep-merge English under the locale), so it is
// reproduced here line for line rather than imported from TypeScript; keep the two in step if one changes. It reads the repo's real
// message files, so the sizes are the product's. Loop hold is the worst lateness of a 1 ms timer while the call runs. This machine only.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const messages = join(root, 'apps/web/messages');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const isTree = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] = isTree(v) && isTree(b) ? deepMerge(b, v) : v;
  }
  return out;
}
function readLocale(dirRoot, locale) {
  const dir = join(dirRoot, locale);
  if (!existsSync(dir)) return {};
  let merged = {};
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    merged = deepMerge(merged, JSON.parse(readFileSync(join(dir, file), 'utf8')));
  }
  return merged;
}
const loadMessages = (locale) => {
  const en = readLocale(messages, 'en');
  return locale === 'en' ? en : deepMerge(en, readLocale(messages, locale));
};

async function hold(fn) {
  let max = 0;
  let expected = performance.now() + 1;
  let on = true;
  const tick = () => {
    if (!on) return;
    const now = performance.now();
    if (now - expected > max) max = now - expected;
    expected = now + 1;
    setTimeout(tick, 1);
  };
  setTimeout(tick, 1);
  await sleep(30);
  max = 0;
  expected = performance.now() + 1;
  const t0 = performance.now();
  fn();
  const wall = performance.now() - t0;
  await sleep(30);
  on = false;
  return { wallMs: Math.round(wall * 10) / 10, holdMs: Math.round(max * 10) / 10 };
}

const locales = readdirSync(messages).filter(
  (f) => existsSync(join(messages, f, 'common.json')) || readdirSync(join(messages, f)).length,
);
const picks = ['en', ...['hi', 'es', 'ar', 'de'].filter((l) => locales.includes(l))];
const rows = [];
for (const locale of picks) {
  const files = readdirSync(join(messages, locale)).filter((f) => f.endsWith('.json')).length;
  const bytes = readdirSync(join(messages, locale)).reduce(
    (n, f) => n + readFileSync(join(messages, locale, f)).length,
    0,
  );
  loadMessages(locale); // warm the OS file cache: the steady state is what a running server sees
  const runs = [];
  for (let i = 0; i < 5; i++) runs.push(await hold(() => loadMessages(locale)));
  runs.sort((a, b) => a.holdMs - b.holdMs);
  const row = {
    locale,
    files,
    mb: Math.round((bytes / 1048576) * 100) / 100,
    medianWallMs: runs[2].wallMs,
    worstHoldMs: runs[4].holdMs,
    medianHoldMs: runs[2].holdMs,
  };
  rows.push(row);
  console.log(
    `${locale.padEnd(4)} ${String(files).padStart(3)} files ${String(row.mb).padStart(5)} MB   wall median ${String(row.medianWallMs).padStart(6)} ms   hold median ${String(row.medianHoldMs).padStart(6)} ms  worst ${String(row.worstHoldMs).padStart(6)} ms`,
  );
}
const dir = join(root, 'reports/event-loop');
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, 'i18n-load.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, note: 'loadMessages reproduced from apps/web/src/i18n/messages.ts; real message files; warm OS cache; this machine only; a Windows timer tick is about 15 ms.', rows }, null, 1)}\n`,
);
