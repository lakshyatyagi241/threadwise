// Google Chat APP layer (flag CHAT_APP_ENABLED). Interactive alert cards (I'm on it / Release / Open PR / Open Grafana), card updates after
// a claim, POST /chat-app/events handler (Google-verified), and a sender that posts as the app and falls back to the webhook per message.
import { createChatApi } from './chat-api.mjs';
import { createTokenVerifier } from './chat-app-auth.mjs';

const PRS = 'https://github.com/lakshyatyagi241/threadwise/pulls';
const btn = (text, action, incidentId) => ({
  text,
  onClick: {
    action: {
      function: action,
      parameters: [
        { key: 'incidentId', value: incidentId },
        { key: 'action', value: action },
      ],
    },
  },
});
const link = (text, url) => ({ text, onClick: { openLink: { url } } });

// All alert, note and PR text is untrusted: strip control chars, escape, truncate. Only github PR URLs of this repo become links.
const clean = (x, n = 200) => {
  const t = String(x ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const PR_URL = /^https:\/\/github\.com\/lakshyatyagi241\/threadwise\/pull\/\d+$/;
const hm = (t) => `${new Date(t).toISOString().slice(11, 16)} UTC`;
const dur = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 1 ? `${Math.max(0, Math.round(ms / 1000))} s` : m < 120 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const MAX_BYTES = 30000; // Chat caps a message at 32,000 bytes
const row = (k, v) => ({ decoratedText: { topLabel: k, text: v, wrapText: true } });
const MAX_TL = 8;

// Plain-words status rows from the incident snapshot (resolver.get). Pure; every dynamic string goes through clean().
function lifeWidgets({ owner, snap, firedAt }) {
  const w = [], pr = snap?.prNumber ? `PR #${Number(snap.prNumber)}${snap.prSummary ? ` (${clean(snap.prSummary, 120)})` : ''}` : '';
  const res = snap?.resolution, done = snap?.status === 'resolved';
  const who = clean(snap?.owner ?? owner, 60);
  if (done && res) {
    const how = res.kind === 'pr' ? `Fixed by ${pr || 'a PR'}${snap.owner ? `, raised by ${who}` : ''}${res.sha ? `, live in release ${clean(String(res.sha).slice(0, 7), 12)}` : ''}.`
      : res.kind === 'release' ? `Resolved by release ${clean(String(res.sha ?? '').slice(0, 7), 12)}.`
      : res.kind === 'action' ? `Resolved automatically by ${clean(res.how, 200)}.`
      : `Cleared on its own, no code change, after ${dur(res.durationMs)}.`;
    w.push(row('✅ How it was resolved', how));
    if (res.measured) w.push(row('What it measured', clean(res.measured, 120)));
    w.push(row('How long / peak', `lasted ${dur(res.durationMs)}${res.peak ? `; peak ${clean(res.peak, 40)}${res.threshold ? ` vs threshold ${clean(res.threshold, 40)}` : ''}` : ''}; verified clear at ${hm(res.at)}`));
  } else if (snap?.status === 'released') {
    w.push(row('🚀 In release', `${pr} is live in release ${clean(String(snap.releasedSha ?? '').slice(0, 7), 12)}; verifying that the problem is gone.`));
  } else if (snap?.prUrl) {
    w.push(row('🔧 PR raised', `${pr}${who ? ` by ${who}` : ''}. Next step: review and merge it; this card resolves itself when the alert clears after the release.`));
  } else if (who && (snap?.status === 'claimed' || !snap)) {
    w.push({ decoratedText: { text: `👀 ${who} is working on this${snap?.claimedAt ? ` since ${hm(snap.claimedAt)}` : ''}`, wrapText: true } });
    w.push(row('Owner / next step', `${who} owns it. Next step: find the cause (see "What to check"), then raise a PR or note what was found.`));
  } else {
    w.push(row('Owner / next step', 'Nobody yet. Press "I\'m on it", then follow "What to check" above.'));
  }
  const found = (snap?.notes ?? []).at(-1);
  if (found) w.push(row(`What ${clean(found.who, 40)} found`, clean(found.text, 600)));
  const tl = [...(firedAt ? [{ t: firedAt, who: snap?.kind === 'deploy_failure' ? 'Deploy' : 'Alertmanager', text: snap?.kind === 'deploy_failure' ? 'deploy failed' : 'alert fired' }] : []), ...(snap?.tl ?? [])].slice(-MAX_TL);
  if (tl.length) w.push(row('Timeline', tl.map((e) => `${hm(e.t)}  ${clean(e.who, 40)}: ${clean(e.text, 160)}`).join('\n')));
  return w;
}

// One highlighted STATUS line at the top of the card body. Only names are bold (Chat decoratedText supports <b>, <a href>); every value is clean()ed first.
function statusLine({ owner, snap }) {
  const who = clean(snap?.owner ?? owner, 60), nm = who && `<b>${who}</b>`, n = snap?.prNumber ? Number(snap.prNumber) : 0;
  const pr = n ? (snap.prUrl && PR_URL.test(snap.prUrl) ? `<a href="${snap.prUrl}">PR #${n}</a>` : `PR #${n}`) : '';
  const res = snap?.resolution;
  if (snap?.status === 'resolved') {
    if (res?.kind === 'pr' || (pr && res?.kind !== 'self')) return `✅ Status: Resolved by ${pr || 'a PR'}${nm ? ` (${nm})` : ''}`;
    if (res?.kind === 'release') return `✅ Status: Resolved by release ${clean(String(res.sha ?? '').slice(0, 7), 12)}`;
    if (res?.kind === 'action') return '✅ Status: Resolved automatically';
    return '✅ Status: Cleared on its own';
  }
  if (snap?.status === 'released') return `🔵 Status: In progress, ${pr || 'the PR'} is live in release ${clean(String(snap.releasedSha ?? '').slice(0, 7), 12)}, verifying`;
  if (pr) return `🔵 Status: In progress, ${pr} raised${nm ? ` by ${nm}` : ''}`;
  if (nm && (snap?.status === 'claimed' || !snap)) return `🔵 Status: In progress, ${nm} is working on this${snap?.claimedAt ? ` since ${hm(snap.claimedAt)}` : ''}`;
  return '🟡 Status: Open, nobody has taken it yet';
}

// base = the plain alert message (no buttons). owner = display name when claimed. snap = incident snapshot (resolver.get) for the full life.
export function renderCard(base, { incidentId, owner, grafanaUrl = '', prUrl = PRS, snap, firedAt }) {
  const m = structuredClone(base),
    card = m.cardsV2?.[0]?.card;
  if (!card) return m;
  const resolved = snap?.status === 'resolved';
  const widgets = lifeWidgets({ owner, snap, firedAt });
  const claimed = !resolved && !!(snap?.owner ?? owner);
  const pr = snap?.prUrl && PR_URL.test(snap.prUrl) ? snap.prUrl : prUrl;
  widgets.push({
    buttonList: {
      buttons: [
        ...(resolved ? [] : [claimed ? btn('Release', 'release', incidentId) : btn("I'm on it", 'claim', incidentId)]),
        link(snap?.prUrl && PR_URL.test(snap.prUrl) ? `PR #${Number(snap.prNumber)}` : 'Open PR', pr),
        ...(grafanaUrl ? [link('Open Grafana', grafanaUrl)] : []),
      ],
    },
  });
  if (resolved) {
    card.header.title = String(card.header.title).replace(/(FIRING|firing)/, '✅ RESOLVED');
    m.text = String(m.text ?? '').replace(/firing/i, 'resolved');
    for (const s of card.sections) for (const x of s.widgets) if (x.textParagraph) x.textParagraph.text = x.textParagraph.text.replace('(firing', '(resolved');
  }
  const taken = resolved || !!(snap?.owner ?? owner); // the "Claim it" suggestion is stale once somebody has it
  const keep = (w) => !w.buttonList && !(taken && w.decoratedText?.topLabel === 'Suggested action'); // our row replaces the alert's own Grafana button row
  card.sections = [...card.sections.map((s) => ({ ...s, widgets: s.widgets.filter(keep) })), { widgets }];
  card.sections[0].widgets.unshift({ decoratedText: { text: statusLine({ owner, snap }), wrapText: true } });
  if (resolved && snap.kind === 'deploy_failure' && !/RESOLVED/.test(card.header.title)) card.header.title = `✅ RESOLVED: ${card.header.title}`;
  // size guard: drop alert widgets from the end of the first section until the message fits
  while (Buffer.byteLength(JSON.stringify(m)) > MAX_BYTES && card.sections[0].widgets.length > 2) card.sections[0].widgets.pop();
  return m;
}

// Fallback claim store with the same contract as the resolver's claim/releaseClaim (team-incident-flow): {code, error?, owner?}.
export function createClaimStore() {
  const m = new Map();
  return {
    claim: async (id, who) => {
      const o = m.get(id);
      if (o && o !== who) return { code: 409, error: `already claimed by ${o}`, owner: o };
      m.set(id, who);
      return { code: 200 };
    },
    releaseClaim: async (id, who) => {
      if (m.get(id) !== who) return { code: 409, error: 'not claimed by you' };
      m.delete(id);
      return { code: 200 };
    },
  };
}

export function createChatApp({
  env = process.env,
  urls = {},
  fetchImpl = fetch,
  webhookSend,
  resolver,
  grafanaUrl = '',
  metrics,
  log = () => {},
  api,
  verifier,
  now = Date.now,
}) {
  const enabled = env.CHAT_APP_ENABLED === 'true';
  if (!enabled) return { enabled: false };
  api ??= createChatApi({ env, urls, fetchImpl, metrics, log });
  verifier ??= createTokenVerifier({ env, fetchImpl, now });
  const store = resolver?.claim ? resolver : createClaimStore();
  const bases = new Map(); // message name -> { base, incidentId } (bounded)
  const remember = (name, v) => {
    bases.delete(name);
    bases.set(name, v);
    if (bases.size > 500) bases.delete(bases.keys().next().value);
  };
  const hits = new Map(); // ip -> [timestamps]
  const limited = (ip) => {
    const t = now(),
      a = (hits.get(ip) ?? []).filter((x) => t - x < 60_000);
    a.push(t);
    hits.set(ip, a);
    if (hits.size > 5000) hits.delete(hits.keys().next().value);
    return a.length > Number(env.CHAT_APP_RATE_PER_MIN ?? 60);
  };
  const resolveId = (id) => resolver?.byKey?.(id)?.id ?? id;

  async function send(channel, body, opts = {}) {
    const { interactive, ...rest } = opts;
    const out = interactive ? renderCard(body, { ...interactive, grafanaUrl }) : body;
    const r = await api.createMessage(channel, out, rest);
    if (r.ok) {
      if (interactive && r.name)
        remember(r.name, { base: body, incidentId: interactive.incidentId, channel, owner: null, firedAt: interactive.firedAt ?? now(), local: [] });
      return r;
    }
    log({ evt: 'chat_app_fallback_webhook', channel, status: r.status });
    return webhookSend(channel, body, rest); // the webhook cannot render buttons: send the plain card
  }

  // Create the one card for an incident through the API only (no webhook fallback). true = created and remembered, so later edits PATCH it.
  async function openCard(channel, body, opts = {}) {
    const { interactive, ...rest } = opts, r = await api.createMessage(channel, renderCard(body, { ...interactive, grafanaUrl }), rest);
    if (!r.ok || !r.name) return false;
    remember(r.name, { base: body, incidentId: interactive.incidentId, channel, owner: null, firedAt: interactive.firedAt ?? now(), local: [] });
    return true;
  }

  const priv = (user, text) => ({
    actionResponse: { type: 'NEW_MESSAGE' },
    text,
    ...(user?.name ? { privateMessageViewer: { name: user.name } } : {}),
  });
  async function onClick(ev) {
    const p = Object.fromEntries([
      ...(ev.common?.parameters ? Object.entries(ev.common.parameters) : []),
      ...(ev.action?.parameters ?? []).map((x) => [x.key, x.value]),
    ]);
    const action = p.action,
      user = ev.user,
      who = user?.displayName;
    if (!who || !p.incidentId || !['claim', 'release'].includes(action))
      return priv(user, 'Unknown action.');
    const id = resolveId(p.incidentId),
      msgName = ev.message?.name;
    const r = action === 'claim' ? await store.claim(id, who) : await store.releaseClaim(id, who);
    if (r.code !== 200)
      return priv(
        user,
        action === 'claim'
          ? `Not claimed: ${r.error ?? 'refused'}`
          : `Not released: ${r.error ?? 'refused'}`,
      );
    const known = bases.get(msgName),
      base = known?.base ?? ev.message ?? {};
    if (msgName && !known) remember(msgName, { base, incidentId: p.incidentId, owner: null, firedAt: now(), local: [] });
    const ent = msgName ? bases.get(msgName) : null;
    if (ent) {
      ent.owner = action === 'claim' ? who : null; // the click response edits the card itself
      if (!resolver?.get) ent.local.push({ t: now(), who, text: action === 'claim' ? 'claimed, working on this' : 'released the claim' });
    }
    const snap = resolver?.get?.(id) ?? (ent ? { owner: ent.owner, status: ent.owner ? 'claimed' : 'open', claimedAt: ent.owner ? now() : null, tl: ent.local, notes: [] } : undefined);
    return {
      actionResponse: { type: 'UPDATE_MESSAGE' },
      ...renderCard(base, {
        incidentId: p.incidentId,
        owner: action === 'claim' ? who : null,
        grafanaUrl,
        snap,
        firedAt: ent?.firedAt,
      }),
    };
  }
  async function onMessage(ev) {
    const t = String(ev.message?.argumentText ?? ev.message?.text ?? '').trim();
    const c = /^claim\s+([A-Za-z0-9:_-]{1,80})$/i.exec(t);
    if (c) {
      const r = await store.claim(resolveId(c[1]), ev.user?.displayName ?? '');
      return {
        text:
          r.code === 200
            ? `👀 ${ev.user?.displayName} is working on ${c[1]}`
            : `Not claimed: ${r.error ?? 'refused'}`,
      };
    }
    if (/^status$/i.test(t)) {
      const l = resolver?.list?.() ?? [];
      return {
        text: l.length
          ? l
              .slice(-10)
              .map((i) => `${i.id} ${i.state}${i.owner ? ` (${i.owner})` : ''}`)
              .join('\n')
          : 'No incidents.',
      };
    }
    return {
      text: 'Commands: "claim INC-id" (take an incident), "status" (recent incidents). Use the buttons on alert cards for the same.',
    };
  }
  async function handleEvent(ev) {
    if (ev?.type === 'ADDED_TO_SPACE')
      return {
        text: 'Threadwise Alerts is here. Alert cards get an "I\'m on it" button; say "status" for recent incidents.',
      };
    if (ev?.type === 'CARD_CLICKED') return onClick(ev);
    if (ev?.type === 'MESSAGE') return onMessage(ev);
    return {};
  }

  // Returns true when it handled the request. Everything that is not a valid Google event gets 401 (rate limit 429, size 413).
  async function handleHttp(req, res) {
    const end = (code, o) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(o));
      return true;
    };
    if (req.method !== 'POST') return end(401, { error: 'unauthorized' });
    const xff = String(req.headers['x-forwarded-for'] ?? '')
      .split(',')
      .pop()
      .trim();
    if (limited(xff || req.socket.remoteAddress || '?')) return end(429, { error: 'rate limited' });
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
    if (!m) return end(401, { error: 'unauthorized' });
    try {
      await verifier(m[1]);
    } catch (e) {
      log({ evt: 'chat_app_rejected', why: e.message });
      return end(401, { error: 'unauthorized' });
    }
    let raw = '';
    for await (const c of req) {
      raw += c;
      if (raw.length > 65536) return end(413, {});
    }
    let ev;
    try {
      ev = JSON.parse(raw);
    } catch {
      return end(400, {});
    }
    return end(
      200,
      await handleEvent(ev).catch((e) => {
        log({ evt: 'chat_app_error', msg: e.message });
        return { text: 'Something went wrong.' };
      }),
    );
  }
  // Any lifecycle change (REST claim, PR, release, note, resolved): re-render the alert card from the resolver's snapshot and PATCH it in place.
  // Returns true when a card shows the change (so the caller skips the thread reply and the top-level announce).
  async function syncCard(incidentId, _owner, extra) {
    let shown = false;
    for (const [name, v] of [...bases]) {
      if (resolveId(v.incidentId) !== incidentId || !v.channel) continue;
      const snap = extra ?? resolver?.get?.(incidentId);
      if (!snap) continue;
      const body = renderCard(v.base, { incidentId: v.incidentId, owner: snap.owner ?? null, grafanaUrl, snap, firedAt: v.firedAt });
      const sig = JSON.stringify(body);
      if (v.sig === sig) { shown = true; continue; }
      const r = await api.updateMessage(v.channel, name, body);
      if (r?.ok) { v.sig = sig; v.owner = snap.owner ?? null; shown = true; } else log({ evt: 'chat_app_card_sync_failed', status: r?.status });
    }
    return shown;
  }
  // The Alertmanager "resolved" webhook in app mode: edit the original card instead of posting a second message. Returns true if it did.
  const resolveCard = (key, resolution) => {
    const inc = resolver?.byKey?.(key), snap = (inc && resolver.get(inc.id)) || {};
    return syncCard(inc?.id ?? key, null, { ...snap, status: 'resolved', resolution, tl: [...(snap.tl ?? []), { t: resolution.at, who: 'Alertmanager', text: 'alert cleared' }] });
  };
  return { enabled, send, openCard, handleHttp, handleEvent, syncCard, resolveCard };
}
