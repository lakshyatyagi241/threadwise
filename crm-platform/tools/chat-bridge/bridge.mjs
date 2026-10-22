// Alertmanager webhook (v4) -> Google Chat. HTTP: POST /alertmanager, GET /health, GET /metrics. Nothing is published outside the
// compose network. Delivery is synchronous so a failure returns 502 and Alertmanager retries on its own schedule.
import http from 'node:http';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { CHANNELS, alertCard, channelFor, createMetrics, createSender, isWatchdog, widgetsOf } from './lib.mjs';
import { diagnose, diagnosisRows, promQuery } from './diagnosis.mjs';
import { createThreads, fmtDur } from './threads.mjs';

export function loadUrls(env = process.env) {
  const urls = {};
  for (const c of CHANNELS) {
    const v = env[`GCHAT_${c.toUpperCase()}_URL`] ?? safeRead(`${env.GCHAT_SECRETS_DIR ?? '/run/secrets'}/gchat_${c}_url`);
    if (v) urls[c] = v.trim();
  }
  return urls;
}
const safeRead = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

export function startBridge({ env = process.env, urls = loadUrls(env), fetchImpl, metrics = createMetrics(), resolverFactory, threads = createThreads(), log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o })) } = {}) {
  // Guard: a typo must never send alert text to another host. Tests opt out with CHAT_ALLOW_ANY_HOST=1 and a local fake receiver.
  for (const [c, u] of Object.entries(urls)) if (!/^https:\/\/chat\.googleapis\.com\//.test(u) && env.CHAT_ALLOW_ANY_HOST !== '1') { delete urls[c]; log({ evt: 'chat_url_rejected', channel: c }); }
  const send = createSender({ urls, fetchImpl, metrics, log, baseMs: Number(env.CHAT_RETRY_BASE_MS ?? 500), retries: Number(env.CHAT_RETRIES ?? 3) });
  const grafanaUrl = env.GRAFANA_URL ?? '';
  const resolver = resolverFactory?.({ post: (...a) => send(...a), promQuery: (e) => promQuery(e, env, fetchImpl ?? fetch), metrics });
  // One thread per alert fingerprint: first firing = top-level card with diagnosis, repeats and resolve = replies in that thread.
  async function handleAlert(a) {
    const fp = a.fingerprint || createHash('sha1').update(JSON.stringify(a.labels ?? {})).digest('hex').slice(0, 16);
    const threadKey = `am-${fp}`, ch = channelFor(a), t0 = Date.parse(a.startsAt), known = threads.get(fp);
    const started = Number.isFinite(t0) && t0 > 0 ? t0 : known?.startedAt ?? Date.now(); // Alertmanager's startsAt survives a bridge restart
    const ev = await diagnose(a, { env }).catch(() => ({ entry: null, rows: [], value: null }));
    const peak = Math.max(known?.peak ?? -Infinity, ev.value ?? -Infinity);
    const peakTxt = Number.isFinite(peak) ? String(Number(peak.toPrecision(3))) : 'n/a';
    if (a.status === 'resolved') {
      const end = Date.parse(a.endsAt); const dur = fmtDur((Number.isFinite(end) && end > 0 ? end : Date.now()) - started);
      threads.delete(fp);
      const inc = resolver?.byKey(`am:${fp}`);
      if (inc && inc.state === 'resolved') return { ok: true }; // the resolver already posted RESOLVED after verification
      if (inc && inc.state === 'open') return send(ch, alertCard(a, { grafanaUrl, title: 'Alertmanager reports it cleared; resolver verification still running', extra: widgetsOf([['Note', 'RESOLVED is only posted after the verification passes']]) }), { threadKey });
      const rows = [['What it was', a.annotations?.summary ?? a.labels?.alertname], ['Peak value seen', `${peakTxt} (sampled when the bridge saw it fire or repeat)`], ['Diagnosis at firing', known?.diag ?? 'not available (bridge restarted since it fired)'], ['Value now', ev.value == null ? 'n/a' : String(Number(ev.value.toPrecision(3)))]];
      return send(ch, alertCard(a, { grafanaUrl, title: `RESOLVED after ${dur}${inc ? '' : ' (cleared on its own, no action taken)'}`, extra: widgetsOf(rows) }), { threadKey });
    }
    const diag = ev.entry ? `${ev.entry.meaning} Most likely: ${ev.entry.causes[0]}.` : '';
    if (known) {
      threads.put(fp, { ...known, peak });
      const rows = [['Still firing for', fmtDur(Date.now() - started)], ...ev.rows];
      return send(ch, { text: `Still firing: ${a.labels?.alertname}`, cardsV2: [{ cardId: 'rep', card: { header: { title: `Still firing (${fmtDur(Date.now() - started)})` }, sections: [{ widgets: widgetsOf(rows) }] } }] }, { threadKey });
    }
    threads.put(fp, { threadKey, startedAt: started, peak, diag });
    if (resolver && ev.entry) {
      const pool = /^DbPool/.test(a.labels?.alertname);
      resolver.handle({ playbook: pool ? 'db_pool' : 'service', action: a.labels?.alertname, key: `am:${fp}`, threadKey, channel: ch, diagnosis: diag, suggestion: ev.entry.action, evidence: ev.rows.map(([k, v]) => `${k}: ${v}`).join('; ') || 'n/a', verify: async () => true });
    }
    return send(ch, alertCard(a, { grafanaUrl, extra: widgetsOf(diagnosisRows(a, ev)) }), { threadKey });
  }
  const server = http.createServer(async (req, res) => {
    const end = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(body); };
    if (req.method === 'GET' && req.url === '/health') return end(200, '{"ok":true}');
    if (req.method === 'GET' && req.url === '/metrics') return end(200, metrics.render(), 'text/plain; version=0.0.4');
    if (req.method === 'GET' && req.url === '/incidents') return end(200, JSON.stringify({ mode: resolver?.mode ?? 'off', incidents: resolver?.list() ?? [] }));
    if (req.method === 'POST' && req.url === '/release') { // called by the deploy step: {"sha":"abc123"}; lets code-fix incidents resolve "by release"
      let b = ''; for await (const c of req) b += c; try { resolver?.setRelease(JSON.parse(b).sha); } catch { return end(400, '{}'); } return end(200, '{"ok":true}');
    }
    if (req.method !== 'POST' || !/^\/(alertmanager)?$/.test(req.url ?? '')) return end(404, '{}');
    let raw = '';
    for await (const c of req) { raw += c; if (raw.length > 2_000_000) return end(413, '{}'); }
    let payload;
    try { payload = JSON.parse(raw); } catch { return end(400, '{"error":"bad json"}'); }
    metrics.received();
    const alerts = payload.alerts ?? [];
    if (alerts.some(isWatchdog)) { metrics.watchdog(); metrics.dropped(); }
    let ok = true;
    for (const a of alerts) if (!isWatchdog(a)) ok = (await handleAlert(a)).ok && ok;
    log({ evt: 'am_webhook', alerts: alerts.length, delivered: ok });
    end(ok ? 200 : 502, JSON.stringify({ ok }));
  });
  return { server, metrics, send, log, resolver };
}
