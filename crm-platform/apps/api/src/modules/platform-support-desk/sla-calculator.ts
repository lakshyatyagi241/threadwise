import type { SlaTimer } from '@crm/contracts';

/**
 * The helpdesk SLA engine (TW-SUPP-029): pure functions, no database and no clock (the caller passes `now`).
 *
 * Ported from Reference's SlaCalculator. Differences, each deliberate:
 *   - minutes are whole and never negative (Reference's Carbon 3 diffs came out signed and fractional, which the unsigned
 *     over_by_minutes column then rejected);
 *   - the same business hours are used by the panel and the scanner (Reference's scanner lost the workspace and fell back to the
 *     server zone, so the two disagreed).
 * Kept: the customer's workspace hours apply (never the operator's); a missing day falls back to Mon-Fri 09:00-17:00; the
 * running-timer severity is `breach` past due, `warn` inside the last max(5 min, a quarter of the window), else `ok`;
 * `pause_when_waiting_on_customer` is stored but not honoured; status `pending` or `closed` never stops a timer.
 */

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type DayKey = (typeof DAY_KEYS)[number];
export type DayWindow = readonly [string, string] | null;
export interface BusinessHours {
  tz: string;
  days: Record<DayKey, DayWindow>;
}

const DEFAULT_WINDOW: DayWindow = ['09:00', '17:00'];
const DEFAULT_DAYS: Record<DayKey, DayWindow> = {
  sun: null,
  mon: DEFAULT_WINDOW,
  tue: DEFAULT_WINDOW,
  wed: DEFAULT_WINDOW,
  thu: DEFAULT_WINDOW,
  fri: DEFAULT_WINDOW,
  sat: null,
};

const MINUTE = 60_000;

const validZone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/**
 * `workspaces.business_hours` is `{ tz?, days?: { mon: ["09:00","17:00"], sat: null, ... } }` (a JSON string or an object).
 * Anything unreadable falls back to the default week; a day that is present replaces that day's default (null = closed).
 */
export function businessHoursFor(raw: unknown, workspaceTz: string | null): BusinessHours {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  const obj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  const tzCandidate = typeof obj.tz === 'string' && obj.tz ? obj.tz : (workspaceTz ?? 'UTC');
  const tz = validZone(tzCandidate) ? tzCandidate : 'UTC';
  const given =
    obj.days && typeof obj.days === 'object' ? (obj.days as Record<string, unknown>) : {};
  const days = { ...DEFAULT_DAYS };
  for (const key of DAY_KEYS) {
    if (!(key in given)) continue;
    const w = given[key];
    days[key] =
      Array.isArray(w) && w.length >= 2 && typeof w[0] === 'string' && typeof w[1] === 'string'
        ? [w[0], w[1]]
        : null;
  }
  return { tz, days };
}

interface Zoned {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  weekday: DayKey;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function zonedParts(at: Date, tz: string): Zoned {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });
    formatters.set(tz, f);
  }
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(at)) p[part.type] = part.value;
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour) % 24,
    mi: Number(p.minute),
    weekday: (p.weekday ?? 'Sun').slice(0, 3).toLowerCase() as DayKey,
  };
}

/** The instant at which the wall clock of `tz` reads y-m-d h:mi (day/month overflow is normalised). */
function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let guess = wall;
  // Two passes settle the offset across a DST change.
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), tz);
    const seen = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
    guess -= seen - wall;
  }
  return new Date(guess);
}

const parseClock = (s: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h > 24 || mi > 59 ? null : h * 60 + mi;
};

/**
 * `start` plus `minutes`, counting only open time when `bh` is given. Bounded to 1000 day steps so a week with every
 * day closed cannot loop forever (it then returns the start moved by the whole bound, which no real policy reaches).
 */
export function addBusinessMinutes(start: Date, minutes: number, bh: BusinessHours | null): Date {
  if (!bh || minutes <= 0) return new Date(start.getTime() + minutes * MINUTE);
  let cursor = start;
  let remaining = minutes;
  for (let guard = 0; guard < 1000 && remaining > 0; guard++) {
    const p = zonedParts(cursor, bh.tz);
    const nextDay = () => zonedToUtc(p.y, p.m, p.d + 1, 0, 0, bh.tz);
    const w = bh.days[p.weekday];
    const open = w ? parseClock(w[0]) : null;
    const close = w ? parseClock(w[1]) : null;
    if (open === null || close === null || close <= open) {
      cursor = nextDay();
      continue;
    }
    const openAt = zonedToUtc(p.y, p.m, p.d, 0, open, bh.tz);
    const closeAt = zonedToUtc(p.y, p.m, p.d, 0, close, bh.tz);
    if (cursor < openAt) cursor = openAt;
    if (cursor >= closeAt) {
      cursor = nextDay();
      continue;
    }
    const available = Math.floor((closeAt.getTime() - cursor.getTime()) / MINUTE);
    if (available <= 0) {
      cursor = nextDay();
      continue;
    }
    if (remaining <= available) {
      cursor = new Date(cursor.getTime() + remaining * MINUTE);
      remaining = 0;
    } else {
      remaining -= available;
      cursor = closeAt;
    }
  }
  return cursor;
}

export interface SlaPolicyTargets {
  firstResponseMinutes: number;
  resolutionMinutes: number;
  respectBusinessHours: boolean;
}

export interface SlaTicketTimes {
  createdAt: Date;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
}

function severityFor(remaining: number, total: number): 'ok' | 'warn' {
  return remaining < Math.max(5, Math.floor(total / 4)) ? 'warn' : 'ok';
}

function timer(deadline: Date, stoppedAt: Date | null, now: Date, totalMinutes: number): SlaTimer {
  if (stoppedAt) {
    const late = stoppedAt.getTime() > deadline.getTime();
    return {
      deadline: deadline.toISOString(),
      breached: late,
      minutesRemaining: null,
      minutesOver: late ? Math.floor((stoppedAt.getTime() - deadline.getTime()) / MINUTE) : null,
      severity: late ? 'breach' : 'met',
    };
  }
  const ms = deadline.getTime() - now.getTime();
  if (ms < 0) {
    return {
      deadline: deadline.toISOString(),
      breached: true,
      minutesRemaining: null,
      minutesOver: Math.floor(-ms / MINUTE),
      severity: 'breach',
    };
  }
  const remaining = Math.floor(ms / MINUTE);
  return {
    deadline: deadline.toISOString(),
    breached: false,
    minutesRemaining: remaining,
    minutesOver: null,
    severity: severityFor(remaining, totalMinutes),
  };
}

/** Both clocks of one ticket against one policy (TW-SUPP-029 rules 2 to 5). */
export function computeSla(
  ticket: SlaTicketTimes,
  policy: SlaPolicyTargets,
  bh: BusinessHours | null,
  now: Date,
): { firstResponse: SlaTimer; resolution: SlaTimer } {
  const hours = policy.respectBusinessHours ? bh : null;
  const firstDeadline = addBusinessMinutes(ticket.createdAt, policy.firstResponseMinutes, hours);
  const resolutionDeadline = addBusinessMinutes(ticket.createdAt, policy.resolutionMinutes, hours);
  return {
    firstResponse: timer(firstDeadline, ticket.firstResponseAt, now, policy.firstResponseMinutes),
    resolution: timer(resolutionDeadline, ticket.resolvedAt, now, policy.resolutionMinutes),
  };
}
