// Slow-query watcher: polls pg_stat_activity (running too long) and pg_stat_statements (slow statements whose calls grew) with a
// READ-ONLY role. Every row is CLASSIFIED before alerting (slow / blocked / idle_in_tx; autovacuum, replication, backups, migrations and
// the watcher itself are excluded), posted to Slow Queries & Warnings (or Critical when severe) as a thread, and handed to the resolver (resolver.mjs).
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createGate, sanitizeSql } from './lib.mjs';
import { fmtDur } from './threads.mjs';
import { isExcluded, isPureSelect } from './resolver.mjs';

const ACTIVE_SQL = `select pid, datname, usename, application_name, state, extract(epoch from now()-query_start) as secs,
  extract(epoch from now()-state_change) as state_secs, extract(epoch from now()-xact_start) as xact_secs, query_start, xact_start,
  wait_event_type, wait_event, pg_blocking_pids(pid) as blockers, query_id::text as query_id, query
  from pg_stat_activity where backend_type='client backend' and pid<>pg_backend_pid() and state in ('active','idle in transaction')
  and application_name<>'gchat-watcher' order by query_start limit 300`;
const STMT_SQL = `select s.queryid::text as queryid, d.datname, r.rolname, s.calls::float8 as calls, s.total_exec_time, s.mean_exec_time, s.max_exec_time, s.rows::float8 as rows, s.query
  from pg_stat_statements s left join pg_database d on d.oid=s.dbid left join pg_roles r on r.oid=s.userid
  where s.mean_exec_time >= $1 and s.query not ilike '%pg_stat_statements%' and s.query not ilike '%pg_stat_activity%' order by s.mean_exec_time desc limit 200`;

export const cfg = (env) => ({
  intervalMs: Number(env.SLOW_POLL_SECONDS ?? 15) * 1000,
  runningSecs: Number(env.SLOW_RUNNING_SECONDS ?? 5),
  meanMs: Number(env.SLOW_MEAN_MS ?? 500),
  cooldownMs: Number(env.SLOW_COOLDOWN_SECONDS ?? 900) * 1000,
  perMinute: Number(env.SLOW_MAX_PER_MINUTE ?? 10),
  idleTxSecs: Number(env.SLOW_IDLE_TX_SECONDS ?? 60),
  critSecs: Number(env.CRITICAL_SLOW_SECONDS ?? 60),
  critBlockSecs: Number(env.CRITICAL_BLOCK_SECONDS ?? 30),
  hardSecs: Number(env.HARD_CANCEL_SECONDS ?? 120),
  idleBlockSecs: Number(env.IDLE_BLOCKER_SECONDS ?? 60),
  recurPolls: Number(env.STMT_RECURRING_POLLS ?? 3),
});

// Pure classification of one pg_stat_activity row. waiterSecs = longest wait among sessions blocked by this pid.
// -> null (not alert-worthy / excluded) | { kind: 'slow'|'blocked'|'idle_in_tx', severity: 'warning'|'critical', verdict }
export function classify(r, c, env = {}, waiterSecs = 0) {
  if (isExcluded(r, env)) return null;
  const blockers = r.blockers ?? [];
  if (r.state === 'idle in transaction') {
    if (Number(r.state_secs) < c.idleTxSecs) return null;
    return { kind: 'idle_in_tx', severity: waiterSecs >= c.critBlockSecs ? 'critical' : 'warning', verdict: `Idle in transaction (not a slow query)${waiterSecs > 0 ? `, blocking another session for ${Math.round(waiterSecs)} s` : ''}` };
  }
  if (Number(r.secs) < c.runningSecs) return null;
  if (blockers.length || r.wait_event_type === 'Lock') return { kind: 'blocked', severity: Number(r.secs) >= c.critBlockSecs ? 'critical' : 'warning', verdict: `Lock wait (blocked by pid ${blockers.join(', ') || '?'})` };
  const sev = Number(r.secs) >= c.critSecs || waiterSecs >= c.critBlockSecs ? 'critical' : 'warning';
  return { kind: 'slow', severity: sev, verdict: `Slow execution (${r.wait_event_type === 'IO' || r.wait_event_type === 'LWLock' ? 'IO' : 'CPU/IO'})${waiterSecs > 0 ? `, blocking another session for ${Math.round(waiterSecs)} s` : ''}` };
}

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const card = (title, rows, sub) => ({ text: title, cardsV2: [{ cardId: 'slow', card: { header: { title, subtitle: sub ?? 'Threadwise slow queries' }, sections: [{ widgets: rows.map(([k, v]) => ({ decoratedText: { topLabel: k, text: esc(v), wrapText: true } })) }] } }] });
const fmt = (n, d = 1) => Number(n).toFixed(d);
const sha = (s) => createHash('sha1').update(s).digest('hex');
const iso = (t) => (t ? new Date(t).toISOString() : '-');

