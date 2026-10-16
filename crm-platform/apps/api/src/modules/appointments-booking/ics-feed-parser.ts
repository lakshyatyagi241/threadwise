import { addDays, parseLocalDate, wallToInstant, weekdayOf } from './tz';

/**
 * Reads an iCalendar (RFC 5545) feed into BUSY INTERVALS (BL-035): what a read-only ICS subscription contributes to the slot engine. Pure: text in,
 * intervals out. It is not a general iCalendar library, it answers one question ("when is this person busy between `from` and `to`?") and is
 * deliberately conservative where it cannot be sure: anything it cannot interpret is reported in `warnings` and never silently turned into
 * "free" when a safer reading exists.
 *
 * What counts as busy: a VEVENT that is not `STATUS:CANCELLED` and not `TRANSP:TRANSPARENT`. All-day events block the whole local day unless
 * the caller turns that off (a holiday feed may not want to close the calendar). Recurring events are expanded for the window: FREQ DAILY,
 * WEEKLY, MONTHLY, YEARLY with INTERVAL, COUNT, UNTIL, BYDAY (with ordinals), BYMONTHDAY, BYMONTH, BYSETPOS and WKST, plus RDATE and EXDATE, and
 * `RECURRENCE-ID` overrides of single occurrences. Expansion is done on the WALL clock of the event's zone and each occurrence is then turned into
 * an instant, so a 9:00 meeting stays at 9:00 across a daylight-saving change. A rule it does not support (HOURLY, BYYEARDAY, BYWEEKNO ...) is
 * read as its first occurrence only, and counted.
 *
 * Time zones: an IANA name works as is; the Windows names Outlook writes are mapped; floating times and a zone nobody knows are read in the
 * feed's own `X-WR-TIMEZONE`, else in `defaultZone` (the workspace's), and an unknown name is counted in `warnings.unknownZone`.
 */

export interface IcsParseOptions {
  /** The workspace's zone: floating times, all-day days and unknown zones are read in it. */
  defaultZone: string;
  /** The window that matters, epoch milliseconds. An event that ends before `fromMs` or starts after `toMs` is left out. */
  fromMs: number;
  toMs: number;
  /** Whether an all-day event blocks its days. */
  blockAllDay: boolean;
  /** Occurrences kept per recurring event, and intervals kept in all. */
  maxOccurrencesPerEvent?: number;
  maxIntervals?: number;
}

export interface IcsBusyInterval {
  startMs: number;
  endMs: number;
}

export interface IcsParseResult {
  busy: IcsBusyInterval[];
  /** VEVENTs read (before the window and the busy rules). */
  events: number;
  calendarName: string | null;
  warnings: {
    /** Events whose time zone is unknown here: read in the feed's or the workspace's zone. */
    unknownZone: number;
    /** Recurrence rules this reader does not support: only the first occurrence is used. */
    unsupportedRule: number;
    /** The caps were hit: the busy time is incomplete, and the feed says so. */
    truncated: boolean;
  };
}

/** The text is not an iCalendar at all. */
export class IcsFormatError extends Error {
  constructor(message = 'not an iCalendar') {
    super(message);
    this.name = 'IcsFormatError';
  }
}

const DAY_MS = 86_400_000;
const DEFAULT_MAX_OCCURRENCES = 2_000;
const DEFAULT_MAX_INTERVALS = 5_000;
/** A rule that has not produced a result after this many periods is not iterated further (a daily rule since 1990 is ~13,000). */
const MAX_PERIODS = 40_000;

