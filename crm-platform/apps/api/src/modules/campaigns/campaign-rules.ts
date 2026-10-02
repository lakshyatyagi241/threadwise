import { isKnownTimeZone, wallTimeToUtc } from '../broadcasts';

/** The pure rules of a campaign (TW-CAMP-003 to 013, 021). Nothing here reads a database or a clock it was not given. */

// ---------------------------------------------------------------- custom message (006)

const NAMED_TOKEN = /\{\{\s*[a-zA-Z_][\w.-]*\s*\}\}/u;
const ANY_TOKEN = /\{\{\s*([a-zA-Z0-9_][\w.-]*)\s*\}\}/gu;

/**
 * Named tokens (`{{order_id}}`) become positional (`{{1}}`) in order of first appearance, with the slot-to-key map beside the
 * body. A body with no named token is returned as it came, with the map it came with (never renumber a positional body).
 */
export function normalizeCustomMessage(
  body: string,
  map: Record<string, string> | null | undefined,
): { body: string; map: Record<string, string> | null } {
  if (body === '' || !NAMED_TOKEN.test(body)) return { body, map: map ?? null };
  const order = new Map<string, number>();
  const out: Record<string, string> = {};
  const next = body.replace(ANY_TOKEN, (_m, token: string) => {
    let slot = order.get(token);
    if (slot === undefined) {
      slot = order.size + 1;
      order.set(token, slot);
      out[String(slot)] = token;
    }
    return `{{${slot}}}`;
  });
  return { body: next, map: out };
}

// ---------------------------------------------------------------- audience inputs (004)

/** Typed numbers: split on whitespace, comma or semicolon. */
export function parseManualNumbers(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

/** Digits only, at least 8 of them, first occurrence wins. */
export function cleanNumbers(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const n of raw) {
    const d = n.replace(/\D+/g, '');
    if (d.length >= 8) seen.add(d);
  }
  return [...seen];
}

/** One CSV line to its cells, with double quotes and doubled quotes as in RFC 4180. */
function csvCells(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

const HEADER_NAMES = /^(name|phone|mobile|number|contact)$/i;
const PHONE_COLUMNS = ['phone', 'mobile', 'number'];
const RESERVED_COLUMNS = new Set(['phone', 'mobile', 'number', 'contact']);

export interface ParsedCsv {
  numbers: string[];
  /** Digits of the phone to its other columns, kept under the raw header and the snake_case form. */
  attrsByPhone: Map<string, Record<string, string>>;
}

/**
 * Reference's CSV rule: a first row that holds one of `name, phone, mobile, number, contact` is a header, otherwise the file has none
 * and the phone is the first column. The phone column is found by header (`phone`, `mobile`, `number`), else it is the first.
 * Every other non-empty column becomes an attribute of that number.
 */
export function parseCsv(text: string): ParsedCsv {
  const numbers: string[] = [];
  const attrsByPhone = new Map<string, Record<string, string>>();
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  let headers: string[] | null = null;
  lines.forEach((line, i) => {
    const cols = csvCells(line);
    if (i === 0) {
      const lower = cols.map((c) => c.trim().toLowerCase());
      if (cols.some((c) => HEADER_NAMES.test(c.trim()))) {
        headers = lower;
        return;
      }
    }
    let phoneIdx = 0;
    if (headers) {
      for (const key of PHONE_COLUMNS) {
        const idx = headers.indexOf(key);
        if (idx !== -1) {
          phoneIdx = idx;
          break;
        }
      }
    }
    const phone = (cols[phoneIdx] ?? '').trim();
    if (phone === '') return;
    numbers.push(phone);
    if (!headers) return;
    const digits = phone.replace(/\D+/g, '');
    const attrs: Record<string, string> = {};
    headers.forEach((h, ci) => {
      const name = h.trim();
      if (ci === phoneIdx || name === '' || RESERVED_COLUMNS.has(name)) return;
      const val = (cols[ci] ?? '').trim();
      if (val === '') return;
      attrs[name] = val;
      const snake = name.replace(/[ -]/g, '_');
      if (snake !== name) attrs[snake] = val;
    });
    if (digits !== '' && Object.keys(attrs).length > 0) {
      attrsByPhone.set(digits, { ...(attrsByPhone.get(digits) ?? {}), ...attrs });
    }
  });
  return { numbers, attrsByPhone };
}

export const SAMPLE_CSV =
  'name,country_code,phone\nAarav Sharma,91,9812345678\nPriya Patel,91,9898765432\n';
export const SAMPLE_CSV_FILE = 'campaign-recipients-sample.csv';

// ---------------------------------------------------------------- media (006)

export type MediaColumn = 'custom_image' | 'custom_video' | 'custom_document';

/** One media per campaign: jpg, jpeg and png are images, mp4 a video, pdf, doc and docx documents. Anything else is refused. */
export function mediaColumnFor(url: string): MediaColumn | null {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* keep the raw text */
  }
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  if (['jpg', 'jpeg', 'png'].includes(ext)) return 'custom_image';
  if (ext === 'mp4') return 'custom_video';
  if (['pdf', 'doc', 'docx'].includes(ext)) return 'custom_document';
  return null;
}

