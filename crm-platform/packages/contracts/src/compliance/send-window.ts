import { z } from 'zod';
import { isInsideWindow } from './regimes';
import type { ComplianceSettingsValues } from './settings';

/**
 * Quiet hours and calling windows as a DECISION, not a refusal (BL-177, spec docs/specs/privacy-and-data-governance.md 11.5).
 *
 * A marketing send asks "may I send this now?" and gets `allow` or `hold` with the instant the window opens. A hold is never a deny:
 * the caller keeps the message and sends it at `until`, asking the ConsentGate again first. Pure: no clock of its own, no database. The
 * dispatchers pass `now`, the workspace settings and what they know about the contact's time zone.
 *
 * Which hours:
 *  - a message (WhatsApp, SMS, email, ...) is held while it is inside the QUIET HOURS;
 *  - a call is allowed only inside the CALLING WINDOW on the chosen weekdays.
 * Both are read on the clock of the contact (see `resolveContactZones`), because that is where the person is woken.
 */

/** Why a send was held. A key under `compliance-center.hold.reason.<reason>` in the locale text. */
export const SEND_HOLD_REASONS = ['quiet_hours', 'calling_window'] as const;
export const sendHoldReasonSchema = z.enum(SEND_HOLD_REASONS);
export type SendHoldReason = (typeof SEND_HOLD_REASONS)[number];

/**
 * Where the time zone of a decision came from, best first. A key under `compliance-center.hold.zoneSource.<source>`.
 *  - `contact_field`: the contact's own time zone property (a contact property of type "timezone", else a property keyed `timezone`);
 *  - `phone_country`: read from the country code of the number (a country with several zones uses ALL of them: the send waits until
 *    the hours are right in every one, the strictest reading);
 *  - `window_setting`: the zone chosen in Compliance center, Quiet hours and calling window;
 *  - `workspace`: the workspace's own time zone;
 *  - `utc`: nothing else was known.
 */
export const ZONE_SOURCES = [
  'contact_field',
  'phone_country',
  'window_setting',
  'workspace',
  'utc',
] as const;
export const zoneSourceSchema = z.enum(ZONE_SOURCES);
export type ZoneSource = (typeof ZONE_SOURCES)[number];

/** The windows as the dispatchers read them: `null` = the window is off for this workspace. */
export interface SendWindowPolicy {
  quietHours: { start: string; end: string } | null;
  callingWindow: { start: string; end: string; days: readonly number[] } | null;
  /** The zone chosen in the settings (null = none chosen). */
  windowTimezone: string | null;
  /** The workspace's own time zone (null = not set). */
  workspaceTimezone: string | null;
}

/** The zones of one recipient. More than one zone means "all of them must be inside the hours". */
export interface ResolvedZones {
  zones: string[];
  source: ZoneSource;
  /** Used when `zones` leave no moment that is right in all of them, and as the displayed zone when there is only one. */
  fallback: { zone: string; source: ZoneSource };
}

export type SendWindowKind = 'message' | 'call';

export type SendWindowDecision =
  | { decision: 'allow' }
  | {
      decision: 'hold';
      reason: SendHoldReason;
      /** The first instant the send may go (ISO 8601, UTC). */
      until: string;
      /** The zone shown to a person; null when the contact's country spans several zones. */
      zone: string | null;
      zoneSource: ZoneSource;
    };

export const ALLOW: SendWindowDecision = { decision: 'allow' };

/** What is stored with a held message or recipient, and returned to the screens. */
export const sendHoldSchema = z.object({
  reason: sendHoldReasonSchema,
  until: z.string(),
  zone: z.string().nullable(),
  zoneSource: zoneSourceSchema,
});
export type SendHold = z.infer<typeof sendHoldSchema>;

export function holdOf(d: SendWindowDecision): SendHold | null {
  return d.decision === 'hold'
    ? { reason: d.reason, until: d.until, zone: d.zone, zoneSource: d.zoneSource }
    : null;
}

