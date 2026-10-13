import { HttpStatus } from '@nestjs/common';
import {
  CALL_LOG_DEFAULT_RANGE,
  CALL_LOG_MAX_RANGE_DAYS,
  ERROR_CODES,
  type CallLogRange,
  type CallLogStatus,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';

/** Pure rules of the call log and the analytics: how a call reads, which days a request covers, what a timeline entry may say. */

const rangeInvalid = (message: string) =>
  new AppError(ERROR_CODES.CALL_RANGE_INVALID, message, HttpStatus.UNPROCESSABLE_ENTITY);

/**
 * How a call reads in the log (Reference `WaCallToAiLogBridge::mapStatus`, which wrote `ai_call_logs.status`): failed when the row is
 * failed; completed when it ended with a duration; declined when the operator or the customer declined it; no answer for any other end;
 * in progress while it is still ringing or running. `declined` is read off the end reason because here Meta's end status is kept on the
 * row (Reference had a `rejected` call status of its own). The same rule is written in SQL in `call-logs.repository.ts`; the integration
 * spec holds the two to the same answers.
 */
export function callLogStatus(call: {
  status: string;
  durationSec: number;
  endReason: string | null;
}): CallLogStatus {
  if (call.status === 'failed') return 'failed';
  if (call.status === 'ended') {
    if (call.durationSec > 0) return 'completed';
    const reason = String(call.endReason ?? '').toUpperCase();
    return reason === 'DECLINED' || reason === 'REJECTED' ? 'declined' : 'no-answer';
  }
  return 'in-progress';
}

/** A call the team answered: it ended with talk time. */
export const isAnswered = (call: { status: string; durationSec: number }): boolean =>
  call.status === 'ended' && call.durationSec > 0;

/**
 * A call the customer placed that nobody talked to: it ended or failed with no talk time. A call we placed that nobody picked up is
 * `no-answer` in the log but is not "missed" (nobody missed it).
 */
export const isMissed = (call: {
  direction: string;
  status: string;
  durationSec: number;
}): boolean =>
  call.direction === 'USER_INITIATED' &&
  (call.status === 'ended' || call.status === 'failed') &&
  call.durationSec <= 0;

// --- days and time zones -----------------------------------------------------------------------------------------------

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The calendar day (`YYYY-MM-DD`) an instant falls on in a time zone. */
export function dayInZone(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Milliseconds the zone's wall clock is ahead of UTC at an instant. */
function offsetMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant a calendar day starts in a time zone (the day can be 23 or 25 hours long where the clocks change). */
export function startOfDayInZone(day: string, tz: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d);
  let t = wall - offsetMs(new Date(wall), tz);
  t = wall - offsetMs(new Date(t), tz);
  return new Date(t);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function daysBetween(from: string, to: string): number {
  const a = startOfDayInZone(from, 'UTC').getTime();
  const b = startOfDayInZone(to, 'UTC').getTime();
  return Math.round((b - a) / 86_400_000);
}

const RANGE_MS: Record<CallLogRange, number> = {
  '24h': 24 * 3_600_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};
const RANGE_DAYS: Record<CallLogRange, number> = { '24h': 1, '7d': 7, '30d': 30 };

export interface RangeInput {
  range?: CallLogRange;
  from?: string;
  to?: string;
  tz?: string;
}

function zoneOf(input: RangeInput): string {
  const tz = input.tz?.trim() || 'UTC';
  if (!isValidTimeZone(tz)) throw rangeInvalid(`Unknown time zone "${tz}".`);
  return tz;
}

/** The days a custom range names, in order, checked. `from` alone runs to today; `to` alone starts 29 days before it. */
function customDays(input: RangeInput, tz: string, now: Date): { fromDay: string; toDay: string } {
  const today = dayInZone(now, tz);
  const toDay = input.to ?? today;
  const fromDay = input.from ?? addDays(toDay, -29);
  if (fromDay > toDay) throw rangeInvalid('The start of the range is after its end.');
  if (daysBetween(fromDay, toDay) + 1 > CALL_LOG_MAX_RANGE_DAYS) {
    throw rangeInvalid(`A range can cover at most ${CALL_LOG_MAX_RANGE_DAYS} days.`);
  }
  return { fromDay, toDay };
}

export interface LogWindow {
  /** Calls that started at or after this instant. */
  start: Date;
  /** ...and before this one; null: no upper bound (Reference's presets end now, and a call that rings this second counts). */
  end: Date | null;
  tz: string;
}

/**
 * The window of the call log. Reference's three presets (24 hours, 7 days, 30 days back from now, 30 days when unsaid) or, when the
 * request names `from` or `to`, whole days in the caller's time zone.
 */
export function logWindow(input: RangeInput, now: Date = new Date()): LogWindow {
  const tz = zoneOf(input);
  if (input.from || input.to) {
    const { fromDay, toDay } = customDays(input, tz, now);
    return {
      start: startOfDayInZone(fromDay, tz),
      end: startOfDayInZone(addDays(toDay, 1), tz),
      tz,
    };
  }
  const range = input.range ?? CALL_LOG_DEFAULT_RANGE;
  return { start: new Date(now.getTime() - RANGE_MS[range]), end: null, tz };
}

export interface DayWindow extends LogWindow {
  fromDay: string;
  toDay: string;
  end: Date;
}

/** The days of an analytics request: a preset counts today and the days before it (`7d` is today and six more), a custom range its own days. */
export function dayWindow(input: RangeInput, now: Date = new Date()): DayWindow {
  const tz = zoneOf(input);
  const { fromDay, toDay } =
    input.from || input.to
      ? customDays(input, tz, now)
      : (() => {
          const today = dayInZone(now, tz);
          const n = RANGE_DAYS[input.range ?? CALL_LOG_DEFAULT_RANGE];
          return { fromDay: addDays(today, -(n - 1)), toDay: today };
        })();
  return {
    fromDay,
    toDay,
    tz,
    start: startOfDayInZone(fromDay, tz),
    end: startOfDayInZone(addDays(toDay, 1), tz),
  };
}

/** Every day from `fromDay` to `toDay`. */
export function eachDay(fromDay: string, toDay: string): string[] {
  const out: string[] = [];
  for (let d = fromDay; d <= toDay; d = addDays(d, 1)) out.push(d);
  return out;
}

// --- search and timeline -----------------------------------------------------------------------------------------------

/** A search text made safe to put between `%` in a LIKE: the backslash, `%` and `_` mean themselves. */
export const likePattern = (text: string): string =>
  `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const digitsOnly = (s: string) => s.replace(/\D/g, '');

/** The digits to search the numbers for; null when the text has too few to be a number (a name search only). */
export function phoneSearch(q: string): string | null {
  const d = digitsOnly(q);
  return d.length >= 3 ? d : null;
}

const noteText = (v: unknown, max = 200): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/**
 * What one ledger step may tell the person reading the call: its type and, for a few steps, a short note. The payload of `connect` and
 * `terminate` is Meta's whole call object (it holds the SDP and the customer's numbers), so nothing of it is passed on beyond Meta's end
 * status and the length of the call.
 */
export function timelineNote(type: string, payload: unknown): string | null {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  switch (type) {
    case 'terminate':
      return noteText(p.status, 40);
    case 'reject_sent':
      return noteText(p.reason, 64);
    case 'dial_failed':
    case 'accept_failed':
      return noteText(p.message);
    case 'recording_stored': {
      const size = typeof p.size === 'number' ? p.size : null;
      const mime = noteText(p.mime, 60);
      return [mime, size === null ? null : `${size} B`].filter(Boolean).join(', ') || null;
    }
    default:
      return null;
  }
}

/**
 * The audio type of a stored recording, from its key. The operator's browser makes WebM (TW-CALL-019); a WAV or MP3 can sit in the same
 * private store (the AI calls' conversion, the dev seed). Anything else is offered as WebM, which is what the recorder writes.
 */
export function recordingMime(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'wav':
      return 'audio/wav';
    case 'mp3':
      return 'audio/mpeg';
    case 'ogg':
      return 'audio/ogg';
    case 'm4a':
      return 'audio/mp4';
    default:
      return 'audio/webm';
  }
}
