// Alertmanager webhook (v4) -> Google Chat. HTTP: POST /alertmanager, GET /health, GET /metrics. Nothing is published outside the
// compose network. Delivery is synchronous so a failure returns 502 and Alertmanager retries on its own schedule.
import http from 'node:http';
import fs from 'node:fs';
import { CHANNELS, createMetrics, createSender, formatAlertmanager, isWatchdog } from './lib.mjs';

export function loadUrls(env = process.env) {
  const urls = {};
  for (const c of CHANNELS) {
    const v = env[`GCHAT_${c.toUpperCase()}_URL`] ?? safeRead(`${env.GCHAT_SECRETS_DIR ?? '/run/secrets'}/gchat_${c === 'slowquery' ? 'slowquery' : c}_url`);
    if (v) urls[c] = v.trim();
  }
  return urls;
}
const safeRead = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

export function startBridge({ env = process.env, urls = loadUrls(env), fetchImpl, metrics = createMetrics(), log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o })) } = {}) {
  // Guard: a typo must never send alert text to another host. Tests opt out with CHAT_ALLOW_ANY_HOST=1 and a local fake receiver.
  for (const [c, u] of Object.entries(urls)) if (!/^https:\/\/chat\.googleapis\.com\//.test(u) && env.CHAT_ALLOW_ANY_HOST !== '1') { delete urls[c]; log({ evt: 'chat_url_rejected', channel: c }); }
  const send = createSender({ urls, fetchImpl, metrics, log, baseMs: Number(env.CHAT_RETRY_BASE_MS ?? 500), retries: Number(env.CHAT_RETRIES ?? 3) });
  const server = http.createServer(async (req, res) => {
    const end = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(body); };
    if (req.method === 'GET' && req.url === '/health') return end(200, '{"ok":true}');
    if (req.method === 'GET' && req.url === '/metrics') return end(200, metrics.render(), 'text/plain; version=0.0.4');
    if (req.method !== 'POST' || !/^\/(alertmanager)?$/.test(req.url ?? '')) return end(404, '{}');
    let raw = '';
    for await (const c of req) { raw += c; if (raw.length > 2_000_000) return end(413, '{}'); }
    let payload;
    try { payload = JSON.parse(raw); } catch { return end(400, '{"error":"bad json"}'); }
    metrics.received();
    const alerts = payload.alerts ?? [];
    if (alerts.some(isWatchdog)) { metrics.watchdog(); metrics.dropped(); }
    const msgs = formatAlertmanager(payload, { grafanaUrl: env.GRAFANA_URL ?? '' });
    let ok = true;
    for (const [ch, list] of Object.entries(msgs)) for (const m of list) ok = (await send(ch, m)).ok && ok;
    log({ evt: 'am_webhook', alerts: alerts.length, delivered: ok });
    end(ok ? 200 : 502, JSON.stringify({ ok }));
  });
  return { server, metrics, send, log };
}
