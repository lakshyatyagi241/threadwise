// Real `next start` of the built web app with the monitor on (EL-B07, EL-B20, EL-B18): does it serve crm_* series, count the requests it
// answers by route template, stamp the release label, and does the listener rule hold?
//
//   pnpm --filter @crm/web build
//   node tools/event-loop-audit/web-metrics-check.mjs <absolute path of apps/web> <output.json>     # needs SWC_NATIVE_BINDING_CACHE on Windows
//
// Starts the built server five times (each start takes minutes on a slow disk) with different OBS_* settings and asks its own /metrics.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const webDir = process.argv[2];
const out = process.argv[3];
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  (${typeof detail === 'string' ? detail : JSON.stringify(detail)})`}`,
  );
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(label, env, fn) {
  console.log(`\n== ${label} ==`);
  let log = '';
  const child = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-p', '3011'],
    {
      cwd: webDir,
      env: { ...process.env, NODE_ENV: 'production', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  try {
    const end = Date.now() + 900_000;
    for (;;) {
      if (Date.now() > end) throw new Error(`web did not answer: ${log.slice(-400)}`);
      try {
        const r = await fetch('http://127.0.0.1:3011/robots.txt', {
          signal: AbortSignal.timeout(8000),
        });
        if (r.status > 0) break;
      } catch {
        /* not up yet */
      }
      await sleep(1500);
    }
    await fn(log);
  } finally {
    child.kill();
    await sleep(1500);
  }
}

const scrape = (token) =>
  fetch('http://127.0.0.1:9477/metrics', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

await run(
  'port set, loopback, no token',
  {
    OBS_METRICS_PORT: '9477',
    OBS_METRICS_HOST: '127.0.0.1',
    OBS_RUNTIME_INTERVAL_SECONDS: '5',
    OBS_RELEASE: 'bench-1.2',
  },
  async () => {
    const r0 = await fetch('http://127.0.0.1:3011/robots.txt');
    check(
      'the web server answers GET /robots.txt (the probe target)',
      r0.status === 200,
      r0.status,
    );
    // generate some traffic so a window has work in it
    for (let i = 0; i < 20; i++)
      await fetch('http://127.0.0.1:3011/robots.txt').catch(() => undefined);
    // a page, a 404 with a hostile-looking URL, a static-asset-shaped URL: three different templates
    // the bodies are read to the end: Next streams pages, and a response is only timed once it has finished
    const read = async (url) => {
      const r = await fetch(url).catch(() => undefined);
      await r?.text();
      return r;
    };
    const login = await read('http://127.0.0.1:3011/login');
    const gone = await read('http://127.0.0.1:3011/wp-admin/setup-config.php?x=1');
    const gone2 = await read('http://127.0.0.1:3011/definitely/not/a/route/12345');
    await sleep(12_000);
    const r = await scrape();
    check('GET /metrics answers 200 on loopback without a token', r.status === 200, r.status);
    const text = await r.text();
    check(
      'series carry service="web"',
      /crm_event_loop_delay_p99_seconds\{[^}]*service="web"/.test(text),
    );
    for (const m of [
      'crm_event_loop_delay_p99_seconds',
      'crm_event_loop_delay_max_seconds',
      'crm_event_loop_utilization_ratio',
      'crm_process_heap_used_bytes',
      'crm_process_rss_bytes',
      'crm_process_active_resources',
      'crm_runtime_last_report_timestamp_seconds',
      'crm_process_start_time_seconds',
    ]) {
      check(`${m} is exported`, new RegExp(`^${m}\\{`, 'm').test(text));
    }
    const p99 = /^crm_event_loop_delay_p99_seconds\{[^}]*\}\s+([0-9.e+-]+)/m.exec(text)?.[1];
    check(
      'an idle web loop reads in a sane range (under 0.5 s)',
      Number(p99) > 0 && Number(p99) < 0.5,
      `p99 ${p99} s`,
    );
    const counts = text
      .split('\n')
      .filter((l) => l.startsWith('crm_http_request_duration_seconds_count{'));
    const hasRoute = (route, status) =>
      counts.some(
        (l) => l.includes(`route="${route}"`) && (!status || l.includes(`status="${status}"`)),
      );
    const total = (route) =>
      Number(
        counts
          .find((l) => l.includes(`route="${route}"`))
          ?.split(' ')
          .pop() ?? 0,
      );
    check(
      'the request histogram counts /robots.txt under its route',
      hasRoute('/robots.txt', '2xx') && total('/robots.txt') >= 21,
      total('/robots.txt'),
    );
    if (login)
      check('a page request is counted under a template (login)', hasRoute('/login'), login.status);
    check(
      'a 404 is counted as "unmatched", not under its URL',
      gone.status === 404 &&
        gone2.status === 404 &&
        hasRoute('unmatched', '4xx') &&
        !counts.some((l) => l.includes('wp-admin') || l.includes('12345')),
      gone.status,
    );
    check('the metrics listener does not count its own requests', !hasRoute('/metrics'));
    check(
      'every series carries the release label',
      /crm_event_loop_delay_p99_seconds\{[^}]*release="bench-1.2"/.test(text) &&
        counts.every((l) => l.includes('release="bench-1.2"')),
    );
    const nf = await fetch('http://127.0.0.1:9477/other');
    check('only /metrics answers (404 elsewhere)', nf.status === 404, nf.status);
  },
);

await run(
  'non-loopback host WITHOUT a token: the listener must stay closed',
  { OBS_METRICS_PORT: '9477', OBS_METRICS_HOST: '0.0.0.0' },
  async (log) => {
    await sleep(3000);
    let reached = false;
    try {
      reached = (await scrape()).status > 0;
    } catch {
      reached = false;
    }
    check('nothing listens on the metrics port', !reached);
    check(
      'a warning says why',
      /not loopback, and OBS_METRICS_TOKEN is not set/.test(log),
      log.match(/metrics listener[^"]*/)?.[0],
    );
  },
);

await run(
  'non-loopback host WITH a token',
  {
    OBS_METRICS_PORT: '9477',
    OBS_METRICS_HOST: '0.0.0.0',
    OBS_METRICS_TOKEN: 'web-check-token-0123456789',
  },
  async () => {
    await sleep(3000);
    check('no token: 401', (await scrape()).status === 401);
    check('wrong token: 401', (await scrape('nope-nope-nope-nope-nope')).status === 401);
    check('right token: 200', (await scrape('web-check-token-0123456789')).status === 200);
  },
);

await run('port not set (the default): collects but does not listen', {}, async () => {
  await sleep(2000);
  let reached = false;
  try {
    reached = (await scrape()).status > 0;
  } catch {
    reached = false;
  }
  check('nothing listens', !reached);
});

await run(
  'switched off',
  { OBS_RUNTIME_MONITOR: 'false', OBS_METRICS_PORT: '9477', OBS_METRICS_HOST: '127.0.0.1' },
  async () => {
    await sleep(2000);
    let reached = false;
    try {
      reached = (await scrape()).status > 0;
    } catch {
      reached = false;
    }
    check('OBS_RUNTIME_MONITOR=false: nothing listens', !reached);
  },
);

writeFileSync(
  out,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, results }, null, 1)}\n`,
);
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} checks passed`);
process.exit(bad ? 1 : 0);