/** Windows time-zone names (what Outlook writes in `TZID`) to IANA. The common ones; anything else is an unknown zone. */
export const WINDOWS_ZONES: Readonly<Record<string, string>> = {
  UTC: 'UTC',
  'Dateline Standard Time': 'Etc/GMT+12',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Alaskan Standard Time': 'America/Anchorage',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Central Standard Time': 'America/Chicago',
  'Central America Standard Time': 'America/Guatemala',
  'Canada Central Standard Time': 'America/Regina',
  'Eastern Standard Time': 'America/New_York',
  'US Eastern Standard Time': 'America/Indiana/Indianapolis',
  'Atlantic Standard Time': 'America/Halifax',
  'Newfoundland Standard Time': 'America/St_Johns',
  'SA Eastern Standard Time': 'America/Cayenne',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Argentina/Buenos_Aires',
  'SA Pacific Standard Time': 'America/Bogota',
  'Mexico Standard Time': 'America/Mexico_City',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'GTB Standard Time': 'Europe/Bucharest',
  'FLE Standard Time': 'Europe/Kiev',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Russian Standard Time': 'Europe/Moscow',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Egypt Standard Time': 'Africa/Cairo',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'W. Central Africa Standard Time': 'Africa/Lagos',
  'E. Africa Standard Time': 'Africa/Nairobi',
  'Arab Standard Time': 'Asia/Riyadh',
  'Arabian Standard Time': 'Asia/Dubai',
  'Iran Standard Time': 'Asia/Tehran',
  'Pakistan Standard Time': 'Asia/Karachi',
  'India Standard Time': 'Asia/Kolkata',
  'Sri Lanka Standard Time': 'Asia/Colombo',
  'Nepal Standard Time': 'Asia/Kathmandu',
  'Bangladesh Standard Time': 'Asia/Dhaka',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  'W. Australia Standard Time': 'Australia/Perth',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'New Zealand Standard Time': 'Pacific/Auckland',
};

const validZones = new Map<string, boolean>();
function isZone(name: string): boolean {
  let ok = validZones.get(name);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: name });
      ok = true;
    } catch {
      ok = false;
    }
    validZones.set(name, ok);
  }
  return ok;
}

/** An IANA name Intl knows, a Windows name mapped to one, or null. (Some feeds quote a vendor prefix: `/mozilla.org/20050126_1/Europe/Paris`.) */
export function zoneOf(tzid: string): string | null {
  const name = tzid.trim().replace(/^"|"$/g, '');
  if (!name) return null;
  if (name === 'Z') return 'UTC';
  const windows = WINDOWS_ZONES[name];
  if (windows && isZone(windows)) return windows;
  if (isZone(name)) return name;
  const tail = /\/((?:[A-Za-z_]+\/)?[A-Za-z_]+(?:\/[A-Za-z_]+)?)$/.exec(name)?.[1];
  if (tail && isZone(tail)) return tail;
  return null;
}

// --- lines ------------------------------------------------------------------------------------------------------------

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** RFC 5545 section 3.1: a line that starts with a space or a tab continues the one before it. */
function unfold(text: string): string[] {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r?\n[ \t]/g, '')
    .split(/\r?\n/)
    .filter((l) => l.length > 0);
}

