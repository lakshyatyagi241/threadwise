#!/usr/bin/env node
// Rehearses how Prometheus finds the blue-green slots (EL-B02): the shipped deploy/observability/prometheus.yml against containers that
// carry the network aliases deploy/hostinger/docker-compose.yml gives the API and web slots. No app image and no database: each "slot"
// is a tiny HTTP server answering /metrics, which is all discovery needs.
//
//   node tools/event-loop-audit/rehearse-slot-discovery.mjs        # about 2 minutes; needs Docker and the prom/prometheus image
//
// It checks what a release does to the targets: both slots running (during a switch) are two targets; the idle slot stopped is NOT a
// down target and raises no TargetDown; the slot coming back is found again. This is the reason the API and web jobs use DNS service
// discovery on a shared alias instead of two static addresses, one of which would be down all the time.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const IMAGE = 'prom/prometheus:v2.55.0';
const NET = 'el-slot-net';
const PORT = 9098;
const work = mkdtempSync(join(tmpdir(), 'el-slots-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (...a) =>
  execFileSync('docker', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  (${typeof detail === 'string' ? detail : JSON.stringify(detail)})`}`,
  );
};
const made = [];
const slot = (name, alias) => {
  docker('rm', '-f', name);
  docker(
    'run',
    '-d',
    '--name',
    name,
    '--network',
    NET,
    '--network-alias',
    alias,
    '--entrypoint',
    'sh',
    IMAGE,
    '-c',
    `mkdir -p /tmp/www && printf '# TYPE crm_event_loop_delay_p99_seconds gauge\\ncrm_event_loop_delay_p99_seconds{service="${alias}"} 0.01\\n' > /tmp/www/metrics && exec httpd -f -p 9464 -h /tmp/www`,
  );
  made.push(name);
};
function cleanup() {
  for (const n of [...made, 'el-slot-prom']) {
    try {
      docker('rm', '-f', n);
    } catch {
      /* gone */
    }
  }
  try {
    docker('network', 'rm', NET);
  } catch {
    /* gone */
  }
  rmSync(work, { recursive: true, force: true });
}
const targets = async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/v1/targets`);
  return (await r.json()).data.activeTargets.map((t) => ({
    job: t.labels.job,
    health: t.health,
    at: t.scrapeUrl,
  }));
};
const byJob = (ts, job) => ts.filter((t) => t.job === job);
async function until(what, fn, ms = 120_000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(2000);
  }
  throw new Error(`timed out: ${what}${last ? ` (${last.message})` : ''}`);
}

try {
  try {
    docker('network', 'rm', NET);
  } catch {
    /* none */
  }
  docker('network', 'create', NET);
  // The same arrangement as production: the API in two slots (blue and green, one alias), the web server in one, a worker and a probe.
  slot('el-slot-api-blue', 'api');
  slot('el-slot-api-green', 'api');
  slot('el-slot-web-blue', 'web');
  slot('el-slot-worker', 'worker');
  slot('el-slot-probe', 'probe');

  const cfgDir = join(work, 'prom');
  mkdirSync(cfgDir);
  writeFileSync(join(cfgDir, 'metrics-token'), 'a-token-for-the-rehearsal-only');
  writeFileSync(
    join(cfgDir, 'prometheus.yml'),
    readFileSync(join(root, 'deploy/observability/prometheus.yml'), 'utf8')
      .replace(/\r\n/g, '\n')
      .replace('scrape_interval: 15s', 'scrape_interval: 5s')
      .replace('evaluation_interval: 15s', 'evaluation_interval: 5s')
      .replaceAll('/run/secrets/obs_metrics_token', '/etc/prometheus/metrics-token')
      // discovery re-reads DNS every 30 s by default; the rehearsal does not wait that long
      .replaceAll(
        'type: A\n        port: 9464',
        'type: A\n        port: 9464\n        refresh_interval: 5s',
      ),
  );
  writeFileSync(
    join(cfgDir, 'event-loop.rules.yml'),
    readFileSync(join(root, 'deploy/observability/event-loop.rules.yml'), 'utf8'),
  );
  docker('rm', '-f', 'el-slot-prom');
  docker(
    'run',
    '-d',
    '--name',
    'el-slot-prom',
    '--network',
    NET,
    '-p',
    `${PORT}:9090`,
    '-v',
    `${cfgDir}:/etc/prometheus:ro`,
    IMAGE,
    '--config.file=/etc/prometheus/prometheus.yml',
  );
  await until(
    'prometheus ready',
    async () => (await fetch(`http://127.0.0.1:${PORT}/-/ready`)).ok,
    60_000,
  );

  // 1. a release is in progress: both API slots run
  const both = await until('both API slots found and up', async () => {
    const t = await targets();
    return byJob(t, 'crm-api').length === 2 &&
      t.filter((x) => x.job !== 'crm-api').length >= 3 &&
      t.every((x) => x.health === 'up')
      ? t
      : null;
  });
  check(
    'both API slots are two targets, all up',
    byJob(both, 'crm-api').length === 2 && both.every((t) => t.health === 'up'),
    both.map((t) => `${t.job}=${t.health}`).join(' '),
  );
  check(
    'the web server, the worker and the probe are found by their names',
    ['crm-web', 'crm-worker', 'crm-probe'].every((j) => byJob(both, j).length === 1),
  );

  // 2. the old slot is stopped after the switch: it must disappear, not turn into a down target
  docker('stop', 'el-slot-api-green');
  const one = await until('the stopped slot to leave the target list', async () => {
    const t = await targets();
    return byJob(t, 'crm-api').length === 1 ? t : null;
  });
  check('the stopped slot is not a target at all', byJob(one, 'crm-api').length === 1);
  check(
    'every remaining target is up',
    one.every((t) => t.health === 'up'),
    one.map((t) => `${t.job}=${t.health}`).join(' '),
  );
  // Between the stop and the next DNS refresh the old address can fail one scrape (up == 0 for a moment). The alert waits 2 minutes
  // (RuntimeMetricsTargetDown "for: 2m") and the refresh is 30 s by default (5 s here), so it must clear long before that.
  const q = async (expr) =>
    (
      await (
        await fetch(`http://127.0.0.1:${PORT}/api/v1/query?query=${encodeURIComponent(expr)}`)
      ).json()
    ).data.result;
  const t0 = Date.now();
  await until(
    '"up == 0" to clear after the slot left',
    async () => (await q('up{job=~"crm-(api|worker|web|probe)"} == 0')).length === 0,
    60_000,
  );
  const clearedAfter = Math.round((Date.now() - t0) / 1000);
  check(
    '"up == 0" (what RuntimeMetricsTargetDown watches) clears, well inside its 2 minute "for"',
    clearedAfter < 30,
    `${clearedAfter}s after the targets list changed`,
  );
  const alerts = await (await fetch(`http://127.0.0.1:${PORT}/api/v1/alerts`)).json();
  check(
    'no alert is firing',
    alerts.data.alerts.filter((a) => a.state === 'firing').length === 0,
    alerts.data.alerts.map((a) => `${a.labels.alertname}:${a.state}`).join(' ') || 'none',
  );

  // 3. the next release brings a slot back (a new container): found again
  slot('el-slot-api-green2', 'api');
  const again = await until('the returning slot to be found', async () => {
    const t = await targets();
    return byJob(t, 'crm-api').length === 2 && t.every((x) => x.health === 'up') ? t : null;
  });
  check('a slot that comes back is found again, up', byJob(again, 'crm-api').length === 2);
} catch (err) {
  check(`rehearsal ran to the end (${err.message})`, false);
  try {
    console.log('targets at failure:', JSON.stringify(await targets()));
    const l = spawnSync('docker', ['logs', '--tail', '15', 'el-slot-prom'], { encoding: 'utf8' });
    console.log(l.stdout + l.stderr);
  } catch {
    /* diagnostics only */
  }
} finally {
  cleanup();
}
const bad = results.filter((r) => !r.ok).length;
const out = join(root, 'reports/event-loop');
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'slot-discovery.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), image: IMAGE, results }, null, 1)}\n`,
);
console.log(
  `\n${results.length - bad}/${results.length} checks passed; written reports/event-loop/slot-discovery.json (copy to docs/performance/event-loop/evidence/ to keep)`,
);
process.exit(bad ? 1 : 0);
