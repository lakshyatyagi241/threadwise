#!/usr/bin/env node
// Queue reliability ratchet (Sheet 3 D-14). Static scan of apps/api/src; no Redis needed.
//
//   node tools/queue-capacity/reliability.mjs [--check] [--summary]
//
// Every queue gets the shared defaults (attempts, exponential backoff, bounded removeOnComplete/removeOnFail, queues.ts) through
// jobOptionsFor(). This fails (exit 1, with --check) when:
//   - a producer overrides attempts, backoff or removeOnComplete/removeOnFail inline and the queue has no written reason in
//     docs/performance/queue-capacity/queue-reliability.json ("overrides");
//   - a producer enqueues without a jobId (BullMQ's own de-duplication) and the queue/file has no reason ("noJobId");
//   - a queue has no idempotency entry, or an entry's evidence quote is no longer in its file, or a registry entry is stale.
// Idempotency has four honest states: documented (a comment or key in the code says a repeat is harmless, with the quote),
// known-risk (the code says a repeat is not harmless), not-demonstrated (nothing in the code says either way) and no-consumer
// (a queue with no @Processor, run by other means). It does not claim more than the code says.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function closeOf(s, i) {
  let d = 0;
  for (let j = i; j < s.length; j++) {
    if ('([{'.includes(s[j])) d++;
    else if (')]}'.includes(s[j]) && --d === 0) return j;
  }
  return -1;
}

/** The queue keys and names in queues.ts: { KEY: 'name' }. */
export function parseQueues(text) {
  const body = text.slice(text.indexOf('export const QUEUES = {'), text.indexOf('} as const;'));
  return Object.fromEntries(
    [...body.matchAll(/^\s{2}([A-Z_0-9]+):\s*'([a-z0-9-]+)'/gm)].map((m) => [m[1], m[2]]),
  );
}

