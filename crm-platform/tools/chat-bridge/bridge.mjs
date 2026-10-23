// Alertmanager webhook (v4) -> Google Chat. HTTP: POST /alertmanager, GET /health, GET /metrics. Nothing is published outside the
// compose network. Delivery is synchronous so a failure returns 502 and Alertmanager retries on its own schedule.
import http from 'node:http';
import fs from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { CHANNELS, alertCard, channelFor, createMetrics, createSender, isTest, isWatchdog, routeFor, widgetsOf } from './lib.mjs';
import { diagnose, diagnosisRows, promQuery } from './diagnosis.mjs';
import { handleIncidents, loadToken } from './incidents-api.mjs';
import { createThreads, fmtDur } from './threads.mjs';
import { createChatApp } from './chat-app.mjs';

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
  const webhookSend = createSender({ urls, fetchImpl, metrics, log, baseMs: Number(env.CHAT_RETRY_BASE_MS ?? 500), retries: Number(env.CHAT_RETRIES ?? 3) });
  let app; const send = (...a) => (app?.enabled ? app.send : webhookSend)(...a); // CHAT_APP_ENABLED=true: post as the Chat app, webhook fallback per message
  const grafanaUrl = env.GRAFANA_URL ?? '', token = loadToken(env);
  const resolver = resolverFactory?.({ post: (...a) => send(...a), promQuery: (e) => promQuery(e, env, fetchImpl ?? fetch), metrics });
  app = createChatApp({ env, urls, fetchImpl, webhookSend, resolver, grafanaUrl, metrics, log });
  resolver?.setOwnerHook?.((id, owner) => app.syncCard?.(id, owner));
  // One thread per alert fingerprint: first firing = top-level card with diagnosis, repeats and resolve = replies in that thread.
  async function handleAlert(a) {
    if (isTest(a)) { // never an incident/resolver call; dropped unless TEST_ALERTS_CHANNEL opts in
      const ch = channelFor(a, env);
      if (ch === 'none') { metrics.dropped('test'); log({ evt: 'alert_test_dropped', alertname: a.labels?.alertname }); return { ok: true }; }
      return send(ch, alertCard(a, { grafanaUrl }));
    } // test=true: plain card, no thread/diagnosis/resolver/escalation, not an incident
    if (channelFor(a, env) === 'none') { metrics.dropped('not_routed'); log({ evt: 'alert_not_routed', alertname: a.labels?.alertname, severity: a.labels?.severity }); return { ok: true }; }
    const fp = a.fingerprint || createHash('sha1').update(JSON.stringify(a.labels ?? {})).digest('hex').slice(0, 16);
    const threadKey = `am-${fp}`, ch = channelFor(a, env), t0 = Date.parse(a.startsAt), known = threads.get(fp);
    const started = Number.isFinite(t0) && t0 > 0 ? t0 : known?.startedAt ?? Date.now(); // Alertmanager's startsAt survives a bridge restart
    const ev = await diagnose(a, { env }).catch(() => ({ entry: null, rows: [], value: null }));
    const peak = Math.max(known?.peak ?? -Infinity, ev.value ?? -Infinity);
    const peakTxt = Number.isFinite(peak) ? String(Number(peak.toPrecision(3))) : 'n/a';
    if (a.status === 'resolved') {
      const end = Date.parse(a.endsAt); const dur = fmtDur((Number.isFinite(end) && end > 0 ? end : Date.now()) - started);
      threads.delete(fp);
      const measured = ev.rows[0]?.[0] ?? a.annotations?.summary ?? a.labels?.alertname, durationMs = (Number.isFinite(end) && end > 0 ? end : Date.now()) - started;
      const extra = { measured, durationMs, ...(Number.isFinite(peak) ? { peak: peakTxt } : {}), ...(a.annotations?.threshold ? { threshold: a.annotations.threshold } : {}) };
      if (await resolver?.alertCleared?.(`am:${fp}`, extra)) return { ok: true }; // a PR was raised for it: RESOLVED names the PR (the card, or the thread reply in webhook mode)
      const inc = resolver?.byKey(`am:${fp}`);
      if (inc && inc.state === 'resolved') return { ok: true }; // the resolver already posted RESOLVED after verification
      if (app.enabled && await app.resolveCard(`am:${fp}`, { kind: 'self', at: Date.now(), ...extra })) return { ok: true }; // the one card is edited in place: no second message
      if (inc && inc.state === 'open') return send(ch, alertCard(a, { grafanaUrl, title: 'Alertmanager reports it cleared; resolver verification still running', extra: widgetsOf([['Note', 'RESOLVED is only posted after the verification passes']]) }), { threadKey });
      const owner = inc?.owner;
      const rows = [['What it means', ev.entry?.meaning ?? a.annotations?.summary ?? a.labels?.alertname], ['What it measured', measured], ['How long it lasted', dur], ['Peak vs threshold', `${peakTxt}${a.annotations?.threshold ? ` vs ${a.annotations.threshold}` : ' (threshold: see the alert rule)'}; sampled when the bridge saw it fire or repeat`], ['What cleared it', owner ? `No PR was recorded; ${owner} was working on it.` : 'Cleared on its own: no code change, no action taken by a person.'], ['Owner / next step', owner ? `${owner}. Next step: add a note on what was found.` : 'Nobody was assigned. Next step: none, unless it comes back; then claim it.'], ['Diagnosis at firing', known?.diag ?? 'not available (bridge restarted since it fired)']];
      return send(ch, alertCard(a, { grafanaUrl, title: `RESOLVED after ${dur}${inc ? '' : ' (cleared on its own, no action taken)'}`, extra: widgetsOf(rows) }), { threadKey });
    }
    const diag = ev.entry ? `${ev.entry.meaning} Most likely: ${ev.entry.causes[0]}.` : '';
    if (known) {
      threads.put(fp, { ...known, peak });
      if (app.enabled) return { ok: true }; // one message per incident: the card is the live view, no repeat reply
      const rows = [['Still firing for', fmtDur(Date.now() - started)], ...ev.rows];
      return send(ch, { text: `Still firing: ${a.labels?.alertname}`, cardsV2: [{ cardId: 'rep', card: { header: { title: `Still firing (${fmtDur(Date.now() - started)})` }, sections: [{ widgets: widgetsOf(rows) }] } }] }, { threadKey });
    }
    threads.put(fp, { threadKey, startedAt: started, peak, diag });
    // the FIRING card must be the thread parent: start the resolver (its replies) only after that post returned
    const card = await send(ch, alertCard(a, { grafanaUrl, extra: widgetsOf(diagnosisRows(a, ev)) }), { threadKey, interactive: { incidentId: resolver?.byKey(`am:${fp}`)?.id ?? `am:${fp}`, firedAt: started } });
    if (resolver && (ev.entry || a.labels?.severity === 'critical')) { // a critical alert ALWAYS opens an incident, even a brand-new rule with no runbook entry yet
      const pool = /^DbPool/.test(a.labels?.alertname);
      resolver.handle({ playbook: pool ? 'db_pool' : 'service', alertname: a.labels?.alertname, action: a.labels?.alertname, key: `am:${fp}`, threadKey, channel: ch, diagnosis: diag, suggestion: ev.entry?.action ?? 'No runbook entry for this alert yet: add one in tools/chat-bridge/diagnosis.mjs', evidence: ev.rows.map(([k, v]) => `${k}: ${v}`).join('; ') || 'n/a', verify: async () => true });
    }
    return card;
  }
  const server = http.createServer(async (req, res) => {
    const end = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(body); };
    if (req.method === 'GET' && req.url === '/health') return end(200, '{"ok":true}');
    if (req.method === 'GET' && req.url === '/metrics') return end(200, metrics.render(), 'text/plain; version=0.0.4');
    if (req.method === 'POST' && req.url === '/route-check') { // read-only: where would this alert go? Posts nothing, touches no state.
      let b = ''; for await (const c of req) { b += c; if (b.length > 20000) return end(413, '{}'); }
      let j; try { j = JSON.parse(b); } catch { return end(400, '{"error":"bad json"}'); }
      const labels = j.labels ?? { ...(j.kind === 'slow_query' ? { group: 'slow_query' } : {}), ...(j.severity ? { severity: j.severity } : {}), ...(j.test ? { test: 'true' } : {}) };
      return end(200, JSON.stringify(routeFor({ labels }, env)));
    }
    if (req.url?.startsWith('/incidents') && await handleIncidents(req, res, { resolver, token, log })) return;
    if (req.method === 'POST' && req.url === '/release') { // called by the release watcher: {"sha","prs":[n],"at"}; token-protected. Only incidents whose PR is in prs move to released.
      const given = req.headers['x-incident-token'];
      if (!token || typeof given !== 'string' || !timingSafeEqual(createHash('sha256').update(given).digest(), createHash('sha256').update(token).digest())) return end(401, '{"error":"unauthorized"}');
      let b = ''; for await (const c of req) { b += c; if (b.length > 20000) return end(413, '{}'); }
      let j; try { j = JSON.parse(b); } catch { return end(400, '{}'); }
      if (!/^[0-9a-f]{7,40}$/i.test(j?.sha ?? '') || (j.prs != null && !(Array.isArray(j.prs) && j.prs.length <= 100 && j.prs.every((n) => Number.isInteger(n) && n > 0)))) return end(400, '{"error":"bad sha or prs"}');
      await resolver?.setRelease(j.sha, j.prs ?? []); return end(200, '{"ok":true}');
    }
    if (app.enabled && req.url === '/chat-app/events') return app.handleHttp(req, res);
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
  const sweep = resolver && setInterval(() => resolver.sweepClaims?.().catch(() => {}), 60_000); sweep?.unref();
  server.on('close', () => clearInterval(sweep));
  return { server, metrics, send, log, resolver };
}
