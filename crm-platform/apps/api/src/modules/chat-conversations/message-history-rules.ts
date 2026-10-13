import {
  MESSAGE_HISTORY_MAX_DAYS,
  MESSAGE_HISTORY_PREVIEW_CHARS,
  MESSAGE_HISTORY_RANGE_DAYS,
  type MessageHistoryFilters,
  type MessageHistorySummary,
  type MessageLogEvent,
  type MessageHistoryType,
} from '@crm/contracts';
import { DAY_MS, addDays, dayOf, dayStart } from './message-log-rules';

/**
 * The pure rules of Message History: which window a filter means, how a recipient is masked, the preview, the percentages of the KPI
 * cards, the cursor. No database and no clock (callers pass `now`), so each rule is checked by a table of cases in the unit tests.
 */

// --- the window --------------------------------------------------------------------------------------------------------------

export interface HistoryWindow {
  from: Date;
  /** Exclusive. */
  to: Date;
}

export type HistoryWindowProblem = 'order' | 'future' | 'too_old';

/**
 * The window a filter means. A preset is the last N days up to a second after `now` (Reference's `resolveRange`; an unknown preset is
 * the default 30 days here, Reference fell back to 7). A `from`/`to` pair is whole UTC days, `to` included. Returns the problem when
 * the pair is reversed, ends in the future or reaches back past MESSAGE_HISTORY_MAX_DAYS.
 */
export function resolveWindow(
  f: Pick<MessageHistoryFilters, 'range' | 'from' | 'to'>,
  now: Date,
): HistoryWindow | { problem: HistoryWindowProblem } {
  if (f.from !== undefined || f.to !== undefined) {
    const today = dayOf(now);
    const from = f.from ?? addDays(f.to ?? today, -(MESSAGE_HISTORY_RANGE_DAYS['30d'] - 1));
    const to = f.to ?? today;
    if (from > to) return { problem: 'order' };
    if (to > today) return { problem: 'future' };
    if (dayStart(from).getTime() < dayStart(addDays(today, -MESSAGE_HISTORY_MAX_DAYS)).getTime()) {
      return { problem: 'too_old' };
    }
    return { from: dayStart(from), to: dayStart(addDays(to, 1)) };
  }
  const days = MESSAGE_HISTORY_RANGE_DAYS[f.range ?? '30d'];
  return { from: new Date(now.getTime() - days * DAY_MS), to: new Date(now.getTime() + 1_000) };
}

/** The equal period right before the window (the "vs last period" card). */
export function previousWindow(w: HistoryWindow): HistoryWindow {
  const span = w.to.getTime() - w.from.getTime();
  return { from: new Date(w.from.getTime() - span), to: w.from };
}

// --- recipients and text -----------------------------------------------------------------------------------------------------

/** A peer key that is a phone number (E.164 digits, with or without the plus) as opposed to a channel's own thread or user id. */
export const isPhoneLike = (key: string | null | undefined): key is string =>
  typeof key === 'string' && /^\+?\d{6,15}$/.test(key);

/** How many digits of a number stay visible when the caller may not read the contact (Reference's phone mask: the last 4). */
export const MASK_VISIBLE_DIGITS = 4;

/**
 * The other side of a message as the screen shows it. A phone number is shown whole only to a caller who may read the contact
 * (`open`); otherwise only its last four digits ("•••••••8988"), as Reference's `mask_customer_numbers` promised (it never enforced
 * it: its History screen printed the full number). A key that is not a phone number (a Telegram id, an email thread) is not PII of
 * the same kind and is shown as it is. Nothing -> null.
 */
export function maskRecipient(
  raw: string | null | undefined,
  open: boolean,
): { value: string | null; masked: boolean } {
  if (raw === null || raw === undefined || raw === '') return { value: null, masked: false };
  if (!isPhoneLike(raw)) return { value: raw, masked: false };
  const digits = raw.replace(/\D/g, '');
  if (open) return { value: `+${digits}`, masked: false };
  const tail = digits.slice(-MASK_VISIBLE_DIGITS);
  return { value: `${'•'.repeat(Math.max(digits.length - tail.length, 3))}${tail}`, masked: true };
}

/** The first MESSAGE_HISTORY_PREVIEW_CHARS characters of a text on one line, with an ellipsis when cut. Null for no text. */
export function previewOf(body: string | null | undefined): string | null {
  if (body === null || body === undefined) return null;
  const one = body.replace(/\s+/g, ' ').trim();
  if (one === '') return null;
  const chars = Array.from(one);
  return chars.length > MESSAGE_HISTORY_PREVIEW_CHARS
    ? `${chars.slice(0, MESSAGE_HISTORY_PREVIEW_CHARS).join('')}…`
    : one;
}

/** The digits of a search term when it looks like (part of) a phone number: at least 3 digits and nothing but digits, spaces, + - ( ). */
export function phoneNeedle(q: string): string | null {
  if (!/^[\d\s+\-().]+$/.test(q)) return null;
  const digits = q.replace(/\D/g, '');
  return digits.length >= 3 ? digits : null;
}

/** Escapes `%`, `_` and `\` so a search term is matched literally by LIKE. */
export const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// --- the type pill and the type filter ---------------------------------------------------------------------------------------

/** What the Type filter means in terms of the columns: an automated source, or the kinds of message it is made of. */
export function typeFilterParts(t: MessageHistoryType): {
  entity?: 'broadcast' | 'campaign' | 'scheduled';
  source?: string;
  kinds?: string[];
} {
  switch (t) {
    case 'broadcast':
    case 'campaign':
    case 'scheduled':
      return { entity: t, source: t };
    case 'auto_reply':
      return { source: 'auto_reply' };
    case 'image':
      return { kinds: ['image'] };
    case 'video':
      return { kinds: ['video'] };
    case 'audio':
      return { kinds: ['audio', 'voice'] };
    case 'document':
      return { kinds: ['document', 'sticker'] };
    case 'location':
      return { kinds: ['location'] };
    case 'template':
      return { kinds: ['template'] };
    case 'text':
      return { kinds: ['text', 'contact', 'interactive'] };
  }
}