export const MEDIA_KIND: Record<MediaColumn, 'image' | 'video' | 'document'> = {
  custom_image: 'image',
  custom_video: 'video',
  custom_document: 'document',
};

// ---------------------------------------------------------------- schedule (008)

/** The instant a scheduled or recurring campaign is due, from its date and time read in its own zone. Null without both. */
export function dueAtUtc(
  sendDate: string | null,
  sendTime: string | null,
  timezone: string | null,
): Date | null {
  if (!sendDate) return null;
  const zone = timezone && isKnownTimeZone(timezone) ? timezone : 'UTC';
  try {
    return wallTimeToUtc(sendDate, (sendTime ?? '00:00').slice(0, 5), zone);
  } catch {
    return null;
  }
}

/** `YYYY-MM-DDTHH:mm` typed in `zone` to the UTC instant it names. Null when it does not parse. */
export function localDateTimeToUtc(local: string | null | undefined, zone: string): Date | null {
  if (!local) return null;
  const [date, time] = local.split('T');
  if (!date || !time) return null;
  try {
    return wallTimeToUtc(date, time.slice(0, 5), isKnownTimeZone(zone) ? zone : 'UTC');
  } catch {
    return null;
  }
}

/** The instant `at` as `YYYY-MM-DDTHH:mm` on the clock of `zone`, the shape the form's end-date field uses. */
export function utcToLocalDateTime(at: Date | null, zone: string): string | null {
  if (!at) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: isKnownTimeZone(zone) ? zone : 'UTC',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Reference's guard: a scheduled or recurring campaign whose end date is not after its send moment would expire before it sends. */
export function expiresBeforeSend(opts: {
  scheduleType: string;
  sendDate: string | null | undefined;
  sendTime: string | null | undefined;
  expiresAtLocal: string | null | undefined;
  timezone: string;
}): boolean {
  if (opts.scheduleType !== 'scheduled' && opts.scheduleType !== 'recurring') return false;
  if (!opts.expiresAtLocal || !opts.sendDate) return false;
  const sendAt = dueAtUtc(opts.sendDate, opts.sendTime ?? '00:00', opts.timezone);
  const endAt = localDateTimeToUtc(opts.expiresAtLocal, opts.timezone);
  if (!sendAt || !endAt) return false;
  return endAt.getTime() <= sendAt.getTime();
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Month plus one, the day clamped to the end of the next month (Carbon's addMonthNoOverflow). */
function addMonthNoOverflow(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const lastOfNext = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, lastOfNext))).toISOString().slice(0, 10);
}

/**
 * The next occurrence of a recurring campaign: the date moves one cadence and the wall-clock time stays, so 09:00 is 09:00 in the
 * campaign's own zone on both sides of a daylight-saving change (dates are calendar dates, never added as 24-hour blocks).
 * Null when there is no cadence or the next date is past `repeatUntil`.
 */
export function advanceRecurring(c: {
  scheduleType: string;
  repeatInterval: string | null;
  repeatUntil: string | null;
  sendDate: string | null;
  sendTime: string | null;
}): { sendDate: string; sendTime: string } | null {
  if (c.scheduleType !== 'recurring' || !c.repeatInterval || !c.sendDate) return null;
  const next =
    c.repeatInterval === 'daily'
      ? addDays(c.sendDate, 1)
      : c.repeatInterval === 'weekly'
        ? addDays(c.sendDate, 7)
        : c.repeatInterval === 'monthly'
          ? addMonthNoOverflow(c.sendDate)
          : null;
  if (!next) return null;
  if (c.repeatUntil && next > c.repeatUntil) return null;
  return { sendDate: next, sendTime: (c.sendTime ?? '00:00:00').slice(0, 5) };
}

// ---------------------------------------------------------------- window (009)

