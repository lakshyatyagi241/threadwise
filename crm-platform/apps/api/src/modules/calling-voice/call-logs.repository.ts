import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { CallLogDirection, CallLogStatus, RecordScope } from '@crm/contracts';
import { likePattern, phoneSearch } from './call-logs.rules';

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (res as { rows: Row[] }).rows;
const num = (v: unknown): number => Number(v ?? 0);

/** Who is asking and what they may see (`call.logs.read`'s record scope over the person who handled the call). */
export interface Viewer {
  orgId: number;
  userId: number | null;
  scope: RecordScope;
}

export interface LogFilters {
  start: Date;
  end: Date | null;
  status?: CallLogStatus;
  direction?: CallLogDirection;
  numberUuid?: string;
  agentUuid?: string;
  q?: string;
}

/**
 * The log status as SQL. The same rule as `callLogStatus` (call-logs.rules.ts), which Reference wrote when it mirrored a call into
 * `ai_call_logs`; keep the two in step (the integration spec compares them on every combination).
 */
const STATUS = sql`(CASE
  WHEN w.status = 'failed' THEN 'failed'
  WHEN w.status = 'ended' AND w.duration_sec > 0 THEN 'completed'
  WHEN w.status = 'ended' AND upper(coalesce(w.end_reason, '')) IN ('DECLINED', 'REJECTED') THEN 'declined'
  WHEN w.status = 'ended' THEN 'no-answer'
  ELSE 'in-progress' END)`;
const ANSWERED = sql`(w.status = 'ended' AND w.duration_sec > 0)`;
const MISSED = sql`(w.direction = 'USER_INITIATED' AND w.status IN ('ended', 'failed') AND w.duration_sec <= 0)`;

const FROM = sql`FROM wa_calls w
  LEFT JOIN contacts ct ON ct.org_id = w.org_id AND ct.id = w.contact_id
  LEFT JOIN wa_provider_configs cfg ON cfg.org_id = w.org_id AND cfg.id = w.wa_provider_config_id
  LEFT JOIN users u ON u.org_id = w.org_id AND u.id = w.handler_user_id`;

/** Whose calls the viewer may read. `all`: every call of the workspace. `own`: the ones they handled. `team`: theirs and their teammates'. */
export function scopeClause(v: Viewer): SQL | null {
  if (v.scope === 'all') return null;
  if (v.userId === null) return sql`false`;
  if (v.scope === 'own') return sql`w.handler_user_id = ${v.userId}`;
  return sql`(w.handler_user_id = ${v.userId} OR w.handler_user_id IN (
    SELECT tm2.user_id FROM team_members tm1
    JOIN team_members tm2 ON tm2.org_id = tm1.org_id AND tm2.team_id = tm1.team_id
    WHERE tm1.org_id = ${v.orgId} AND tm1.user_id = ${v.userId}))`;
}

const and = (parts: Array<SQL | null | undefined | false | ''>): SQL => {
  const real = parts.filter((p): p is SQL => !!p);
  return real.length ? sql.join(real, sql` AND `) : sql`true`;
};

function filterClause(v: Viewer, f: LogFilters): SQL {
  const digits = f.q ? phoneSearch(f.q) : null;
  return and([
    sql`w.org_id = ${v.orgId}`,
    scopeClause(v),
    sql`w.started_at >= ${f.start.toISOString()}::timestamptz`,
    f.end && sql`w.started_at < ${f.end.toISOString()}::timestamptz`,
    f.status && sql`${STATUS} = ${f.status}`,
    f.direction &&
      sql`w.direction = ${f.direction === 'inbound' ? 'USER_INITIATED' : 'BUSINESS_INITIATED'}`,
    f.numberUuid && sql`cfg.uuid = ${f.numberUuid}::uuid`,
    f.agentUuid && sql`u.uuid = ${f.agentUuid}::uuid`,
    f.q &&
      sql`(ct.name ILIKE ${likePattern(f.q)} OR ct.first_name ILIKE ${likePattern(f.q)}${
        digits
          ? sql` OR w.from_phone LIKE ${likePattern(digits)} OR w.to_phone LIKE ${likePattern(digits)}`
          : sql``
      })`,
  ]);
}

const ROW_COLS = sql`w.uuid, w.direction, w.status AS call_status, ${STATUS} AS log_status, w.duration_sec, w.end_reason, w.from_phone,
  w.to_phone, w.started_at, w.answered_at, w.ended_at, w.handler_type, (w.recording_path IS NOT NULL) AS has_recording,
  ct.uuid AS contact_uuid, coalesce(ct.name, ct.first_name) AS contact_name,
  cfg.uuid AS number_uuid, coalesce(cfg.display_label, cfg.phone_number) AS number_label,
  u.uuid AS handler_uuid, u.full_name AS handler_name`;

