#!/usr/bin/env node
// Alertmanager -> local webhook: posts one critical alert (labels + annotations as in p0-failure-modes.rules.yml) to a private
// Alertmanager running the repo alertmanager.yml (destination swapped for a local receiver) and prints what the receiver got.
// Usage: node tools/alerting/webhook-delivery-check.mjs <workDir> <out.json>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [work, out] = process.argv.slice(2);
const ROOT = path.resolve(import.meta.dirname, '../..');
const AM = 59193,
  HOOK = 59194;
const name = `al76-am-${Math.random().toString(36).slice(2, 7)}`;
fs.mkdirSync(work, { recursive: true });
fs.writeFileSync(
  path.join(work, 'am.yml'),
  fs
    .readFileSync(path.join(ROOT, 'deploy/observability/alertmanager.yml'), 'utf8')
    .replaceAll('url_file: /run/secrets/alert_webhook_url', `url: http://localhost:${HOOK}/hook`),
);
const got = [];
const srv = http
  .createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      got.push(JSON.parse(b));
      res.end('ok');
    });
  })
  .listen(HOOK);
execFileSync('docker', ['run', '-d', '--name', name, '--network', 'host', '-v', `${work}:/c`, 'prom/alertmanager:v0.27.0', '--config.file=/c/am.yml', `--web.listen-address=:${AM}`, '--cluster.listen-address=', '--storage.path=/tmp/am']);
await new Promise((r) => setTimeout(r, 3000));
const alert = {
  labels: { alertname: 'RedisDown', severity: 'critical', service: 'api' },
  annotations: { summary: 'Redis INFO has failed for 2 minutes (seen by api)', runbook: 'docs/runbooks/p0-failure-modes.md#redisdown' },
};
await fetch(`http://localhost:${AM}/api/v2/alerts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([alert]) });
const t0 = Date.now();
while (!got.length && Date.now() - t0 < 40000) await new Promise((r) => setTimeout(r, 500));
const delivered = got.map((d) => ({
  status: d.status,
  receiver: d.receiver,
  alerts: d.alerts.map((a) => ({ alertname: a.labels.alertname, severity: a.labels.severity, runbook: a.annotations.runbook ?? null, hasSummary: Boolean(a.annotations.summary) })),
}));
const secondsToDelivery = got.length ? +((Date.now() - t0) / 1000).toFixed(1) : null;
fs.writeFileSync(out, JSON.stringify({ secondsToDelivery, delivered }, null, 2));
console.log(JSON.stringify({ secondsToDelivery, delivered }));
execFileSync('docker', ['rm', '-f', name]);
srv.close();
