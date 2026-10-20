import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { CallLogDirection, CallLogSource, CallLogStatus, RecordScope } from '@crm/contracts';
import { likePattern, phoneSearch } from './call-logs.rules';
import { scopeOwnerCondition } from '../../kernel/rbac/scope';

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
  /** Only calls that reached the log this way. */
  source?: CallLogSource;
  /** Only this contact's calls (the contact page). */
  contactId?: number;
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

/** The WhatsApp calls, in the shape the unified log reads (see UNIFIED). */
const WA_BRANCH = sql`SELECT 'whatsapp'::text AS source, w.org_id, w.id AS row_id, w.uuid, w.direction, w.status, w.duration_sec,
    w.end_reason, w.from_phone, w.to_phone, w.started_at, w.answered_at, w.ended_at, w.handler_type, w.handler_user_id, w.contact_id,
    w.wa_provider_config_id, (w.recording_path IS NOT NULL) AS has_recording, ${STATUS} AS log_status, ${ANSWERED} AS is_answered,
    ${MISSED} AS is_missed, NULL::text AS outcome, NULL::text AS notes, NULL::text AS number_label
  FROM wa_calls w`;

/**
 * A call log entry (a call that is not a WhatsApp call) written in the vocabulary of the WhatsApp rows, so that every filter, card and
 * chart below reads both the same way: Meta's two direction words, a status that is `ended` or `failed`, the customer's number as digits.
 * `log_status`, `is_answered` and `is_missed` are decided here, because an entry's talk time may be unknown (0) on a call that connected.
 */
const ENTRY_BRANCH = sql`SELECT e.source, e.org_id, e.id AS row_id, e.uuid,
    CASE e.direction WHEN 'inbound' THEN 'USER_INITIATED' ELSE 'BUSINESS_INITIATED' END AS direction,
    CASE WHEN e.outcome IN ('failed', 'wrong_number') THEN 'failed' ELSE 'ended' END AS status,
    e.duration_sec,
    CASE e.outcome WHEN 'connected' THEN 'COMPLETED' WHEN 'busy' THEN 'BUSY' WHEN 'declined' THEN 'DECLINED'
      WHEN 'failed' THEN 'FAILED' WHEN 'wrong_number' THEN 'FAILED' ELSE 'NO_ANSWER' END AS end_reason,
    CASE e.direction WHEN 'inbound' THEN regexp_replace(coalesce(e.customer_phone, ''), '[^0-9]', '', 'g')
      ELSE regexp_replace(coalesce(e.our_phone, ''), '[^0-9]', '', 'g') END AS from_phone,
    CASE e.direction WHEN 'inbound' THEN regexp_replace(coalesce(e.our_phone, ''), '[^0-9]', '', 'g')
      ELSE regexp_replace(coalesce(e.customer_phone, ''), '[^0-9]', '', 'g') END AS to_phone,
    e.started_at, NULL::timestamptz AS answered_at, e.started_at + make_interval(secs => e.duration_sec) AS ended_at,
    CASE WHEN e.handler_user_id IS NULL THEN 'none' ELSE 'operator' END AS handler_type, e.handler_user_id, e.contact_id,
    NULL::bigint AS wa_provider_config_id, (e.recording_ref IS NOT NULL) AS has_recording,
    CASE e.outcome WHEN 'connected' THEN 'completed' WHEN 'declined' THEN 'declined'
      WHEN 'failed' THEN 'failed' WHEN 'wrong_number' THEN 'failed' ELSE 'no-answer' END AS log_status,
    (e.outcome = 'connected') AS is_answered,
    (e.direction = 'inbound' AND e.outcome <> 'connected') AS is_missed,
    e.outcome, e.notes, e.number_label
  FROM call_log_entries e`;

