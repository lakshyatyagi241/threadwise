import { Injectable, type PipeTransform } from '@nestjs/common';
import { ERROR_CODES, type ErrorCode } from '@crm/contracts';
import { AppError } from '../../../../common/errors/app-error';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SENDER_KEY =
  /^(baileys|waba|twilio|sms):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Engines a WhatsApp sender can belong to; the order a bare uuid is looked up in. */
export const SENDER_ENGINES = ['baileys', 'waba', 'twilio', 'sms'] as const;

/** The `:id` of a route. A value that is not a uuid is a missing record, not a malformed request (WaDesk: a non-numeric id never matched). */
@Injectable()
export class UuidParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw AppError.notFound('Record');
    return value.toLowerCase();
  }
}

/** Candidate sender keys for a public `device_id`: a full key is itself, a bare uuid is tried against every engine, anything else is nobody. */
export function senderKeyCandidates(deviceId: string | null | undefined): string[] {
  const id = deviceId?.trim();
  if (!id) return [];
  if (SENDER_KEY.test(id)) return [id.toLowerCase()];
  if (UUID.test(id)) return SENDER_ENGINES.map((e) => `${e}:${id.toLowerCase()}`);
  return [];
}

/**
 * The numbers of a campaign request as the audience resolver wants them (WD-API-095): everything but digits removed, fewer than 8 digits
 * dropped silently, duplicates collapsed. Done here, one entry at a time, because the resolver splits a text on spaces and so would cut
 * `+1 415 555 0100` into four numbers.
 */
export function contactDigits(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const entry of raw) {
    const digits = entry.replace(/\D+/g, '');
    if (digits.length >= 8) seen.add(digits);
  }
  return [...seen];
}

/** Scheduled numbers: digits only, empty ones dropped, duplicates removed, no minimum length (WD-API-091). */
export function scheduledDigits(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const entry of raw) {
    const digits = entry.replace(/\D+/g, '');
    if (digits !== '') seen.add(digits);
  }
  return [...seen];
}

export interface WallClock {
  date: string;
  time: string;
  /** Minutes east of UTC when the text carried its own offset, else null. */
  offsetMinutes: number | null;
}

const DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/** `2026-12-01 09:00`, `2026-12-01T09:00:00+05:30`, `2026-12-01` (midnight); null when it is not a real date and time. */
export function parseWallClock(raw: string): WallClock | null {
  const m = DATETIME.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, hh = '0', mi = '0', , off] = m;
  const hour = Number(hh);
  const minute = Number(mi);
  if (hour > 23 || minute > 59) return null;
  const probe = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (
    probe.getUTCFullYear() !== Number(y) ||
    probe.getUTCMonth() !== Number(mo) - 1 ||
    probe.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  let offsetMinutes: number | null = null;
  if (off) {
    if (off.toUpperCase() === 'Z') offsetMinutes = 0;
    else {
      const digits = off.slice(1).replace(':', '');
      const oh = Number(digits.slice(0, 2));
      const om = Number(digits.slice(2) || '0');
      if (oh > 23 || om > 59) return null;
      offsetMinutes = (off.startsWith('-') ? -1 : 1) * (oh * 60 + om);
    }
  }
  return {
    date: `${y}-${mo}-${d}`,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    offsetMinutes,
  };
}

/** The wall clock an instant shows in an IANA zone. */
export function wallClockIn(instant: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

/**
 * When a scheduled message runs, as the date and time the staff service takes (read in `timeZone`). Text without an offset is already a
 * wall clock in that zone; text with one names an instant, which is converted to the zone's wall clock (WaDesk parsed it in the zone).
 */
export function scheduledRunParts(
  raw: string,
  timeZone: string,
): { date: string; time: string } | null {
  const w = parseWallClock(raw);
  if (!w) return null;
  if (w.offsetMinutes === null) return { date: w.date, time: w.time };
  const [h, mi] = w.time.split(':').map(Number) as [number, number];
  const [y, mo, d] = w.date.split('-').map(Number) as [number, number, number];
  const instant = new Date(Date.UTC(y, mo - 1, d, h, mi) - w.offsetMinutes * 60_000);
  return wallClockIn(instant, timeZone);
}

/** `14:30`, `2:30 PM` or `9:05 am` as `HH:mm`; null when it is not a time. */
export function normalizeTime(raw: string): string | null {
  const m = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/.exec(raw.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2]);
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

/** Percent of `part` in `base`, two decimals, 0 for an empty base (WaDesk's rate rounding). */
export function rate(part: number, base: number): number {
  return base > 0 ? Math.round((part / base) * 10_000) / 100 : 0;
}

const SNAKE: Record<string, string> = {
  senderKey: 'device_id',
  manualNumbers: 'contacts',
  contactIds: 'recipients',
  groupIds: 'group_id',
};

/** The staff services name fields in camelCase; the public API names them as the client sent them. */
export function publicFieldName(path: string, rename: Record<string, string> = {}): string {
  const head = path.split('.')[0] ?? path;
  return rename[head] ?? SNAKE[head] ?? head.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** Domain refusal codes to the codes WaDesk's clients branch on. Anything not listed passes through unchanged. */
export function refusalAs(
  err: unknown,
  map: Partial<Record<string, ErrorCode>>,
  opts: { rename?: Record<string, string>; validationAs?: ErrorCode } = {},
): unknown {
  if (!(err instanceof AppError)) return err;
  const code: ErrorCode | undefined =
    map[err.code] ?? (err.code === ERROR_CODES.VALIDATION_FAILED ? opts.validationAs : undefined);
  if (!code) {
    if (err.details?.length) {
      return new AppError(
        err.code,
        messageOf(err),
        err.getStatus(),
        err.details.map((d) => ({
          path: publicFieldName(d.path, opts.rename),
          message: d.message,
        })),
      );
    }
    return err;
  }
  return new AppError(
    code,
    messageOf(err),
    err.getStatus(),
    err.details?.map((d) => ({ path: publicFieldName(d.path, opts.rename), message: d.message })),
  );
}

/** The message of a refusal. For a validation failure the first field message is the reason a client wants to read. */
function messageOf(err: AppError): string {
  const body = err.getResponse() as { message?: string };
  const first = err.details?.[0]?.message;
  if (err.code === ERROR_CODES.VALIDATION_FAILED && first) return first;
  return body.message ?? err.message;
}
