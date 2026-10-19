// Times every GET route of the running API, and reads per-statement timings back from pg_stat_statements.
//   API_URL=http://localhost:3000 PERF_EMAIL=perf1@geta.ai PERF_PASSWORD=... PSQL_URL=postgres://crm@localhost:5433/crm \
//     node tools/api-inventory/measure.mjs [--samples 7] [--out perf/results]
// Needs: the API running in production mode, the organisation filled by tools/perf/seed.sql, psql on the PATH (or PSQL=/path/to/psql),
// and the pg_stat_statements extension. Only GET routes are called: a write needs a valid body per route and would change data, so writes are
// listed as "not run", never guessed. A route that answers 4xx (no data for its path parameter, or a platform-operator route called with a
// workspace token) is recorded with its status and is NOT counted as a latency result.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routes } from '../qa-suite/lib/routes.mjs';
import { paramPools, resolveUrl } from './resolve-params.mjs';
import { summarize } from './stats.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const API = process.env.API_URL ?? 'http://localhost:3000';
const PSQL = process.env.PSQL ?? 'psql';
const PG = process.env.PSQL_URL ?? 'postgres://crm@localhost:5433/crm';
const SAMPLES = Number(arg('--samples', 7));
const OUT = resolve(ROOT, arg('--out', 'perf/results'));
const TIMEOUT_MS = 20000;
const SKIP_GET = /(logout|sign-?out|\/callback\b|\/oauth\/)/i; // a GET that ends the session or finishes a provider handshake

const psql = (sql) =>
  execFileSync(PSQL, [PG, '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    encoding: 'utf8',
    maxBuffer: 256 << 20,
  });

async function login(path, email, password, ip) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email, password }),
  });
  const j = await res.json();
  if (!j.tokens?.accessToken)
    throw new Error(`login failed: ${res.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j.tokens.accessToken;
}

const PASSWORD = process.env.PERF_PASSWORD ?? 'Str0ngPassw0rd#1';
const token = await login(
  '/v2/auth/login',
  process.env.PERF_EMAIL ?? 'perf1@geta.ai',
  PASSWORD,
  '10.9.0.9',
);
// Platform routes answer only to a platform operator (a different realm); without one they would all be a 401 and say nothing.
const operatorToken = process.env.OPERATOR_EMAIL
  ? await login(
      '/v2/platform/auth/login',
      process.env.OPERATOR_EMAIL,
      process.env.OPERATOR_PASSWORD ?? PASSWORD,
      '10.9.0.10',
    )
  : null;
const tokenFor = (url) =>
  url.startsWith('/v2/platform/') && operatorToken ? operatorToken : token;
const orgId = Number(
  psql(`SELECT id FROM organizations WHERE slug = '${process.env.PERF_ORG ?? 'perf-org'}'`).trim(),
);
const pools = paramPools((sql) => psql(sql), orgId);
console.log(`org ${orgId}, ${pools.size} tables with sample ids`);

const seen = new Set();
const targets = [];
const notRun = [];
for (const r of routes()) {
  const route = `${r.method} ${r.url}`;
  if (seen.has(route)) continue;
  seen.add(route);
  if (r.method !== 'GET' || SKIP_GET.test(r.url)) notRun.push(route);
  else targets.push(r);
}

psql('SELECT pg_stat_statements_reset()');
const results = {};
let n = 0;
for (const r of targets) {
  const route = `${r.method} ${r.url}`;
  const { url, resolved } = resolveUrl(r.url, pools);
  const times = [];
  let status = 0;
  let bytes = 0;
  let err = null;
  for (let i = 0; i < SAMPLES + 1; i++) {
    const t0 = performance.now();
    try {
      const res = await fetch(`${API}${url}`, {
        headers: {
          authorization: `Bearer ${tokenFor(r.url)}`,
          'x-forwarded-for': `10.8.${(n >> 8) & 255}.${n & 255}`,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const buf = await res.arrayBuffer();
      status = res.status;
      bytes = buf.byteLength;
      if (i > 0) times.push(performance.now() - t0); // the first call warms the route and is discarded
      if (status === 429) break; // throttled: the time says nothing
      if (status >= 400 && i === 1) break; // an error answers fast and says nothing about latency
    } catch (e) {
      err = String(e?.name ?? e);
      status = 0;
      break;
    }
  }
  results[route] = { status, resolved, bytes, err, ...(times.length ? summarize(times) : {}) };
  if (++n % 100 === 0) console.log(`${n}/${targets.length}`);
}

// Every statement the run produced, with its own timings.
const q =
  psql(`SELECT calls, round(mean_exec_time::numeric, 2), round(max_exec_time::numeric, 2), round(total_exec_time::numeric, 1), rows,
    replace(replace(left(query, 400), E'\\n', ' '), E'\\t', ' ')
  FROM pg_stat_statements
  WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) AND query NOT ILIKE '%pg_stat_statements%'
  ORDER BY mean_exec_time DESC`);
const queries = q
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    const [calls, mean, max, total, rows, query] = l.split('\t');
    return { calls: +calls, meanMs: +mean, maxMs: +max, totalMs: +total, rows: +rows, query };
  });

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'api-timings.json'), JSON.stringify(results, null, 1) + '\n');
writeFileSync(join(OUT, 'query-timings.json'), JSON.stringify(queries, null, 1) + '\n');
writeFileSync(join(OUT, 'not-run.json'), JSON.stringify(notRun, null, 1) + '\n');
const ok = Object.values(results).filter((x) => x.status >= 200 && x.status < 400 && x.p95 != null);
console.log(
  `${targets.length} GET routes called, ${ok.length} answered 2xx/3xx (timed), ${notRun.length} not run (writes), ${queries.length} statements, ${queries.filter((x) => x.meanMs > 50).length} over 50 ms mean`,
);
