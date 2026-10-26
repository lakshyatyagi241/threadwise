// Sheet3 D-06: the weekly slow-query digest. Every Monday (09:00 UTC by default) the watcher's read-only connection reads pg_stat_statements,
// subtracts the snapshot it took a week ago, and posts the statements that cost the most database time that week to Slow Queries & Warnings.
// The baseline lives in memory (the bridge has no volume): after a restart the first digest covers the time since the statistics were last
// reset and says so, and the next one is a full week.
import { fmtDur } from './threads.mjs';
import { sanitizeSql, widgetsOf } from './lib.mjs';

// total_exec_time is the cost of a statement (calls x mean), so the ranking is by what the database spent, not by the single slowest call.
export const DIGEST_SQL = `select s.queryid::text as queryid, s.calls::float8 as calls, s.total_exec_time, s.max_exec_time, left(s.query, 600) as q
  from pg_stat_statements s where s.calls > 0 and s.query not ilike '%pg_stat_statements%' and s.query not ilike '%pg_stat_activity%'`;
export const RESET_SQL = `select stats_reset from pg_stat_statements_info`;

export const digestCfg = (env) => ({
  day: Number(env.SLOW_DIGEST_DAY ?? 1), // 0 = Sunday ... 1 = Monday (UTC)
  hour: Number(env.SLOW_DIGEST_HOUR ?? 9), // UTC
  top: Number(env.SLOW_DIGEST_TOP ?? 10),
  thresholdMs: Number(env.SLOW_DIGEST_MEAN_MS ?? 120), // a statement is flagged when its mean is over this
  enabled: env.SLOW_DIGEST !== '0',
});

/** True during the configured hour of the configured weekday, and not again within 6 days of the last digest. */
export function digestDue(nowMs, lastSentMs, { day, hour }) {
  const d = new Date(nowMs);
  if (d.getUTCDay() !== day || d.getUTCHours() !== hour) return false;
  return lastSentMs == null || nowMs - lastSentMs > 6 * 86400_000;
}

/**
 * Statements ranked by database time over the interval between two snapshots (Maps queryid -> {calls, total, max, q}). `ref` null = the
 * counters themselves (lifetime since the statistics reset). A statement that is new or whose counters went backwards was reset: its current
 * value is used. `skip(text)` drops maintenance statements.
 * -> { totalMs, statements, top: [{ id, calls, totalMs, meanMs, maxMs, share, q }] }
 */
export function weeklyTop(ref, cur, { top = 10, skip = () => false } = {}) {
  const rows = [];
  let totalMs = 0;
  for (const [id, now] of cur) {
    const before = ref?.get(id);
    const fresh = !before || now.calls < before.calls || now.total < before.total;
    const calls = fresh ? now.calls : now.calls - before.calls;
    const ms = fresh ? now.total : now.total - before.total;
    if (calls <= 0 || skip(now.q ?? '')) continue;
    totalMs += ms;
    rows.push({ id, calls, totalMs: ms, meanMs: ms / calls, maxMs: now.max, q: now.q ?? '' });
  }
  rows.sort((a, b) => b.totalMs - a.totalMs);
  return {
    totalMs,
    statements: rows.length,
    top: rows.slice(0, top).map((r) => ({ ...r, share: totalMs > 0 ? r.totalMs / totalMs : 0 })),
  };
}

/** The Google Chat message. `sinceLabel` says whether it is a full week or since a statistics reset. */
export function digestMessage(w, { sinceLabel, thresholdMs }) {
  const title = `Weekly database digest: ${w.statements} statements, ${fmtDur(w.totalMs)} of database time`;
  if (!w.top.length) return { text: `${title}. Nothing ran in this period.` };
  const rows = w.top.map((r, i) => [
    `#${i + 1}  ${(r.share * 100).toFixed(1)} % of time${r.meanMs >= thresholdMs ? `  ·  mean over ${thresholdMs} ms` : ''}`,
    `${r.calls.toLocaleString('en')} calls · mean ${r.meanMs.toFixed(1)} ms · max ${r.maxMs.toFixed(0)} ms · total ${fmtDur(r.totalMs)}\n${sanitizeSql(r.q, 240)}`,
  ]);
  return {
    text: `${title} (${sinceLabel})`,
    cardsV2: [
      {
        cardId: 'digest',
        card: { header: { title, subtitle: sinceLabel }, sections: [{ widgets: widgetsOf(rows) }] },
      },
    ],
  };
}

/** Wires the digest to a clock: call `tick()` about once a minute. Never throws (a failed digest is logged and retried on the next tick). */
export function createDigest({
  query,
  send,
  log = () => {},
  now = Date.now,
  env = process.env,
  skip = () => false,
}) {
  const c = digestCfg(env);
  let baseline = null,
    lastSent = null,
    busy = false; // baseline: { t, map }
  const read = async () => {
    const map = new Map();
    for (const r of (await query(DIGEST_SQL, [])).rows)
      map.set(String(r.queryid), {
        calls: Number(r.calls),
        total: Number(r.total_exec_time),
        max: Number(r.max_exec_time),
        q: String(r.q ?? ''),
      });
    return map;
  };
  async function sinceReset() {
    try {
      const r = (await query(RESET_SQL, [])).rows[0]?.stats_reset;
      return r
        ? `since statistics reset ${new Date(r).toISOString().slice(0, 10)}`
        : 'since statistics reset';
    } catch {
      return 'since statistics reset';
    } // pg_stat_statements_info needs Postgres 14
  }
  async function tick() {
    if (!c.enabled || busy) return false;
    const t = now();
    busy = true;
    try {
      if (!baseline) baseline = { t, map: await read() };
      if (!digestDue(t, lastSent, c)) return false;
      const cur = await read();
      const full = t - baseline.t >= 5 * 86400_000; // started this week (a restart): lifetime counters instead, and say since when
      const sinceLabel = full
        ? `last 7 days, since ${new Date(baseline.t).toISOString().slice(0, 10)}`
        : await sinceReset();
      const w = weeklyTop(full ? baseline.map : null, cur, { top: c.top, skip });
      await send('slowquery', digestMessage(w, { sinceLabel, thresholdMs: c.thresholdMs }), {
        meta: { kind: 'weekly_digest' },
      });
      lastSent = t;
      baseline = { t, map: cur };
      return true;
    } catch (e) {
      log({ evt: 'digest_error', code: e.code ?? 'error' });
      return false;
    } finally {
      busy = false;
    }
  }
  return { tick, state: () => ({ lastSent, baselineAt: baseline?.t ?? null }) };
}
