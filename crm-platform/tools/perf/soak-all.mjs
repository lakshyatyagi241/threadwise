#!/usr/bin/env node
// A timed soak of EVERY resolvable GET route of a running API, with the load stepped up minute by minute to full load, while sampling the
// API's and Postgres' RAM and CPU, and a per-minute, per-route latency table: what each API costs along the timeline.
//   API_URL=http://localhost:3000 PERF_EMAIL=... PERF_PASSWORD=... PSQL_URL=postgres://crm@localhost:5433/crm \
//     node tools/perf/soak-all.mjs [--minutes 15] [--start-vus 2] [--max-vus 32] [--out perf/soak-all] [--cpuprofile <dir>]
// Closed loop: each virtual user sends its next request as soon as the last one answered (no think time), choosing a route at random from the
// working set (every GET route that answers 200 for the seeded organisation). Load per minute rises linearly from start-vus to max-vus over the
// first 80 % of the run; the last 20 % holds max-vus ("full load"). The API should be started by tools/perf/soak-all.sh (heap capped, V8 CPU
// profile on); `--cpuprofile <dir>` makes the report read the .cpuprofile written there when the API exits.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routes } from '../qa-suite/lib/routes.mjs';
import { paramPools, resolveUrl } from '../api-inventory/resolve-params.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const API = process.env.API_URL ?? 'http://localhost:3000';
const PSQL = process.env.PSQL ?? 'psql';
const PG = process.env.PSQL_URL ?? 'postgres://crm@localhost:5433/crm';
const MINUTES = Number(arg('--minutes', 15));
const START_VUS = Number(arg('--start-vus', 2));
const MAX_VUS = Number(arg('--max-vus', 32));
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = join(resolve(ROOT, arg('--out', 'perf/soak-all')), STAMP);
const SKIP_GET = /(logout|sign-?out|\/callback\b|\/oauth\/)/i;
const psql = (sql) =>
  execFileSync(PSQL, [PG, '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    encoding: 'utf8',
    maxBuffer: 256 << 20,
  });