/** The settings document reduced to what the dispatchers need. A window that cannot work (no days, start not before end) is off. */
export function policyOfSettings(
  s: Pick<ComplianceSettingsValues, 'quietHours' | 'callingWindow' | 'windowTimezone'>,
  workspaceTimezone: string | null,
): SendWindowPolicy {
  const q = s.quietHours;
  const c = s.callingWindow;
  const callingOk = c.enabled && c.days.length > 0 && clock(c.start) < clock(c.end);
  return {
    quietHours: q.enabled && q.start !== q.end ? { start: q.start, end: q.end } : null,
    callingWindow: callingOk ? { start: c.start, end: c.end, days: [...c.days] } : null,
    windowTimezone: s.windowTimezone && isZone(s.windowTimezone) ? s.windowTimezone : null,
    workspaceTimezone: workspaceTimezone && isZone(workspaceTimezone) ? workspaceTimezone : null,
  };
}

/** Is any window on for this kind of send? Lets a caller skip every lookup when nothing is configured. */
export const windowActive = (policy: SendWindowPolicy, kind: SendWindowKind): boolean =>
  kind === 'message' ? policy.quietHours !== null : policy.callingWindow !== null;

// ---- time zone arithmetic (Intl only, DST-safe) ----------------------------------------------------------------------------------

const clock = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    formatters.set(zone, f);
  }
  return f;
}

/** Is this an IANA zone the runtime knows? */
export function isZone(zone: string | null | undefined): zone is string {
  if (typeof zone !== 'string' || zone.trim() === '') return false;
  try {
    formatter(zone.trim());
    return true;
  } catch {
    return false;
  }
}

/** The zone as the runtime spells it (`asia/kolkata` becomes `Asia/Kolkata`), or null when it is not a zone it knows. */
export function canonicalZone(zone: string | null | undefined): string | null {
  if (!isZone(zone)) return null;
  try {
    return formatter(zone.trim()).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

interface Local {
  day: string;
  minutes: number;
  weekday: number;
  /** The wall clock read as if it were UTC, in ms (second resolution): the zone's offset is this minus the real instant. */
  wallMs: number;
}

function localOf(at: Date, zone: string): Local {
  const parts = formatter(zone).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  const y = Number(get('year'));
  const mo = Number(get('month'));
  const d = Number(get('day'));
  const h = Number(get('hour'));
  const mi = Number(get('minute'));
  const s = Number(get('second'));
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: h * 60 + mi,
    weekday: WEEKDAY[get('weekday')] ?? 1,
    wallMs: Date.UTC(y, mo - 1, d, h, mi, s),
  };
}

const offsetMs = (zone: string, instantMs: number): number =>
  localOf(new Date(instantMs), zone).wallMs - Math.floor(instantMs / 1000) * 1000;

/** `day` plus `n` calendar days (pure date arithmetic; a DST change cannot move it). */
function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The instant a wall clock time (`day`, `hhmm`) happens in `zone`. A time that does not exist (the clocks jump over it) lands just after. */
function wallToInstant(day: string, hhmm: string, zone: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)));
  const first = guess - offsetMs(zone, guess);
  return new Date(guess - offsetMs(zone, first));
}

/** Is a send of this kind allowed at this instant on the clock of `zone`? */
function allowedIn(
  kind: SendWindowKind,
  policy: SendWindowPolicy,
  zone: string,
  at: Date,
): boolean {
  const local = localOf(at, zone);
  if (kind === 'message') {
    const q = policy.quietHours;
    return q === null || !isInsideWindow(local.minutes, q);
  }
  const c = policy.callingWindow;
  return c === null || (c.days.includes(local.weekday) && isInsideWindow(local.minutes, c));
}

/** The instants after `at` at which the hours open on the clock of `zone` (the end of the quiet hours, the start of the calling window). */
function openings(kind: SendWindowKind, policy: SendWindowPolicy, zone: string, at: Date): Date[] {
  const today = localOf(at, zone).day;
  const out: Date[] = [];
  if (kind === 'message') {
    const q = policy.quietHours;
    if (!q) return out;
    for (let n = 0; n <= 2; n++) out.push(wallToInstant(addDays(today, n), q.end, zone));
  } else {
    const c = policy.callingWindow;
    if (!c) return out;
    for (let n = 0; n <= 8; n++) out.push(wallToInstant(addDays(today, n), c.start, zone));
  }
  return out.filter((d) => d.getTime() > at.getTime());
}