/** `HH:MM` on the clock of `zone` at `now`, as minutes since midnight. */
export function minutesInZone(now: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: isKnownTimeZone(zone) ? zone : 'UTC',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** Inside the active hours, which may run past midnight (22:00 to 06:00). Equal start and end means all day. */
export function withinSendWindow(now: Date, zone: string, start: string, end: string): boolean {
  const cur = minutesInZone(now, zone);
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return true;
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}

/** When the window opens next, in ms from `now` (whole minutes), for the stop reason `window`. */
export function msUntilWindowOpens(now: Date, zone: string, start: string): number {
  const cur = minutesInZone(now, zone);
  const s = toMinutes(start);
  const wait = (s - cur + 1440) % 1440;
  return (wait === 0 ? 1440 : wait) * 60_000;
}

// ---------------------------------------------------------------- retries (012)

export const MAX_ATTEMPTS_DEFAULT = 3;
export const RETRY_BACKOFF_DEFAULT_SEC = 60;

/** Meta's marketing-frequency throttle: retrying is futile and hurts the number's rating, so it is spaced out and capped low. */
export const isEcosystemThrottle = (error: string): boolean => {
  const e = error.toLowerCase();
  return e.includes('healthy ecosystem') || e.includes('131049');
};

/**
 * What a transient failure does to a recipient row (TW-CAMP-012). While attempts remain the row stays `failed` with a next attempt
 * (base x 2^(n-1) seconds, at most an hour; for the ecosystem throttle 6 h then 12 h, at most a day, and only 2 attempts);
 * at the cap it is final and counts as failed.
 */
export function retryOutcome(opts: {
  attemptsBefore: number;
  maxAttempts: number;
  backoffSec: number;
  error: string;
  now: Date;
}): { attempts: number; nextAttemptAt: Date | null; final: boolean } {
  const eco = isEcosystemThrottle(opts.error);
  const attempts = opts.attemptsBefore + 1;
  const cap = eco ? Math.min(opts.maxAttempts, 2) : opts.maxAttempts;
  if (attempts < cap) {
    const delay = eco
      ? Math.min(86_400, 21_600 * 2 ** (attempts - 1))
      : Math.min(3_600, opts.backoffSec * 2 ** (attempts - 1));
    return {
      attempts,
      nextAttemptAt: new Date(opts.now.getTime() + delay * 1000),
      final: false,
    };
  }
  // An ecosystem throttle is stamped at the global cap so no sweep re-pokes Meta with it.
  return { attempts: eco ? opts.maxAttempts : attempts, nextAttemptAt: null, final: true };
}

// ---------------------------------------------------------------- A/B (007)

/** Which variant each recipient gets: shuffled, then the first `round(n x split / 100)` are A. */
export function assignVariants<T>(
  ids: readonly T[],
  splitPercent: number,
  random: () => number,
): Map<T, 'A' | 'B'> {
  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const split = Math.max(0, Math.min(100, Math.trunc(splitPercent)));
  const countA = Math.round((shuffled.length * split) / 100);
  return new Map(shuffled.map((id, i) => [id, i < countA ? 'A' : 'B']));
}

// ---------------------------------------------------------------- status machine (021)

/** A report only moves a recipient forward: read never goes back to delivered. */
export const STATUS_RANK: Record<string, number> = {
  queued: 0,
  pending: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  failed: 9,
};

export const isNewer = (current: string, incoming: string): boolean =>
  (STATUS_RANK[incoming] ?? 0) >= (STATUS_RANK[current] ?? 0);

/** Recipient statuses that count as delivered to the provider; they are never sent again. */
export const SENT_STATUSES = ['sent', 'delivered', 'read', 'responded'] as const;
/** Statuses the sender leaves alone for good. */
export const SETTLED_STATUSES = [...SENT_STATUSES, 'unsubscribed', 'skipped'] as const;

// ---------------------------------------------------------------- counters and finishing (001, 019)

export interface Aggregate {
  sent: number;
  delivered: number;
  read: number;
  responded: number;
  clicked: number;
  /** Rows that are done one way or another (sent, failed, unsubscribed, skipped). */
  terminal: number;
  total: number;
  failed: number;
}

/** A campaign whose recipients are all resolved is finished; nothing sent at all means it failed. */
export function reconciledStatus(
  status: string,
  a: Pick<Aggregate, 'sent' | 'terminal' | 'total'>,
): 'completed' | 'failed' | null {
  if (status !== 'scheduled' && status !== 'running') return null;
  if (a.total > 0 && a.terminal >= a.total) return a.sent === 0 ? 'failed' : 'completed';
  return null;
}

/** Percent of `part` in `base`, one decimal; 0 for an empty base. */
export const pct = (part: number, base: number): number =>
  base > 0 ? Math.round((part / base) * 1000) / 10 : 0;

/** The tile shows the greater of our click count and Meta's, never the sum. */
export const effectiveClicks = (ours: number, meta: number): number => Math.max(ours, meta);

// ---------------------------------------------------------------- export (020)

/** A leading `=`, `+`, `-` or `@` would run as a formula in a spreadsheet. */
export const csvSafe = (v: string): string => (/^[=+\-@]/.test(v) ? `'${v}` : v);