// --- setup: token, working set -------------------------------------------------------------------------------------------------
const login = await fetch(`${API}/v2/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.6.0.1' },
  body: JSON.stringify({
    email: process.env.PERF_EMAIL ?? 'perf1@geta.ai',
    password: process.env.PERF_PASSWORD ?? 'Str0ngPassw0rd#1',
  }),
}).then((r) => r.json());
const token = login.tokens?.accessToken;
if (!token) throw new Error(`login failed: ${JSON.stringify(login).slice(0, 200)}`);
const orgId = Number(
  psql(`SELECT id FROM organizations WHERE slug = '${process.env.PERF_ORG ?? 'Admin'}'`).trim(),
);
const pools = paramPools((s) => psql(s), orgId);
const seen = new Set();
const candidates = [];
for (const r of routes()) {
  const key = `${r.method} ${r.url}`;
  if (
    seen.has(key) ||
    r.method !== 'GET' ||
    SKIP_GET.test(r.url) ||
    r.url.startsWith('/v2/platform/')
  )
    continue;
  seen.add(key);
  const { url, resolved } = resolveUrl(r.url, pools);
  if (resolved) candidates.push({ route: key, url });
}
const headers = (i) => ({
  authorization: `Bearer ${token}`,
  'x-forwarded-for': `10.5.${(i >> 8) & 255}.${i & 255}`,
});
const working = [];
for (const [i, c] of candidates.entries()) {
  try {
    const res = await fetch(`${API}${c.url}`, {
      headers: headers(i),
      signal: AbortSignal.timeout(20000),
    });
    await res.arrayBuffer();
    if (res.status === 200) working.push(c);
  } catch {
    /* not part of the working set */
  }
}
console.log(`working set: ${working.length} GET routes (of ${candidates.length} resolvable)`);
if (!working.length) throw new Error('no route answered 200');

// --- process sampling ----------------------------------------------------------------------------------------------------------
const pidOf = (port) => {
  try {
    return Number(
      execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).split(
        '\n',
      )[0],
    );
  } catch {
    return 0;
  }
};
const apiPid = pidOf(new URL(API).port || 80);
const ps = (args) => {
  try {
    return execFileSync('ps', args, { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return [];
  }
};
function sample(t0) {
  const a = apiPid
    ? ps(['-o', 'rss=,pcpu=', '-p', String(apiPid)])[0]
        ?.trim()
        .split(/\s+/)
        .map(Number)
    : null;
  const pgRows = ps(['-axo', 'rss=,pcpu=,command=']).filter(
    (l) => /postgres/.test(l) && /qa-live|pgdata|crm/.test(l),
  );
  const pg = pgRows.reduce(
    (acc, l) => {
      const [r, c] = l.trim().split(/\s+/);
      return [acc[0] + Number(r), acc[1] + Number(c)];
    },
    [0, 0],
  );
  let active = null;
  try {
    active = Number(
      psql(
        "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state <> 'idle'",
      ).trim(),
    );
  } catch {
    /* ignore */
  }
  return {
    t: (Date.now() - t0) / 1000,
    apiRssMb: a ? a[0] / 1024 : null,
    apiCpu: a ? a[1] : null,
    pgRssMb: pg[0] / 1024,
    pgCpu: pg[1],
    pgActive: active,
    load1: loadavg()[0],
  };
}

// --- load ----------------------------------------------------------------------------------------------------------------------
psql('SELECT pg_stat_statements_reset()');
const t0 = Date.now();
const END = t0 + MINUTES * 60_000;
const minuteOf = () => Math.min(MINUTES - 1, Math.floor((Date.now() - t0) / 60_000));
const vusFor = (m) => {
  const ramp = Math.max(1, Math.round(MINUTES * 0.8));
  return Math.round(
    START_VUS + ((MAX_VUS - START_VUS) * Math.min(m, ramp - 1)) / Math.max(1, ramp - 1),
  );
};
const perRoute = new Map(); // route -> per-minute { lat: [], err }
const codes = {};
const samples = [];
const perMinute = Array.from({ length: MINUTES }, () => ({ n: 0, errors: 0, lat: [] }));
const note = (route, m, ms, ok) => {
  const byMin =
    perRoute.get(route) ??
    perRoute
      .set(
        route,
        Array.from({ length: MINUTES }, () => ({ lat: [], err: 0 })),
      )
      .get(route);
  byMin[m].lat.push(ms);
  if (!ok) byMin[m].err++;
  perMinute[m].n++;
  perMinute[m].lat.push(ms);
  if (!ok) perMinute[m].errors++;
};
async function vu(id) {
  while (Date.now() < END) {
    // a user is "on" while its index is below this minute's target; the others idle until their minute comes
    if (id >= vusFor(minuteOf())) {
      await new Promise((r) => setTimeout(r, 250));
      continue;
    }
    const c = working[Math.floor(Math.random() * working.length)];
    const t = performance.now();
    let code = 0;
    try {
      const res = await fetch(`${API}${c.url}`, {
        headers: headers(id + 1000),
        signal: AbortSignal.timeout(30000),
      });
      await res.arrayBuffer();
      code = res.status;
    } catch {
      code = 0;
    }
    codes[code] = (codes[code] ?? 0) + 1;
    note(c.route, minuteOf(), performance.now() - t, code >= 200 && code < 300);
  }
}
const sampler = setInterval(() => {
  const s = sample(t0);
  s.vus = vusFor(minuteOf());
  samples.push(s);
}, 5000);
const bar = setInterval(
  () =>
    console.log(
      `min ${minuteOf() + 1}/${MINUTES}  users ${vusFor(minuteOf())}  requests ${perMinute.reduce((a, m) => a + m.n, 0)}`,
    ),
  60_000,
);
await Promise.all(Array.from({ length: MAX_VUS }, (_, i) => vu(i)));
clearInterval(sampler);
clearInterval(bar);

// --- results -------------------------------------------------------------------------------------------------------------------
const pct = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sqlRows =
  psql(`SELECT calls, round(mean_exec_time::numeric,2), round(total_exec_time::numeric,0), round(max_exec_time::numeric,1), rows,
  replace(replace(left(query,200), E'\\n',' '), E'\\t',' ') FROM pg_stat_statements
  WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) AND query NOT ILIKE '%pg_stat_statements%'
  ORDER BY total_exec_time DESC LIMIT 15`)
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [calls, m, tot, max, rows, q] = l.split('\t');
      return { calls: +calls, meanMs: +m, totalMs: +tot, maxMs: +max, rows: +rows, query: q };
    });
const routeTable = [...perRoute.entries()]
  .map(([route, mins]) => {
    const all = mins.flatMap((m) => m.lat);
    return {
      route,
      calls: all.length,
      errors: mins.reduce((a, m) => a + m.err, 0),
      totalMs: all.reduce((a, b) => a + b, 0),
      meanMs: mean(all),
      p50: pct(all, 50),
      p95: pct(all, 95),
      p99: pct(all, 99),
      maxMs: Math.max(...all),
      perMinuteP95: mins.map((m) => (m.lat.length ? pct(m.lat, 95) : null)),
      perMinuteCalls: mins.map((m) => m.lat.length),
    };
  })
  .sort((a, b) => b.totalMs - a.totalMs);
const grandTotal = routeTable.reduce((a, r) => a + r.totalMs, 0);
const minutesTable = perMinute.map((m, i) => {
  const ss = samples.filter((s) => s.t >= i * 60 && s.t < (i + 1) * 60);
  const avg = (k) => mean(ss.map((s) => s[k]).filter((v) => v != null));
  const max = (k) => Math.max(0, ...ss.map((s) => s[k]).filter((v) => v != null));
  return {
    minute: i + 1,
    vus: vusFor(i),
    requests: m.n,
    rps: m.n / 60,
    p50: pct(m.lat, 50),
    p95: pct(m.lat, 95),
    p99: pct(m.lat, 99),
    errors: m.errors,
    apiRssAvg: avg('apiRssMb'),
    apiRssMax: max('apiRssMb'),
    apiCpuAvg: avg('apiCpu'),
    apiCpuMax: max('apiCpu'),
    pgCpuAvg: avg('pgCpu'),
    pgRssAvg: avg('pgRssMb'),
    pgActiveMax: max('pgActive'),
    load1: avg('load1'),
  };
});
// RSS slope after the first third of the run (MB/h): a steady climb under steady load is a leak; under a ramp some growth is expected
const tail = samples.filter((s) => s.apiRssMb != null && s.t > (MINUTES * 60) / 3);
const slope = (() => {
  if (tail.length < 4) return null;
  const mx = mean(tail.map((s) => s.t));
  const my = mean(tail.map((s) => s.apiRssMb));
  const num = tail.reduce((a, s) => a + (s.t - mx) * (s.apiRssMb - my), 0);
  const den = tail.reduce((a, s) => a + (s.t - mx) ** 2, 0);
  return (num / den) * 3600;
})();
const result = {
  generatedAt: new Date().toISOString(),
  api: API,
  minutes: MINUTES,
  startVus: START_VUS,
  maxVus: MAX_VUS,
  workingSet: working.length,
  machine: {
    cpus: cpus().length,
    model: cpus()[0]?.model,
    memGb: Math.round(totalmem() / 2 ** 30),
  },
  apiPid,
  codes,
  minutesTable,
  routeTable,
  grandTotalMs: grandTotal,
  sql: sqlRows,
  samples,
  rssSlopeMbPerHour: slope,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'result.json'), JSON.stringify(result, null, 1));

// --- CPU profile (read after the API exited and wrote its .cpuprofile) ---------------------------------------------------------
/** Self time per function and per module from a V8 .cpuprofile. */
export function topSelf(profile, n = 25) {
  const self = new Map();
  const byId = new Map(profile.nodes.map((x) => [x.id, x]));
  const dt = profile.timeDeltas ?? [];
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (dt[i] ?? 0)));
  const total = [...self.values()].reduce((a, b) => a + b, 0) || 1;
  const fns = new Map();
  const mods = new Map();
  const moduleOf = (url) => {
    if (!url) return '(native / idle)';
    const file = url.replace(/^file:\/\//, '');
    if (url.startsWith('node:')) return 'node internals';
    if (file.includes('node_modules/')) {
      const rest = file.split('node_modules/').pop().split('/');
      return `node_modules/${rest.slice(0, rest[0].startsWith('@') ? 2 : 1).join('/')}`;
    }
    return file.split('/dist/').pop().split('/').slice(0, 3).join('/');
  };
  for (const [id, us] of self) {
    const f = byId.get(id).callFrame;
    const file = (f.url || '(native)').replace(/^file:\/\//, '');
    const key = `${f.functionName || '(anonymous)'} ${file.split('/').slice(-2).join('/')}:${f.lineNumber + 1}`;
    fns.set(key, (fns.get(key) ?? 0) + us);
    const mod = moduleOf(f.url);
    mods.set(mod, (mods.get(mod) ?? 0) + us);
  }
  const top = (m) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, us]) => ({ name: k, ms: us / 1000, pct: (100 * us) / total }));
  return { totalMs: total / 1000, functions: top(fns), modules: top(mods) };
}
const profDir = arg('--cpuprofile', '');
let cpu = null;
if (profDir && apiPid) {
  // the .cpuprofile is written when the API process exits: stop it gracefully (SIGINT runs its shutdown hooks) and wait for it to go
  process.kill(apiPid, 'SIGINT');
  for (let i = 0; i < 60; i++) {
    try {
      process.kill(apiPid, 0);
    } catch {
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (profDir && existsSync(profDir)) {
  const f = readdirSync(profDir)
    .filter((x) => x.endsWith('.cpuprofile'))
    .sort()
    .pop();
  if (f) cpu = topSelf(JSON.parse(readFileSync(join(profDir, f), 'utf8')));
}
if (cpu) writeFileSync(join(OUT, 'cpu-profile.json'), JSON.stringify(cpu, null, 1));

// --- report --------------------------------------------------------------------------------------------------------------------
const e = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
const f0 = (x) => (x == null || !Number.isFinite(x) ? '-' : Math.round(x).toLocaleString('en'));
const f1 = (x) => (x == null || !Number.isFinite(x) ? '-' : x.toFixed(1));
const line = (pts, w, h, color) => {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y1 = Math.max(...ys, 1);
  return `<polyline fill="none" stroke="${color}" stroke-width="1.6" points="${pts.map(([x, y]) => `${((x - x0) / (x1 - x0 || 1)) * w},${h - (y / y1) * h}`).join(' ')}"/>`;
};
const chart = (title, series, unit, xmax) =>
  `<div class="chart"><b>${e(title)}</b> <span class="mut">${unit}; peak ${series.map((s) => `${s.label} ${f1(Math.max(...s.pts.map((p) => p[1])))}`).join(', ')}</span><svg viewBox="0 0 600 120" width="100%" role="img" aria-label="${e(title)}">${series.map((s) => line(s.pts, 600, 120, s.color)).join('')}</svg><div class="mut">${series.map((s) => `<span style="color:${s.color}">&#9632;</span> ${s.label}`).join(' &nbsp; ')} &nbsp; (x: start to ${xmax})</div></div>`;
const heat = (v) =>
  v == null ? '' : `style="background:rgba(214,69,65,${Math.min(0.55, v / 3000)})"`;
const rssVals = samples.map((s) => s.apiRssMb).filter((v) => v != null);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Soak: all endpoints, ${MINUTES} min</title><style>:root{--bg:#fff;--fg:#1a1a1a;--mut:#666;--bd:#ddd;--hd:#f3f4f6}@media(prefers-color-scheme:dark){:root{--bg:#15171a;--fg:#e8e8e8;--mut:#9aa;--bd:#333;--hd:#20242a}}body{background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif;margin:0 auto;max-width:1200px;padding:16px}h1{font-size:22px}h2{font-size:17px;margin-top:26px}table{border-collapse:collapse;width:100%;font-size:12px;display:block;overflow-x:auto}th,td{border:1px solid var(--bd);padding:3px 6px;text-align:right;white-space:nowrap}th{background:var(--hd)}td.l,th.l{text-align:left;max-width:520px;overflow:hidden;text-overflow:ellipsis}.mut{color:var(--mut)}.card{border:1px solid var(--bd);border-radius:8px;padding:10px 14px;margin:10px 0}.chart{margin:12px 0}code{font:11px ui-monospace,monospace}</style></head><body>
<h1>Soak of every GET endpoint: ${MINUTES} minutes, load stepped from ${START_VUS} to ${MAX_VUS} users</h1>
<p class="mut">${e(result.generatedAt)}. ${working.length} routes answered 200 for the seeded workspace (100k contacts, 1M messages). Closed-loop users, no think time, random route per request. The API ran as one Node process (heap capped) next to Postgres, Redis and this load generator on ${result.machine.cpus} cores / ${result.machine.memGb} GB (${e(result.machine.model ?? '')}): a ranking and a trend, not a production number.</p>
<div class="card"><b>${f0(minutesTable.reduce((a, m) => a + m.requests, 0))} requests</b>, status ${e(JSON.stringify(codes))}. API RSS ${f0(Math.min(...rssVals))} to ${f0(Math.max(...rssVals))} MB${slope == null ? '' : `; slope after the first third of the run ${f1(slope)} MB/h (the load ramp inflates this: judge a leak on the last minutes at full load)`}. Peak API CPU ${f0(Math.max(0, ...samples.map((s) => s.apiCpu ?? 0)))} % (100 % is one core), peak Postgres CPU ${f0(Math.max(0, ...samples.map((s) => s.pgCpu ?? 0)))} %.</div>
<h2>Load, latency and resources by minute</h2>
<table><tr><th>Min</th><th>Users</th><th>Req/s</th><th>p50 ms</th><th>p95 ms</th><th>p99 ms</th><th>Errors</th><th>API RSS avg/max MB</th><th>API CPU avg/max %</th><th>PG CPU avg %</th><th>PG RSS MB</th><th>PG active max</th><th>Load 1m</th></tr>${minutesTable.map((m) => `<tr><td>${m.minute}</td><td>${m.vus}</td><td>${f1(m.rps)}</td><td>${f0(m.p50)}</td><td>${f0(m.p95)}</td><td>${f0(m.p99)}</td><td>${m.errors}</td><td>${f0(m.apiRssAvg)} / ${f0(m.apiRssMax)}</td><td>${f0(m.apiCpuAvg)} / ${f0(m.apiCpuMax)}</td><td>${f0(m.pgCpuAvg)}</td><td>${f0(m.pgRssAvg)}</td><td>${f0(m.pgActiveMax)}</td><td>${f1(m.load1)}</td></tr>`).join('')}</table>
${chart(
  'Throughput and p95 latency',
  [
    { label: 'req/s', color: '#2a6fdb', pts: minutesTable.map((m) => [m.minute, m.rps]) },
    {
      label: 'p95 ms (scaled to its own peak)',
      color: '#d64541',
      pts: minutesTable.map((m) => [m.minute, m.p95]),
    },
  ],
  'by minute',
  `${MINUTES} min`,
)}
${chart(
  'API memory and CPU',
  [
    {
      label: 'RSS MB',
      color: '#1b7f3b',
      pts: samples.filter((s) => s.apiRssMb != null).map((s) => [s.t, s.apiRssMb]),
    },
    {
      label: 'CPU %',
      color: '#9a6700',
      pts: samples.filter((s) => s.apiCpu != null).map((s) => [s.t, s.apiCpu]),
    },
  ],
  'every 5 s',
  `${MINUTES} min`,
)}
${chart(
  'Postgres CPU and active connections',
  [
    { label: 'CPU %', color: '#8250df', pts: samples.map((s) => [s.t, s.pgCpu]) },
    {
      label: 'active connections',
      color: '#555',
      pts: samples.filter((s) => s.pgActive != null).map((s) => [s.t, s.pgActive]),
    },
  ],
  'every 5 s',
  `${MINUTES} min`,
)}
<h2>What each API costs along the timeline</h2>
<p class="mut">Cost = server time spent answering (sum of latencies = how long that route kept connections busy), its share of all time, and p95 per minute (cells shade red towards 3 s). Top 40 of ${routeTable.length} routes by total time.</p>
<table><tr><th class="l">Route</th><th>Calls</th><th>Share %</th><th>Total s</th><th>Mean ms</th><th>p95 ms</th><th>p99 ms</th><th>Max ms</th><th>Err</th>${Array.from({ length: MINUTES }, (_, i) => `<th>m${i + 1}</th>`).join('')}</tr>${routeTable
  .slice(0, 40)
  .map(
    (r) =>
      `<tr><td class="l"><code>${e(r.route.replace('GET ', ''))}</code></td><td>${f0(r.calls)}</td><td>${f1((100 * r.totalMs) / grandTotal)}</td><td>${f1(r.totalMs / 1000)}</td><td>${f0(r.meanMs)}</td><td>${f0(r.p95)}</td><td>${f0(r.p99)}</td><td>${f0(r.maxMs)}</td><td>${r.errors}</td>${r.perMinuteP95.map((v) => `<td ${heat(v)}>${v == null ? '' : f0(v)}</td>`).join('')}</tr>`,
  )
  .join('')}</table>
<h2>CPU profile of the API (V8, self time)</h2>
${cpu ? `<p class="mut">${f0(cpu.totalMs)} ms of sampled time. "(native / idle)" is mostly the event loop waiting for work.</p><table><tr><th class="l">Module</th><th>ms</th><th>%</th></tr>${cpu.modules.map((m) => `<tr><td class="l"><code>${e(m.name)}</code></td><td>${f0(m.ms)}</td><td>${f1(m.pct)}</td></tr>`).join('')}</table><br><table><tr><th class="l">Function (file:line)</th><th>ms</th><th>%</th></tr>${cpu.functions.map((m) => `<tr><td class="l"><code>${e(m.name)}</code></td><td>${f0(m.ms)}</td><td>${f1(m.pct)}</td></tr>`).join('')}</table>` : '<p class="mut">No .cpuprofile found: start the API through tools/perf/soak-all.sh (it runs node with --cpu-prof and stops it gracefully so the profile is written).</p>'}
<h2>Database: statements by total time</h2>
<table><tr><th class="l">Statement</th><th>Calls</th><th>Mean ms</th><th>Total ms</th><th>Max ms</th><th>Rows</th></tr>${sqlRows.map((s) => `<tr><td class="l"><code>${e(s.query)}</code></td><td>${f0(s.calls)}</td><td>${f1(s.meanMs)}</td><td>${f0(s.totalMs)}</td><td>${f1(s.maxMs)}</td><td>${f0(s.rows)}</td></tr>`).join('')}</table>
</body></html>`;
writeFileSync(join(OUT, 'report.html'), html);
console.log(`report: ${join(OUT, 'report.html')}`);
