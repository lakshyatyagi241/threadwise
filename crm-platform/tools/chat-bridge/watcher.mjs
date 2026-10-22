// Slow-query watcher: polls pg_stat_activity (running too long) and pg_stat_statements (slow statements whose calls grew) with a
// READ-ONLY role and posts normalized SQL (no literals) to the Slow Queries space. See docs/runbooks/google-chat-alerts.md.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createGate, sanitizeSql } from './lib.mjs';

const ACTIVE_SQL = `select pid, datname, usename, application_name, extract(epoch from now()-query_start) as secs, wait_event_type, query
  from pg_stat_activity where state='active' and backend_type='client backend' and pid<>pg_backend_pid()
  and application_name<>'gchat-watcher' and now()-query_start >= make_interval(secs => $1) order by query_start limit 20`;
const STMT_SQL = `select s.queryid::text as queryid, d.datname, r.rolname, s.calls::float8 as calls, s.total_exec_time, s.mean_exec_time, s.max_exec_time, s.rows::float8 as rows, s.query
  from pg_stat_statements s left join pg_database d on d.oid=s.dbid left join pg_roles r on r.oid=s.userid
  where s.mean_exec_time >= $1 and s.query not ilike '%pg_stat_statements%' and s.query not ilike '%pg_stat_activity%' order by s.mean_exec_time desc limit 200`;

export const cfg = (env) => ({
  intervalMs: Number(env.SLOW_POLL_SECONDS ?? 15) * 1000,
  runningSecs: Number(env.SLOW_RUNNING_SECONDS ?? 5),
  meanMs: Number(env.SLOW_MEAN_MS ?? 500),
  cooldownMs: Number(env.SLOW_COOLDOWN_SECONDS ?? 900) * 1000,
  perMinute: Number(env.SLOW_MAX_PER_MINUTE ?? 10),
});

const card = (title, rows, sub) => ({
  text: `${title}`,
  cardsV2: [{ cardId: 'slow', card: { header: { title, subtitle: sub ?? 'Threadwise slow queries' }, sections: [{ widgets: rows.map(([k, v]) => ({ decoratedText: { topLabel: k, text: String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;'), wrapText: true } })) }] } }],
});
const fmt = (n, d = 1) => Number(n).toFixed(d);

// Pure core, injectable db.query for tests. Returns { poll() }.
export function createWatcher({ query, env = process.env, metrics, send, log = () => {}, now = Date.now }) {
  const c = cfg(env);
  const gate = createGate({ cooldownMs: c.cooldownMs, perMinute: c.perMinute, now });
  const prev = new Map(); // queryid -> { calls, total }
  let baselined = false, suppressed = 0, warnedNoStmts = false;
  metrics.set('crm_slow_query_max_seconds', 'gauge', 0);
  metrics.set('pg_stat_statements_available', 'gauge', 0);
  const emit = async (kind, key, msg) => {
    const g = gate.allow(key);
    if (g !== 'send') { if (g === 'limited') suppressed++; metrics.inc('crm_slow_query_events_total', `kind="${g === 'limited' ? 'suppressed' : 'deduped'}"`); return; }
    metrics.inc('crm_slow_query_events_total', `kind="${kind}"`);
    await send('slowquery', msg);
  };
  async function poll() {
    let maxSecs = 0;
    try {
      const act = await query(ACTIVE_SQL, [c.runningSecs]);
      for (const r of act.rows) {
        const text = sanitizeSql(r.query, 800);
        maxSecs = Math.max(maxSecs, Number(r.secs));
        await emit('running', `act:${createHash('sha1').update(`${r.datname}|${text}`).digest('hex')}`, card(`Slow query running ${fmt(r.secs)} s`, [
          ['Duration', `${fmt(r.secs)} s`], ['Database', r.datname], ['Role', r.usename], ['App', r.application_name || '-'], ['Waiting on', r.wait_event_type || '-'], ['Query (normalized)', text],
        ]));
      }
      try {
        const st = await query(STMT_SQL, [c.meanMs]);
        metrics.set('pg_stat_statements_available', 'gauge', 1);
        for (const r of st.rows) {
          const key = `${r.queryid}|${r.datname}|${r.rolname}`; // one queryid appears once per database and role
          const p = prev.get(key);
          prev.set(key, { calls: Number(r.calls), total: Number(r.total_exec_time) });
          if (!baselined || !p || Number(r.calls) <= p.calls) continue; // first sight or reset: baseline only
          const dCalls = Number(r.calls) - p.calls, dMean = (Number(r.total_exec_time) - p.total) / dCalls;
          maxSecs = Math.max(maxSecs, Number(r.max_exec_time) / 1000);
          await emit('statement', `st:${key}`, card(`Slow statement: mean ${fmt(r.mean_exec_time, 0)} ms`, [
            ['Calls since last poll', dCalls], ['Mean (lifetime / since poll)', `${fmt(r.mean_exec_time, 0)} ms / ${fmt(dMean, 0)} ms`], ['Max', `${fmt(r.max_exec_time, 0)} ms`], ['Rows (lifetime)', r.rows],
            ['Database', r.datname ?? '-'], ['Role', r.rolname ?? '-'], ['Query (normalized)', sanitizeSql(r.query, 800)],
          ]));
        }
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
  return { poll, intervalMs: c.intervalMs };
}

export function startWatcher({ env, metrics, send, log }) {
  let url = env.SLOW_PG_URL;
  if (!url) { try { url = fs.readFileSync(env.SLOW_PG_URL_FILE ?? '/run/secrets/slow_query_pg_url', 'utf8').trim(); } catch { /* unconfigured */ } }
  if (!url) { log({ evt: 'watcher_disabled', reason: 'no SLOW_PG_URL or secret file' }); return null; }
  const { Client } = createRequire(`${process.cwd()}/`)('pg');
  const client = new Client({ connectionString: url, application_name: 'gchat-watcher', statement_timeout: 5000 });
  client.on('error', () => { /* reconnect on next poll */ });
  let connected = false;
  const w = createWatcher({
    query: async (sql, params) => {
      if (!connected) { await client.connect(); await client.query('set default_transaction_read_only = on'); connected = true; }
      return client.query(sql, params);
    },
    env, metrics, send, log,
  });
  const t = setInterval(() => w.poll(), w.intervalMs);
  t.unref?.();
  w.poll();
  return { stop: () => { clearInterval(t); client.end().catch(() => {}); } };
}