/** SQL of the call log and analytics. Every method runs in the caller's transaction; the workspace is `viewer.orgId` and RLS backs it. */
@Injectable()
export class CallLogsRepository {
  /** One page of the log, newest first. */
  async page(tx: Tx, v: Viewer, f: LogFilters, limit: number, offset: number): Promise<Row[]> {
    const res = await tx.execute(sql`
      SELECT ${ROW_COLS} ${FROM}
      WHERE ${filterClause(v, f)}
      ORDER BY w.started_at DESC, w.id DESC
      LIMIT ${limit} OFFSET ${offset}`);
    return rowsOf(res);
  }

  /** What the filters select: the count (for the pages) and the cards under Reference's four. */
  async selection(tx: Tx, v: Viewer, f: LogFilters) {
    const res = await tx.execute(sql`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE ${ANSWERED}) AS answered,
             count(*) FILTER (WHERE ${MISSED}) AS missed,
             coalesce(round(avg(w.duration_sec) FILTER (WHERE ${ANSWERED})), 0) AS avg_sec,
             coalesce(sum(w.duration_sec), 0) AS total_sec
      ${FROM}
      WHERE ${filterClause(v, f)}`);
    const r = rowsOf(res)[0] ?? {};
    return {
      total: num(r.total),
      answered: num(r.answered),
      missed: num(r.missed),
      avgDurationSec: num(r.avg_sec),
      totalMinutes: Math.floor(num(r.total_sec) / 60),
    };
  }

  /** Reference's four cards: every call the viewer may see, whatever the filters say. */
  async workspaceTotals(tx: Tx, v: Viewer) {
    const res = await tx.execute(sql`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE w.started_at >= now() - interval '24 hours') AS last24h,
             coalesce(sum(w.duration_sec) FILTER (WHERE w.started_at >= now() - interval '24 hours'), 0) AS sec24h,
             count(*) FILTER (WHERE ${STATUS} = 'completed') AS completed,
             count(*) FILTER (WHERE ${STATUS} IN ('failed', 'no-answer')) AS failed
      ${FROM}
      WHERE ${and([sql`w.org_id = ${v.orgId}`, scopeClause(v)])}`);
    const r = rowsOf(res)[0] ?? {};
    return {
      total: num(r.total),
      last24h: num(r.last24h),
      minutes24h: Math.floor(num(r.sec24h) / 60),
      completed: num(r.completed),
      failed: num(r.failed),
    };
  }

  async numbers(tx: Tx, orgId: number) {
    const res = await tx.execute(sql`
      SELECT uuid, coalesce(display_label, phone_number) AS label, phone_number
      FROM wa_provider_configs WHERE org_id = ${orgId} AND provider = 'waba'
      ORDER BY is_primary DESC, connected_at DESC NULLS LAST, id`);
    return rowsOf(res).map((r) => ({
      id: String(r.uuid),
      label: String(r.label ?? ''),
      phoneNumber: (r.phone_number as string | null) ?? null,
    }));
  }

  /** The teammates who handled a call the viewer may see. */
  async agents(tx: Tx, v: Viewer) {
    const res = await tx.execute(sql`
      SELECT DISTINCT u.uuid, u.full_name ${FROM}
      WHERE ${and([sql`w.org_id = ${v.orgId}`, scopeClause(v), sql`u.id IS NOT NULL`])}
      ORDER BY u.full_name, u.uuid`);
    return rowsOf(res).map((r) => ({ id: String(r.uuid), name: String(r.full_name) }));
  }

  /** One call by uuid, when the viewer may see it. */
  async byUuid(tx: Tx, v: Viewer, uuid: string) {
    const res = await tx.execute(sql`
      SELECT w.id, w.recording_path, w.conversation_id, conv.uuid AS conversation_uuid, ${ROW_COLS},
             w.recording_consent_status, w.recording_consent_method, w.recording_consent_at, w.recording_notice_version,
             w.recording_notice_sha256, w.recording_stored_at, w.recording_legal_hold, w.recording_hold_reason,
             w.recording_deleted_at, w.recording_deleted_reason,
             coalesce((SELECT s.retention_days FROM call_recording_settings s WHERE s.org_id = w.org_id), 90) AS retention_days
      ${FROM}
      LEFT JOIN conversations conv ON conv.org_id = w.org_id AND conv.id = w.conversation_id
      WHERE ${and([sql`w.org_id = ${v.orgId}`, scopeClause(v), sql`w.uuid = ${uuid}::uuid`])}`);
    return rowsOf(res)[0] ?? null;
  }

