#!/usr/bin/env node
// V-03 report (HTML): what one queue costs in Redis, what the event-stream cap buys, concurrency against the DB pool, and the jobs that carry
// bodies. node tools/queue-capacity/v03-report.mjs [out.html]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(
  process.argv[2] ?? join(root, 'docs/performance/queue-capacity/V03-bullmq-REPORT.html'),
);
const bench = JSON.parse(
  readFileSync(join(root, 'docs/performance/queue-capacity/v03/retention-bench.json'), 'utf8'),
);
const inv = JSON.parse(
  readFileSync(join(root, 'docs/performance/queue-capacity/queue-inventory.json'), 'utf8'),
);
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
const kb = (b) => (b / 1024).toFixed(0);
const QUEUES = inv.queues.length;
const MAXMEM_MB = 192;
const today = bench.results[0];
const worst = (r) => ((r.queueBytes * QUEUES) / 1048576).toFixed(0);
const db = inv.queues
  .filter((q) => q.jobKind === 'db' && q.concurrencyPerWorker)
  .sort((a, b) => b.concurrencyPerWorker - a.concurrencyPerWorker);
const dbSlots = db.reduce((s, q) => s + q.concurrencyPerWorker, 0);
const slots = inv.queues.reduce((s, q) => s + (q.concurrencyPerWorker ?? 0), 0);
const member = JSON.stringify({
  phone: '+919840001000',
  name: 'Priya Sharma',
  contactId: 123456,
}).length;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>V-03 BullMQ</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#1b1f23}table{border-collapse:collapse;width:100%;margin:.5rem 0 1.2rem}td,th{border:1px solid #d0d7de;padding:5px 9px;text-align:left}th{background:#f6f8fa}pre{background:#f6f8fa;padding:10px;overflow:auto}.note{border-left:4px solid #d4a72c;background:#fff8c5;padding:8px 12px}</style></head><body>
<h1>V-03: BullMQ memory, payloads and concurrency</h1>
<p>Sheet4 V-03 (owner Vishal). Target: worker RSS and Redis memory down 20%. Measured on the real BullMQ ${esc(bench.results.length)} variants against a private Redis ${esc(bench.redis)}: ${today.jobs.toLocaleString('en')} ids-only jobs completed and ${today.failed} failed per variant, bytes by <code>MEMORY USAGE</code> (exact).</p>
<h2>Verdict</h2>
<ul>
<li><b>Changed: the event stream of every queue is capped at 100 entries</b> (BullMQ keeps 10,000). Nothing in this code base reads it (no <code>QueueEvents</code>). One busy queue: ${kb(today.queueBytes)} KB to ${kb(bench.results[1].queueBytes)} KB, <b>${bench.results[1].vsTodayPct}%</b>. No behaviour change.</li>
<li><b>Short of the 20% target on its own (${bench.results[1].vsTodayPct}%).</b> Not done, owner decision: keep 100 completed jobs per queue instead of 1,000 (<code>removeOnComplete.count</code>): ${bench.results[2].vsTodayPct}% together with the cap. It shortens the "what finished in the last hour" view of every queue on the defaults, which <code>queues.ts</code> says is the point of the 1,000, so it is not made here.</li>
<li><b>Worst case against the Redis limit:</b> ${QUEUES} queues, all full, hold about ${worst(today)} MB today against ${MAXMEM_MB} MB of <code>maxmemory</code> (${worst(bench.results[1])} MB with the cap, ${worst(bench.results[2])} MB with both). Real queues are rarely all full; <code>noeviction</code> means a full Redis refuses writes, not that it drops keys.</li>
<li><b>Concurrency is oversubscribed against the DB pool.</b> The worker runs ${slots} job slots; ${dbSlots} are database-bound queues, and production sets <code>DB_POOL_MAX</code> to 10 (<code>deploy/hostinger/docker-compose.yml</code>; default 20). Up to ${dbSlots} jobs can wait on 10 connections. Not changed: no real processor has been benchmarked (see <code>worker-concurrency-recommendations.md</code>), and lowering a queue's concurrency without that can slow ingest.</li>
<li><b>Payloads: most producers already pass ids</b> (message send is <code>{orgId, messageUuid, generation}</code>; campaign and broadcast runs pass ids; the inbound queues drop completed jobs). The ones that carry bodies are listed below; none is changed here.</li>
</ul>
<div class="note"><b>What this does not prove.</b> The 19% is for ids-only jobs on one Redis: larger payloads make the stream a smaller share, so the saving is a floor per queue, not a measure of production. Worker RSS was not measured: the job-slot count and payload size bear on it, but no processor was run here. Real queue fill rates need production metrics (<code>crm_queue_job_duration_seconds</code>, Redis <code>used_memory</code> per queue prefix).</div>
<h2>Redis bytes of one queue (${today.jobs} completed run, ${today.failed} failed)</h2>
<table><tr><th>Variant</th><th>Queue KB</th><th>vs today</th><th>Job hashes KB</th><th>Event stream KB</th><th>All ${QUEUES} queues full, MB</th></tr>${bench.results.map((r) => `<tr><td>${esc(r.variant)}</td><td>${kb(r.queueBytes)}</td><td>${r.vsTodayPct}%</td><td>${kb(r.bytesByKind.job ?? 0)}</td><td>${kb(r.bytesByKind.events ?? 0)}</td><td>${worst(r)}</td></tr>`).join('')}</table>
<p><code>today</code>: completed 1,000 kept for 1 h, failed 500 for 3 days, stream cap 10,000. A job costs about ${((today.bytesByKind.job ?? 0) / 1500 / 1024).toFixed(1)} KB retained even with a two-field payload: the hash, its options and its timestamps.</p>
<h2>Concurrency against the pool</h2>
<table><tr><th>Queue</th><th>Slots</th><th>Kind</th></tr>${db
  .slice(0, 8)
  .map(
    (q) =>
      `<tr><td>${esc(q.queue)}</td><td>${q.concurrencyPerWorker}</td><td>${esc(q.jobKind)}</td></tr>`,
  )
  .join('')}</table>