function earliestOpening(
  kind: SendWindowKind,
  policy: SendWindowPolicy,
  zones: readonly string[],
  at: Date,
): Date | null {
  const candidates = zones
    .flatMap((z) => openings(kind, policy, z, at))
    .sort((a, b) => a.getTime() - b.getTime());
  return candidates.find((c) => zones.every((z) => allowedIn(kind, policy, z, c))) ?? null;
}

/**
 * The decision for one recipient at `now`. Allowed when no window is on, or every zone of the recipient is inside the hours. Otherwise
 * `hold` until the first instant at which all of them are. If the recipient's zones leave no such moment (a country spanning more
 * hours than the window is wide) the fallback zone alone decides.
 */
export function decideSendWindow(
  kind: SendWindowKind,
  policy: SendWindowPolicy,
  resolved: ResolvedZones,
  now: Date,
): SendWindowDecision {
  if (!windowActive(policy, kind)) return ALLOW;
  const reason: SendHoldReason = kind === 'message' ? 'quiet_hours' : 'calling_window';
  const attempt = (zones: string[], source: ZoneSource): SendWindowDecision | null => {
    if (zones.every((z) => allowedIn(kind, policy, z, now))) return ALLOW;
    const until = earliestOpening(kind, policy, zones, now);
    if (!until) return null;
    return {
      decision: 'hold',
      reason,
      until: until.toISOString(),
      zone: zones.length === 1 ? (zones[0] ?? null) : null,
      zoneSource: source,
    };
  };
  return (
    attempt(resolved.zones, resolved.source) ??
    attempt([resolved.fallback.zone], resolved.fallback.source) ??
    ALLOW
  );
}

// ---- which zone is the contact in ----------------------------------------------------------------------------------------------

/**
 * Calling code to the IANA zone(s) of the country. A country with one zone has one entry; a country spanning hours lists the zones that
 * bound it. Only codes people actually message from are listed; anything else falls through to the workspace's zone.
 */
const CODE_ZONES: Readonly<Record<string, readonly string[]>> = {
  '1': [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Anchorage',
    'Pacific/Honolulu',
    'America/Halifax',
    'America/St_Johns',
  ],
  '7': [
    'Europe/Moscow',
    'Asia/Yekaterinburg',
    'Asia/Novosibirsk',
    'Asia/Vladivostok',
    'Asia/Almaty',
  ],
  '20': ['Africa/Cairo'],
  '27': ['Africa/Johannesburg'],
  '30': ['Europe/Athens'],
  '31': ['Europe/Amsterdam'],
  '32': ['Europe/Brussels'],
  '33': ['Europe/Paris'],
  '34': ['Europe/Madrid'],
  '36': ['Europe/Budapest'],
  '39': ['Europe/Rome'],
  '40': ['Europe/Bucharest'],
  '41': ['Europe/Zurich'],
  '43': ['Europe/Vienna'],
  '44': ['Europe/London'],
  '45': ['Europe/Copenhagen'],
  '46': ['Europe/Stockholm'],
  '47': ['Europe/Oslo'],
  '48': ['Europe/Warsaw'],
  '49': ['Europe/Berlin'],
  '51': ['America/Lima'],
  '52': ['America/Mexico_City', 'America/Tijuana', 'America/Cancun', 'America/Hermosillo'],
  '53': ['America/Havana'],
  '54': ['America/Argentina/Buenos_Aires'],
  '55': ['America/Sao_Paulo', 'America/Manaus', 'America/Rio_Branco', 'America/Noronha'],
  '56': ['America/Santiago'],
  '57': ['America/Bogota'],
  '58': ['America/Caracas'],
  '60': ['Asia/Kuala_Lumpur'],
  '61': [
    'Australia/Sydney',
    'Australia/Adelaide',
    'Australia/Darwin',
    'Australia/Brisbane',
    'Australia/Perth',
  ],
  '62': ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'],
  '63': ['Asia/Manila'],
  '64': ['Pacific/Auckland'],
  '65': ['Asia/Singapore'],
  '66': ['Asia/Bangkok'],
  '81': ['Asia/Tokyo'],
  '82': ['Asia/Seoul'],
  '84': ['Asia/Ho_Chi_Minh'],
  '86': ['Asia/Shanghai'],
  '90': ['Europe/Istanbul'],
  '91': ['Asia/Kolkata'],
  '92': ['Asia/Karachi'],
  '94': ['Asia/Colombo'],
  '98': ['Asia/Tehran'],
  '212': ['Africa/Casablanca'],
  '213': ['Africa/Algiers'],
  '216': ['Africa/Tunis'],
  '233': ['Africa/Accra'],
  '234': ['Africa/Lagos'],
  '251': ['Africa/Addis_Ababa'],
  '254': ['Africa/Nairobi'],
  '255': ['Africa/Dar_es_Salaam'],
  '256': ['Africa/Kampala'],
  '351': ['Europe/Lisbon'],
  '352': ['Europe/Luxembourg'],
  '353': ['Europe/Dublin'],
  '354': ['Atlantic/Reykjavik'],
  '356': ['Europe/Malta'],
  '357': ['Asia/Nicosia'],
  '358': ['Europe/Helsinki'],
  '359': ['Europe/Sofia'],
  '370': ['Europe/Vilnius'],
  '371': ['Europe/Riga'],
  '372': ['Europe/Tallinn'],
  '375': ['Europe/Minsk'],
  '380': ['Europe/Kyiv'],
  '381': ['Europe/Belgrade'],
  '385': ['Europe/Zagreb'],
  '386': ['Europe/Ljubljana'],
  '420': ['Europe/Prague'],
  '421': ['Europe/Bratislava'],
  '502': ['America/Guatemala'],
  '503': ['America/El_Salvador'],
  '504': ['America/Tegucigalpa'],
  '505': ['America/Managua'],
  '506': ['America/Costa_Rica'],
  '507': ['America/Panama'],
  '591': ['America/La_Paz'],
  '593': ['America/Guayaquil'],
  '595': ['America/Asuncion'],
  '598': ['America/Montevideo'],
  '852': ['Asia/Hong_Kong'],
  '880': ['Asia/Dhaka'],
  '886': ['Asia/Taipei'],
  '961': ['Asia/Beirut'],
  '962': ['Asia/Amman'],
  '964': ['Asia/Baghdad'],
  '965': ['Asia/Kuwait'],
  '966': ['Asia/Riyadh'],
  '968': ['Asia/Muscat'],
  '971': ['Asia/Dubai'],
  '972': ['Asia/Jerusalem'],
  '973': ['Asia/Bahrain'],
  '974': ['Asia/Qatar'],
  '977': ['Asia/Kathmandu'],
};

