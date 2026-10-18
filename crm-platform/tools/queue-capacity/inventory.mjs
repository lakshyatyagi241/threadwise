#!/usr/bin/env node
// Queue / worker inventory (QCAP-001..010). Static scan of apps/api/src; no Redis needed.
//
//   node tools/queue-capacity/inventory.mjs [--check] [--out docs/performance/queue-capacity]
//
// Reads QUEUES (infra/queue/queues.ts), every `@Processor(QUEUES.X, {...})` (concurrency, limiter), every `@InjectQueue(QUEUES.X)`
// producer, and the per-queue job options. Writes queue-worker-inventory.csv, queue-inventory.json and queue-topology.md.
// --check exits 1 when a queue has no consumer and no allow-listed reason, or a consumer has no concurrency set, so a new queue
// cannot ship unmeasured (QCAP-001, QCAP-008).
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from './lib/classes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const src = join(root, 'apps/api/src');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const outDir = resolve(root, opt('out', 'docs/performance/queue-capacity'));

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, acc);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.d.ts')) acc.push(p);
  }
  return acc;
}

// 1. The queue registry: constant name, queue name, doc comment.
const queuesTs = readFileSync(join(src, 'infra/queue/queues.ts'), 'utf8');
const block = queuesTs.slice(queuesTs.indexOf('export const QUEUES'), queuesTs.indexOf('} as const'));
const queues = [];
{
  let comment = '';
  for (const line of block.split('\n')) {
    const c = line.match(/^\s*\/\*\*\s*(.*?)\s*(\*\/)?\s*$/);
    if (c) comment = c[1].replace(/\*\/$/, '').trim();
    const m = line.match(/^\s*([A-Z0-9_]+):\s*'([^']+)'/);
    if (m) {
      queues.push({ constant: m[1], name: m[2], purpose: comment });
      comment = '';
    }
  }
}
const byConst = new Map(queues.map((q) => [q.constant, q]));

// 2. Retry policy per queue from QUEUE_JOB_OPTIONS (+ defaults).
const overrides = {};
for (const m of queuesTs.matchAll(/\[QUEUES\.([A-Z0-9_]+)\]:\s*([A-Z_]+|\{[^}]*\})/g)) overrides[m[1]] = m[2];
const policyOf = (constant) => {
  const o = overrides[constant];
  if (o === 'INBOUND_RETRY_OPTIONS' || o === 'INBOUND_RETRY') return { attempts: 10, backoff: 'exp 5s jitter .25', inbound: true };
  return { attempts: 5, backoff: 'exp 2s jitter .5', inbound: false };
};

// 3. Consumers and producers.
const files = walk(src);
const consumers = {};
const producers = {};
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const rel = relative(root, f);
  for (const m of text.matchAll(/@Processor\(\s*QUEUES\.([A-Z0-9_]+)\s*(?:,\s*\{([\s\S]*?)\}\s*\))?/g)) {
    const optsText = m[2] ?? '';
    const conc = optsText.match(/concurrency:\s*(\d+)/);
    const lim = optsText.match(/limiter:\s*\{\s*max:\s*(\d+)\s*,\s*duration:\s*([\d_]+)/);
    (consumers[m[1]] ??= []).push({
      file: rel,
      concurrency: conc ? Number(conc[1]) : null,
      limiter: lim ? { max: Number(lim[1]), durationMs: Number(lim[2].replace(/_/g, '')) } : null,
    });
  }
  for (const m of text.matchAll(/@InjectQueue\(\s*QUEUES\.([A-Z0-9_]+)\s*\)/g)) {
    const set = (producers[m[1]] ??= new Set());
    set.add(rel);
  }
}

// 4. Which queues have a scheduler / repeatable job (cron style) - looked up from `upsertJobScheduler|repeat:`.
const scheduled = new Set();
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  if (!/upsertJobScheduler|repeat:\s*\{/.test(text)) continue;
  for (const m of text.matchAll(/QUEUES\.([A-Z0-9_]+)/g)) scheduled.add(m[1]);
}

// @Interval / @Cron sweepers run in-process, outside BullMQ: they are capacity too (QCAP-001) but have no queue to measure.
const sweepers = [];
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/@(Interval|Cron)\(\s*([^)]*)\)/g)) sweepers.push({ file: relative(root, f), kind: m[1], spec: m[2].trim() });
}