/** Both logs as one set, `w` to everything below. Entries are left out entirely when the request is for WhatsApp only. */
const UNIFIED = sql`FROM (${WA_BRANCH} UNION ALL ${ENTRY_BRANCH}) w
  LEFT JOIN contacts ct ON ct.org_id = w.org_id AND ct.id = w.contact_id
  LEFT JOIN wa_provider_configs cfg ON cfg.org_id = w.org_id AND cfg.id = w.wa_provider_config_id
  LEFT JOIN users u ON u.org_id = w.org_id AND u.id = w.handler_user_id`;

/** One WhatsApp call by itself (the detail with its ledger and recording evidence reads this, not the union). */
const FROM = sql`FROM wa_calls w
  LEFT JOIN contacts ct ON ct.org_id = w.org_id AND ct.id = w.contact_id
  LEFT JOIN wa_provider_configs cfg ON cfg.org_id = w.org_id AND cfg.id = w.wa_provider_config_id
  LEFT JOIN users u ON u.org_id = w.org_id AND u.id = w.handler_user_id`;

/** Whose calls the viewer may read. `all`: every call of the workspace. `own`: the ones they handled. `team`: theirs and their teammates'. */
export function scopeClause(v: Viewer): SQL | null {
  return (
    scopeOwnerCondition({ orgId: v.orgId, userId: v.userId }, v.scope, sql`w.handler_user_id`) ??
    null
  );
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
    f.status && sql`w.log_status = ${f.status}`,
    f.direction &&
      sql`w.direction = ${f.direction === 'inbound' ? 'USER_INITIATED' : 'BUSINESS_INITIATED'}`,
    f.numberUuid && sql`cfg.uuid = ${f.numberUuid}::uuid`,
    f.agentUuid && sql`u.uuid = ${f.agentUuid}::uuid`,
    f.source && sql`w.source = ${f.source}`,
    f.contactId !== undefined && sql`w.contact_id = ${f.contactId}`,
    f.q &&
      sql`(ct.name ILIKE ${likePattern(f.q)} OR ct.first_name ILIKE ${likePattern(f.q)}${
        digits
          ? sql` OR w.from_phone LIKE ${likePattern(digits)} OR w.to_phone LIKE ${likePattern(digits)}`
          : sql``
      })`,
  ]);
}

/** The columns of one WhatsApp call (the detail reads it from `wa_calls` directly). */
const WA_ROW_COLS = sql`w.uuid, w.direction, w.status AS call_status, ${STATUS} AS log_status, w.duration_sec, w.end_reason, w.from_phone,
  w.to_phone, w.started_at, w.answered_at, w.ended_at, w.handler_type, (w.recording_path IS NOT NULL) AS has_recording,
  ct.uuid AS contact_uuid, coalesce(ct.name, ct.first_name) AS contact_name,
  cfg.uuid AS number_uuid, coalesce(cfg.display_label, cfg.phone_number) AS number_label,
  u.uuid AS handler_uuid, u.full_name AS handler_name`;

/** The columns of a row of the unified log, from either source. */
const ROW_COLS = sql`w.uuid, w.source, w.outcome, w.notes, w.direction, w.status AS call_status, w.log_status, w.duration_sec,
  w.end_reason, w.from_phone, w.to_phone, w.started_at, w.answered_at, w.ended_at, w.handler_type, w.has_recording,
  to_char(w.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started_iso,
  ct.uuid AS contact_uuid, coalesce(ct.name, ct.first_name) AS contact_name,
  cfg.uuid AS number_uuid, coalesce(w.number_label, cfg.display_label, cfg.phone_number) AS number_label,
  u.uuid AS handler_uuid, u.full_name AS handler_name`;

/** SQL of the call log and analytics. Every method runs in the caller's transaction; the workspace is `viewer.orgId` and RLS backs it. */
@Injectable()
export class CallLogsRepository {
  /** One page of the log, newest first. */
  async page(tx: Tx, v: Viewer, f: LogFilters, limit: number, offset: number): Promise<Row[]> {
    const res = await tx.execute(sql`
      SELECT ${ROW_COLS} ${UNIFIED}
      WHERE ${filterClause(v, f)}
      ORDER BY w.started_at DESC, w.row_id DESC, w.source
      LIMIT ${limit} OFFSET ${offset}`);
    return rowsOf(res);
  }

