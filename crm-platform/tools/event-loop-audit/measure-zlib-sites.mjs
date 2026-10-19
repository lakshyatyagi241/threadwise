#!/usr/bin/env node
// How long does each synchronous zlib site hold the event loop when its input is the size the code can really produce? (EL-B08)
//
//   node tools/event-loop-audit/measure-zlib-sites.mjs            # all sites, writes reports/event-loop/zlib-sites.json
//   node tools/event-loop-audit/measure-zlib-sites.mjs --quick    # smaller sizes, a few seconds
//
// One scenario per site found by scan.mjs (rule sync-zlib). Each builds a payload the way that site builds or reads it, at sizes taken
// from the constants in the code (batch sizes, row caps, byte caps) and from assumed row sizes, then times the SYNC call and the async
// equivalent (the same zlib call on the thread pool). "Hold" is the worst lateness of an independent 1 ms timer during the call, i.e.
// the longest time nothing else could run in that process. The payloads are SYNTHETIC: row text is built from a small vocabulary plus
// random tokens, at two compressibilities: `typical` (about 4 to 1, like a CSV or JSON export of mostly repeated structure and short text)
// and `hard` (about 2.6 to 1, mostly unique tokens: the slow end, deflate works harder). Real data lies somewhere in between and is not
// known here; the ratio is printed per row. A timer on Windows cannot read below about 15 ms (its tick), so 15 ms means "nothing
// measurable". Valid for this machine and Node version only. Nothing here reads real data.
import {
  deflateRawSync,
  gunzip,
  gunzipSync,
  gzip,
  gzipSync,
  inflateRaw,
  inflateRawSync,
  deflateRaw,
} from 'node:zlib';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const QUICK = process.argv.includes('--quick');
const THRESHOLD_MS = 50; // backlog EL-B08: fix the ones that exceed this
const gzipA = promisify(gzip);
const gunzipA = promisify(gunzip);
const inflateRawA = promisify(inflateRaw);
const deflateRawA = promisify(deflateRaw);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1024 * 1024;

// ---- synthetic text, repeatable ---------------------------------------------------------------------------------------------------
let seed = 12345;
let NOISE = 0.35; // share of words that are unique random tokens
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const WORDS = (
  'order shipped delivered payment received refund template campaign welcome hello support ticket invoice contact reply status ' +
  'confirmed pending failed retry webhook message inbound outbound read sent queued agent customer thanks reminder appointment'
).split(' ');
const token = () => Math.floor(rnd() * 36 ** 8).toString(36);
function text(bytes) {
  let s = '';
  while (s.length < bytes)
    s += rnd() < NOISE ? `${token()} ` : `${WORDS[Math.floor(rnd() * WORDS.length)]} `;
  return s.slice(0, bytes);
}
const iso = (i) => new Date(1_760_000_000_000 + i * 1000).toISOString();
const q = (s) => `"${s.replace(/"/g, '""')}"`;
/** `n` CSV rows of about `rowBytes` each (a few short columns and one free-text column). */
function csvRows(n, rowBytes, sep = '\r\n') {
  const out = [];
  for (let i = 0; i < n; i++) {
    const head = `${iso(i)},user,${q(text(18))},no,,${WORDS[i % WORDS.length]},update,${token()},${token()}${token()},`;
    out.push(head + q(text(Math.max(8, rowBytes - head.length - 2))));
  }
  return `${out.join(sep)}${sep}`;
}
/** `n` NDJSON event lines of about `rowBytes` each (the message-log archive shape). */
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

// ---- the loop-hold meter ----------------------------------------------------------------------------------------------------------
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
  await run();
  const wall = performance.now() - t0;
  await sleep(30);
  on = false;
  return { wallMs: Math.round(wall * 10) / 10, holdMs: Math.round(max * 10) / 10 };
}
async function best(run, reps) {
  const rs = [];
  for (let i = 0; i < reps; i++) rs.push(await hold(run));
  rs.sort((a, b) => a.holdMs - b.holdMs);
  return { wallMs: rs[Math.floor(rs.length / 2)].wallMs, holdMs: rs[rs.length - 1].holdMs, reps };
}