/**
 * The zone(s) of a phone number, read from its country code. `digits` must carry the country code (an E.164 number without its plus,
 * or with it); a number written locally gives null, because guessing the country would put the wrong clock on a person.
 */
export function zonesOfPhone(phone: string | null | undefined): string[] | null {
  const digits = (phone ?? '').replace(/\D+/g, '');
  if (digits.length < 7 || digits.startsWith('0')) return null;
  for (let len = 3; len >= 1; len--) {
    const zones = CODE_ZONES[digits.slice(0, len)];
    if (zones) return [...zones];
  }
  return null;
}

/**
 * Which clock a recipient's hours are read on (the documented fallback, best first):
 *  1. the contact's own time zone property, when it names a real IANA zone;
 *  2. the zone(s) of the country code of the phone number;
 *  3. the zone chosen in Compliance center (Quiet hours and calling window);
 *  4. the workspace's own time zone;
 *  5. UTC.
 * Steps 3 to 5 are also the `fallback` for the case where several zones of a country leave no common moment.
 */
export function resolveContactZones(
  policy: Pick<SendWindowPolicy, 'windowTimezone' | 'workspaceTimezone'>,
  facts: { timezone?: string | null; phone?: string | null },
): ResolvedZones {
  const fallback: ResolvedZones['fallback'] = policy.windowTimezone
    ? { zone: policy.windowTimezone, source: 'window_setting' }
    : policy.workspaceTimezone
      ? { zone: policy.workspaceTimezone, source: 'workspace' }
      : { zone: 'UTC', source: 'utc' };
  const own = (facts.timezone ?? '').trim();
  if (own !== '' && isZone(own)) return { zones: [own], source: 'contact_field', fallback };
  const byPhone = zonesOfPhone(facts.phone);
  if (byPhone) return { zones: byPhone, source: 'phone_country', fallback };
  return { zones: [fallback.zone], source: fallback.source, fallback };
}