// --- the KPI cards -----------------------------------------------------------------------------------------------------------

export interface RawCounts {
  total: number;
  /** Outbound by status. */
  queued: number;
  sentStatus: number;
  delivered: number;
  read: number;
  failed: number;
  received: number;
}

const pct = (n: number, d: number, digits = 0): number => {
  if (d <= 0) return 0;
  const f = 10 ** digits;
  return Math.round((n / d) * 100 * f) / f;
};

/**
 * Reference's definitions (TW-CHAT-040): `sent` is outbound that did not fail (queued ones included), `received` is inbound, `failed`
 * is outbound that failed, `sentPct` and `receivedPct` are shares of the total, `failPct` is failed / sent (one decimal). Added here:
 * delivered (reached `delivered` or `read`), read, and the delivery rate over what left the queue.
 */
export function kpiFigures(
  c: RawCounts,
  previousTotal: number,
): Omit<MessageHistorySummary, 'window' | 'avgFirstResponseSeconds' | 'cost'> {
  const outbound = c.queued + c.sentStatus + c.delivered + c.read + c.failed;
  const sent = outbound - c.failed;
  const left = outbound - c.queued;
  const deliveredAll = c.delivered + c.read;
  const deltaPct =
    previousTotal > 0
      ? Math.round(((c.total - previousTotal) / previousTotal) * 100)
      : c.total > 0
        ? 100
        : 0;
  return {
    total: c.total,
    sent,
    received: c.received,
    failed: c.failed,
    queued: c.queued,
    delivered: deliveredAll,
    read: c.read,
    sentPct: pct(sent, c.total),
    receivedPct: pct(c.received, c.total),
    failPct: sent > 0 ? pct(c.failed, sent, 1) : 0,
    deliveryRate: left > 0 ? pct(deliveredAll, left, 1) : null,
    deltaPct,
    dirCounts: { all: c.total, out: outbound, in: c.received, fail: c.failed },
  };
}

// --- volume buckets ----------------------------------------------------------------------------------------------------------

export type VolumeBucket = 'hourly' | 'daily' | 'weekly';

/** The `date_trunc` unit of a bucket. Weeks start on Monday (Postgres), as Reference's did. */
export const bucketUnit = (b: VolumeBucket): 'hour' | 'day' | 'week' =>
  b === 'hourly' ? 'hour' : b === 'weekly' ? 'week' : 'day';

/** A zone name Postgres will accept: anything `Intl` knows, else UTC. */
export function safeZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

// --- the cursor --------------------------------------------------------------------------------------------------------------

export interface HistoryCursor {
  /** The row's moment as Postgres printed it (microseconds), so the next page resumes exactly after it. */
  at: string;
  rank: number;
  id: number;
}

export const encodeCursor = (c: HistoryCursor): string =>
  Buffer.from(JSON.stringify([c.at, c.rank, c.id]), 'utf8').toString('base64url');

export function decodeCursor(raw: string): HistoryCursor | null {
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(v) || v.length !== 3) return null;
    const [at, rank, id] = v as [unknown, unknown, unknown];
    if (typeof at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(at))
      return null;
    if (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 0 || rank > 9) return null;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) return null;
    return { at, rank, id };
  } catch {
    return null;
  }
}

// --- the timeline of a recipient row -----------------------------------------------------------------------------------------

const instant = (v: unknown): Date | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * The moments a broadcast, campaign or scheduled recipient row recorded, oldest first, in the shape of a delivery-log line: queued (the
 * row was made), sent, delivered, read, failed (with the reason). These rows keep no event log of their own, so this is all there is.
 */
export function recipientTimeline(r: Record<string, unknown>): MessageLogEvent[] {
  const line = (
    event: MessageLogEvent['event'],
    at: Date,
    source: 'system' | 'provider',
    err?: { code: string | null; message: string | null },
  ): MessageLogEvent => ({
    event,
    at: at.toISOString(),
    source,
    providerMessageId:
      event === 'queued' ? null : typeof r.provider_id === 'string' ? r.provider_id : null,
    errorCode: err?.code ?? null,
    errorMessage: err?.message ?? null,
    attempt: null,
    byUserId: null,
    applied: null,
    replayed: null,
    detail: {},
  });
  const out: MessageLogEvent[] = [];
  const created = instant(r.created_at);
  const sent = instant(r.sent_at);
  const delivered = instant(r.delivered_at);
  const read = instant(r.read_at);
  const failed = instant(r.failed_at);
  if (created) out.push(line('queued', created, 'system'));
  if (sent) out.push(line('sent', sent, 'system'));
  if (delivered) out.push(line('delivered', delivered, 'provider'));
  if (read) out.push(line('read', read, 'provider'));
  if (failed) {
    out.push(
      line('failed', failed, 'system', {
        code: typeof r.fail_code === 'string' ? r.fail_code : null,
        message: typeof r.fail_reason === 'string' ? r.fail_reason : null,
      }),
    );
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

// --- the export file ---------------------------------------------------------------------------------------------------------

export const HISTORY_CSV_HEADER = [
  'ID',
  'Source',
  'When (UTC)',
  'Direction',
  'Phone',
  'Contact',
  'Status',
  'Type',
  'Body',
  'Channel',
  'Template',
  'Campaign / broadcast / schedule',
  'Error code',
  'Error message',
] as const;