  async timeline(tx: Tx, orgId: number, callId: number) {
    const res = await tx.execute(sql`
      SELECT event_type, received_at, payload FROM wa_call_events
      WHERE org_id = ${orgId} AND wa_call_id = ${callId}
      ORDER BY received_at, id`);
    return rowsOf(res);
  }

  // --- analytics -------------------------------------------------------------------------------------------------------------

  private window(v: Viewer, start: Date, end: Date, numberUuid?: string): SQL {
    return and([
      sql`w.org_id = ${v.orgId}`,
      scopeClause(v),
      sql`w.started_at >= ${start.toISOString()}::timestamptz`,
      sql`w.started_at < ${end.toISOString()}::timestamptz`,
      numberUuid && sql`cfg.uuid = ${numberUuid}::uuid`,
    ]);
  }

  async analyticsTotals(tx: Tx, v: Viewer, start: Date, end: Date, numberUuid?: string) {
    const res = await tx.execute(sql`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE w.status IN ('ended', 'failed')) AS finished,
             count(*) FILTER (WHERE ${ANSWERED}) AS answered,
             count(*) FILTER (WHERE ${MISSED}) AS missed,
             coalesce(round(avg(w.duration_sec) FILTER (WHERE ${ANSWERED})), 0) AS avg_sec,
             coalesce(sum(w.duration_sec), 0) AS total_sec
      ${FROM} WHERE ${this.window(v, start, end, numberUuid)}`);
    const r = rowsOf(res)[0] ?? {};
    return {
      total: num(r.total),
      finished: num(r.finished),
      answered: num(r.answered),
      missed: num(r.missed),
      avgHandleSec: num(r.avg_sec),
      totalMinutes: Math.floor(num(r.total_sec) / 60),
    };
  }

  /** Calls per local day. Days with no call are not returned (the service fills them). */
  async analyticsDaily(tx: Tx, v: Viewer, start: Date, end: Date, tz: string, numberUuid?: string) {
    const res = await tx.execute(sql`
      SELECT to_char((w.started_at AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS day,
             count(*) AS total,
             count(*) FILTER (WHERE ${ANSWERED}) AS answered,
             count(*) FILTER (WHERE ${MISSED}) AS missed
      ${FROM} WHERE ${this.window(v, start, end, numberUuid)}
      GROUP BY 1 ORDER BY 1`);
    return rowsOf(res).map((r) => ({
      day: String(r.day),
      total: num(r.total),
      answered: num(r.answered),
      missed: num(r.missed),
    }));
  }

  async analyticsByAgent(tx: Tx, v: Viewer, start: Date, end: Date, numberUuid?: string) {
    const res = await tx.execute(sql`
      SELECT u.uuid AS agent_uuid, u.full_name AS name, count(*) AS calls,
             count(*) FILTER (WHERE ${ANSWERED}) AS answered,
             coalesce(round(avg(w.duration_sec) FILTER (WHERE ${ANSWERED})), 0) AS avg_sec,
             coalesce(sum(w.duration_sec), 0) AS total_sec
      ${FROM} WHERE ${this.window(v, start, end, numberUuid)}
      GROUP BY u.uuid, u.full_name
      ORDER BY count(*) DESC, u.full_name NULLS LAST`);
    return rowsOf(res).map((r) => ({
      agentId: (r.agent_uuid as string | null) ?? null,
      name: (r.name as string | null) ?? null,
      calls: num(r.calls),
      answered: num(r.answered),
      avgHandleSec: num(r.avg_sec),
      totalMinutes: Math.floor(num(r.total_sec) / 60),
    }));
  }

  async analyticsHeatmap(
    tx: Tx,
    v: Viewer,
    start: Date,
    end: Date,
    tz: string,
    numberUuid?: string,
  ) {
    const res = await tx.execute(sql`
      SELECT extract(dow FROM w.started_at AT TIME ZONE ${tz})::int AS weekday,
             extract(hour FROM w.started_at AT TIME ZONE ${tz})::int AS hour,
             count(*) AS calls
      ${FROM} WHERE ${this.window(v, start, end, numberUuid)}
      GROUP BY 1, 2 ORDER BY 1, 2`);
    return rowsOf(res).map((r) => ({
      weekday: num(r.weekday),
      hour: num(r.hour),
      calls: num(r.calls),
    }));
  }
}
