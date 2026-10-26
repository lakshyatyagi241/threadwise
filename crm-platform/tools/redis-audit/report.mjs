#!/usr/bin/env node
// V-04 report (HTML) from the two files script-testing/redis-memory/run.sh writes. node tools/redis-audit/report.mjs [dir] [out.html]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = resolve(process.argv[2] ?? join(root, 'docs/performance/redis/v04'));
const out = resolve(
  process.argv[3] ?? join(root, 'docs/performance/redis/V04-redis-memory-REPORT.html'),
);
const live = JSON.parse(readFileSync(join(dir, 'redis-live-baseline.json'), 'utf8'));
const eng = JSON.parse(readFileSync(join(dir, 'engines.json'), 'utf8'));
const inv = JSON.parse(readFileSync(join(root, 'docs/performance/redis/inventory.json'), 'utf8'));
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
const mb = (b) => (b / 1048576).toFixed(2);
const t = live.totals;
const hyg = JSON.parse(
  readFileSync(join(root, 'docs/performance/redis/measurements.json'), 'utf8'),
).keyHygieneUnderLoad;
const withTtl = t.keys - t.keysNoTtl;
const [a, b] = eng.engines;
const rows = live.families
  .map(
    (f) =>
      `<tr><td>${esc(f.family)}</td><td>${f.keys}</td><td>${f.bytes}</td><td>${f.noTtl}</td><td>${f.noTtl ? '—' : f.ttlMaxSeconds}</td><td>${f.status === 'ttl' ? 'all expire' : esc(f.owner ?? 'UNOWNED')}</td></tr>`,
  )
  .join('');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>V-04 Redis memory audit</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#1b1f23}table{border-collapse:collapse;width:100%;margin:.5rem 0 1.2rem}td,th{border:1px solid #d0d7de;padding:5px 9px;text-align:left}th{background:#f6f8fa}pre{background:#f6f8fa;padding:10px;overflow:auto}.note{border-left:4px solid #d4a72c;background:#fff8c5;padding:8px 12px}</style></head><body>
<h1>V-04: Redis memory audit</h1>
<p>Sheet4 V-04 (owner Vishal). Run ${esc(live.at.slice(0, 10))} on a private ${esc(live.server)} with the dev settings (AOF on, <code>noeviction</code>), the built API and worker, a ramp of 5 and 10 users.</p>
<h2>Verdict</h2>
<ul>
<li><b>TTL or named owner: ${t.familiesUnowned === 0 ? 'met for every key seen' : 'NOT met'}.</b> ${t.keys} keys in ${t.families} families; ${withTtl} expire, ${t.keysNoTtl} never do, and every one of those belongs to a named owner (BullMQ job state, the worker heartbeat). ${t.familiesUnowned} unowned.</li>
<li><b>Eviction policy: <code>noeviction</code> everywhere</b> (dev compose; prod compose 192 MB; Hostinger 448 MB). Right for a server that holds BullMQ state: evicting a queue key loses the job. The risk it leaves is a full Redis refusing writes, which is what the TTL coverage and the per-queue retention limits are for (<code>docs/performance/redis/measurements.json</code>: OOM behaviour measured in item 67).</li>
<li><b>used_memory baseline:</b> ${mb(live.memory.usedMemory)} MB after the run (peak ${mb(live.memory.usedMemoryPeak)} MB; an empty server is ${mb(a.emptyBytes)} MB). Key data is ${t.bytes} bytes; the rest is server overhead and the append-only buffer.</li>
<li><b>Valkey ${esc(b.server.split(' ')[1])} vs Redis ${esc(a.server.split(' ')[1])}:</b> the same ${eng.sourceKeys * eng.copies} keys use ${eng.valkeyVsRedisPct}% memory on Valkey (${mb(b.dataBytes)} MB vs ${mb(a.dataBytes)} MB); an empty Valkey is ${mb(b.emptyBytes)} MB vs ${mb(a.emptyBytes)} MB. Drop-in for the commands this code uses, but this is one small data set, so it does not by itself justify a switch.</li>
</ul>
<div class="note"><b>What this does not prove.</b> The workload is a read ramp, so only ${t.families} key families were created, of the ${inv.totals.keyFamilies} the code can write (the static inventory). The other families are covered by the static check (every write in ${inv.totals.familiesInFilesWhereEveryWriteHasATtl} families has a TTL) and by the synthetic key-hygiene spec (${hyg.families} families, ${hyg.keysCreated.toLocaleString('en')} keys, ${hyg.keysWithoutTtl} without a TTL), not by this run. The Valkey figure is from ${eng.sourceKeys} keys copied ${eng.copies} times (about ${mb(a.dataBytes)} MB): per-key overhead, not a production data set. Production figures would need <code>live.mjs</code> run read-only against a production replica.</div>
<h2>Keys by family (live)</h2>
<table><tr><th>Family</th><th>Keys</th><th>Bytes</th><th>No TTL</th><th>Max TTL s</th><th>Owner</th></tr>${rows}</table>
<h2>Owners of the keys that never expire</h2>
<table><tr><th>Family</th><th>Owner</th><th>Why it is bounded</th></tr>${JSON.parse(
  readFileSync(join(root, 'docs/performance/redis/key-owners.json'), 'utf8'),
)
  .owners.map(
    (o) => `<tr><td>${esc(o.family)}</td><td>${esc(o.owner)}</td><td>${esc(o.reason)}</td></tr>`,
  )
  .join('')}</table>
<h2>Redis vs Valkey, same keys</h2>
<table><tr><th>Server</th><th>Empty</th><th>After 1 copy (${eng.sourceKeys} keys)</th><th>After ${eng.copies} copies</th><th>Data</th><th>Bytes per key</th></tr>${eng.engines.map((e) => `<tr><td>${esc(e.server)}</td><td>${e.emptyBytes}</td><td>${e.steps[0].usedMemory}</td><td>${e.steps.at(-1).usedMemory}</td><td>${e.dataBytes}</td><td>${e.bytesPerKey}</td></tr>`).join('')}</table>
<p>Keys are read by type and written natively into each server (a Redis 7.4 DUMP is refused by Valkey 8), TTLs kept. Memory is <code>used_memory</code> minus the server's own empty baseline.</p>
<h2>Scripts</h2>
<pre>bash script-testing/redis-memory/run.sh            # about 80 s once the API is built: private Redis, API + worker, ramp, audit, Redis vs Valkey
bash script-testing/redis-memory/run.sh --quick    # tests only
node tools/redis-audit/live.mjs --url redis://host:6379 --db 0 [--prefix p:] --check   # read-only audit of any instance
node tools/redis-audit/report.mjs                  # this report
node tools/redis-audit/inventory.mjs --check       # the static inventory is current</pre>
<h2>Next</h2>
<ul><li>D-15 (Vedant) owns separating cache and queue memory and the AOF cost; this audit gives it the TTL and baseline numbers.</li><li>Widen the workload (writes: contacts, campaigns, inbox) so more families are created, then re-run; the audit fails on any new key family that never expires and has no owner.</li></ul>
</body></html>`;
writeFileSync(out, html);
console.log(`written ${out}`);
