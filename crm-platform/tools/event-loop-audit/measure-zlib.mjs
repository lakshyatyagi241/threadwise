#!/usr/bin/env node
// Reproduces the sync-zlib suspects from scan.mjs: how long does gzipSync / gunzipSync hold the event loop for an export-sized
// payload, and how long does the equivalent async call hold it? The payload is synthetic NDJSON shaped like a message-log or audit
// export (ids, timestamps, short text), compressible like the real thing but NOT real data.
//
//   node tools/event-loop-audit/measure-zlib.mjs
//
// Loop hold is measured with an independent 1 ms setTimeout drift sampler, so it is the longest time nothing else could run.
import { gunzip, gunzipSync, gzip, gzipSync } from 'node:zlib';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const gzipA = promisify(gzip);
const gunzipA = promisify(gunzip);

function makeNdjson(targetBytes) {
  const lines = [];
  let size = 0;
  for (let i = 0; size < targetBytes; i++) {
    const line = JSON.stringify({
      id: `msg_${i.toString(36)}${(i * 2654435761).toString(36)}`,
      at: new Date(1_700_000_000_000 + i * 1000).toISOString(),
      dir: i % 3 ? 'in' : 'out',
      contact: `c_${(i * 7919) % 100000}`,
      body: `Hello ${i % 977}, your order ${(i * 31) % 99991} is on the way. Reply STOP to opt out.`,
    });
    lines.push(line);
    size += line.length + 1;
  }
  return Buffer.from(lines.join('\n'));
}

let driftMax = 0;
let expected = performance.now() + 1;
let sampling = true;
(function tick() {
  if (!sampling) return;
  const now = performance.now();
  driftMax = Math.max(driftMax, now - expected);
  expected = now + 1;
  setTimeout(tick, 1);
})();

const holdOf = async (fn) => {
  await new Promise((r) => setTimeout(r, 20));
  driftMax = 0;
  expected = performance.now() + 1;
  const t0 = performance.now();
  const out = await fn();
  const wall = performance.now() - t0;
  await new Promise((r) => setTimeout(r, 5));
  return { out, wallMs: +wall.toFixed(1), loopHoldMs: +driftMax.toFixed(1) };
};

const rows = [];
for (const mb of [1, 5, 20, 50]) {
  const raw = makeNdjson(mb * 1024 * 1024);
  const gz = await holdOf(() => gzipSync(raw));
  const gzA = await holdOf(() => gzipA(raw));
  const un = await holdOf(() => gunzipSync(gz.out));
  const unA = await holdOf(() => gunzipA(gz.out));
  rows.push({
    payloadMb: mb,
    compressedMb: +(gz.out.length / 2 ** 20).toFixed(2),
    gzipSync: { wallMs: gz.wallMs, loopHoldMs: gz.loopHoldMs },
    gzipAsync: { wallMs: gzA.wallMs, loopHoldMs: gzA.loopHoldMs },
    gunzipSync: { wallMs: un.wallMs, loopHoldMs: un.loopHoldMs },
    gunzipAsync: { wallMs: unA.wallMs, loopHoldMs: unA.loopHoldMs },
  });
  console.log(JSON.stringify(rows.at(-1)));
}
sampling = false;

const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  cpu: cpus()[0]?.model,
  note: 'Synthetic NDJSON, not production data. loopHoldMs = worst setTimeout(1) lateness while the call ran. Valid for this machine only.',
  rows,
};
const dir = join(root, 'reports/event-loop');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'zlib-hold.json'), `${JSON.stringify(report, null, 1)}\n`);
console.log('written reports/event-loop/zlib-hold.json');