/** `NAME;PARAM=VALUE;PARAM2="VALUE;WITH:DELIMITERS":the value`. */
function parseLine(line: string): Prop | null {
  let i = 0;
  let inQuote = false;
  let colon = -1;
  for (; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts: string[] = [];
  let cur = '';
  inQuote = false;
  for (const c of head) {
    if (c === '"') inQuote = !inQuote;
    if (c === ';' && !inQuote) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  parts.push(cur);
  const name = parts[0]!.toUpperCase();
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

// --- values -----------------------------------------------------------------------------------------------------------

interface IcsTime {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Seconds since local midnight; 0 for a DATE. */
  seconds: number;
  allDay: boolean;
  /** `Z` suffix: an instant in UTC. */
  utc: boolean;
  tzid: string | null;
}

function parseTime(p: Prop): IcsTime | null {
  const v = p.value.trim();
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (date) {
    return {
      date: `${date[1]}-${date[2]}-${date[3]}`,
      seconds: 0,
      allDay: true,
      utc: false,
      tzid: null,
    };
  }
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/i.exec(v);
  if (!dt) return null;
  return {
    date: `${dt[1]}-${dt[2]}-${dt[3]}`,
    seconds: Number(dt[4]) * 3600 + Number(dt[5]) * 60 + Number(dt[6]),
    allDay: p.params.VALUE?.toUpperCase() === 'DATE',
    utc: dt[7]!.toUpperCase() === 'Z',
    tzid: p.params.TZID ?? null,
  };
}

/** `P1DT2H30M`, `PT45M`, `P2W`, `-PT15M`: milliseconds, or null. */
function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(
    v.trim(),
  );
  if (!m || v.trim().replace(/^[+-]/, '') === 'P') return null;
  const ms =
    Number(m[2] ?? 0) * 7 * DAY_MS +
    Number(m[3] ?? 0) * DAY_MS +
    Number(m[4] ?? 0) * 3_600_000 +
    Number(m[5] ?? 0) * 60_000 +
    Number(m[6] ?? 0) * 1000;
  return m[1] === '-' ? -ms : ms;
}

// --- events -----------------------------------------------------------------------------------------------------------

interface RawEvent {
  uid: string;
  props: Prop[];
}

interface Resolver {
  defaultZone: string;
  feedZone: string | null;
  unknownZone: number;
}

/** Local wall time to an instant. A `Z` time is already one. Returns the zone used (for expanding a rule in the same zone). */
function toInstant(t: IcsTime, r: Resolver): { ms: number; zone: string } {
  if (t.utc) return { ms: wallToInstant(t.date, 0, 'UTC') + t.seconds * 1000, zone: 'UTC' };
  let zone = r.feedZone ?? r.defaultZone;
  if (t.tzid) {
    const known = zoneOf(t.tzid);
    if (known) zone = known;
    else r.unknownZone += 1;
  }
  const whole = Math.floor(t.seconds / 60);
  return {
    ms: wallToInstant(t.date, whole, zone) + (t.seconds - whole * 60) * 1000,
    zone,
  };
}

const first = (props: Prop[], name: string): Prop | undefined => props.find((p) => p.name === name);

// --- recurrence -------------------------------------------------------------------------------------------------------

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count: number | null;
  /** Epoch ms, or null. */
  until: IcsTime | null;
  byDay: Array<{ ord: number | null; weekday: number }>;
  byMonthDay: number[];
  byMonth: number[];
  bySetPos: number[];
  wkst: number;
}

/** Null when the rule uses something this reader does not support. */
function parseRule(value: string): Rule | null {
  const kv: Record<string, string> = {};
  for (const part of value.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) kv[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  const freq = kv.FREQ?.toUpperCase();
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null;
  for (const unsupported of ['BYYEARDAY', 'BYWEEKNO', 'BYHOUR', 'BYMINUTE', 'BYSECOND']) {
    if (kv[unsupported] !== undefined) return null;
  }
  const ints = (v: string | undefined) =>
    (v ?? '')
      .split(',')
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isInteger(n));
  const byDay: Rule['byDay'] = [];
  for (const token of (kv.BYDAY ?? '').split(',').filter(Boolean)) {
    const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(token.trim());
    if (!m) return null;
    byDay.push({
      ord: m[1] ? Number(m[1]) : null,
      weekday: WEEKDAYS.indexOf(m[2]!.toUpperCase() as (typeof WEEKDAYS)[number]),
    });
  }
  const wkst = kv.WKST ? WEEKDAYS.indexOf(kv.WKST.toUpperCase() as (typeof WEEKDAYS)[number]) : 1;
  const until = kv.UNTIL ? parseTime({ name: 'UNTIL', params: {}, value: kv.UNTIL }) : null;
  if (kv.UNTIL && !until) return null;
  const interval = kv.INTERVAL ? Number(kv.INTERVAL) : 1;
  const count = kv.COUNT ? Number(kv.COUNT) : null;
  if (!Number.isInteger(interval) || interval < 1) return null;
  if (count !== null && (!Number.isInteger(count) || count < 1)) return null;
  return {
    freq,
    interval,
    count,
    until,
    byDay,
    byMonthDay: ints(kv.BYMONTHDAY),
    byMonth: ints(kv.BYMONTH),
    bySetPos: ints(kv.BYSETPOS),
    wkst: wkst < 0 ? 1 : wkst,
  };
}

const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const ymd = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

/** Dates (YYYY-MM-DD) of the weekday `wd` in a month. */
function weekdaysOfMonth(y: number, m: number, wd: number): string[] {
  const out: string[] = [];
  for (let d = 1; d <= daysInMonth(y, m); d += 1) {
    if (weekdayOf(ymd(y, m, d)) === wd) out.push(ymd(y, m, d));
  }
  return out;
}

/** `ord` is 1-based from the front, negative from the back. */
function nth<T>(list: T[], ord: number): T | undefined {
  return ord > 0 ? list[ord - 1] : list[list.length + ord];
}

function applySetPos(dates: string[], setPos: number[]): string[] {
  if (setPos.length === 0) return dates;
  const sorted = [...new Set(dates)].sort();
  const out = new Set<string>();
  for (const p of setPos) {
    const hit = nth(sorted, p);
    if (hit) out.add(hit);
  }
  return [...out].sort();
}

/** The dates one period (a day, a week, a month, a year) of the rule produces, ascending. `n` counts periods from the one holding DTSTART. */
function periodDates(rule: Rule, start: string, n: number): string[] {
  const s = parseLocalDate(start);
  const k = n * rule.interval;
  switch (rule.freq) {
    case 'DAILY': {
      const date = addDays(start, k);
      const l = parseLocalDate(date);
      if (rule.byMonth.length > 0 && !rule.byMonth.includes(l.m)) return [];
      if (rule.byDay.length > 0 && !rule.byDay.some((b) => b.weekday === weekdayOf(date)))
        return [];
      if (rule.byMonthDay.length > 0 && !monthDayMatches(rule.byMonthDay, l.y, l.m, l.d)) return [];
      return [date];
    }
    case 'WEEKLY': {
      const base = addDays(start, -((weekdayOf(start) - rule.wkst + 7) % 7) + 7 * k);
      const weekdays =
        rule.byDay.length > 0 ? rule.byDay.map((b) => b.weekday) : [weekdayOf(start)];
      const out = weekdays.map((wd) => addDays(base, (wd - rule.wkst + 7) % 7)).sort();
      return out.filter(
        (d) => rule.byMonth.length === 0 || rule.byMonth.includes(parseLocalDate(d).m),
      );
    }
    case 'MONTHLY': {
      const index = s.y * 12 + (s.m - 1) + k;
      const y = Math.floor(index / 12);
      const m = (index % 12) + 1;
      if (rule.byMonth.length > 0 && !rule.byMonth.includes(m)) return [];
      return applySetPos(monthDates(rule, y, m, s.d), rule.bySetPos);
    }
    case 'YEARLY': {
      const y = s.y + k;
      const months = rule.byMonth.length > 0 ? rule.byMonth : [s.m];
      const out = months.flatMap((m) => monthDates(rule, y, m, s.d));
      return applySetPos(out.sort(), rule.bySetPos);
    }
  }
}

function monthDayMatches(list: number[], y: number, m: number, d: number): boolean {
  const last = daysInMonth(y, m);
  return list.some((x) => (x > 0 ? x === d : last + x + 1 === d));
}

/** The dates of one month a MONTHLY or YEARLY rule selects (`dom`: the day of month DTSTART falls on, the default). */
function monthDates(rule: Rule, y: number, m: number, dom: number): string[] {
  const last = daysInMonth(y, m);
  const days = new Set<string>();
  if (rule.byMonthDay.length > 0) {
    for (const x of rule.byMonthDay) {
      const d = x > 0 ? x : last + x + 1;
      if (d >= 1 && d <= last) days.add(ymd(y, m, d));
    }
    if (rule.byDay.length > 0) {
      const wanted = new Set(rule.byDay.map((b) => b.weekday));
      for (const d of [...days]) if (!wanted.has(weekdayOf(d))) days.delete(d);
    }
  } else if (rule.byDay.length > 0) {
    for (const b of rule.byDay) {
      const all = weekdaysOfMonth(y, m, b.weekday);
      if (b.ord === null) all.forEach((d) => days.add(d));
      else {
        const hit = nth(all, b.ord);
        if (hit) days.add(hit);
      }
    }
  } else if (dom <= last) {
    // RFC 5545: a month that has no such day produces nothing.
    days.add(ymd(y, m, dom));
  }
  return [...days].sort();
}

// --- the reader -------------------------------------------------------------------------------------------------------

function mergeIntervals(list: IcsBusyInterval[]): IcsBusyInterval[] {
  const sorted = [...list].sort((a, b) => a.startMs - b.startMs);
  const out: IcsBusyInterval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.startMs <= last.endMs) last.endMs = Math.max(last.endMs, i.endMs);
    else out.push({ ...i });
  }
  return out;
}

