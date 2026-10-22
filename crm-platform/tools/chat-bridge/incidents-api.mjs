// Team incident API (JSON), all routes need header X-Incident-Token. See docs/runbooks/team-incident-flow.md.
//   GET /incidents[?status=] | GET /incidents/:id | POST /incidents/:id/{claim,release-claim,pr,note}
import fs from 'node:fs';
import { timingSafeEqual, createHash } from 'node:crypto';

const PR_RE = /^https:\/\/github\.com\/lakshyatyagi241\/threadwise\/pull\/(\d{1,7})$/;
const STATUSES = ['open', 'claimed', 'pr_raised', 'resolved', 'escalated'];
const CTRL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const text = (v, max) => typeof v === 'string' && v.trim() && v.length <= max && !CTRL.test(v) ? v.trim() : null;
const sha = (s) => createHash('sha256').update(s).digest();

export const loadToken = (env = process.env) => (env.INCIDENT_API_TOKEN ?? (() => { try { return fs.readFileSync(`${env.GCHAT_SECRETS_DIR ?? '/run/secrets'}/incident_api_token`, 'utf8'); } catch { return ''; } })()).trim();

// Returns true when it handled the request. Never echoes the token; a missing/unset token is always 401 (fails closed).
export async function handleIncidents(req, res, { resolver, token, log = () => {} }) {
  const u = new URL(req.url, 'http://x'), m = /^\/incidents(?:\/([A-Za-z0-9-]{1,64})(?:\/(claim|release-claim|pr|note))?)?\/?$/.exec(u.pathname);
  if (!m) return false;
  const out = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); return true; };
  const given = req.headers['x-incident-token'];
  if (!token || typeof given !== 'string' || !timingSafeEqual(sha(given), sha(token))) return out(401, { error: 'unauthorized' });
  if (!resolver) return out(503, { error: 'resolver off' });
  await resolver.sweepClaims();
  const [, id, action] = m;
  if (req.method === 'GET' && !action) {
    if (id) { const v = resolver.get(id); return v ? out(200, v) : out(404, { error: 'unknown incident' }); }
    const status = u.searchParams.get('status');
    if (status && !STATUSES.includes(status)) return out(400, { error: 'bad status' });
    return out(200, { mode: resolver.mode, incidents: resolver.listFull(status) });
  }
  if (req.method !== 'POST' || !id || !action) return out(405, { error: 'method not allowed' });
  let raw = ''; for await (const c of req) { raw += c; if (raw.length > 8000) return out(413, { error: 'too large' }); }
  let b; try { b = JSON.parse(raw || '{}'); } catch { return out(400, { error: 'bad json' }); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return out(400, { error: 'bad body' });
  const who = text(b.who, 40);
  if (!who || !/^[\p{L}\p{N} ._@-]+$/u.test(who)) return out(400, { error: 'who must be 1-40 chars (letters, digits, space . _ @ -)' });
  let r;
  if (action === 'claim') r = await resolver.claim(id, who);
  else if (action === 'release-claim') r = await resolver.releaseClaim(id, who);
  else if (action === 'note') { const t = text(b.text, 500); if (!t) return out(400, { error: 'text must be 1-500 chars without control characters' }); r = await resolver.addNote(id, who, t); }
  else {
    const summary = text(b.summary, 200); let url = typeof b.url === 'string' && b.url.length <= 200 ? b.url.split(/[?#]/)[0] : '';
    const pm = PR_RE.exec(url);
    if (!pm) return out(400, { error: 'url must be https://github.com/lakshyatyagi241/threadwise/pull/<n>' });
    if (!summary) return out(400, { error: 'summary must be 1-200 chars without control characters' });
    if (b.number != null && Number(b.number) !== Number(pm[1])) return out(400, { error: 'number does not match url' });
    r = await resolver.raisePr(id, who, { url, number: Number(pm[1]), summary });
  }
  log({ evt: 'incident_api', id, action, who, code: r.code });
  return r.error ? out(r.code, { error: r.error, ...(r.owner ? { owner: r.owner } : {}) }) : out(200, r.inc);
}