<p>${dbSlots} database-bound slots in total against a pool of 10 in production. Next step: run the real processors of the top five behind a mock provider (<code>tools/queue-capacity/bench.mjs</code>) and set concurrency near the pool share.</p>
<h2>Jobs that carry bodies (read from the code, not measured)</h2>
<table><tr><th>Producer</th><th>What the job holds</th><th>Retention</th><th>Note</th></tr>
<tr><td>shopify-woocommerce/broadcast.service.ts</td><td><code>resume.audience</code>: every held recipient (phone, name, contactId), about ${member} bytes each</td><td>delayed until quiet hours end; failed kept 1,000</td><td>10,000 held people is about ${((member * 10000) / 1048576).toFixed(1)} MB in one job. Pass a reference to a stored list instead.</td></tr>
<tr><td>outbound-webhooks/webhook-dispatch.consumer.ts</td><td>the whole event <code>envelope</code>, per (event, webhook)</td><td>1,000 completed, 5,000 failed</td><td>The largest retention of any queue: up to 6,000 envelopes.</td></tr>
<tr><td>webhook-fanout/webhook-fanout.service.ts</td><td>the raw webhook <code>body</code>, once per target</td><td>dropped on completion</td><td>N copies of one body for N targets.</td></tr>
<tr><td>whatsapp-cloud-api-waba/waba-webhook.service.ts</td><td>the changes, sealed (encrypted)</td><td>dropped on completion</td><td>Encrypted at rest in Redis; about 1.4 times the plain size.</td></tr>
<tr><td>shopify-woocommerce/webhook.service.ts, cart.service.ts</td><td>the store event <code>data</code></td><td>dropped on completion; failed kept 1,000</td><td></td></tr></table>
<h2>Scripts</h2>
<pre>docker run -d --rm --name qb -p 127.0.0.1:7301:6379 redis:7-alpine redis-server --appendonly no --save ""
node tools/queue-capacity/retention-bench.mjs --url redis://127.0.0.1:7301 --out docs/performance/queue-capacity/v03/retention-bench.json
docker rm -f qb
node tools/queue-capacity/v03-report.mjs
cd apps/api &amp;&amp; npx vitest run test/integration/redis/queue-events-stream.spec.ts --testTimeout=120000</pre>
</body></html>`;
writeFileSync(out, html);
console.log(`written ${out}`);