interface Occurrence {
  startMs: number;
  endMs: number;
  allDay: boolean;
}

export function parseIcsBusy(text: string, opts: IcsParseOptions): IcsParseResult {
  const lines = unfold(text);
  if (!lines.some((l) => /^BEGIN:VCALENDAR\s*$/i.test(l))) throw new IcsFormatError();

  let calendarName: string | null = null;
  let feedZoneName: string | null = null;
  const events: RawEvent[] = [];
  let current: Prop[] | null = null;
  let depth = 0; // components nested inside the VEVENT (VALARM): their properties are not the event's
  for (const line of lines) {
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === 'BEGIN') {
      if (current) depth += 1;
      else if (prop.value.trim().toUpperCase() === 'VEVENT') current = [];
      continue;
    }
    if (prop.name === 'END') {
      if (current && depth > 0) depth -= 1;
      else if (current) {
        const uid = first(current, 'UID')?.value ?? `event-${events.length}`;
        events.push({ uid, props: current });
        current = null;
      }
      continue;
    }
    if (current) {
      if (depth === 0) current.push(prop);
    } else if (prop.name === 'X-WR-CALNAME') calendarName = prop.value.trim().slice(0, 200) || null;
    else if (prop.name === 'X-WR-TIMEZONE') feedZoneName = prop.value.trim();
  }

  const defaultZone = isZone(opts.defaultZone) ? opts.defaultZone : 'UTC';
  const resolver: Resolver = {
    defaultZone,
    feedZone: feedZoneName ? zoneOf(feedZoneName) : null,
    unknownZone: 0,
  };
  const maxPer = opts.maxOccurrencesPerEvent ?? DEFAULT_MAX_OCCURRENCES;
  const maxIntervals = opts.maxIntervals ?? DEFAULT_MAX_INTERVALS;
  const warnings: IcsParseResult['warnings'] = {
    unknownZone: 0,
    unsupportedRule: 0,
    truncated: false,
  };

  // Overrides of single occurrences (RECURRENCE-ID): the occurrence they replace is not generated.
  const replaced = new Set<string>();
  for (const e of events) {
    const rid = first(e.props, 'RECURRENCE-ID');
    const t = rid && parseTime(rid);
    if (t) replaced.add(`${e.uid}|${toInstant(t, resolver).ms}`);
  }

  const busy: IcsBusyInterval[] = [];
  const keep = (o: Occurrence) => {
    if (o.endMs <= opts.fromMs || o.startMs >= opts.toMs) return;
    if (o.allDay && !opts.blockAllDay) return;
    busy.push({ startMs: o.startMs, endMs: o.endMs });
  };

  for (const e of events) {
    const status = first(e.props, 'STATUS')?.value.trim().toUpperCase();
    if (status === 'CANCELLED') continue;
    if (first(e.props, 'TRANSP')?.value.trim().toUpperCase() === 'TRANSPARENT') continue;
    const startProp = first(e.props, 'DTSTART');
    const start = startProp && parseTime(startProp);
    if (!start) continue;
    const begin = toInstant(start, resolver);

    // How long it lasts: DTEND, else DURATION, else a whole day for a DATE and nothing for a point in time.
    let lengthMs: number;
    const endProp = first(e.props, 'DTEND');
    const durProp = first(e.props, 'DURATION');
    const end = endProp && parseTime(endProp);
    if (end) {
      lengthMs = toInstant(end, resolver).ms - begin.ms;
    } else if (durProp && parseDuration(durProp.value) !== null) {
      lengthMs = parseDuration(durProp.value)!;
    } else {
      lengthMs = start.allDay ? DAY_MS : 0;
    }
    if (lengthMs <= 0) continue;

    const ruleProp = first(e.props, 'RRULE');
    const rdates = e.props.filter((p) => p.name === 'RDATE');
    const isOverride = first(e.props, 'RECURRENCE-ID') !== undefined;
    if (!ruleProp && rdates.length === 0) {
      keep({ startMs: begin.ms, endMs: begin.ms + lengthMs, allDay: start.allDay });
      continue;
    }

    // A recurring event: its occurrences within the window.
    const exdates = new Set<number>();
    for (const x of e.props.filter((p) => p.name === 'EXDATE')) {
      for (const v of x.value.split(',')) {
        const t = parseTime({ ...x, value: v });
        if (t) exdates.add(toInstant(t, resolver).ms);
      }
    }
    const skip = (ms: number) => exdates.has(ms) || replaced.has(`${e.uid}|${ms}`);

    let produced = 0;
    const emit = (ms: number): boolean => {
      if (skip(ms)) return true;
      keep({ startMs: ms, endMs: ms + lengthMs, allDay: start.allDay });
      produced += 1;
      return produced < maxPer;
    };

    // The first instance is DTSTART itself; RDATEs are extra instances.
    if (!isOverride) {
      let more = true;
      const rule = ruleProp ? parseRule(ruleProp.value) : null;
      if (ruleProp && !rule) {
        warnings.unsupportedRule += 1;
        emit(begin.ms);
        more = false;
      }
      if (rule && more) {
        // A DATE as UNTIL includes that whole day.
        const untilMs = rule.until
          ? toInstant(rule.until, { ...resolver, unknownZone: 0 }).ms +
            (rule.until.allDay ? DAY_MS : 0)
          : null;
        // DTSTART is always the first instance of the set, whether or not the rule would pick it.
        let counted = 1;
        if (!emit(begin.ms)) warnings.truncated = true;
        // COUNT=1 is DTSTART alone.
        const only = rule.count !== null && rule.count <= 1;
        outer: for (let n = 0; n < MAX_PERIODS && !only; n += 1) {
          for (const date of periodDates(rule, start.date, n)) {
            if (date < start.date) continue;
            const ms = start.allDay
              ? wallToInstant(date, 0, begin.zone)
              : wallToInstant(date, Math.floor(start.seconds / 60), begin.zone) +
                (start.seconds % 60) * 1000;
            if (ms === begin.ms) continue;
            if (untilMs !== null && ms > untilMs) break outer;
            counted += 1;
            if (rule.count !== null && counted > rule.count) break outer;
            if (ms >= opts.toMs) break outer;
            // Too far back to matter: counted, not kept.
            if (ms + lengthMs > opts.fromMs && !emit(ms)) {
              warnings.truncated = true;
              break outer;
            }
          }
        }
      }
      for (const rd of rdates) {
        for (const v of rd.value.split(',')) {
          const t = parseTime({ ...rd, value: v });
          if (t && !emit(toInstant(t, resolver).ms)) warnings.truncated = true;
        }
      }
    }
    if (isOverride) keep({ startMs: begin.ms, endMs: begin.ms + lengthMs, allDay: start.allDay });
  }

  warnings.unknownZone = resolver.unknownZone;
  let merged = mergeIntervals(busy);
  if (merged.length > maxIntervals) {
    warnings.truncated = true;
    merged = merged.slice(0, maxIntervals);
  }
  return {
    busy: merged,
    events: events.length,
    calendarName,
    warnings,
  };
}