// ---- the sites ---------------------------------------------------------------------------------------------------------------------
// who: the process the code runs in. gz: compress or decompress. Sizes come from the constants named in `bound`.
const reps = QUICK ? 2 : 3;
const scale = QUICK ? 0.2 : 1;
const sites = [
  {
    site: 'audit-log/audit-log-export.runner.ts:146 build() gzipSync per page',
    who: 'worker',
    bound:
      'BATCH = 5,000 rows per gzip member; row size assumed 250 B (short delta) to 1 KB (large delta JSON)',
    cases: [
      ['5,000 x 250 B', () => csvRows(5000, 250)],
      ['5,000 x 1 KB', () => csvRows(5000, 1024)],
    ],
    kind: 'gzip',
  },
  {
    site: 'chat-conversations/message-log-export.runner.ts:131 buildMessages() gzipSync per page',
    who: 'worker',
    bound: 'BATCH = 5,000 history rows per member; row 300 B to 1.2 KB (message text)',
    cases: [
      ['5,000 x 300 B', () => csvRows(5000, 300)],
      ['5,000 x 1.2 KB', () => csvRows(5000, 1200)],
    ],
    kind: 'gzip',
  },
  {
    site: 'chat-conversations/message-log-export.runner.ts:152 build() gzipSync per slice',
    who: 'worker',
    bound: 'BATCH = 5,000 event lines per member; 250 B to 800 B',
    cases: [
      ['5,000 x 250 B', () => csvRows(5000, 250)],
      ['5,000 x 800 B', () => csvRows(5000, 800)],
    ],
    kind: 'gzip',
  },
  {
    site: 'contact-consent/consent-export.runner.ts:99 build() gzipSync per page',
    who: 'worker',
    bound: 'BATCH = 5,000 proof rows; 300 B to 700 B',
    cases: [
      ['5,000 x 300 B', () => csvRows(5000, 300)],
      ['5,000 x 700 B', () => csvRows(5000, 700)],
    ],
    kind: 'gzip',
  },
  {
    site: 'crm/revenue-report/revenue-export.runner.ts:168 ledger() gzipSync per page',
    who: 'worker',
    bound: 'BATCH = 5,000 ledger rows; 200 B to 500 B',
    cases: [
      ['5,000 x 200 B', () => csvRows(5000, 200, '\n')],
      ['5,000 x 500 B', () => csvRows(5000, 500, '\n')],
    ],
    kind: 'gzip',
  },
  {
    site: 'crm/revenue-report/revenue-export.runner.ts:140,155,188 summary CSV, PDF, header',
    who: 'worker',
    bound: 'one small report: a summary CSV (tens of KB) or a generated PDF (a few hundred KB)',
    cases: [
      ['PDF 400 KB', () => text(400 * 1024)],
      ['summary CSV 60 KB', () => csvRows(300, 200)],
    ],
    kind: 'gzip',
  },
  {
    site: 'chat-conversations/message-log-archive.service.ts:109 archiveDay() gzipSync per batch',
    who: 'worker (daily sweep)',
    bound: 'BATCH = 20,000 events per gzip member; event line 250 B to 800 B',
    cases: [
      ['20,000 x 250 B', () => ndjson(20000, 250)],
      ['20,000 x 800 B', () => ndjson(20000, 800)],
    ],
    kind: 'gzip',
  },
  {
    site: 'chat-conversations/message-log.service.ts:47 archivedEventsOf() gunzipSync + split + JSON.parse of EVERY line',
    who: "API (request: one message's history)",
    bound:
      "one UTC day of one workspace's archive: events per day x line size, no cap in the code. 20k, 100k, 400k events x 300 B",
    cases: [
      ['20,000 events (6 MB)', () => ndjson(Math.round(20000 * scale), 300)],
      ['100,000 events (30 MB)', () => ndjson(Math.round(100000 * scale), 300)],
      ['400,000 events (120 MB)', () => ndjson(Math.round(400000 * scale), 300)],
    ],
    kind: 'gunzip-parse',
  },
  {
    site: 'chat-conversations/message-log-export.runner.ts:166 build() gunzipSync + split + JSON.parse of every line of a day',
    who: 'worker',
    bound: 'one archived day object, as above',
    cases: [
      ['20,000 events (6 MB)', () => ndjson(Math.round(20000 * scale), 300)],
      ['100,000 events (30 MB)', () => ndjson(Math.round(100000 * scale), 300)],
    ],
    kind: 'gunzip-parse',
  },
  {
    site: 'privacy/engine/zip.ts:48 buildZip() deflateRawSync per entry (data-subject export)',
    who: 'worker',
    bound:
      "one entry per exported section; a contact's message history or a workspace export: 1 MB to 50 MB each",
    cases: [
      ['1 MB entry', () => text(1 * MB)],
      ['10 MB entry', () => text(10 * MB)],
      ['50 MB entry', () => text(Math.round(50 * MB * scale))],
    ],
    kind: 'deflateRaw',
  },
  {
    site: 'shopify-woocommerce/plugin/zip-writer.ts:26 buildZip() deflateRawSync level 9',
    who: 'API (plugin download)',
    bound: 'a handful of small text files (the doc comment says so): up to ~200 KB',
    cases: [['200 KB file, level 9', () => text(200 * 1024)]],
    kind: 'deflateRaw9',
  },
  {
    site: 'wallet-message-billing/xlsx-lite.ts:67 partText() inflateRawSync',
    who: 'API (rate-card upload)',
    bound: 'MAX_PART_BYTES = 8 MiB inflated per part',
    cases: [
      ['1 MB part', () => text(1 * MB)],
      ['8 MiB part (the cap)', () => text(8 * MB)],
    ],
    kind: 'inflateRaw',
  },
  {
    site: 'addons-extension-registry/zip-reader.ts:90 readEntry() inflateRawSync',
    who: 'API (extension install)',
    bound: 'entry.size of an uploaded package; no cap in the reader, assume up to 20 MB per entry',
    cases: [
      ['1 MB entry', () => text(1 * MB)],
      ['20 MB entry', () => text(20 * MB)],
    ],
    kind: 'inflateRaw',
  },
  {
    site: 'ai-agents-training/file-extract.ts:58 readZipEntry() inflateRawSync',
    who: 'API (training-source upload)',
    bound: 'MAX_INFLATED = 64 MiB for word/document.xml',
    cases: [
      ['2 MB document.xml', () => text(2 * MB)],
      ['64 MiB (the cap)', () => text(Math.round(64 * MB * scale))],
    ],
    kind: 'inflateRaw',
  },
];

