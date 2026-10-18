#!/usr/bin/env node
// Sends ONE test alert through a running Alertmanager and resolves it, so the real destination (webhook, Slack/Discord, PagerDuty) can be
// seen to accept what Alertmanager sends (EL-B14). It posts to Alertmanager's own API; it never touches the destination directly, so the
// destination URL or key stays where observability-up.sh put it (a compose secret).
//
//   # on the host, Alertmanager is not published: run it inside the container
//   docker compose -f docker-compose.yml -f observability.compose.yml exec alertmanager \
//     wget -qO- --post-data "$(node ../../tools/event-loop-audit/send-test-alert.mjs --print)" \
//     --header 'Content-Type: application/json' http://localhost:9093/api/v2/alerts
//   # or, with Alertmanager reachable (an SSH tunnel to 9093, or a local one):
//   node tools/event-loop-audit/send-test-alert.mjs --url=http://localhost:9093
//   node tools/event-loop-audit/send-test-alert.mjs --url=http://localhost:9093 --resolve    # send the "resolved" message now
//
// The alert is named EventLoopTestAlert with severity=warning and service=test, so it is never confused with a real one. It is sent with
// a short endsAt: even if nobody resolves it, it resolves by itself after --lifetime seconds (default 90). Alertmanager waits
// group_wait (30 s in the shipped files) before it notifies, so a "firing" message arrives after about 30 s and "resolved" after the
// lifetime plus the next group_interval.
import { pathToFileURL } from 'node:url';

export function buildTestAlert({ now = Date.now(), lifetimeSeconds = 90, resolve = false } = {}) {
  const startsAt = new Date(now - (resolve ? 120_000 : 0)).toISOString();
  const endsAt = new Date(now + (resolve ? -1000 : lifetimeSeconds * 1000)).toISOString();
  return [
    {
      labels: {
        alertname: 'EventLoopTestAlert',
        severity: 'warning',
        service: 'test',
        instance: 'send-test-alert',
      },
      annotations: {
        summary:
          'Test alert from tools/event-loop-audit/send-test-alert.mjs. Nothing is wrong; this checks the alert path.',
      },
      startsAt,
      endsAt,
      generatorURL: 'http://send-test-alert.invalid/',
    },
  ];
}

async function main() {
  const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
  const alerts = buildTestAlert({
    lifetimeSeconds: Number(arg('lifetime', 90)),
    resolve: process.argv.includes('--resolve'),
  });
  if (process.argv.includes('--print')) {
    process.stdout.write(JSON.stringify(alerts));
    return;
  }
  const base = arg('url', 'http://localhost:9093').replace(/\/$/, '');
  const res = await fetch(`${base}/api/v2/alerts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(alerts),
  });
  if (!res.ok) {
    console.error(`Alertmanager answered ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  console.log(`sent EventLoopTestAlert to ${base} (status ${res.status})`);
  console.log(
    'Check the destination: the firing message arrives after group_wait (30 s), the resolved one after the alert ends.',
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
