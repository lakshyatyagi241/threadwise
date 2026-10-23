// Polls GitHub (read-only token) for PRs attached to open incidents so the one card can say "merged, waiting for the release".
// RESOLVED is never decided here: only the release/verification logic in resolver.mjs resolves an incident.
import fs from 'node:fs';

const MAX_BYTES = 512 * 1024;
export function startPrPoller({ resolver, env = process.env, fetchImpl = fetch, log = () => {}, readFile = (f) => fs.readFileSync(f, 'utf8') }) {
  let token = '';
  try { token = String(readFile(env.GITHUB_TOKEN_FILE ?? '/run/secrets/github_read_token')).trim(); } catch { /* no token file: polling stays off */ }
  if (!token || !resolver?.listFull) return { enabled: false, tick: async () => {}, stop() {} };
  const repo = /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO ?? '') ? env.GITHUB_REPO : 'lakshyatyagi241/threadwise';
  const secs = Math.max(30, Number(env.PR_POLL_SECONDS) || 60);
  async function one(v) {
    const n = v.prNumber;
    const r = await fetchImpl(`https://api.github.com/repos/${repo}/pulls/${n}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'threadwise-chat-bridge' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return;
    const txt = await r.text();
    if (txt.length > MAX_BYTES) return;
    const j = JSON.parse(txt);
    if (j?.merged === true) {
      const login = String(j.merged_by?.login ?? '');
      await resolver.markPrMerged(v.id, { at: Date.parse(j.merged_at) || Date.now(), by: /^[A-Za-z0-9-]{1,39}$/.test(login) ? login : null, sha7: /^[0-9a-f]{40}$/i.test(j.merge_commit_sha ?? '') ? j.merge_commit_sha.slice(0, 7) : null });
    } else if (j?.state === 'closed') await resolver.markPrClosed(v.id);
  }
  let running = false;
  async function tick() { // never throws; one failing PR does not stop the others
    if (running) return; running = true;
    try {
      for (const v of resolver.listFull()) {
        if (!Number.isInteger(v.prNumber) || v.prNumber < 1 || v.prMerged || v.status === 'resolved') continue;
        try { await one(v); } catch (e) { log({ evt: 'pr_poll_failed', pr: v.prNumber, err: e?.name ?? 'error' }); }
      }
    } catch { /* ignore */ } finally { running = false; }
  }
  const timer = setInterval(tick, secs * 1000); timer.unref();
  return { enabled: true, tick, stop: () => clearInterval(timer) };
}