// ---- run ---------------------------------------------------------------------------------------------------------------------------
const out = [];
console.log(
  `threshold ${THRESHOLD_MS} ms; ${reps} reps per row; hold = worst timer lateness during the call\n`,
);
for (const s of sites) {
  for (const [label, make, mix] of s.cases.flatMap(([l, m]) => [
    [l, m, 'typical'],
    [l, m, 'hard'],
  ])) {
    seed = 12345;
    NOISE = mix === 'typical' ? 0.12 : 0.35;
    const payload = make();
    const raw = Buffer.from(payload);
    let syncFn;
    let asyncFn;
    let compressed;
    if (s.kind === 'gzip') {
      compressed = gzipSync(raw);
      syncFn = () => gzipSync(payload);
      asyncFn = () => gzipA(payload);
    } else if (s.kind === 'deflateRaw' || s.kind === 'deflateRaw9') {
      const opts = s.kind === 'deflateRaw9' ? { level: 9 } : undefined;
      compressed = deflateRawSync(raw, opts);
      syncFn = () => deflateRawSync(raw, opts);
      asyncFn = () => deflateRawA(raw, opts);
    } else if (s.kind === 'inflateRaw') {
      compressed = deflateRawSync(raw);
      syncFn = () => inflateRawSync(compressed);
      asyncFn = () => inflateRawA(compressed);
    } else {
      // gunzip-parse: the code gunzips, splits on \n and JSON.parses every line, in one synchronous pass
      compressed = gzipSync(raw);
      const parseAll = (buf) => {
        let n = 0;
        for (const line of buf.toString('utf8').split('\n')) {
          if (line === '') continue;
          JSON.parse(line);
          n += 1;
        }
        return n;
      };
      syncFn = () => parseAll(gunzipSync(compressed));
      asyncFn = async () => parseAll(await gunzipA(compressed)); // zlib moves off the loop; the parse stays on it
    }
    const sync = await best(async () => syncFn(), reps);
    const asyn = await best(asyncFn, reps);
    const row = {
      site: s.site,
      who: s.who,
      bound: s.bound,
      case: label,
      mix,
      rawMb: Math.round((raw.length / MB) * 100) / 100,
      compressedMb: Math.round((compressed.length / MB) * 100) / 100,
      ratio: Math.round((raw.length / compressed.length) * 10) / 10,
      sync,
      async: asyn,
      overThreshold: sync.holdMs > THRESHOLD_MS,
    };
    out.push(row);
    console.log(
      `${row.overThreshold ? 'OVER ' : 'ok   '} ${s.site.split(' ')[0].padEnd(78)} ${label.padEnd(26)} ${mix.padEnd(7)} ${String(row.rawMb).padStart(6)} MB ratio ${String(row.ratio).padStart(4)}  sync hold ${String(sync.holdMs).padStart(7)} ms   async hold ${String(asyn.holdMs).padStart(7)} ms`,
    );
  }
}
const dir = join(root, 'reports/event-loop');
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, 'zlib-sites.json'),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      node: process.version,
      cpu: cpus()[0]?.model,
      quick: QUICK,
      thresholdMs: THRESHOLD_MS,
      note: 'Synthetic payloads (vocabulary plus random tokens), sizes from the constants in the code and assumed row sizes. Hold = worst lateness of a 1 ms timer during the call. This machine only.',
      rows: out,
    },
    null,
    1,
  )}\n`,
);
console.log(
  `\n${out.filter((r) => r.overThreshold).length} of ${out.length} rows over ${THRESHOLD_MS} ms; written reports/event-loop/zlib-sites.json`,
);
