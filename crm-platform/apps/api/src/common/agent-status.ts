import { sql } from 'drizzle-orm';
import {
  personalWorkingHoursSchema,
  type AgentStatusReason,
  type AgentStatusState,
  type PersonalWorkingHours,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { isOutsideBusinessHours } from './business-hours';
import { calendarDay, loadWorkspaceCalendar, resolveTimezone } from './workspace-calendar';

/**
 * The ONE rule for "is this person available right now" (docs/specs/agent-status-bar.md). Routing, the handoff pickers, Try it, the
 * assignee picker, the away rules and the status endpoints all ask this file; nothing else decides.
 *
 *   manual choice  >  leave (out of office)  >  working hours  >  Available
 *
 *  - **Manual choice**: `agent_statuses.status` is `offline` (Away) or `busy` (kept for routing, not offered in the menu), or `online`
 *    together with a manual record in `preferences.availability.manual` (the person pressed "Set as available"; plain `online` with no
 *    record is just the default and decides nothing). A manual choice beats leave and the schedule. It lasts until the person changes it,
 *    except while the person automates their status (switch on, plan has `agent_status_automation`, at least one open day): then it
 *    lasts until the next schedule boundary (`manual.until`), so Away is not forgotten for ever. Turning automation off or losing the plan
 *    feature makes it "until changed" again.
 *    A manual "Available" set BEFORE a leave began does not override that leave (a click made weeks ago must not defeat out-of-office).
 *  - **Leave**: on leave today in the workspace calendar -> Away.
 *  - **Working hours**: automation active and the instant is outside the person's own schedule -> Away. An empty schedule (no open
 *    day) is never Away: it is "always available", and the dialog warns.
 *  - Otherwise Available. A member with no status row is Available.
 *
 * Pure: `now` is passed in, nothing is read here. `loadAgentStatuses` below gathers the inputs for many people with three queries.
 */

export type ManualChoice = { status: 'online' | 'offline'; setAt: string; until: string | null };

/** `preferences.availability`: the part of `agent_statuses.preferences` this feature owns. Other keys are never touched. */
export interface AvailabilityPrefs {
  manual?: ManualChoice;
  hours?: PersonalWorkingHours & { updatedAt?: string };
}

export interface StatusInput {
  /** `agent_statuses.status`, null when the person has no row yet. */
  storedStatus: string | null;
  manual: ManualChoice | null;
  hours: PersonalWorkingHours | null;
  /** The plan has `agent_status_automation` (the workspace's entitlement, resolved by the caller once). */
  automationAllowed: boolean;
  /** The leave covering today in the workspace calendar, if any. */
  leave: { startsOn: string; endsOn: string | null } | null;
  workspaceTimezone: string;
  now: Date;
}

/** What a skip is called in a trace line and in the picker text. */
export type StatusTrace = 'available' | 'away' | 'busy' | 'on_leave' | 'outside_working_hours';

export interface EffectiveStatus {
  state: AgentStatusState;
  reason: AgentStatusReason;
  trace: StatusTrace;
  /** True for the legacy `busy` value: still not routable, not offered in the menu. */
  busy: boolean;
  routable: boolean;
  /** When the status changes by itself (next schedule boundary, or the end of an expiring manual choice). */
  changesAt: Date | null;
  /** Reason `leave`: last day away, null = open-ended. */
  leaveUntil: string | null;
  automationActive: boolean;
  /** Automation switched on but no day open (never Away by schedule). */
  emptySchedule: boolean;
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** At least one day of the schedule is open. */
export function hasOpenDay(hours: PersonalWorkingHours | null): boolean {
  return !!hours && DAY_KEYS.some((k) => hours.days[k]?.enabled === true);
}

/** Whether `at` is outside the person's own hours (their zone). Only meaningful when `hasOpenDay`. */
export function isOutsideOwnHours(hours: PersonalWorkingHours, at: Date): boolean {
  return isOutsideBusinessHours({ days: hours.days }, hours.timezone, at);
}

// --- schedule boundaries -----------------------------------------------------------------------------------------------------

/** The zone's offset from UTC in ms at an instant (DST-aware, from the zone's own rules). */
function offsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: resolveTimezone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The UTC instant of a wall-clock time ("YYYY-MM-DD", "HH:mm" or "24:00") in a zone. A time that does not exist (the hour skipped when
 * clocks go forward) is read with the offset in force before the change, so it lands an hour earlier on the clock; a repeated one (clocks go back) takes its first occurrence.
 */
export function zonedInstant(date: string, hhmm: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm, 0);
  let guess = wall - offsetMs(timeZone, new Date(wall));
  const again = wall - offsetMs(timeZone, new Date(guess));
  if (again !== guess) guess = again;
  return new Date(guess);
}

const WEEKDAY_OF: Record<number, (typeof DAY_KEYS)[number]> = {
  0: 'sun',
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
  6: 'sat',
};

function addDay(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * The next instant after `from` at which "inside the hours" flips (within the next 9 days), or null when it never does (always open,
 * always closed, or no open day). Candidates are the opening and closing times of every window of the days around `from`, converted
 * to instants in the person's zone, so a DST change moves the instant and never the rule; the first candidate whose state differs from
 * the state at `from` is the boundary. Back-to-back windows (09:00-12:00 and 12:00-18:00) are not a boundary.
 */
export function nextScheduleChange(hours: PersonalWorkingHours, from: Date): Date | null {
  if (!hasOpenDay(hours)) return null;
  const tz = hours.timezone;
  const startState = isOutsideOwnHours(hours, from);
  const today = calendarDay(from, tz);
  const candidates: number[] = [];
  for (let offset = -1; offset <= 8; offset += 1) {
    const date = addDay(today, offset);
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    const day = hours.days[WEEKDAY_OF[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!];
    if (!day?.enabled) continue;
    for (const w of [{ from: day.from, to: day.to }, ...(day.extra ?? [])]) {
      const overnight = w.to !== '24:00' && w.to <= w.from;
      candidates.push(zonedInstant(date, w.from, tz).getTime());
      candidates.push(zonedInstant(overnight ? addDay(date, 1) : date, w.to, tz).getTime());
    }
  }
  candidates.sort((a, b) => a - b);
  for (const c of candidates) {
    if (c <= from.getTime()) continue;
    if (isOutsideOwnHours(hours, new Date(c)) !== startState) return new Date(c);
  }
  return null;
}

// --- the rule ------------------------------------------------------------------------------------------------------------------

export function effectiveAgentStatus(input: StatusInput): EffectiveStatus {
  const { hours, now } = input;
  const open = hasOpenDay(hours);
  const automationActive = input.automationAllowed && hours?.automate === true && open;
  const emptySchedule = hours?.automate === true && !open;
  const base = { automationActive, emptySchedule, leaveUntil: null as string | null };
  const stored = input.storedStatus ?? 'online';

  // An expiring manual choice: only while automation is active, `until` is honoured.
  const manualExpired =
    automationActive && input.manual?.until != null && now.getTime() >= Date.parse(input.manual.until);
  const manualChangesAt =
    automationActive && input.manual?.until != null && !manualExpired
      ? new Date(input.manual.until)
      : null;

  if (stored === 'busy') {
    return {
      ...base,
      state: 'away',
      reason: 'manual',
      trace: 'busy',
      busy: true,
      routable: false,
      changesAt: null,
    };
  }
  if (stored === 'offline' && !manualExpired) {
    return {
      ...base,
      state: 'away',
      reason: 'manual',
      trace: 'away',
      busy: false,
      routable: false,
      changesAt: manualChangesAt,
    };
  }
  if (stored !== 'offline' && input.manual?.status === 'online' && !manualExpired) {
    const beforeLeave =
      input.leave !== null &&
      calendarDay(new Date(input.manual.setAt), resolveTimezone(input.workspaceTimezone)) <
        input.leave.startsOn;
    if (!beforeLeave) {
      return {
        ...base,
        state: 'available',
        reason: 'manual',
        trace: 'available',
        busy: false,
        routable: true,
        changesAt: manualChangesAt,
      };
    }
  }

  if (input.leave) {
    return {
      ...base,
      state: 'away',
      reason: 'leave',
      trace: 'on_leave',
      busy: false,
      routable: false,
      changesAt: null,
      leaveUntil: input.leave.endsOn,
    };
  }

  if (automationActive && hours) {
    const outside = isOutsideOwnHours(hours, now);
    const changesAt = nextScheduleChange(hours, now);
    if (outside) {
      return {
        ...base,
        state: 'away',
        reason: 'schedule',
        trace: 'outside_working_hours',
        busy: false,
        routable: false,
        changesAt,
      };
    }
    return {
      ...base,
      state: 'available',
      reason: 'default',
      trace: 'available',
      busy: false,
      routable: true,
      changesAt,
    };
  }

  return {
    ...base,
    state: 'available',
    reason: 'default',
    trace: 'available',
    busy: false,
    routable: true,
    changesAt: null,
  };
}

/**
 * When a manual choice made `now` should stop deciding: the next schedule boundary while the person automates, otherwise never
 * (null). Written next to the choice so every reader (routing included) can tell it expired without recomputing the schedule.
 */
export function manualUntil(
  hours: PersonalWorkingHours | null,
  automationAllowed: boolean,
  now: Date,
): string | null {
  if (!automationAllowed || !hours?.automate || !hasOpenDay(hours)) return null;
  return nextScheduleChange(hours, now)?.toISOString() ?? null;
}

// --- reading --------------------------------------------------------------------------------------------------------------------

/** What `preferences` holds for this feature, validated: anything malformed reads as "not set". */
export function readAvailabilityPrefs(preferences: unknown): {
  manual: ManualChoice | null;
  hours: (PersonalWorkingHours & { updatedAt?: string }) | null;
} {
  const raw =
    preferences && typeof preferences === 'object'
      ? (preferences as { availability?: unknown }).availability
      : null;
  if (!raw || typeof raw !== 'object') return { manual: null, hours: null };
  const a = raw as { manual?: unknown; hours?: unknown };
  let manual: ManualChoice | null = null;
  const m = a.manual as Partial<ManualChoice> | undefined;
  if (
    m &&
    (m.status === 'online' || m.status === 'offline') &&
    typeof m.setAt === 'string' &&
    !Number.isNaN(Date.parse(m.setAt)) &&
    (m.until === null || m.until === undefined || !Number.isNaN(Date.parse(String(m.until))))
  ) {
    manual = { status: m.status, setAt: m.setAt, until: m.until ?? null };
  }
  const parsed = personalWorkingHoursSchema.safeParse(a.hours);
  return { manual, hours: parsed.success ? parsed.data : null };
}

type Raw = Record<string, unknown>;

export interface LoadedStatus extends EffectiveStatus {
  storedStatus: string | null;
}

/**
 * The effective status of many people in one go: one read of the status rows, one of the leaves covering today, one of the workspace
 * calendar. Everyone asked for is in the result (a person with no row is Available). Runs inside the tenant transaction it is given.
 */
export async function loadAgentStatuses(
  tx: Tx,
  orgId: number,
  userIds: readonly number[],
  opts: { automationAllowed: boolean; now?: Date },
): Promise<Map<number, LoadedStatus>> {
  const out = new Map<number, LoadedStatus>();
  if (userIds.length === 0) return out;
  const now = opts.now ?? new Date();
  const ids = sql.join(
    userIds.map((i) => sql`${i}`),
    sql`, `,
  );
  const rows = await tx.execute(
    sql`SELECT user_id, status, preferences FROM agent_statuses WHERE org_id = ${orgId} AND user_id IN (${ids})`,
  );
  const cal = await loadWorkspaceCalendar(tx, orgId, now);
  const leaves = await tx.execute(sql`
    SELECT user_id, min(starts_on)::text AS starts_on,
           CASE WHEN bool_or(ends_on IS NULL) THEN NULL ELSE max(ends_on)::text END AS ends_on
    FROM member_leaves
    WHERE org_id = ${orgId} AND status IN ('scheduled', 'active') AND user_id IN (${ids})
      AND starts_on <= ${cal.today}::date AND (ends_on IS NULL OR ends_on >= ${cal.today}::date)
    GROUP BY user_id`);
  const stored = new Map((rows.rows as Raw[]).map((r) => [Number(r.user_id), r]));
  const leaveOf = new Map(
    (leaves.rows as Raw[]).map((r) => [
      Number(r.user_id),
      { startsOn: String(r.starts_on), endsOn: (r.ends_on as string | null) ?? null },
    ]),
  );
  for (const id of userIds) {
    const row = stored.get(id);
    const prefs = readAvailabilityPrefs(row?.preferences);
    const status = effectiveAgentStatus({
      storedStatus: (row?.status as string | undefined) ?? null,
      manual: prefs.manual,
      hours: prefs.hours,
      automationAllowed: opts.automationAllowed,
      leave: leaveOf.get(id) ?? null,
      workspaceTimezone: cal.timezone,
      now,
    });
    out.set(id, { ...status, storedStatus: (row?.status as string | undefined) ?? null });
  }
  return out;
}
