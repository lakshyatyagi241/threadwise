// Closed-loop ramp test of a running API: N virtual users each send the next request as soon as the last answered, a mix of the main
// read routes. Steps hold for STEP_S seconds; per step it reports requests/s, p50/p95/p99, errors, and (with PSQL_URL) the database
// connections in use. The "limit" is the last step whose p95 stays under --p95 and whose error rate stays under 1%.
//   API_URL=http://localhost:3000 PERF_EMAIL=perf1@geta.ai PERF_PASSWORD=... PSQL_URL=postgres://crm@localhost:5433/crm \
//     node tools/perf/stress-ramp.mjs [--steps 5,10,25,50,100] [--seconds 20] [--p95 500] [--out perf/stress.json]
// Reads only (GET). One machine drives and serves, so the result is a ceiling for THIS box, not for production.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const API = process.env.API_URL ?? 'http://localhost:3000';
const STEPS = arg('--steps', '5,10,25,50,100').split(',').map(Number);
const STEP_S = Number(arg('--seconds', 20));
const P95_LIMIT = Number(arg('--p95', 500));
const MIX = [
  ['/v2/inbox/conversations', 20],
  ['/v2/message-history', 10],
  ['/v2/message-history/summary', 10],
  ['/v2/message-history/insights', 5],
  ['/v2/dashboard/summary', 10],
  ['/v2/shell/overview-stats', 5],
  ['/v2/contacts', 15],
  ['/v2/contacts/stats', 5],
  ['/v2/crm/dashboard', 5],
  ['/health', 15],
];
const pick = (() => {
  const bag = MIX.flatMap(([u, w]) => Array(w).fill(u));
  return () => bag[Math.floor(Math.random() * bag.length)];
})();

const login = await fetch(`${API}/v2/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.1.1' },
  body: JSON.stringify({
    email: process.env.PERF_EMAIL ?? 'perf1@geta.ai',
    password: process.env.PERF_PASSWORD ?? 'Str0ngPassw0rd#1',
  }),
}).then((r) => r.json());
const token = login.tokens?.accessToken;
if (!token) throw new Error(`login failed: ${JSON.stringify(login).slice(0, 200)}`);

const pct = (xs, p) =>
  xs.length ? xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : 0;
const dbConns = () => {
  if (!process.env.PSQL_URL) return null;
  try {
    return Number(
      execFileSync(
        process.env.PSQL ?? 'psql',
        [
          process.env.PSQL_URL,
          '-Atc',
          "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state <> 'idle'",
        ],
        { encoding: 'utf8' },
      ).trim(),
    );
  } catch {
    return null;
  }
};

async function step(vus) {
  const lat = [];
  const byRoute = new Map();
  let errors = 0;
  const codes = {};
  const end = Date.now() + STEP_S * 1000;
  let maxActive = 0;
  const sampler = setInterval(() => {
    const c = dbConns();
    if (c !== null) maxActive = Math.max(maxActive, c);
  }, 2000);
  await Promise.all(
    Array.from({ length: vus }, async (_, i) => {
      const ip = `10.8.${Math.floor(i / 250)}.${(i % 250) + 1}`; // one address per user so a per-IP limiter does not decide the result
      while (Date.now() < end) {
        const url = pick();
        const t0 = performance.now();
        let code = 0;
        try {
          const res = await fetch(`${API}${url}`, {
            headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': ip },
            signal: AbortSignal.timeout(30_000),
          });
          await res.arrayBuffer();
          code = res.status;
        } catch {
          code = 0;
        }
        const ms = performance.now() - t0;
        codes[code] = (codes[code] ?? 0) + 1;
        if (code < 200 || code >= 300) errors++;
        lat.push(ms);
        (byRoute.get(url) ?? byRoute.set(url, []).get(url)).push(ms);
      }
    }),
  );
  clearInterval(sampler);
  lat.sort((a, b) => a - b);
  const routes = {};
  for (const [u, xs] of byRoute) {
    xs.sort((a, b) => a - b);
    routes[u] = { n: xs.length, p50: pct(xs, 50), p95: pct(xs, 95), p99: pct(xs, 99) };
  }
  return {
    vus,
    requests: lat.length,
    rps: lat.length / STEP_S,
    p50: pct(lat, 50),
    p95: pct(lat, 95),
    p99: pct(lat, 99),
    max: lat.at(-1) ?? 0,
    errorRate: lat.length ? errors / lat.length : 0,
    codes,
    dbActiveMax: maxActive,
    routes,
  };
}

const results = [];
for (const v of STEPS) {
  const r = await step(v);
  results.push(r);
  console.log(
    `${String(v).padStart(4)} vus  ${r.rps.toFixed(0).padStart(5)} rps  p50 ${r.p50.toFixed(0)}  p95 ${r.p95.toFixed(0)}  p99 ${r.p99.toFixed(0)}  err ${(r.errorRate * 100).toFixed(1)}%  db-active-max ${r.dbActiveMax}`,
  );
}
const ok = results.filter((r) => r.p95 <= P95_LIMIT && r.errorRate < 0.01);
const out = {
  api: API,
  stepSeconds: STEP_S,
  p95LimitMs: P95_LIMIT,
  mix: MIX,
  limitVus: ok.length ? ok.at(-1).vus : null,
  results,
};
writeFileSync(arg('--out', 'perf/stress.json'), JSON.stringify(out, null, 2));
console.log(
  `limit: ${out.limitVus === null ? 'below the first step' : `${out.limitVus} users (p95 <= ${P95_LIMIT} ms, errors < 1%)`}`,
);