// Pure core, injectable db.query for tests. send(channel, msg, {threadKey, meta}). Returns { poll, offenders, open }.
export function createWatcher({ query, env = process.env, metrics, send, log = () => {}, now = Date.now, resolver }) {
  const c = cfg(env);
  const gate = createGate({ cooldownMs: c.cooldownMs, perMinute: c.perMinute, now });
  const prev = new Map(), recur = new Map(), open = new Map(); // statement baselines, recurring statements, alerts awaiting their end
  let baselined = false, suppressed = 0, warnedNoStmts = false, offenders = [];
  metrics.set('crm_slow_query_max_seconds', 'gauge', 0);
  metrics.set('pg_stat_statements_available', 'gauge', 0);
  const emit = async (kind, key, msg, opts) => {
    const g = gate.allow(key);
    if (g !== 'send') { if (g === 'limited') suppressed++; metrics.inc('crm_slow_query_events_total', `kind="${g === 'limited' ? 'suppressed' : 'deduped'}"`); return false; }
    metrics.inc('crm_slow_query_events_total', `kind="${kind}"`);
    await send(opts.channel, msg, { threadKey: opts.threadKey, meta: opts.meta });
    return true;
  };
  async function planHint(r, text) {
    // Plain EXPLAIN (never ANALYZE) only for a pure SELECT whose normalized text has NO literal/parameter (nothing was stripped), else skipped.
    if (!isPureSelect(r.query) || /[?$]/.test(text)) return 'skipped (query has parameters/literals; EXPLAIN is only run on literal-free SELECTs)';
    try {
      const plan = (await query(`explain ${r.query}`, [])).rows.map((x) => x['QUERY PLAN']).join('\n');
      const hits = [...plan.matchAll(/(Seq Scan|Index Only Scan|Index Scan|Bitmap Heap Scan) on (\S+).*?rows=(\d+)/g)].slice(0, 3);
      const out = [];
      for (const h of hits) {
        const sz = await query('select pg_total_relation_size(to_regclass($1)) as b', [h[2]]).then((x) => Number(x.rows[0]?.b), () => NaN);
        out.push(`${h[1]} on ${h[2]} (est. rows ${h[3]}${Number.isFinite(sz) ? `, ${Math.round(sz / 1048576)} MB` : ''})${h[1] === 'Seq Scan' && Number(h[3]) > 10000 ? ' <- seq scan on a big table: likely missing index' : ''}`);
      }
      return out.join('; ') || 'no table scan in the plan';
    } catch { return 'unavailable'; }
  }
  async function statsLine(r) {
    if (!r.query_id) return 'n/a (no query_id)';
    try {
      const s = (await query('select calls, mean_exec_time, max_exec_time from pg_stat_statements where queryid=$1::bigint limit 1', [r.query_id])).rows[0];
      return s ? `${s.calls} completed calls, mean ${fmt(s.mean_exec_time, 0)} ms, max ${fmt(s.max_exec_time, 0)} ms` : 'no completed execution recorded yet (first run)';
    } catch { return 'unavailable'; }
  }
  async function poll() {
    let maxSecs = 0;
    try {
      const rows = (await query(ACTIVE_SQL, [])).rows;
      const byPid = new Map(rows.map((r) => [r.pid, r])), waiter = {};
      for (const r of rows) for (const b of r.blockers ?? []) waiter[b] = Math.max(waiter[b] ?? 0, Number(r.secs));
      const seen = new Set(); offenders = [];
      for (const r of rows) {
        const k = classify(r, c, env, waiter[r.pid] ?? 0);
        if (!k) { if (isExcluded(r, env)) metrics.inc('crm_slow_query_events_total', 'kind="excluded"'); continue; }
        const text = sanitizeSql(r.query, 800), secs = Number(k.kind === 'idle_in_tx' ? r.state_secs : r.secs);
        if (k.kind === 'slow') maxSecs = Math.max(maxSecs, secs);
        const ok = `${r.pid}:${iso(r.query_start)}:${k.kind}`; seen.add(ok);
        const o = open.get(ok); if (o) o.peak = Math.max(o.peak, secs);
        offenders.push({ kind: k.kind, row: r, text, waiterSecs: waiter[r.pid] ?? 0 });
        const channel = k.severity === 'critical' ? 'critical' : 'slowquery', h = sha(`${r.datname}|${k.kind}|${text}`), threadKey = `sq-${h.slice(0, 16)}`;
        const blk = (r.blockers ?? []).map((p) => byPid.get(p)).filter(Boolean)[0];
        const rowsOut = [['Verdict', k.verdict], ['Duration', `${fmt(secs)} s (${k.kind === 'idle_in_tx' ? 'time idle in transaction' : 'now() - query_start'})`], ['Database / role / app', `${r.datname} / ${r.usename} / ${r.application_name || '-'}`],
          ['Evidence (verify in psql)', `pid ${r.pid}, query_start ${iso(r.query_start)}, state ${r.state}, wait_event ${r.wait_event_type ?? '-'}/${r.wait_event ?? '-'}, xact age ${r.xact_secs == null ? '-' : fmt(r.xact_secs, 0)} s`]];
        if (k.kind === 'blocked') rowsOut.push(['Blocker', (r.blockers ?? []).map((p) => { const b = byPid.get(p); return b ? `pid ${p} (${b.state}, ${fmt(b.xact_secs ?? b.secs, 0)} s in xact): ${sanitizeSql(b.query, 200)}` : `pid ${p} (not visible)`; }).join(' | ') || 'unknown']);
        if (k.kind === 'slow') rowsOut.push(['pg_stat_statements cross-check', await statsLine(r)], ['Plan hint (plain EXPLAIN)', await planHint(r, text)]);
        rowsOut.push(['Query (normalized)', text]);
        const title = k.kind === 'idle_in_tx' ? `Idle in transaction ${fmt(secs, 0)} s` : k.kind === 'blocked' ? `Blocked query waiting ${fmt(secs)} s` : `Slow query running ${fmt(secs)} s`;
        const sent = await emit(k.kind === 'slow' ? 'running' : k.kind, `act:${h}|${k.severity}`, card(`${k.severity === 'critical' ? 'CRITICAL: ' : ''}${title}`, rowsOut), { channel, threadKey, meta: { kind: k.kind, severity: k.severity, app: r.application_name, pid: r.pid, secs } });
        if (sent && o && !o.channels.has(channel)) { // escalated: thread in Critical, pointer reply in the earlier thread
          if (channel === 'critical') await send('slowquery', card(`Escalated to Critical at ${fmt(secs, 0)} s`, [['Where', 'see the thread in the Critical space']]), { threadKey, meta: { kind: 'pointer' } });
          o.channels.add(channel);
        }
        if (sent && !o) open.set(ok, { rkey: `${k.kind}:${r.pid}:${iso(r.query_start)}`, threadKey, channels: new Set([channel]), start: now(), peak: secs, title, kind: k.kind });
        const act = (k.kind === 'slow' && secs >= c.hardSecs) || (k.kind === 'idle_in_tx' && secs >= c.idleBlockSecs && (waiter[r.pid] ?? 0) > 0);
        if (act && resolver) resolver.handle({ playbook: k.kind === 'slow' ? 'cancel_select' : 'terminate_idle', key: `${k.kind}:${r.pid}:${iso(r.query_start)}`, threadKey, channel, channels: [...(open.get(ok)?.channels ?? [channel])], row: r, text, waiterSecs: waiter[r.pid] ?? 0, diagnosis: `${k.verdict}. ${rowsOut[3][1]}`, suggestion: 'cancel the query / fix the application transaction handling', evidence: rowsOut[3][1] });
      }
      // alerts whose session is gone: reply in their thread (skipped when the resolver already owns the incident)
      for (const [ok, o] of open) {
        if (seen.has(ok)) continue;
        open.delete(ok);
        if (resolver?.byKey(o.rkey)) continue;
        for (const ch of o.channels) await send(ch, card(`RESOLVED after ${fmtDur(now() - o.start)} (finished on its own)`, [['What it was', o.title], ['Peak observed', `${fmt(o.peak)} s`], ['How it ended', 'the session is no longer active/idle-in-transaction at the next poll; the exact end time is within one poll interval']]), { threadKey: o.threadKey, meta: { kind: 'ended', ok } });
      }
      try {
        const st = await query(STMT_SQL, [c.meanMs]);
        metrics.set('pg_stat_statements_available', 'gauge', 1);
        const present = new Set();
        for (const r of st.rows) {
          const key = `${r.queryid}|${r.datname}|${r.rolname}`; present.add(key); // one queryid appears once per database and role
          const p = prev.get(key);
          prev.set(key, { calls: Number(r.calls), total: Number(r.total_exec_time) });
          if (!baselined || !p || Number(r.calls) <= p.calls) continue; // first sight or reset: baseline only
          const dCalls = Number(r.calls) - p.calls, dMean = (Number(r.total_exec_time) - p.total) / dCalls;
          const rc = recur.get(key);
          if (dMean < c.meanMs) { if (rc && ++rc.quiet >= c.recurPolls && resolver) { await resolver.statementRecovered(`st:${key}`); recur.delete(key); } continue; } // lifetime mean is high, but NEW calls are fast: not a live problem
          maxSecs = Math.max(maxSecs, Number(r.max_exec_time) / 1000);
          const text = sanitizeSql(r.query, 800), rcc = recur.get(key) ?? { slow: 0, quiet: 0, first: now() }; rcc.slow++; rcc.quiet = 0; recur.set(key, rcc);
          const threadKey = `st-${sha(key).slice(0, 16)}`;
          await emit('statement', `st:${key}`, card(`Slow statement: mean ${fmt(r.mean_exec_time, 0)} ms`, [
            ['Verdict', 'Slow execution (statement mean over threshold, new calls also slow)'], ['Calls since last poll', dCalls], ['Mean (lifetime / since poll)', `${fmt(r.mean_exec_time, 0)} ms / ${fmt(dMean, 0)} ms`], ['Max', `${fmt(r.max_exec_time, 0)} ms`], ['Rows (lifetime)', r.rows],
            ['Database', r.datname ?? '-'], ['Role', r.rolname ?? '-'], ['Query (normalized)', text]]), { channel: 'slowquery', threadKey, meta: { kind: 'statement' } });
          if (rcc.slow >= c.recurPolls && resolver) resolver.handle({ playbook: 'code_fix', key: `st:${key}`, threadKey, channel: 'slowquery', text, diagnosis: `Recurring slow statement: new calls averaged ${fmt(dMean, 0)} ms for ${rcc.slow} polls`, suggestion: 'add an index / rewrite the query', file: { normalized_query: text, queryid: r.queryid, database: r.datname, calls: r.calls, mean_ms: Number(r.mean_exec_time), max_ms: Number(r.max_exec_time), first_seen: new Date(rcc.first).toISOString(), last_seen: new Date(now()).toISOString(), verdict: 'recurring slow statement' } });
        }
        for (const [key, rc] of recur) if (!present.has(key) && ++rc.quiet >= c.recurPolls) { if (resolver) await resolver.statementRecovered(`st:${key}`); recur.delete(key); }
        baselined = true;
      } catch (e) {
        if (['42P01', '55000', '42501', '0A000'].includes(e.code)) {
          metrics.set('pg_stat_statements_available', 'gauge', 0);
          if (!warnedNoStmts) { warnedNoStmts = true; log({ evt: 'pg_stat_statements_unavailable', code: e.code, hint: 'needs shared_preload_libraries=pg_stat_statements and CREATE EXTENSION; running-query checks continue' }); }
        } else throw e;
      }
      if (suppressed > 0 && gate.allow('digest:' + Math.floor(now() / 60000)) === 'send') {
        await send('slowquery', { text: `${suppressed} more slow-query events were held back by the rate limit (max ${c.perMinute}/min). See the Threadwise slow queries dashboard.` });
        metrics.inc('crm_slow_query_events_total', 'kind="digest"'); suppressed = 0;
      }
      metrics.set('crm_slow_query_max_seconds', 'gauge', maxSecs);
      metrics.set('crm_slow_query_watcher_last_poll_timestamp', 'gauge', now() / 1000);
    } catch (e) {
      metrics.inc('crm_slow_query_watcher_errors_total');
      log({ evt: 'watcher_poll_error', code: e.code ?? 'error' });
    }
  }
  return { poll, intervalMs: c.intervalMs, offenders: () => offenders, open };
}

