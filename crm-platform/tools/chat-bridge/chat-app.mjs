// Google Chat APP layer (flag CHAT_APP_ENABLED). Interactive alert cards (I'm on it / Release / Open PR / Open Grafana), card updates after
// a claim, POST /chat-app/events handler (Google-verified), and a sender that posts as the app and falls back to the webhook per message.
import { createChatApi } from './chat-api.mjs';
import { createTokenVerifier } from './chat-app-auth.mjs';

const PRS = 'https://github.com/lakshyatyagi241/threadwise/pulls';
const btn = (text, action, incidentId) => ({ text, onClick: { action: { function: action, parameters: [{ key: 'incidentId', value: incidentId }, { key: 'action', value: action }] } } });
const link = (text, url) => ({ text, onClick: { openLink: { url } } });

// base = the plain alert message (no buttons). owner = display name when claimed.
export function renderCard(base, { incidentId, owner, grafanaUrl = '', prUrl = PRS }) {
  const m = structuredClone(base), card = m.cardsV2?.[0]?.card;
  if (!card) return m;
  const widgets = [];
  if (owner) widgets.push({ decoratedText: { text: `👀 ${String(owner).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])} is working on this`, wrapText: true } });
  widgets.push({ buttonList: { buttons: [owner ? btn('Release', 'release', incidentId) : btn("I'm on it", 'claim', incidentId), link('Open PR', prUrl), ...(grafanaUrl ? [link('Open Grafana', grafanaUrl)] : [])] } });
  const keep = (w) => !w.buttonList; // our row replaces the alert's own Grafana button row
  card.sections = [...card.sections.map((s) => ({ ...s, widgets: s.widgets.filter(keep) })), { widgets }];
  return m;
}

// Fallback claim store with the same contract as the resolver's claim/releaseClaim (team-incident-flow): {code, error?, owner?}.
export function createClaimStore() {
  const m = new Map();
  return {
    claim: async (id, who) => { const o = m.get(id); if (o && o !== who) return { code: 409, error: `already claimed by ${o}`, owner: o }; m.set(id, who); return { code: 200 }; },
    releaseClaim: async (id, who) => { if (m.get(id) !== who) return { code: 409, error: 'not claimed by you' }; m.delete(id); return { code: 200 }; },
  };
}

export function createChatApp({ env = process.env, urls = {}, fetchImpl = fetch, webhookSend, resolver, grafanaUrl = '', metrics, log = () => {}, api, verifier, now = Date.now }) {
  const enabled = env.CHAT_APP_ENABLED === 'true';
  if (!enabled) return { enabled: false };
  api ??= createChatApi({ env, urls, fetchImpl, metrics, log });
  verifier ??= createTokenVerifier({ env, fetchImpl, now });
  const store = resolver?.claim ? resolver : createClaimStore();
  const bases = new Map(); // message name -> { base, incidentId } (bounded)
  const remember = (name, v) => { bases.delete(name); bases.set(name, v); if (bases.size > 500) bases.delete(bases.keys().next().value); };
  const hits = new Map(); // ip -> [timestamps]
  const limited = (ip) => { const t = now(), a = (hits.get(ip) ?? []).filter((x) => t - x < 60_000); a.push(t); hits.set(ip, a); if (hits.size > 5000) hits.delete(hits.keys().next().value); return a.length > Number(env.CHAT_APP_RATE_PER_MIN ?? 60); };
  const resolveId = (id) => resolver?.byKey?.(id)?.id ?? id;

  async function send(channel, body, opts = {}) {
    const { interactive, ...rest } = opts;
    const out = interactive ? renderCard(body, { ...interactive, grafanaUrl }) : body;
    const r = await api.createMessage(channel, out, rest);
    if (r.ok) { if (interactive && r.name) remember(r.name, { base: body, incidentId: interactive.incidentId }); return r; }
    log({ evt: 'chat_app_fallback_webhook', channel, status: r.status });
    return webhookSend(channel, body, rest); // the webhook cannot render buttons: send the plain card
  }

  const priv = (user, text) => ({ actionResponse: { type: 'NEW_MESSAGE' }, text, ...(user?.name ? { privateMessageViewer: { name: user.name } } : {}) });
  async function onClick(ev) {
    const p = Object.fromEntries([...(ev.common?.parameters ? Object.entries(ev.common.parameters) : []), ...(ev.action?.parameters ?? []).map((x) => [x.key, x.value])]);
    const action = p.action, user = ev.user, who = user?.displayName;
    if (!who || !p.incidentId || !['claim', 'release'].includes(action)) return priv(user, 'Unknown action.');
    const id = resolveId(p.incidentId), msgName = ev.message?.name;
    const r = action === 'claim' ? await store.claim(id, who) : await store.releaseClaim(id, who);
    if (r.code !== 200) return priv(user, action === 'claim' ? `Not claimed: ${r.error ?? 'refused'}` : `Not released: ${r.error ?? 'refused'}`);
    const known = bases.get(msgName), base = known?.base ?? ev.message ?? {};
    if (msgName && !known) remember(msgName, { base, incidentId: p.incidentId });
    return { actionResponse: { type: 'UPDATE_MESSAGE' }, ...renderCard(base, { incidentId: p.incidentId, owner: action === 'claim' ? who : null, grafanaUrl }) };
  }
  async function onMessage(ev) {
    const t = String(ev.message?.argumentText ?? ev.message?.text ?? '').trim();
    const c = /^claim\s+([A-Za-z0-9:_-]{1,80})$/i.exec(t);
    if (c) { const r = await store.claim(resolveId(c[1]), ev.user?.displayName ?? ''); return { text: r.code === 200 ? `👀 ${ev.user?.displayName} is working on ${c[1]}` : `Not claimed: ${r.error ?? 'refused'}` }; }
    if (/^status$/i.test(t)) { const l = resolver?.list?.() ?? []; return { text: l.length ? l.slice(-10).map((i) => `${i.id} ${i.state}${i.owner ? ` (${i.owner})` : ''}`).join('\n') : 'No incidents.' }; }
    return { text: 'Commands: "claim INC-id" (take an incident), "status" (recent incidents). Use the buttons on alert cards for the same.' };
  }
  async function handleEvent(ev) {
    if (ev?.type === 'ADDED_TO_SPACE') return { text: 'Threadwise Alerts is here. Alert cards get an "I\'m on it" button; say "status" for recent incidents.' };
    if (ev?.type === 'CARD_CLICKED') return onClick(ev);
    if (ev?.type === 'MESSAGE') return onMessage(ev);
    return {};
  }

  // Returns true when it handled the request. Everything that is not a valid Google event gets 401 (rate limit 429, size 413).
  async function handleHttp(req, res) {
    const end = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); return true; };
    if (req.method !== 'POST') return end(401, { error: 'unauthorized' });
    const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').pop().trim();
    if (limited(xff || req.socket.remoteAddress || '?')) return end(429, { error: 'rate limited' });
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
    if (!m) return end(401, { error: 'unauthorized' });
    try { await verifier(m[1]); } catch (e) { log({ evt: 'chat_app_rejected', why: e.message }); return end(401, { error: 'unauthorized' }); }
    let raw = ''; for await (const c of req) { raw += c; if (raw.length > 65536) return end(413, {}); }
    let ev; try { ev = JSON.parse(raw); } catch { return end(400, {}); }
    return end(200, await handleEvent(ev).catch((e) => { log({ evt: 'chat_app_error', msg: e.message }); return { text: 'Something went wrong.' }; }));
  }
  return { enabled, send, handleHttp, handleEvent };
}