  /**
   * A contact's calls from both logs, newest first, a page at a time (keyset on the start time and the uuid: the two tables share no
   * id sequence). Asks for one more than `limit` so the caller can tell whether there is a next page.
   */
  async forContact(
    tx: Tx,
    v: Viewer,
    contactId: number,
    limit: number,
    after: { startedAt: string; uuid: string } | null,
    source?: CallLogSource,
  ): Promise<Row[]> {
    const res = await tx.execute(sql`
      SELECT ${ROW_COLS} ${UNIFIED}
      WHERE ${and([
        sql`w.org_id = ${v.orgId}`,
        sql`w.contact_id = ${contactId}`,
        scopeClause(v),
        source && sql`w.source = ${source}`,
        after &&
          sql`(w.started_at, w.uuid) < (${after.startedAt}::timestamptz, ${after.uuid}::uuid)`,
      ])}
      ORDER BY w.started_at DESC, w.uuid DESC
      LIMIT ${limit + 1}`);
    return rowsOf(res);
  }

  /** One logged call (not a WhatsApp one) by uuid, when the viewer may see it. */
  async entryByUuid(tx: Tx, v: Viewer, uuid: string) {
    const res = await tx.execute(sql`
      SELECT ${ROW_COLS}, tk.uuid AS task_uuid
      ${UNIFIED}
      LEFT JOIN call_log_entries ce ON ce.org_id = w.org_id AND ce.uuid = w.uuid AND w.source <> 'whatsapp'
      LEFT JOIN tasks tk ON tk.org_id = ce.org_id AND tk.id = ce.follow_up_task_id
      WHERE ${and([
        sql`w.org_id = ${v.orgId}`,
        sql`w.source <> 'whatsapp'`,
        scopeClause(v),
        sql`w.uuid = ${uuid}::uuid`,
      ])}`);
    return rowsOf(res)[0] ?? null;
  }

  /** What the filters select: the count (for the pages) and the cards under Reference's four. */
  async selection(tx: Tx, v: Viewer, f: LogFilters) {
    const res = await tx.execute(sql`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE w.is_answered) AS answered,
             count(*) FILTER (WHERE w.is_missed) AS missed,
             coalesce(round(avg(w.duration_sec) FILTER (WHERE w.is_answered AND w.duration_sec > 0)), 0) AS avg_sec,
             coalesce(sum(w.duration_sec), 0) AS total_sec
      ${UNIFIED}
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
             count(*) FILTER (WHERE w.log_status = 'completed') AS completed,
             count(*) FILTER (WHERE w.log_status IN ('failed', 'no-answer')) AS failed
      ${UNIFIED}
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
      SELECT DISTINCT u.uuid, u.full_name ${UNIFIED}
      WHERE ${and([sql`w.org_id = ${v.orgId}`, scopeClause(v), sql`u.id IS NOT NULL`])}
      ORDER BY u.full_name, u.uuid`);
    return rowsOf(res).map((r) => ({ id: String(r.uuid), name: String(r.full_name) }));
  }