const readSecret = (v, file) => { if (v) return v; try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; } };

export function startWatcher({ env, metrics, send, log, resolverFactory }) {
  const url = readSecret(env.SLOW_PG_URL, env.SLOW_PG_URL_FILE ?? '/run/secrets/slow_query_pg_url');
  if (!url) { log({ evt: 'watcher_disabled', reason: 'no SLOW_PG_URL or secret file' }); return null; }
  const { Client } = createRequire(`${process.cwd()}/`)('pg');
  const client = new Client({ connectionString: url, application_name: 'gchat-watcher', statement_timeout: 5000 });
  client.on('error', () => { /* reconnect on next poll */ });
  let connected = false;
  const query = async (sql, params) => {
    if (!connected) { await client.connect(); await client.query('set default_transaction_read_only = on'); connected = true; }
    return client.query(sql, params);
  };
  // Separate OPTIONAL role for the two actions; without it the resolver only suggests and ESCALATES.
  const curl = readSecret(env.SLOW_CANCEL_PG_URL, env.SLOW_CANCEL_PG_URL_FILE ?? '/run/secrets/slow_query_cancel_pg_url');
  let db = {}, cc;
  if (curl) {
    cc = new Client({ connectionString: curl, application_name: 'gchat-resolver', statement_timeout: 5000 }); cc.on('error', () => {}); let up = false;
    const q = async (sql, p) => { if (!up) { await cc.connect(); up = true; } return cc.query(sql, p); };
    const same = async (r) => (await q(`select 1 from pg_stat_activity where pid=$1 and date_trunc('milliseconds', query_start) = date_trunc('milliseconds', $2::timestamptz) and state=$3`, [r.pid, r.query_start, r.state])).rowCount > 0;
    db = { recheck: same, cancel: async (pid) => (await q('select pg_cancel_backend($1) as ok', [pid])).rows[0].ok, terminate: async (pid) => (await q('select pg_terminate_backend($1) as ok', [pid])).rows[0].ok };
  }
  db.isGone = async (r) => !(await query(`select 1 from pg_stat_activity where pid=$1 and date_trunc('milliseconds', query_start) = date_trunc('milliseconds', $2::timestamptz) and state=$3`, [r.pid, r.query_start, r.state])).rowCount;
  let w; const resolver = resolverFactory?.({ db, offenders: () => w.offenders() });
  w = createWatcher({ query, env, metrics, send, log, resolver });
  const t = setInterval(() => w.poll(), w.intervalMs);
  t.unref?.();
  w.poll();
  return { stop: () => { clearInterval(t); client.end().catch(() => {}); cc?.end().catch(() => {}); } };
}