const rows = queues.map((q) => {
  const cons = consumers[q.constant] ?? [];
  const prod = [...(producers[q.constant] ?? [])].sort();
  const cls = classify(q.constant);
  const pol = policyOf(q.constant);
  const totalConc = cons.reduce((a, c) => a + (c.concurrency ?? 1), 0);
  return {
    queue: q.name,
    constant: q.constant,
    class: cls.class,
    priority: cls.priority,
    waitSloMsP95: cls.waitSloMsP95,
    workload: cls.workload,
    jobKind: cls.kind, // io | cpu | db | provider
    dependency: cls.dependency,
    consumerFiles: cons.map((c) => c.file),
    concurrencyPerWorker: cons.length ? totalConc : null,
    limiter: cons.find((c) => c.limiter)?.limiter ?? null,
    attempts: pol.attempts,
    backoff: pol.backoff,
    inboundProtected: pol.inbound,
    producerFiles: prod,
    scheduled: scheduled.has(q.constant),
    purpose: q.purpose,
  };
});

const problems = [];
for (const r of rows) {
  if (!r.consumerFiles.length) problems.push(`${r.queue}: no @Processor found (producer-only or consumer registered another way - add to ALLOW_NO_CONSUMER with a reason)`);
  else if (r.concurrencyPerWorker === null) problems.push(`${r.queue}: consumer has no explicit concurrency`);
  if (!r.producerFiles.length && !r.scheduled) problems.push(`${r.queue}: no @InjectQueue producer found`);
}
const ALLOW = new Set(readJson(join(here, 'allow-no-consumer.json'), []).map((a) => a.queue));
const blocking = problems.filter((p) => !ALLOW.has(p.split(':')[0]));

function readJson(p, d) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return d;
  }
}

mkdirSync(outDir, { recursive: true });
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const cols = ['queue', 'class', 'priority', 'waitSloMsP95', 'workload', 'jobKind', 'dependency', 'concurrencyPerWorker', 'limiter', 'attempts', 'backoff', 'inboundProtected', 'scheduled', 'consumerFiles', 'producerFiles', 'purpose'];
const csv = [cols.join(',')]
  .concat(rows.map((r) => cols.map((c) => csvCell(typeof r[c] === 'object' && r[c] !== null ? (Array.isArray(r[c]) ? r[c].join(' | ') : JSON.stringify(r[c])) : r[c])).join(',')))
  .join('\n');
writeFileSync(join(outDir, 'queue-worker-inventory.csv'), csv + '\n');
writeFileSync(join(outDir, 'queue-inventory.json'), JSON.stringify({ generatedFrom: 'apps/api/src', queueCount: rows.length, queues: rows, sweepers, problems }, null, 2) + '\n');

const byClass = {};
for (const r of rows) (byClass[r.class] ??= []).push(r);
const slots = (list) => list.reduce((a, r) => a + (r.concurrencyPerWorker ?? 0), 0);
let md = `# Queue topology\n\nGenerated by \`tools/queue-capacity/inventory.mjs\` from \`apps/api/src\`. Do not edit by hand.\n\n`;
md += `- Broker: Redis via BullMQ (\`bullmq\` ^6, \`@nestjs/bullmq\`), single Redis, \`noeviction\`.\n`;
md += `- ${rows.length} queues, ${rows.filter((r) => r.consumerFiles.length).length} with a \`@Processor\`. Processors run only when WORKER_MODE is on (worker process); the API process only enqueues.\n`;
md += `- All processors in one worker process share one event loop; the slot totals below are per worker instance.\n\n`;
for (const cls of ['critical-inbound', 'interactive', 'automation', 'bulk', 'maintenance']) {
  const list = byClass[cls] ?? [];
  if (!list.length) continue;
  md += `## ${cls} (${list.length} queues, ${slots(list)} slots per worker instance)\n\n| queue | conc | limiter | wait p95 SLO | dependency | scheduled | consumer |\n|---|---|---|---|---|---|---|\n`;
  for (const r of list.sort((a, b) => a.queue.localeCompare(b.queue))) {
    md += `| ${r.queue} | ${r.concurrencyPerWorker ?? '?'} | ${r.limiter ? `${r.limiter.max}/${r.limiter.durationMs}ms` : '-'} | ${r.waitSloMsP95 ?? '-'} ms | ${r.dependency} | ${r.scheduled ? 'yes' : '-'} | ${r.consumerFiles[0] ?? 'NONE'} |\n`;
  }
  md += '\n';
}
md += `## In-process sweepers (@Interval / @Cron, not BullMQ): ${sweepers.length}\n\n${sweepers.map((s) => `- ${s.file}: @${s.kind}(${s.spec})`).join('\n')}\n\n`;
md += `## Findings\n\n${problems.length ? problems.map((p) => `- ${p}${ALLOW.has(p.split(':')[0]) ? ' (allow-listed)' : ''}`).join('\n') : '- none'}\n`;
writeFileSync(join(outDir, 'queue-topology.md'), md);

console.log(`queues=${rows.length} consumers=${rows.filter((r) => r.consumerFiles.length).length} problems=${problems.length} blocking=${blocking.length}`);
for (const p of problems) console.log(' -', p);
if (flag('check') && blocking.length) process.exit(1);
