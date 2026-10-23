// Polls Sentry (read-only Internal Integration token) and opens ONE incident per Sentry issue via resolver.openSentryIssue.
// No token file (or empty) = the whole feature is off. Never throws; the token is never logged. RESOLVED is decided by the resolver, never here.
import fs from 'node:fs';

const MAX_BYTES = 1024 * 1024, MAX_PAGES = 3, NEW_MS = 15 * 60e3;
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').trim().slice(0, n);
const sum = (a) => (Array.isArray(a) ? a.reduce((t, p) => t + (Number(Array.isArray(p) ? p[1] : p) || 0), 0) : 0);

export function startSentryPoller({ resolver, env = process.env, fetchImpl = fetch, log = () => {}, now = Date.now, readFile = (f) => fs.readFileSync(f, 'utf8') }) {
  let token = '';
  try { token = String(readFile(env.SENTRY_TOKEN_FILE ?? '/run/secrets/sentry_token')).trim(); } catch { /* no token file: feature off */ }
  if (!token || !resolver?.openSentryIssue) return { enabled: false, tick: async () => {}, stop() {} };
  const base = /^https:\/\/[A-Za-z0-9.-]+$/.test((env.SENTRY_API_BASE ?? '').replace(/\/+$/, '')) ? env.SENTRY_API_BASE.replace(/\/+$/, '') : 'https://sentry.io';
  const org = env.SENTRY_ORG || 'geta-ai-cj', sentryEnv = env.SENTRY_ENV || 'production';
  const projects = (env.SENTRY_PROJECTS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const secs = Math.max(30, Number(env.SENTRY_POLL_SECONDS) || 60), spikeN = Number(env.SENTRY_SPIKE_EVENTS) || 20;
  const known = new Set(); let baselined = false;

  async function get(url) { // -> parsed JSON + headers; throws on any failure (callers catch)
    const r = await fetchImpl(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': 'threadwise-chat-bridge' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw Object.assign(new Error('http'), { status: r.status });
    const txt = await r.text();
    if (txt.length > MAX_BYTES) throw new Error('too_large');
    return { j: JSON.parse(txt), link: r.headers?.get?.('link') ?? '' };
  }
  const nextUrl = (link) => { // only follow a cursor link on the configured host: the token must never go elsewhere
    for (const seg of String(link).split(',')) if (/rel="next"/.test(seg) && /results="true"/.test(seg)) { const m = /<([^>]+)>/.exec(seg); if (m && m[1].startsWith(`${base}/`)) return m[1]; }
    return null;
  };
  async function listIssues() {
    let url = `${base}/api/0/organizations/${encodeURIComponent(org)}/issues/?query=${encodeURIComponent(`is:unresolved environment:${sentryEnv}`)}&statsPeriod=1h&sort=date`;
    const all = [];
    for (let p = 0; url && p < MAX_PAGES; p++) { const { j, link } = await get(url); if (!Array.isArray(j)) throw new Error('bad_shape'); all.push(...j); url = nextUrl(link); }
    return all;
  }
  async function frames(id) { // untrusted evidence: innermost in_app frames, best effort
    try {
      const { j } = await get(`${base}/api/0/issues/${encodeURIComponent(id)}/events/latest/`);
      const ex = (j.entries ?? []).find((e) => e?.type === 'exception'), vals = ex?.data?.values ?? [];
      const fr = vals.flatMap((v) => v?.stacktrace?.frames ?? []).filter((f) => f?.inApp ?? f?.in_app);
      return fr.slice(-5).reverse().map((f) => clip(`${f.filename ?? f.module ?? '?'}:${Number(f.lineNo ?? f.lineno) || 0} ${f.function ?? ''}`, 160));
    } catch (e) { log({ evt: 'sentry_frames_failed', err: e?.status ?? e?.name ?? 'error' }); return []; }
  }
  function decide(i, ev1h) {
    const t = Date.parse(i.firstSeen), fresh = Number.isFinite(t) && now() - t <= NEW_MS, lvl = i.level;
    if (!baselined) return lvl === 'fatal' || ev1h >= 10 ? 'new' : null; // issues that existed at bridge start: only the serious ones
    if (i.substatus === 'regressed') return 'regression';
    if (fresh && (lvl === 'error' || lvl === 'fatal')) return 'new';
    if (known.has(String(i.id)) && ev1h >= spikeN) return 'spike';
    return null;
  }
  async function watchOpen() { // issues we track that left the unresolved list, or are open: ask Sentry for status + last event
    let n = 0;
    for (const v of resolver.listFull()) {
      if (v.kind !== 'sentry_issue' || v.status === 'resolved' || !v.meta?.issueId || n++ >= 20) continue;
      try {
        const { j } = await get(`${base}/api/0/issues/${encodeURIComponent(v.meta.issueId)}/`);
        const act = [...(j.activity ?? [])].reverse().find((a) => a?.type === 'set_resolved');
        await resolver.sentryStatus(v.id, { status: String(j.status), lastSeen: Date.parse(j.lastSeen) || null, by: clip(act?.user?.name ?? act?.user?.email, 40) || null });
      } catch (e) { log({ evt: 'sentry_status_failed', err: e?.status ?? e?.name ?? 'error' }); }
    }
  }
  let running = false;
  async function tick() { // never throws; a failed fetch leaves all state unchanged
    if (running) return; running = true;
    try {
      let issues; try { issues = await listIssues(); } catch (e) { log({ evt: 'sentry_poll_failed', err: e?.status ?? e?.name ?? 'error' }); return; }
      if (projects.length) issues = issues.filter((i) => projects.includes(i.project?.slug));
      for (const i of issues) {
        if (!i?.id) continue;
        const stats = i.stats ?? {}, ev1h = stats['1h'] ? sum(stats['1h']) : Number(i.count) || 0, rule = decide(i, ev1h);
        known.add(String(i.id));
        if (!rule) continue;
        const critical = i.level === 'fatal' || rule === 'spike';
        try {
          await resolver.openSentryIssue({ issueId: String(i.id), shortId: clip(i.shortId, 40), title: clip(i.title, 200), culprit: clip(i.culprit, 200), level: clip(i.level, 12), project: clip(i.project?.slug ?? i.project?.name, 60), count: ev1h, userCount: Number(i.userCount) || 0, firstSeen: i.firstSeen, lastSeen: i.lastSeen, url: typeof i.permalink === 'string' ? i.permalink : '', channel: env.SENTRY_CHANNEL === 'sentry' ? 'sentry' : critical ? 'critical' : 'other', rule, frames: () => frames(i.id) });
        } catch (e) { log({ evt: 'sentry_open_failed', err: e?.name ?? 'error' }); }
      }
      baselined = true;
      await watchOpen();
    } catch { /* ignore */ } finally { running = false; }
  }
  const timer = setInterval(tick, secs * 1000); timer.unref();
  return { enabled: true, tick, stop: () => clearInterval(timer) };
}
