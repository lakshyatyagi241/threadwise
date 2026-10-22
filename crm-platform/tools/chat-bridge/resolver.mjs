// Incident RESOLVER. Lifecycle posted as replies in the alert's thread: DIAGNOSED -> ACTION -> VERIFIED -> RESOLVED, or ESCALATED to the
// critical channel (action failed, verification failed, or no safe playbook). RESOLVED is only posted after verification passed.
// AUTO_REMEDIATE=off|dry-run|on (default dry-run, unknown value -> dry-run). Allow-list of playbooks (nothing else ever runs):
//   cancel_select   pg_cancel_backend of a runaway pure SELECT           (rollback: none needed, client may retry)
//   terminate_idle  pg_terminate_backend of ONLY an idle-in-transaction session that blocks others (rolls back its open tx)
//   db_pool         runs the two above on the offenders, verifies crm_db_pool_waiting == 0
//   code_fix        writes incidents/open/<id>.json for a recurring slow statement (no runtime fix); resolved only by a release
//   service         pluggable executor stubs (restart worker, scale...) : no executor wired in this PR -> suggested + ESCALATED
import fs from 'node:fs';
import path from 'node:path';
import { fmtDur } from './threads.mjs';

const WRITE = /\b(insert|update|delete|merge|alter|create|drop|truncate|grant|revoke|vacuum|analyze|copy|call|do|refresh|reindex|cluster|lock|into|set|reset|listen|notify|prepare|execute|begin|commit)\b|\bfor\s+(no\s+key\s+)?(update|share)\b|\bnextval\b|\bsetval\b|\bpg_(terminate|advisory|notify)/i;
const strip = (q) => String(q ?? '').replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
export const isPureSelect = (q) => /^\s*(\(\s*)*(select|with)\b/i.test(q ?? '') && !WRITE.test(strip(q));

// Allow-list for autovacuum/backups/migrations/replication/the watcher (regex on application_name and usename). Used by watcher and resolver.
export const excludeRes = (env = process.env) => ({
  app: new RegExp(env.SLOW_EXCLUDE_APP_REGEX ?? '^(gchat-watcher|pg_dump|pg_restore|pg_basebackup|pg_receivewal|.*migrat.*|.*backup.*|.*replica.*|pgbackrest.*)$', 'i'),
  user: new RegExp(env.SLOW_EXCLUDE_USER_REGEX ?? '^(replicator|repl.*|backup.*|pgbackrest)$', 'i'),
});
export const isExcluded = (r, env) => { const x = excludeRes(env); return x.app.test(r.application_name ?? '') || x.user.test(r.usename ?? '') || /^autovacuum:/i.test(r.query ?? ''); };

export function createResolver({ env = process.env, db = {}, post, promQuery, log = () => {}, metrics, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), executors = {}, offenders = () => [] }) {
  const mode = ['off', 'dry-run', 'on'].includes(env.AUTO_REMEDIATE) ? env.AUTO_REMEDIATE : 'dry-run';
  const hard = Number(env.HARD_CANCEL_SECONDS ?? 120), holder = Number(env.CANCEL_BLOCKER_SECONDS ?? 30), idleBlock = Number(env.IDLE_BLOCKER_SECONDS ?? 60);
  const verifyMs = Number(env.VERIFY_SECONDS ?? 120) * 1000, pollMs = Number(env.VERIFY_POLL_MS ?? 2000), perHour = Number(env.AUTO_REMEDIATE_MAX_PER_HOUR ?? 3);
  const dir = env.INCIDENTS_DIR ?? 'incidents';
  const incidents = new Map(), pending = new Set(), acted = {}; let release = null, seq = 0;
  const count = (playbook, outcome) => metrics?.inc('crm_incident_total', `playbook="${playbook}",outcome="${outcome}"`);
  const audit = (o) => log({ evt: 'remediation_audit', mode, ...o });

  const step = (inc, label, text, channel) => {
    inc.events.push({ t: now(), label, text: String(text).slice(0, 500) });
    const body = { text: (label ? `${label}: ${text}` : String(text)).slice(0, 300), cardsV2: [{ cardId: 'inc', card: { header: { title: label || 'Incident update', subtitle: `incident ${inc.id} (${inc.playbook})` }, sections: [{ widgets: [{ decoratedText: { text: String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;'), wrapText: true } }] }] } }] };
    return Promise.all((channel ? [channel] : inc.channels).map((ch) => post(ch, body, { threadKey: inc.threadKey })));
  };
  const escalate = async (inc, why) => {
    inc.state = 'escalated'; count(inc.playbook, 'escalated'); audit({ id: inc.id, playbook: inc.playbook, result: 'escalated', why });
    await step(inc, 'ESCALATED', `NOT resolved, needs a human: ${why}. Suggested next step: ${inc.suggestion ?? 'see the diagnosis in this thread'}. Evidence: ${inc.evidence ?? 'see thread'}`, env.SLOW_QUERY_ESCALATE_TO_CRITICAL === 'true' ? 'critical' : inc.channel);
  };
  const pre = {
    cancel_select(c) {
      const r = c.row, w = [];
      if (isExcluded(r, env)) w.push('allow-listed application or role');
      if (r.state !== 'active') w.push('not active');
      if (!isPureSelect(r.query)) w.push('not a pure SELECT (writes/DDL/locking are never cancelled)');
      if (Number(r.secs) < hard) w.push(`running ${Math.round(r.secs)} s < HARD_CANCEL_SECONDS ${hard}`);
      if (c.waiterSecs > 0 && c.waiterSecs < holder) w.push(`holds locks others wait on for only ${Math.round(c.waiterSecs)} s (< ${holder})`);
      return w;
    },
    terminate_idle(c) {
      const r = c.row, w = [];
      if (isExcluded(r, env)) w.push('allow-listed application or role');
      if (r.state !== 'idle in transaction') w.push('not idle in transaction (active sessions are never terminated)');
      if (Number(r.state_secs) < idleBlock) w.push(`idle ${Math.round(r.state_secs)} s < IDLE_BLOCKER_SECONDS ${idleBlock}`);
      if (!(c.waiterSecs > 0)) w.push('blocks nobody');
      return w;
    },
    db_pool: () => [], code_fix: () => [], service: () => [],
  };
  const describe = {
    cancel_select: (c) => `cancel pid ${c.row.pid} (${c.text.slice(0, 120)}, running ${Math.round(c.row.secs)} s) with pg_cancel_backend`,
    terminate_idle: (c) => `terminate idle-in-transaction pid ${c.row.pid} (idle ${Math.round(c.row.state_secs)} s, blocking others; its open transaction is rolled back)`,
    db_pool: () => 'cancel runaway SELECTs / terminate idle-in-transaction blockers among the current offenders',
    code_fix: (c) => `write incidents/open/<id>.json for the recurring slow statement (${(c.text ?? '').slice(0, 100)})`,
    service: (c) => c.suggestion ?? 'run the configured executor',
  };
  const act = {
    async cancel_select(c) {
      if (!db.cancel) return { ok: false, desc: 'no cancel role configured (secrets/slow_query_cancel_pg_url); only suggested' };
      if (db.recheck && !(await db.recheck(c.row))) return { ok: false, desc: 'the query already finished or changed before the action' };
      const ok = await db.cancel(c.row.pid);
      return { ok, desc: ok ? `Cancelled ${describe.cancel_select(c).replace(/^cancel /, '')}: returned true (backend NOT terminated).` : 'pg_cancel_backend returned false' };
    },
    async terminate_idle(c) {
      if (!db.terminate) return { ok: false, desc: 'no cancel/terminate role configured; only suggested' };
      if (db.recheck && !(await db.recheck(c.row))) return { ok: false, desc: 'the session is no longer idle in the same transaction' };
      const ok = await db.terminate(c.row.pid);
      return { ok, desc: ok ? `Terminated idle-in-transaction pid ${c.row.pid} (its transaction was rolled back; the app reconnects).` : 'pg_terminate_backend returned false' };
    },
    async db_pool(c) {
      const done = [];
      for (const o of offenders()) {
        const pb = o.kind === 'idle_in_tx' ? 'terminate_idle' : 'cancel_select';
        if (pre[pb](o).length) continue;
        const r = await act[pb](o).catch(() => ({ ok: false }));
        if (r.ok) done.push(r.desc);
      }
      return { ok: done.length > 0, desc: done.join(' ') || 'no offender passed the safety preconditions' };
    },
    async code_fix(c) {
      fs.mkdirSync(path.join(dir, 'open'), { recursive: true });
      const f = path.join(dir, 'open', `${c.incident.id}.json`);
      fs.writeFileSync(f, JSON.stringify({ id: c.incident.id, ...c.file, status: 'open', ticket: 'needs a code/index fix; a Claude Code routine may draft a PR from this file' }, null, 2));
      return { ok: true, desc: `needs a code/index fix: ticket opened (${f}); PR pending. This is resolved only by a release, I will reply here.` };
    },
    async service(c) {
      const ex = executors[c.action];
      if (!ex) return { ok: false, desc: `no executor wired for "${c.action}" (stub: no docker socket access in this PR)` };
      return ex(c);
    },
  };
  const verify = {
    cancel_select: (c) => db.isGone(c.row), terminate_idle: (c) => db.isGone(c.row),
    db_pool: async () => (await promQuery?.('max(crm_db_pool_waiting)')) === 0,
    service: (c) => c.verify?.() ?? false,
  };

  async function run(inc, c) {
    c.incident = inc;
    if (mode === 'off') return inc;
    await step(inc, 'DIAGNOSED', inc.diagnosis ?? 'see the first message of this thread');
    const why = pre[inc.playbook](c);
    if (why.length) { audit({ id: inc.id, result: 'refused', why }); await escalate(inc, `no safe action: ${why.join('; ')}`); return inc; }
    if (mode === 'dry-run') {
      inc.state = 'dry-run'; count(inc.playbook, 'dry_run'); audit({ id: inc.id, playbook: inc.playbook, result: 'dry-run' });
      await step(inc, 'ACTION', `DRY-RUN: would ${describe[inc.playbook](c)} - set AUTO_REMEDIATE=on to enable`);
      return inc;
    }
    const h = (acted[inc.playbook] ??= []); while (h.length && now() - h[0] > 3600e3) h.shift();
    if (h.length >= perHour) { await escalate(inc, `rate limit ${perHour}/hour reached for ${inc.playbook}`); return inc; }
    h.push(now());
    let res; try { res = await act[inc.playbook](c); } catch (e) { res = { ok: false, desc: `action threw ${e?.code ?? 'error'}` }; }
    audit({ id: inc.id, playbook: inc.playbook, result: res.ok ? 'acted' : 'failed', desc: res.desc });
    if (!res.ok) { await escalate(inc, `action failed: ${res.desc}`); return inc; }
    await step(inc, 'ACTION', res.desc);
    if (inc.playbook === 'code_fix') { inc.state = 'needs_fix'; count('code_fix', 'ticket'); return inc; }
    // VERIFY: the same check must hold continuously for VERIFY_SECONDS; if it relapses or never clears -> ESCALATED.
    const t0 = now(); let clear = null;
    for (;;) {
      const ok = await Promise.resolve(verify[inc.playbook](c)).catch(() => false);
      if (ok) { clear ??= now(); if (now() - clear >= verifyMs) break; } else if (clear) { await escalate(inc, 'verification failed: the condition came back'); return inc; }
      if (now() - t0 > verifyMs * 2 + pollMs * 2) { await escalate(inc, `verification failed: condition not cleared after ${fmtDur(now() - t0)}`); return inc; }
      await sleep(pollMs);
    }
    await step(inc, 'VERIFIED', `condition stayed cleared for ${fmtDur(verifyMs)} (same check as the detection)`);
    inc.state = 'resolved'; count(inc.playbook, 'resolved');
    const how = inc.playbook === 'cancel_select' ? `cancelling pid ${c.row.pid} (pg_cancel_backend, not terminated)` : inc.playbook === 'terminate_idle' ? `terminating idle-in-transaction pid ${c.row.pid}` : inc.playbook;
    await step(inc, 'RESOLVED', `resolved by ${how}, after ${fmtDur(now() - inc.startedAt)}`);
    return inc;
  }

  // Dedup is on the key in EVERY state but resolved: an escalated/dry-run incident must not be re-opened (and re-posted) on every watcher poll.
  // handle({playbook, threadKey, channel, key, diagnosis, ...ctx}) -> promise (not awaited by callers on the hot path; use settle() in tests).
  function handle(spec) {
    if (mode === 'off') return Promise.resolve(null);
    const dup = spec.key && [...incidents.values()].find((i) => i.key === spec.key && i.state !== 'resolved');
    if (dup) return Promise.resolve(dup);
    const inc = { id: `inc-${now().toString(36)}-${++seq}`, key: spec.key, playbook: spec.playbook, threadKey: spec.threadKey, channel: spec.channel ?? 'slowquery', channels: spec.channels ?? [spec.channel ?? 'slowquery'], state: 'open', startedAt: now(), notes: [], events: [], diagnosis: spec.diagnosis, suggestion: spec.suggestion, evidence: spec.evidence };
    incidents.set(inc.id, inc); if (incidents.size > 200) incidents.delete(incidents.keys().next().value);
    const p = run(inc, spec).catch((e) => log({ evt: 'resolver_error', code: e?.code ?? 'error' })).finally(() => pending.delete(p));
    pending.add(p); return p;
  }
  // (d) the watcher reports a recurring slow statement is fast again; a release marker makes it "resolved by release <sha>".
  const resolveByRelease = async (inc) => {
    inc.state = 'resolved'; count('code_fix', 'resolved');
    try { fs.mkdirSync(path.join(dir, 'resolved'), { recursive: true }); fs.renameSync(path.join(dir, 'open', `${inc.id}.json`), path.join(dir, 'resolved', `${inc.id}.json`)); } catch { /* file optional */ }
    if (inc.prUrl) return step(inc, '', `\u2705 RESOLVED by PR #${inc.prNumber} (owner ${inc.owner ?? 'n/a'}), release ${release.sha}, after ${fmtDur(now() - inc.startedAt)}`);
    await step(inc, 'RESOLVED', `statement is fast again (mean under threshold for the verification polls); resolved by release ${release.sha}, after ${fmtDur(now() - inc.startedAt)}`);
  };
  // Recovery WITHOUT a release recorded since the incident opened is NOT a resolution (a data change, a cache or a one-off may explain it):
  // the incident stays open (file stays in incidents/open) for review until POST /release arrives.
  async function statementRecovered(key) {
    const inc = [...incidents.values()].find((i) => i.key === key && i.state === 'needs_fix');
    if (!inc) return false;
    if (release && release.at >= inc.startedAt) { await resolveByRelease(inc); return true; }
    inc.state = 'recovered_no_release'; count('code_fix', 'recovered_no_release');
    await step(inc, 'RECOVERED', `statement is fast again, but recovered, no release recorded: the incident stays OPEN for review (${path.join(dir, 'open', `${inc.id}.json`)}); it resolves when POST /release arrives or a human closes it`);
    return true;
  }
  async function setRelease(sha) {
    release = { sha: String(sha).slice(0, 40), at: now() };
    for (const inc of incidents.values()) if (inc.state === 'recovered_no_release' || (inc.prUrl && inc.state !== 'resolved' && inc.prAt <= release.at)) await resolveByRelease(inc);
  }

  // ---- team claim flow (docs/runbooks/team-incident-flow.md). Claims are checked and set synchronously (no await in between), so two racing callers cannot both win.
  const ttlMs = () => Math.max(0.01, Number(env.INCIDENT_CLAIM_TTL_HOURS ?? 4)) * 3600e3;
  const hhmm = (t) => `${new Date(t).toISOString().slice(11, 16)} UTC`;
  const held = (inc) => !!inc.owner && (!!inc.prUrl || inc.claimExpiresAt > now());
  const statusOf = (inc) => inc.state === 'resolved' ? 'resolved' : inc.prUrl ? 'pr_raised' : held(inc) ? 'claimed' : inc.state === 'escalated' ? 'escalated' : 'open';
  const view = (inc) => ({ id: inc.id, playbook: inc.playbook, state: inc.state, status: statusOf(inc), owner: held(inc) ? inc.owner : null, claimedAt: inc.claimedAt ?? null, claimExpiresAt: inc.claimExpiresAt ?? null, prUrl: inc.prUrl ?? null, prNumber: inc.prNumber ?? null, threadKey: inc.threadKey, startedAt: inc.startedAt, diagnosis: inc.diagnosis, notes: inc.notes, events: inc.events.map((e) => ({ t: e.t, label: e.label })) });
  const sweepClaims = async () => {
    for (const inc of incidents.values()) if (inc.owner && !inc.prUrl && inc.state !== 'resolved' && inc.claimExpiresAt <= now()) { inc.owner = null; inc.claimedAt = inc.claimExpiresAt = null; await step(inc, '', '\u23F0 claim expired, incident is open again'); }
  };
  const mutate = (id, who, fn) => {
    const inc = incidents.get(id);
    if (!inc) return { code: 404, error: 'unknown incident' };
    if (inc.state === 'resolved') return { code: 409, error: 'incident already resolved' };
    const r = fn(inc); return r.error ? r : { code: 200, inc: view(inc), post: r.post };
  };
  const done = async (r, inc) => { if (r.post) await step(incidents.get(inc ?? r.inc.id), '', r.post); delete r.post; return r; };
  const claim = (id, who) => done(mutate(id, who, (inc) => {
    if (held(inc) && inc.owner !== who) return { code: 409, error: `already claimed by ${inc.owner}`, owner: inc.owner };
    const fresh = !held(inc); inc.owner = who; if (fresh) inc.claimedAt = now(); inc.claimExpiresAt = now() + ttlMs();
    return { post: fresh ? `\uD83D\uDC40 ${who} is working on this (claimed ${hhmm(inc.claimedAt)})` : undefined };
  }), id);
  const releaseClaim = (id, who) => done(mutate(id, who, (inc) => {
    if (!held(inc) || inc.owner !== who) return { code: 409, error: 'not claimed by you' };
    inc.owner = null; inc.claimedAt = inc.claimExpiresAt = null; return { post: `\uD83E\uDD1D ${who} released this incident` };
  }), id);
  const raisePr = (id, who, { url, number, summary }) => done(mutate(id, who, (inc) => {
    if (held(inc) && inc.owner !== who) return { code: 409, error: `claimed by ${inc.owner}`, owner: inc.owner };
    inc.owner = who; inc.claimedAt ??= now(); inc.prUrl = url; inc.prNumber = number; inc.prAt = now(); inc.claimExpiresAt = null;
    return { post: `\uD83D\uDD27 PR #${number} raised by ${who} at ${hhmm(now())}: ${summary} ${url}` };
  }), id);
  const addNote = (id, who, text) => done(mutate(id, who, (inc) => {
    if (held(inc) && inc.owner !== who) return { code: 409, error: `claimed by ${inc.owner}`, owner: inc.owner };
    inc.notes.push({ t: now(), who, text }); if (inc.notes.length > 50) inc.notes.shift();
    if (held(inc) && !inc.prUrl) inc.claimExpiresAt = now() + ttlMs(); // activity renews the claim
    return { post: `\uD83D\uDCDD ${who}: ${text}` };
  }), id);
  // The alert cleared (verified by Alertmanager's resolved) after a PR was raised: resolved by that PR.
  async function alertCleared(key) {
    const inc = [...incidents.values()].find((i) => i.key === key && i.prUrl && i.state !== 'resolved');
    if (!inc) return false;
    inc.state = 'resolved'; await step(inc, '', `\u2705 RESOLVED by PR #${inc.prNumber} (owner ${inc.owner ?? 'n/a'}): the alert verified cleared after the fix, after ${fmtDur(now() - inc.startedAt)}`); return true;
  }
  return {
    mode, handle, statementRecovered, settle: async () => { while (pending.size) await Promise.all([...pending]); },
    setRelease, claim, releaseClaim, raisePr, addNote, sweepClaims, alertCleared,
    get: (id) => (incidents.has(id) ? view(incidents.get(id)) : null),
    listFull: (status) => [...incidents.values()].map(view).filter((v) => !status || v.status === status),
    byKey: (k) => [...incidents.values()].find((i) => i.key === k),
    list: () => [...incidents.values()].map(({ id, playbook, state, threadKey, startedAt, events }) => ({ id, playbook, state, threadKey, startedAt, events: events.map((e) => ({ t: e.t, label: e.label })) })),
  };
}
