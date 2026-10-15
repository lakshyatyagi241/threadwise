import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';

/**
 * The workspace's calendar: "today" is a date in the workspace's own time zone (`organizations.settings.timezone`, UTC when it has none or
 * names a zone this runtime does not know), never the server's or the browser's. Leave windows (`member_leaves`) are such dates, so
 * "is she away today" is the same answer for the routing engine, the picker and the sweep.
 */

/** The zone as saved, if the runtime knows it; UTC otherwise (a bad value must not break routing for the workspace). */
export function resolveTimezone(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw });
    return raw;
  } catch {
    return 'UTC';
  }
}

/** The calendar day (`YYYY-MM-DD`) an instant falls on in a time zone. DST-safe: the zone's own rules decide, not a fixed offset. */
export function calendarDay(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: resolveTimezone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** `day` plus `n` calendar days (n may be negative). Pure date arithmetic on the proleptic calendar: a DST change cannot move it. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export interface LeaveWindow {
  startsOn: string;
  endsOn: string | null;
  status: string;
}

/** Whether a leave covers `today`: it still counts (scheduled or active) and today lies in `[startsOn, endsOn]` (no end = open-ended). */
export function leaveCoversDay(leave: LeaveWindow, today: string): boolean {
  if (leave.status !== 'scheduled' && leave.status !== 'active') return false;
  return leave.startsOn <= today && (leave.endsOn === null || leave.endsOn >= today);
}

export interface WorkspaceCalendar {
  timezone: string;
  today: string;
}

/** The workspace's zone and today, read inside the tenant transaction. */
export async function loadWorkspaceCalendar(
  tx: Tx,
  orgId: number,
  now: Date = new Date(),
): Promise<WorkspaceCalendar> {
  const res = await tx.execute(
    sql`SELECT settings ->> 'timezone' AS timezone FROM organizations WHERE id = ${orgId}`,
  );
  const timezone = resolveTimezone((res.rows[0] as { timezone?: unknown } | undefined)?.timezone);
  return { timezone, today: calendarDay(now, timezone) };
}

/**
 * SQL: the person in column `userCol` of table alias `alias` is on leave on `today` (a `YYYY-MM-DD` the caller computed with
 * `loadWorkspaceCalendar`). Status is part of the test, the sweep is not: it is correct between two sweeps.
 */
export function onLeaveOnSql(alias: string, today: string): SQL {
  const orgCol = sql.raw(`${alias}.org_id`);
  const userCol = sql.raw(`${alias}.id`);
  return sql`EXISTS (
    SELECT 1 FROM member_leaves ml
    WHERE ml.org_id = ${orgCol} AND ml.user_id = ${userCol} AND ml.status IN ('scheduled', 'active')
      AND ml.starts_on <= ${today}::date AND (ml.ends_on IS NULL OR ml.ends_on >= ${today}::date))`;
}

/** Which of these people are on leave on `today`, with the last day away (`null` = open-ended). Anyone not in the map is present. */
export async function onLeaveMap(
  tx: Tx,
  orgId: number,
  userIds: readonly number[],
  today: string,
): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  if (userIds.length === 0) return out;
  const res = await tx.execute(sql`
    SELECT user_id, min(ends_on)::text AS ends_on, bool_or(ends_on IS NULL) AS open_ended FROM member_leaves
    WHERE org_id = ${orgId} AND status IN ('scheduled', 'active')
      AND user_id IN (${sql.join(
        userIds.map((i) => sql`${i}`),
        sql`, `,
      )})
      AND starts_on <= ${today}::date AND (ends_on IS NULL OR ends_on >= ${today}::date)
    GROUP BY user_id`);
  for (const r of res.rows as Array<Record<string, unknown>>) {
    out.set(Number(r.user_id), r.open_ended === true ? null : (r.ends_on as string));
  }
  return out;
}