/** Queue keys that have a @Processor (a consumer in the API/worker process). */
export function parseProcessors(files) {
  const out = new Set();
  for (const f of files)
    for (const m of f.text.matchAll(/@Processor\(\s*QUEUES\.([A-Z_0-9]+)/g)) out.add(m[1]);
  return out;
}

/** Every `.add(` / `.addBulk(` on a queue injected with @InjectQueue(QUEUES.X). */
export function scanEnqueues(files) {
  const sites = [];
  const inject =
    /@InjectQueue\(\s*QUEUES\.([A-Z_0-9]+)\s*\)\s*(?:private\s+|protected\s+|public\s+)?(?:readonly\s+)?(\w+)\s*:/g;
  for (const f of files) {
    const names = new Map([...f.text.matchAll(inject)].map((m) => [m[2], m[1]]));
    if (!names.size) continue;
    for (const m of f.text.matchAll(/\b(?:this\.)?(\w+)\.(add|addBulk)\s*\(/g)) {
      const queue = names.get(m[1]);
      if (!queue) continue;
      const open = m.index + m[0].length - 1;
      const call = f.text.slice(open, closeOf(f.text, open) + 1);
      sites.push({
        queue,
        file: f.path,
        line: f.text.slice(0, m.index).split('\n').length,
        jobId: /\bjobId\b/.test(call),
        overrides: [
          ...new Set(
            [...call.matchAll(/\b(attempts|backoff|removeOnComplete|removeOnFail)\s*:/g)].map(
              (x) => x[1],
            ),
          ),
        ].sort(),
      });
    }
  }
  return sites;
}

/** Pure: the problems with `sites`/`queues` against `registry`. `fileText(path)` returns a source file's text or undefined. */
export function check({ queues, sites, processors, registry, fileText }) {
  const problems = [];
  const keys = Object.keys(queues);

  for (const q of new Set(sites.filter((s) => s.overrides.length).map((s) => s.queue)))
    if (!registry.overrides?.[q]?.trim())
      problems.push(
        `${q}: a producer overrides ${[...new Set(sites.filter((s) => s.queue === q).flatMap((s) => s.overrides))].join(', ')} inline and the queue has no written reason in "overrides"`,
      );
  for (const q of Object.keys(registry.overrides ?? {}))
    if (!sites.some((s) => s.queue === q && s.overrides.length))
      problems.push(
        `overrides: ${q} has a reason but no producer overrides anything any more (remove it)`,
      );

  for (const s of sites.filter((x) => !x.jobId))
    if (
      !registry.noJobId?.some((e) => e.queue === s.queue && e.file === s.file && e.reason?.trim())
    )
      problems.push(
        `${s.queue}: ${s.file}:${s.line} enqueues without a jobId and has no reason in "noJobId"`,
      );
  for (const e of registry.noJobId ?? [])
    if (!sites.some((s) => s.queue === e.queue && s.file === e.file && !s.jobId))
      problems.push(
        `noJobId: ${e.queue} in ${e.file} no longer enqueues without a jobId (remove it)`,
      );

  const states = new Set(['documented', 'known-risk', 'not-demonstrated', 'no-consumer']);
  for (const k of keys) {
    const e = registry.idempotency?.[k];
    if (!e) {
      problems.push(`${k}: no entry in "idempotency"`);
      continue;
    }
    if (!states.has(e.status))
      problems.push(
        `${k}: idempotency status "${e.status}" is not one of ${[...states].join(', ')}`,
      );
    const hasProc = processors.has(k);
    if (e.status === 'no-consumer' && hasProc)
      problems.push(`${k}: marked no-consumer but has a @Processor`);
    if (e.status !== 'no-consumer' && !hasProc)
      problems.push(`${k}: has no @Processor, so it must be marked no-consumer`);
    if (e.status === 'documented' || e.status === 'known-risk') {
      const text = e.file ? fileText(e.file) : undefined;
      if (!e.quote || text === undefined)
        problems.push(`${k}: ${e.status} needs a file and a quote`);
      else if (!text.replace(/\s*\n\s*(?:\*|\/\/)?\s*/g, ' ').includes(e.quote))
        problems.push(`${k}: the quote "${e.quote}" is no longer in ${e.file}`);
    }
  }
  for (const k of Object.keys(registry.idempotency ?? {}))
    if (!keys.includes(k))
      problems.push(`idempotency: ${k} is not a queue in queues.ts (remove it)`);
  return problems;
}

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.d.ts')) acc.push(p);
  }
  return acc;
}

export function load(root) {
  const src = join(root, 'apps/api/src');
  const files = walk(src).map((p) => ({ path: relative(src, p), text: readFileSync(p, 'utf8') }));
  const byPath = new Map(files.map((f) => [f.path, f.text]));
  const queues = parseQueues(byPath.get('infra/queue/queues.ts'));
  const registry = JSON.parse(
    readFileSync(join(root, 'docs/performance/queue-capacity/queue-reliability.json'), 'utf8'),
  );
  return {
    queues,
    sites: scanEnqueues(files),
    processors: parseProcessors(files),
    registry,
    fileText: (p) => byPath.get(p),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const data = load(root);
  const problems = check(data);
  const { queues, sites, registry } = data;
  if (process.argv.includes('--summary') || !problems.length) {
    const n = Object.keys(queues).length;
    const count = (st) => Object.values(registry.idempotency).filter((e) => e.status === st).length;
    const inline = new Set(sites.filter((s) => s.overrides.length).map((s) => s.queue));
    console.log(
      `queues ${n} | enqueue sites ${sites.length} (${sites.filter((s) => s.jobId).length} with jobId) | ` +
        `queues with inline overrides ${inline.size}, all with a written reason | ` +
        `idempotency: ${count('documented')} documented, ${count('known-risk')} known risk, ${count('not-demonstrated')} not demonstrated, ${count('no-consumer')} no consumer`,
    );
  }
  if (problems.length) {
    console.error(`queue reliability FAILED (${problems.length}):\n- ${problems.join('\n- ')}`);
    if (process.argv.includes('--check')) process.exit(1);
  } else console.log('queue reliability: ok');
}
