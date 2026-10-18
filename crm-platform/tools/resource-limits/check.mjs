#!/usr/bin/env node
// Resource-limits check (RES-099). Reads the deployment compose files and the API source, evaluates the budgets in
// docs/performance/resource-limits/resource-policy-registry.json and compares the result with the gaps that registry accepts.
//
//   node tools/resource-limits/check.mjs [--check] [--json] [--out <file>]
//
// Static: it reads files and does arithmetic. It never starts a container and never measures anything, so a PASSED here means "the
// configuration is inside the policy", not "the service survives load". Runtime proof is the fault-injection and soak work listed in
// the registry's `notRun` section.
//
// --check exits 1 when a result is FAILED/BLOCKED and not listed in `acceptedGaps` (a regression), when an accepted gap now passes
// (stale: delete it so the list only shrinks), or when an accepted gap is past its `expires` date.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyAccepted,
  commandFlag,
  evaluate,
  flowListFlag,
  heapLimitBytes,
  parseCompose,
  parseSize,
  processorConcurrency,
  serviceCpuLimit,
  serviceEnv,
  serviceMemLimit,
  servicePidsLimit,
} from './lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
const read = (p) => readFileSync(join(root, p), 'utf8');

const registry = JSON.parse(read('docs/performance/resource-limits/resource-policy-registry.json'));

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.d.ts')) acc.push(p);
  }
  return acc;
}

const envSchema = read('apps/api/src/config/env.schema.ts');
const poolDefault = Number(envSchema.match(/DB_POOL_MAX:[^\n]*\.default\((\d+)\)/)?.[1] ?? 20);

/** The raw text of one service block, for the flow-list commands the small reader does not follow. */
function serviceText(text, name) {
  const m = text.match(
    new RegExp(`^ {2}${name}:\\s*$([\\s\\S]*?)(?=^ {2}[\\w-]+:\\s*$|^[a-z]|\\Z)`, 'm'),
  );
  return m ? m[1] : '';
}

function deployment(name, file) {
  const text = read(file);
  const doc = parseCompose(text);
  const services = Object.entries(doc.services ?? {}).map(([sname, svc]) => {
    const env = serviceEnv(svc);
    const image = String(svc.image ?? '');
    const runsNode = /^(api|worker|web)/.test(sname);
    const isRedis = /^redis:/.test(image);
    const raw = serviceText(text, sname);
    const stop = String(svc.stop_grace_period ?? '').match(/^(\d+)s$/);
    const pg = Array.isArray(svc.command) ? commandFlag(svc.command, 'max_connections') : undefined;
    const usesDb = !!(env.DATABASE_URL || svc.env_file) && /^(api|worker)/.test(sname);
    const dbUrl = env.DATABASE_URL;
    const replica = env.DATABASE_REPLICA_URL;
    return {
      name: sname,
      oneShot: svc.restart === 'no' || sname === 'migrate',
      slot2: /-green$/.test(sname),
      memLimit: serviceMemLimit(svc),
      cpuLimit: serviceCpuLimit(svc),
      pidsLimit: servicePidsLimit(svc),
      logging: !!svc.logging,
      heapLimit: heapLimitBytes(env.NODE_OPTIONS),
      runsNode,
      stopGraceSeconds: stop ? Number(stop[1]) : undefined,
      maxConnections: pg ? Number(pg) : undefined,
      dbPoolMax: usesDb ? Number(env.DB_POOL_MAX ?? poolDefault) : undefined,
      poolsPerProcess: usesDb && replica && replica !== dbUrl ? 2 : 1,
      isRedis,
      redisMaxMemory: isRedis ? parseSize(flowListFlag(raw, 'maxmemory')) : undefined,
      redisPolicy: isRedis ? flowListFlag(raw, 'maxmemory-policy') : undefined,
    };
  });
  return { name, file, services };
}

const facts = {
  deployments: [
    deployment('hostinger', 'deploy/hostinger/docker-compose.yml'),
    deployment('prod-reference', 'docker-compose.prod.yml'),
  ],
  workerConcurrency: processorConcurrency(
    walk(join(root, 'apps/api/src')).map((f) => [
      f.slice(root.length + 1),
      readFileSync(f, 'utf8'),
    ]),
  ),
};
const hostinger = facts.deployments[0].services.find((s) => s.name === 'worker');
facts.workerPoolMax = hostinger?.dbPoolMax ?? poolDefault;

// The worker is one process, so the pool-per-process arithmetic above uses the deployed worker's pool.
const results = evaluate(facts, registry);
const verdict = applyAccepted(results, registry.acceptedGaps);

if (flag('json') || opt('out')) {
  const body = JSON.stringify(
    {
      generated: new Date().toISOString().slice(0, 10),
      results,
      verdict: {
        regressions: verdict.regressions.map((r) => r.id),
        stale: verdict.stale,
        expired: verdict.expired,
      },
    },
    null,
    2,
  );
  if (opt('out')) {
    mkdirSync(dirname(resolve(opt('out'))), { recursive: true });
    writeFileSync(resolve(opt('out')), body + '\n');
  } else process.stdout.write(body + '\n');
}
if (!flag('json')) {
  const accepted = new Set((registry.acceptedGaps ?? []).map((a) => a.id));
  for (const r of results)
    console.log(
      `${r.status.padEnd(7)} ${accepted.has(r.id) ? '(accepted) ' : ''}${r.id}  ${r.summary}`,
    );
  console.log(
    `\n${results.length} checks; ${verdict.regressions.length} regression(s), ${verdict.stale.length} stale accepted gap(s), ${verdict.expired.length} expired.`,
  );
  for (const r of verdict.regressions) console.log(`  REGRESSION ${r.id}: ${r.summary}`);
  for (const id of verdict.stale)
    console.log(`  STALE accepted gap (now passes or no longer exists, remove it): ${id}`);
  for (const id of verdict.expired) console.log(`  EXPIRED accepted gap: ${id}`);
}
if (flag('check') && (verdict.regressions.length || verdict.stale.length || verdict.expired.length))
  process.exit(1);