  /** One call by uuid, when the viewer may see it. */
  async byUuid(tx: Tx, v: Viewer, uuid: string) {
    const res = await tx.execute(sql`
      SELECT w.id, w.recording_path, w.conversation_id, conv.uuid AS conversation_uuid, ${WA_ROW_COLS},
             w.recording_consent_status, w.recording_consent_method, w.recording_consent_at, w.recording_notice_version,
             w.recording_notice_sha256, w.recording_stored_at, w.recording_legal_hold, w.recording_hold_reason,
             w.recording_deleted_at, w.recording_deleted_reason,
             coalesce((SELECT s.retention_days FROM call_recording_settings s WHERE s.org_id = w.org_id), retention_live_days('call_recordings', 90)) AS retention_days
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

  private window(
    v: Viewer,
    start: Date,
    end: Date,
    numberUuid?: string,
    source?: CallLogSource,
  ): SQL {
    return and([
      sql`w.org_id = ${v.orgId}`,
      scopeClause(v),
      sql`w.started_at >= ${start.toISOString()}::timestamptz`,
      sql`w.started_at < ${end.toISOString()}::timestamptz`,
      numberUuid && sql`cfg.uuid = ${numberUuid}::uuid`,
      source && sql`w.source = ${source}`,
    ]);
  }

  async analyticsTotals(
    tx: Tx,
    v: Viewer,
    start: Date,
    end: Date,
    numberUuid?: string,
    source?: CallLogSource,
  ) {
    const res = await tx.execute(sql`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE w.status IN ('ended', 'failed')) AS finished,
             count(*) FILTER (WHERE w.is_answered) AS answered,
             count(*) FILTER (WHERE w.is_missed) AS missed,
             coalesce(round(avg(w.duration_sec) FILTER (WHERE w.is_answered AND w.duration_sec > 0)), 0) AS avg_sec,
             coalesce(sum(w.duration_sec), 0) AS total_sec
      ${UNIFIED} WHERE ${this.window(v, start, end, numberUuid, source)}`);
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
  async analyticsDaily(
    tx: Tx,
    v: Viewer,
    start: Date,
    end: Date,
    tz: string,
    numberUuid?: string,
    source?: CallLogSource,
  ) {
    const res = await tx.execute(sql`
      SELECT to_char((w.started_at AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS day,
             count(*) AS total,
             count(*) FILTER (WHERE w.is_answered) AS answered,
             count(*) FILTER (WHERE w.is_missed) AS missed
      ${UNIFIED} WHERE ${this.window(v, start, end, numberUuid, source)}
      GROUP BY 1 ORDER BY 1`);
    return rowsOf(res).map((r) => ({
      day: String(r.day),
      total: num(r.total),
      answered: num(r.answered),
      missed: num(r.missed),
    }));
  }

  async analyticsByAgent(
    tx: Tx,
    v: Viewer,
    start: Date,
    end: Date,
    numberUuid?: string,
    source?: CallLogSource,
  ) {
    const res = await tx.execute(sql`
      SELECT u.uuid AS agent_uuid, u.full_name AS name, count(*) AS calls,
             count(*) FILTER (WHERE w.is_answered) AS answered,
             coalesce(round(avg(w.duration_sec) FILTER (WHERE w.is_answered AND w.duration_sec > 0)), 0) AS avg_sec,
             coalesce(sum(w.duration_sec), 0) AS total_sec
      ${UNIFIED} WHERE ${this.window(v, start, end, numberUuid, source)}
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
    source?: CallLogSource,
  ) {
    const res = await tx.execute(sql`
      SELECT extract(dow FROM w.started_at AT TIME ZONE ${tz})::int AS weekday,
             extract(hour FROM w.started_at AT TIME ZONE ${tz})::int AS hour,
             count(*) AS calls
      ${UNIFIED} WHERE ${this.window(v, start, end, numberUuid, source)}
      GROUP BY 1, 2 ORDER BY 1, 2`);
    return rowsOf(res).map((r) => ({
      weekday: num(r.weekday),
      hour: num(r.hour),
      calls: num(r.calls),
    }));
  }

  /** The calls of a window by how they reached the log (only the sources with a call). */
  async analyticsBySource(
    tx: Tx,
    v: Viewer,
    start: Date,
    end: Date,
    numberUuid?: string,
    source?: CallLogSource,
  ) {
    const res = await tx.execute(sql`
      SELECT w.source, count(*) AS calls, count(*) FILTER (WHERE w.is_answered) AS answered,
             count(*) FILTER (WHERE w.is_missed) AS missed
      ${UNIFIED} WHERE ${this.window(v, start, end, numberUuid, source)}
      GROUP BY w.source ORDER BY count(*) DESC, w.source`);
    return rowsOf(res).map((r) => ({
      source: String(r.source) as CallLogSource,
      calls: num(r.calls),
      answered: num(r.answered),
      missed: num(r.missed),
    }));
  }
}
