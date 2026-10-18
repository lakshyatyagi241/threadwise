#!/usr/bin/env node
// Rehearses the two NATIVE Alertmanager receivers (EL-B14) against a real Alertmanager: the shipped alertmanager.slack.yml and
// alertmanager.pagerduty.yml run in prom/alertmanager, a stand-in for Slack / PagerDuty runs on this machine, and send-test-alert.mjs
// sends one test alert and then resolves it. It proves what Alertmanager sends and that the configs route; it does NOT prove that a live
// Slack, Discord or PagerDuty account accepts it (that needs the real URL or key, see the runbook).
//
//   node tools/event-loop-audit/rehearse-alert-receivers.mjs        # about 1 minute; needs Docker and the prom/alertmanager image
//
// The shipped files are used unchanged except: the notification delays are cut to a second or two, and for PagerDuty the Events API
// URL is pointed at the stand-in (the receiver has an `url` field for exactly that).
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTestAlert } from './send-test-alert.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const IMAGE = 'prom/alertmanager:v0.27.0';
const AM_PORT = 9094;
const STANDIN_PORT = 9191;
const work = mkdtempSync(join(tmpdir(), 'el-recv-'));
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

const received = [];
const standIn = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let body = Buffer.concat(chunks).toString('utf8');
    try {
      body = JSON.parse(body);
    } catch {
      /* keep the text */
    }
    received.push({ path: req.url, body });
    if (process.env.REHEARSE_DEBUG)
      console.log(
        '  stand-in got',
        req.url,
        JSON.stringify([
          body.attachments?.[0]?.title,
          body.attachments?.[0]?.fallback?.slice(0, 30),
          body.attachments?.[0]?.color,
        ]),
      );
    // Slack answers a plain "ok" (Alertmanager reads a JSON content type as {"ok": true}, fails to parse it and retries); PagerDuty answers JSON.
    const pd = req.url.startsWith('/pd');
    res.writeHead(200, { 'content-type': pd ? 'application/json' : 'text/plain' });
    res.end(pd ? '{"status":"success","message":"Event processed","dedup_key":"x"}' : 'ok');
  });
});
async function until(what, fn, ms = 40_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(500);
  }
  throw new Error(`timed out: ${what}`);
}
async function post(alerts) {
  const r = await fetch(`http://127.0.0.1:${AM_PORT}/api/v2/alerts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(alerts),
  });
  if (!r.ok) throw new Error(`Alertmanager answered ${r.status}`);
}
async function rehearse(kind, file, secret, tweak, isResolved) {
  received.length = 0;
  const dir = join(work, kind);
  mkdirSync(dir, { recursive: true });
  const cfg = readFileSync(join(root, 'deploy/observability', file), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace('group_wait: 30s', 'group_wait: 1s')
    .replace('group_interval: 5m', 'group_interval: 2s');
  writeFileSync(join(dir, 'alertmanager.yml'), tweak(cfg));
  writeFileSync(join(dir, 'secret'), secret);
  const name = `el-recv-${kind}`;
  try {
    docker('rm', '-f', name);
  } catch {
    /* none */
  }
  docker(
    'run',
    '-d',
    '--name',
    name,
    '-p',
    `${AM_PORT}:9093`,
    '-v',
    `${join(dir, 'alertmanager.yml')}:/etc/alertmanager/alertmanager.yml:ro`,
    '-v',
    `${join(dir, 'secret')}:/run/secrets/alert_webhook_url:ro`,
    IMAGE,
    '--config.file=/etc/alertmanager/alertmanager.yml',
    '--storage.path=/tmp/am',
  );
  try {
    await until('alertmanager ready', () => null, 0).catch(() => {});
    for (let i = 0; i < 40; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${AM_PORT}/-/ready`)).ok) break;
      } catch {
        /* starting */
      }
      await sleep(500);
    }
    await post(buildTestAlert({ lifetimeSeconds: 300 }));
    const firing = await until(`${kind}: the firing message`, () => received[0]);
    await post(buildTestAlert({ resolve: true }));
    const resolved = await until(`${kind}: the resolved message`, () =>
      received.slice(1).find(isResolved),
    );
    return { firing, resolved, count: received.length };
  } finally {
    try {
      docker('rm', '-f', name);
    } catch {
      /* gone */
    }
  }
}

try {
  await new Promise((r) => standIn.listen(STANDIN_PORT, '0.0.0.0', r));
  const stand = `http://host.docker.internal:${STANDIN_PORT}`;

  const slack = await rehearse(
    'slack',
    'alertmanager.slack.yml',
    `${stand}/slack`,
    (c) => c,
    (m) => /(resolved)/.test(m.body.attachments?.[0]?.title ?? ''),
  );
  const att = (m) => m.body.attachments?.[0] ?? {};
  check(
    'slack: the firing message reaches the webhook URL from the secret file',
    slack.firing.path === '/slack',
    slack.firing.path,
  );
  check(
    'slack: title names the alert and says firing',
    /EventLoopTestAlert \(firing\) test/.test(att(slack.firing).title),
    att(slack.firing).title,
  );
  check(
    'slack: text carries the summary',
    String(att(slack.firing).text).includes('Nothing is wrong'),
    att(slack.firing).text?.slice?.(0, 60),
  );
  check(
    'slack: the resolved message follows and says resolved',
    /\(resolved\)/.test(att(slack.resolved).title),
    att(slack.resolved).title,
  );

  const pd = await rehearse(
    'pagerduty',
    'alertmanager.pagerduty.yml',
    '0123456789abcdef0123456789abcdef',
    (c) =>
      c.replace('      - routing_key_file:', `      - url: ${stand}/pd\n        routing_key_file:`),
    (m) => m.body.event_action === 'resolve',
  );
  check(
    'pagerduty: the firing event is a trigger carrying the routing key from the file',
    pd.firing.body.event_action === 'trigger' &&
      pd.firing.body.routing_key === '0123456789abcdef0123456789abcdef',
    pd.firing.body.event_action,
  );
  check(
    'pagerduty: a warning stays a warning (only critical pages as critical)',
    pd.firing.body.payload?.severity === 'warning',
    pd.firing.body.payload?.severity,
  );
  check(
    'pagerduty: the description names the alert and its summary',
    /EventLoopTestAlert: .*Nothing is wrong/.test(pd.firing.body.payload?.summary ?? ''),
    pd.firing.body.payload?.summary?.slice?.(0, 70),
  );
  check(
    'pagerduty: the resolve event follows with the same dedup key',
    pd.resolved.body.event_action === 'resolve' &&
      pd.resolved.body.dedup_key === pd.firing.body.dedup_key,
    pd.resolved.body.event_action,
  );
} catch (err) {
  check(`rehearsal ran to the end (${err.message})`, false);
} finally {
  standIn.close();
  rmSync(work, { recursive: true, force: true });
}
const bad = results.filter((r) => !r.ok).length;
const out = join(root, 'reports/event-loop');
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'alert-receivers.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), image: IMAGE, results }, null, 1)}\n`,
);
console.log(
  `\n${results.length - bad}/${results.length} checks passed; written reports/event-loop/alert-receivers.json`,
);
process.exit(bad ? 1 : 0);
