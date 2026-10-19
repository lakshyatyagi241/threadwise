#!/usr/bin/env node
// The same loop-hold meter as measure-zlib-sites.mjs, run on the REAL compiled functions that EL-B08 changed (apps/api/dist), so the
// "after" numbers are the code's, not a stand-in. Needs `pnpm --filter @crm/api build` first.
//
//   node tools/event-loop-audit/measure-zlib-real.mjs
//
// Only the functions that are exported can be called from here: the day-archive reader (`archivedEventsOf`), the privacy export zip
// (`buildZip`), the extension package reader (`readEntryAsync`) and the DOCX reader (`docxToText`). The export runners and the archive
// sweep build their gzip members inside private methods; for those, measure-zlib-sites.mjs shows the same zlib call both ways.
// Synthetic payloads (see that file); this machine and Node version only.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'apps/api/package.json'));
const dist = (p) => join(root, 'apps/api/dist/src/modules', p);
const { archivedEventsOf } = require(dist('chat-conversations/message-log.service.js'));
const { buildZip } = require(dist('privacy/engine/zip.js'));
const { readEntryAsync, readZip } = require(dist('addons-extension-registry/zip-reader.js'));
const { docxToText } = require(dist('ai-agents-training/file-extract.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1024 * 1024;
let seed = 12345;
let NOISE = 0.12;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const WORDS = (
  'order shipped delivered payment received refund template campaign welcome hello support ticket invoice contact reply status ' +
  'confirmed pending failed retry webhook message inbound outbound read sent queued agent customer thanks reminder appointment'
).split(' ');
const token = () => Math.floor(rnd() * 36 ** 8).toString(36);
function text(bytes) {
  const parts = [];
  let n = 0;
  while (n < bytes) {
    const w = rnd() < NOISE ? token() : WORDS[Math.floor(rnd() * WORDS.length)];
    parts.push(w);
    n += w.length + 1;
  }
  return parts.join(' ').slice(0, bytes);
}
const iso = (i) => new Date(1_760_000_000_000 + i * 1000).toISOString();
function ndjson(n, rowBytes) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const base = {
      id: i + 1,
      messageId: 1000 + (i % 5000),
      messageCreatedAt: iso(i),
      event: 'delivered',
      at: iso(i + 3),
    };
    const pad = Math.max(8, rowBytes - JSON.stringify({ ...base, detail: { note: '' } }).length);
    out.push(JSON.stringify({ ...base, detail: { note: text(pad) } }));
  }
  return `${out.join('\n')}\n`;
}

async function hold(run) {
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
  const result = await run();
  const wall = performance.now() - t0;
  await sleep(30);
  on = false;
  return { wallMs: Math.round(wall * 10) / 10, holdMs: Math.round(max * 10) / 10, result };
}
async function worst(run, reps = 3) {
  const rs = [];
  for (let i = 0; i < reps; i++) rs.push(await hold(run));
  rs.sort((a, b) => a.holdMs - b.holdMs);
  return {
    wallMs: rs[Math.floor(rs.length / 2)].wallMs,
    holdMs: rs[rs.length - 1].holdMs,
    reps,
    last: rs[rs.length - 1].result,
  };
}

const rows = [];
const report = (site, label, r, extra) => {
  rows.push({ site, case: label, wallMs: r.wallMs, holdMs: r.holdMs, ...extra });
  console.log(
    `${r.holdMs > 50 ? 'OVER ' : 'ok   '} ${site.padEnd(52)} ${label.padEnd(28)} hold ${String(r.holdMs).padStart(7)} ms   wall ${String(r.wallMs).padStart(8)} ms`,
  );
};

// 1. the day-archive reader the message timeline uses (API request path)
for (const [label, n] of [
  ['20,000 events (6 MB)', 20_000],
  ['100,000 events (30 MB)', 100_000],
  ['400,000 events (120 MB)', 400_000],
]) {
  seed = 12345;
  NOISE = 0.12;
  const payload = gzipSync(ndjson(n, 300));
  const mine = { id: 1000, createdAtText: iso(0) };
  const r = await worst(() => archivedEventsOf([payload], mine), 2);
  report('message-log.service archivedEventsOf()', label, r, { matched: r.last.length });
}

// 2. the data-subject export zip (worker)
for (const [label, mb] of [
  ['1 MB entry', 1],
  ['10 MB entry', 10],
  ['50 MB entry', 50],
]) {
  seed = 12345;
  NOISE = 0.12;
  const data = Buffer.from(text(mb * MB));
  const r = await worst(() => buildZip([{ name: 'messages.csv', data }]), 2);
  report('privacy/engine/zip buildZip()', label, r, {
    zipMb: Math.round((r.last.length / MB) * 100) / 100,
  });
}

// 3. the extension package reader (API admin action), on an entry built by the real zip writer
{
  seed = 12345;
  NOISE = 0.12;
  const data = Buffer.from(text(20 * MB));
  const zip = await buildZip([{ name: 'big.js', data }]);
  const entry = readZip(zip, { maxEntries: 10 })[0];
  const r = await worst(() => readEntryAsync(zip, entry), 3);
  report('addons zip-reader readEntryAsync()', '20 MB entry', r, {
    ok: r.last.length === data.length,
  });
}

// 4. the DOCX reader (API upload): inflate is async now; what remains is the text clean-up on the inflated XML
for (const [label, mb] of [
  ['2 MB document.xml', 2],
  ['20 MB document.xml', 20],
]) {
  seed = 12345;
  NOISE = 0.12;
  const xml = Buffer.from(`<w:document>${text(mb * MB).replace(/ /g, '</w:p><w:p>')}</w:document>`);
  const zip = await buildZip([{ name: 'word/document.xml', data: xml }]);
  const r = await worst(() => docxToText(zip), 2);
  report('ai-agents-training docxToText()', label, r, { chars: r.last.length });
}

const dir = join(root, 'reports/event-loop');
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, 'zlib-real.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model, note: 'The real compiled functions from apps/api/dist after EL-B08, synthetic payloads, this machine only. Hold = worst lateness of a 1 ms timer (about 15 ms is the Windows tick, i.e. nothing measurable).', rows }, null, 1)}\n`,
);
console.log(`\nwritten reports/event-loop/zlib-real.json`);
