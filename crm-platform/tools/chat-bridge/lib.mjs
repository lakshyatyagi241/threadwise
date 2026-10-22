// Pure helpers for the Google Chat bridge and the slow-query watcher: sanitizer, router, formatter, sender, dedup, rate limit.
// No dependencies. Webhook URLs are secrets: nothing here logs or returns them.

export const CHANNELS = ['critical', 'slowquery', 'deploy'];
const MAX_TEXT = 3500; // Chat caps a message text at 4096 chars; cards are counted by the text they hold, keep a margin.
const MAX_WIDGETS = 40;

const trunc = (s, n) => (s == null ? '' : String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

// Strips every literal from SQL: strings (incl. E'' and dollar-quoted), comments, numbers. Placeholders $1 stay.
// shortcut: regex, not a SQL parser; a literal split by an unterminated quote is cut at the quote and the rest dropped, never leaked.
export function sanitizeSql(sql, max = 800) {
  let s = String(sql ?? '');
  s = s.replace(/\/\*[\s\S]*?(\*\/|$)/g, ' ').replace(/--[^\n]*/g, ' ');
  s = s.replace(/(\$[A-Za-z_]*\$)[\s\S]*?(\1|$)/g, '?');
  s = s.replace(/[eEbBxXnN]?'(?:[^']|'')*('|$)/g, '?');
  s = s.replace(/(?<![\w$.])0[xX][0-9a-fA-F]+\b|(?<![\w$.])\d+(?:\.\d*)?(?:[eE][+-]?\d+)?\b/g, '?');
  s = s.replace(/\(\s*\?(?:\s*,\s*\?)+\s*\)/g, '(?)'); // IN lists
  return trunc(s.replace(/\s+/g, ' ').trim(), max);
}

export function isWatchdog(a) {
  return a?.labels?.alertname === 'Watchdog';
}

export function channelFor(a) {
  return a?.labels?.severity === 'critical' ? 'critical' : 'slowquery';
}

const ICON = { critical: '🔴', warning: '🟠', info: '🔵', resolved: '✅' };
const fmtTime = (t) => (t && !String(t).startsWith('0001') ? String(t).replace('T', ' ').replace(/\.\d+/, '').replace('Z', ' UTC') : '');

function alertWidgets(a, grafanaUrl) {
  const l = a.labels ?? {}, n = a.annotations ?? {};
  const resolved = a.status === 'resolved';
  const icon = resolved ? ICON.resolved : ICON[l.severity] ?? ICON.warning;
  const where = [l.instance, l.job].filter(Boolean).join(' / ');
  const w = [
    { textParagraph: { text: `<b>${icon} ${esc(trunc(l.alertname ?? 'alert', 120))}</b> (${resolved ? 'resolved' : 'firing'}${l.severity ? `, ${esc(l.severity)}` : ''})` } },
  ];
  if (n.summary) w.push({ decoratedText: { topLabel: 'Summary', text: esc(trunc(n.summary, 400)), wrapText: true } });
  if (n.description) w.push({ decoratedText: { topLabel: 'Description', text: esc(trunc(n.description, 600)), wrapText: true } });
  if (where) w.push({ decoratedText: { topLabel: 'Instance / job', text: esc(trunc(where, 200)) } });
  const t = [`started ${fmtTime(a.startsAt)}`, resolved && fmtTime(a.endsAt) ? `ended ${fmtTime(a.endsAt)}` : ''].filter(Boolean).join(', ');
  if (t) w.push({ decoratedText: { topLabel: 'Time', text: t } });
  const buttons = [];
  if (n.runbook_url || n.runbook) buttons.push({ text: 'Runbook', onClick: { openLink: { url: safeUrl(n.runbook_url ?? n.runbook) } } });
  const g = n.dashboard_url ?? (grafanaUrl ? `${grafanaUrl.replace(/\/$/, '')}/alerting/list` : '');
  if (g) buttons.push({ text: 'Grafana', onClick: { openLink: { url: safeUrl(g) } } });
  const valid = buttons.filter((b) => b.onClick.openLink.url);
  if (valid.length) w.push({ buttonList: { buttons: valid } });
  w.push({ divider: {} });
  return w;
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const safeUrl = (u) => (/^https?:\/\//.test(String(u ?? '')) ? String(u).slice(0, 500) : ''); // runbook annotations are repo paths in this repo: no link then

const size = (ws) => JSON.stringify(ws).length;

// -> { critical: [msg...], slowquery: [...] }; each msg is a Chat cardsV2 message body under the size limits.
export function formatAlertmanager(payload, { grafanaUrl = '' } = {}) {
  const per = {};
  for (const a of payload?.alerts ?? []) {
    if (isWatchdog(a)) continue;
    (per[channelFor(a)] ??= []).push(a);
  }
  const out = {};
  for (const [ch, alerts] of Object.entries(per)) {
    out[ch] = [];
    let cur = [], len = 0;
    const flush = () => {
      if (!cur.length) return;
      const firing = cur.filter((a) => a.status !== 'resolved').length;
      const head = `${firing ? `${firing} firing` : ''}${firing && cur.length > firing ? ', ' : ''}${cur.length > firing ? `${cur.length - firing} resolved` : ''}`;
      const widgets = cur.flatMap((a) => alertWidgets(a, grafanaUrl));
      out[ch].push({
        text: trunc(`${head}: ${[...new Set(cur.map((a) => a.labels?.alertname))].join(', ')}`, 300),
        cardsV2: [{ cardId: `am-${out[ch].length}`, card: { header: { title: trunc(head, 100), subtitle: 'Threadwise alerts' }, sections: [{ widgets: widgets.slice(0, MAX_WIDGETS * 3) }] } }],
      });
      cur = []; len = 0;
    };
    for (const a of alerts) {
      const l = size(alertWidgets(a, grafanaUrl));
      if (cur.length && (len + l > MAX_TEXT * 4 || cur.length >= 8)) flush();
      cur.push(a); len += l;
    }
    flush();
  }
  return out;
}

// One card for ONE alert (so each alert can have its own thread). extra = widgets appended before the buttons (diagnosis).
export function alertCard(a, { grafanaUrl = '', extra = [], title } = {}) {
  const resolved = a.status === 'resolved';
  const widgets = [...alertWidgets(a, grafanaUrl), ...extra].slice(0, MAX_WIDGETS * 3);
  const name = trunc(a.labels?.alertname ?? 'alert', 120);
  return { text: trunc(`${title ?? (resolved ? 'resolved' : 'firing')}: ${name}`, 300), cardsV2: [{ cardId: 'am-1', card: { header: { title: trunc(title ?? `${resolved ? 'RESOLVED' : 'FIRING'}: ${name}`, 100), subtitle: 'Threadwise alerts' }, sections: [{ widgets }] } }] };
}
export const widgetsOf = (rows) => rows.map(([k, v]) => ({ decoratedText: { topLabel: k, text: esc(trunc(v, 700)), wrapText: true } }));

export function textMessage(text) {
  return { text: trunc(text, 4000) };
}

// Sender: post(channel, body) -> { ok, status, attempts }. Retries 429/5xx/network errors with backoff, never throws, never exposes the URL.
export function createSender({ urls, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), metrics, retries = 3, baseMs = 500, timeoutMs = 5000, log = () => {} }) {
  // opts.threadKey: post into that thread (Chat webhook ?threadKey + body.thread.threadKey); a missing thread falls back to a new one.
  return async function post(channel, body, opts = {}) {
    let url = urls[channel];
    if (url && opts.threadKey) {
      const u = new URL(url); u.searchParams.set('threadKey', opts.threadKey); u.searchParams.set('messageReplyOption', 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD');
      url = u.toString(); body = { ...body, thread: { threadKey: opts.threadKey } };
    }
    if (!url) { metrics?.fail(channel, 'unconfigured'); log({ evt: 'chat_unconfigured', channel }); return { ok: false, status: 0, attempts: 0 }; }
    let status = 0;
    for (let i = 0; i <= retries; i++) {
      let retryAfter = 0;
      try {
        const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
        status = r.status;
        if (r.ok) { metrics?.ok(channel); return { ok: true, status, attempts: i + 1 }; }
        retryAfter = Number(r.headers?.get?.('retry-after')) * 1000 || 0;
        if (status !== 429 && status < 500) break; // 4xx other than 429 will not get better
      } catch (e) {
        status = 0;
        log({ evt: 'chat_post_error', channel, code: e?.name === 'TimeoutError' ? 'timeout' : e?.cause?.code ?? e?.code ?? 'error' });
      }
      if (i < retries) await sleep(Math.min(retryAfter || baseMs * 2 ** i, 10000));
    }
    metrics?.fail(channel, String(status));
    log({ evt: 'chat_post_failed', channel, status });
    return { ok: false, status, attempts: retries + 1 };
  };
}

// Per-key cooldown + global per-minute limit. allow(key) -> 'send' | 'cooldown' | 'limited'.
export function createGate({ cooldownMs = 900000, perMinute = 10, now = Date.now } = {}) {
  const seen = new Map(), sent = [];
  return {
    allow(key) {
      const t = now();
      for (const [k, v] of seen) if (t - v > cooldownMs) seen.delete(k);
      while (sent.length && t - sent[0] > 60000) sent.shift();
      if (seen.has(key)) return 'cooldown';
      if (sent.length >= perMinute) return 'limited';
      seen.set(key, t); sent.push(t);
      return 'send';
    },
  };
}

export function createMetrics() {
  const sent = {}, failed = {}, last = {}, g = { received: 0, lastReceived: 0, lastWatchdog: 0, dropped: 0 };
  const extra = new Map(); // name -> { help, type, samples: Map(labelStr -> value) }
  const m = {
    ok: (c) => { sent[c] = (sent[c] ?? 0) + 1; last[c] = Date.now() / 1000; },
    fail: (c, reason) => { const k = `${c}|${reason}`; failed[k] = (failed[k] ?? 0) + 1; },
    received: () => { g.received++; g.lastReceived = Date.now() / 1000; },
    watchdog: () => { g.lastWatchdog = Date.now() / 1000; },
    dropped: () => { g.dropped++; },
    set(name, type, value, labels = '') { const e = extra.get(name) ?? { type, samples: new Map() }; e.samples.set(labels, value); extra.set(name, e); },
    inc(name, labels = '', by = 1) { const e = extra.get(name) ?? { type: 'counter', samples: new Map() }; e.samples.set(labels, (e.samples.get(labels) ?? 0) + by); extra.set(name, e); },
    render() {
      const L = [];
      const fam = (n, t, h, rows) => { L.push(`# HELP ${n} ${h}`, `# TYPE ${n} ${t}`, ...rows); };
      fam('crm_chat_bridge_sent_total', 'counter', 'Messages delivered to Google Chat.', CHANNELS.map((c) => `crm_chat_bridge_sent_total{channel="${c}"} ${sent[c] ?? 0}`));
      fam('crm_chat_bridge_failed_total', 'counter', 'Messages not delivered after retries.', CHANNELS.map((c) => `crm_chat_bridge_failed_total{channel="${c}"} ${Object.entries(failed).filter(([k]) => k.startsWith(`${c}|`)).reduce((a, [, v]) => a + v, 0)}`));
      fam('crm_chat_bridge_last_success_timestamp_seconds', 'gauge', 'Unix time of the last delivered message per channel (0 = never).', CHANNELS.map((c) => `crm_chat_bridge_last_success_timestamp_seconds{channel="${c}"} ${last[c] ?? 0}`));
      fam('crm_chat_bridge_received_total', 'counter', 'Alertmanager webhook calls received.', [`crm_chat_bridge_received_total ${g.received}`]);
      fam('crm_chat_bridge_last_received_timestamp_seconds', 'gauge', 'Unix time of the last Alertmanager call.', [`crm_chat_bridge_last_received_timestamp_seconds ${g.lastReceived}`]);
      fam('crm_chat_bridge_last_watchdog_timestamp_seconds', 'gauge', 'Unix time the Watchdog alert last reached the bridge (dead-man).', [`crm_chat_bridge_last_watchdog_timestamp_seconds ${g.lastWatchdog}`]);
      fam('crm_chat_bridge_dropped_total', 'counter', 'Alerts dropped on purpose (Watchdog).', [`crm_chat_bridge_dropped_total ${g.dropped}`]);
      for (const [n, e] of extra) fam(n, e.type, n, [...e.samples].map(([l, v]) => `${n}${l ? `{${l}}` : ''} ${v}`));
      return `${L.join('\n')}\n`;
    },
  };
  return m;
}
