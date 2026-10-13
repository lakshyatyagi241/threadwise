import {
  SLA_AT_RISK_MINUTES,
  type ConversationPriority,
  type SlaKind,
  type SlaPriorityOverrides,
  type SlaState,
  type SlaStatus,
} from '@crm/contracts';
import { isOutsideBusinessHours, parseBusinessHours } from './business-hours';

/**
 * The arithmetic of SLA clocks (TW-TIB2-026): which targets apply, when a clock runs out, and how a clock looks to the agent. Pure
 * functions, so every rule (priority override, business hours, a time zone, an overnight shift) is tested without a database.
 */

export interface PolicyTargets {
  firstResponseMinutes: number | null;
  resolutionMinutes: number | null;
}

const positive = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : null;

/**
 * The policy's targets for a priority: a priority's override replaces the policy's own value key by key (an absent key keeps it).
 * A target of null or 0 means "no clock".
 */
export function effectiveTargets(
  policy: PolicyTargets,
  overrides: SlaPriorityOverrides | null | undefined,
  priority: ConversationPriority | string,
): PolicyTargets {
  const o = (
    overrides as Record<string, SlaPriorityOverrides[keyof SlaPriorityOverrides]> | null
  )?.[priority];
  return {
    firstResponseMinutes: positive(o?.firstResponseMinutes ?? policy.firstResponseMinutes),
    resolutionMinutes: positive(o?.resolutionMinutes ?? policy.resolutionMinutes),
  };
}

const MINUTE = 60_000;
/** While closed, look ahead this far at a time; on landing in an open stretch, step back to the exact minute it opened. */
const CLOSED_JUMP_MINUTES = 10;
/** While open, a whole hour that is open at both ends is open throughout (a day has one contiguous window). */
const OPEN_JUMP_MINUTES = 60;
/** No workspace is closed for longer than this: past it the hours are taken as unusable and the clock runs plain. */
const MAX_SEARCH_DAYS = 14;

/** Whether the hours config opens on at least one day (a config with every day off is "unusable": the workspace is treated as always open). */
function hasOpenDay(raw: unknown): boolean {
  const cfg = parseBusinessHours(raw);
  if (!cfg?.days) return false;
  return Object.values(cfg.days).some((d) => d?.enabled === true);
}

/**
 * `start` plus `minutes` of OPEN time. With no usable hours config this is plain addition. Otherwise the clock stops while the
 * workspace is closed (the hours are read in `timeZone`, daylight saving included) and resumes at the next opening; a clock that starts
 * while closed starts counting at the next opening. Accurate to the minute.
 */
export function addBusinessMinutes(
  start: Date,
  minutes: number,
  hoursRaw: unknown,
  timeZone: string,
): Date {
  if (minutes <= 0) return new Date(start);
  if (!hasOpenDay(hoursRaw)) return new Date(start.getTime() + minutes * MINUTE);

  const closed = (t: number) => isOutsideBusinessHours(hoursRaw, timeZone, new Date(t));
  let t = Math.floor(start.getTime() / MINUTE) * MINUTE;
  const limit = t + (MAX_SEARCH_DAYS * 24 * 60 + minutes) * MINUTE * 4;
  let left = minutes;

  while (left > 0) {
    if (t > limit) return new Date(start.getTime() + minutes * MINUTE);
    if (closed(t)) {
      // Jump to the next opening: coarse steps while closed, then back to the exact minute.
      let probe = t;
      while (closed(probe)) {
        probe += CLOSED_JUMP_MINUTES * MINUTE;
        if (probe > limit) return new Date(start.getTime() + minutes * MINUTE);
      }
      while (!closed(probe - MINUTE) && probe > t) probe -= MINUTE;
      t = probe;
      continue;
    }
    // Open: take a whole hour when the far end is open too, else one minute.
    const hour = Math.min(left, OPEN_JUMP_MINUTES);
    if (
      hour === OPEN_JUMP_MINUTES &&
      !closed(t + (hour - 1) * MINUTE) &&
      !closed(t + hour * MINUTE)
    ) {
      t += hour * MINUTE;
      left -= hour;
    } else {
      t += MINUTE;
      left -= 1;
    }
  }
  // A start that was not on a whole minute keeps its seconds.
  return new Date(t + (start.getTime() - Math.floor(start.getTime() / MINUTE) * MINUTE));
}

/** The due time of a clock started at `start`. */
export function dueAt(
  start: Date,
  minutes: number | null,
  respectBusinessHours: boolean,
  hoursRaw: unknown,
  timeZone: string,
): Date | null {
  if (minutes === null) return null;
  return respectBusinessHours
    ? addBusinessMinutes(start, minutes, hoursRaw, timeZone)
    : new Date(start.getTime() + minutes * MINUTE);
}

export interface ClockFacts {
  status: string;
  /** The customer is waiting for a human answer (the first-response clock runs). */
  waitingSince: Date | string | null;
  firstResponseDue: Date | string | null;
  resolutionDue: Date | string | null;
  breached: boolean;
}

const ms = (v: Date | string | null): number | null => {
  if (v === null) return null;
  const n = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isNaN(n) ? null : n;
};

/** Statuses on which a clock keeps running for display (a finished or spam thread shows only a breach that happened). */
const FINISHED = new Set(['resolved', 'closed', 'spam']);

/**
 * The clock that matters now. The first-response clock while the customer waits for a first answer, else the resolution clock. A
 * finished conversation shows nothing unless it was breached. `breached` also covers a due time that passed and is not flagged yet
 * (the sweep runs once a minute), so the badge never lags the clock.
 */
export function slaStatus(f: ClockFacts, now: Date): SlaStatus | null {
  const first = ms(f.firstResponseDue);
  const resolution = ms(f.resolutionDue);
  const firstRuns = first !== null && f.waitingSince !== null;
  const kind: SlaKind | null = firstRuns
    ? 'first_response'
    : resolution !== null
      ? 'resolution'
      : null;
  const due = kind === 'first_response' ? first : kind === 'resolution' ? resolution : null;
  if (kind === null || due === null) return null;
  if (FINISHED.has(f.status) && !f.breached) return null;

  let state: SlaState;
  if (f.breached || (!FINISHED.has(f.status) && now.getTime() > due)) state = 'breached';
  else if (due - now.getTime() <= SLA_AT_RISK_MINUTES * MINUTE) state = 'at_risk';
  else state = 'ok';
  return { state, kind, dueAt: new Date(due).toISOString() };
}
