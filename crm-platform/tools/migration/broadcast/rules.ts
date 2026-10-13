import type { Soft } from '../transform/types';
import { bool, isDeleted, str, toDate, type Doc } from '../util';
import type { BroadcastSettings } from './config';

/**
 * The rules of the broadcast step that the loader needs twice: once in pass 1 (the plan, which computes the campaign counters BEFORE
 * the campaign row is inserted) and once per document in the transform. Pure functions of one document (plus the campaign table the
 * plan holds). reconcile/oracle-campaigns.ts writes these rules a second time, independently.
 */
const isObj = (v: unknown): v is Doc =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

const present = (v: unknown): boolean => v !== null && v !== undefined && v !== '';

/** An integer from a number or a numeric string; null otherwise. */
export function intOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null;
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Math.trunc(Number(v));
  return null;
}

/** A Waboo amount (mixed int / double in the source) as an exact decimal string; never a float in a report or a row. */
export function moneyString(v: unknown): string | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    return Number.isInteger(v) ? String(v) : v.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  }
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return v.trim();
  return null;
}

/** A date as the dump spells it. A string with no zone ("2026-06-12T10:00:00") is read as UTC, never in the machine's own zone. */
export function utcDate(v: unknown): Date | null {
  if (typeof v === 'string') {
    const t = v.trim();
    if (/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(t))
      return toDate(`${t.replace(' ', 'T')}Z`);
    return toDate(t);
  }
  return toDate(v);
}

// ------------------------------------------------------------------------------------------------------------------ campaigns

export interface CampaignEntry {
  /** The primary key (ObjectId hex) of the document the keys point at. */
  primary: string;
  verdict: 'load' | 'exclude' | 'quarantine';
  code?: string;
  reason?: string;
}

export function campaignVerdict(
  doc: Doc,
  s: BroadcastSettings,
): { verdict: 'load' | 'exclude' | 'quarantine'; code?: string; reason?: string } {
  if (isDeleted(doc))
    return { verdict: 'exclude', code: 'SOFT_DELETED', reason: 'soft-deleted at the source' };
  if (bool(doc.test) && !s.keepTestBroadcasts)
    return {
      verdict: 'exclude',
      code: 'TEST_BROADCAST',
      reason: 'test=true: a test send, not a real broadcast (--keep-test-broadcasts loads them)',
    };
  if (!str(doc.broadcast_name))
    return { verdict: 'quarantine', code: 'EMPTY_NAME', reason: 'the campaign has no name' };
  const type = str(doc.type);
  if (type && type.toLowerCase() !== 'whatsapp')
    return {
      verdict: 'quarantine',
      code: 'UNSUPPORTED_TYPE',
      reason: `type "${type}" is not whatsapp (sms / email broadcasts have no table in crm-platform)`,
    };
  return { verdict: 'load' };
}

const NONTERMINAL_WORDS = new Set([
  'scheduled',
  'running',
  'draft',
  'queued',
  'processing',
  'pending',
  'paused',
  'in_progress',
  'in progress',
  'sending',
  'active',
  'started',
]);

/**
 * Only terminal statuses are ever written: the sweeper starts `scheduled` campaigns, the retry job and the resend actions work on
 * `running` / `paused` / `scheduled` ones. An imported campaign must never send, so anything that is not clearly finished is imported
 * as `nonTerminalStatus` (cancelled by default) with a soft issue.
 */
export function campaignStatus(
  raw: unknown,
  s: BroadcastSettings,
): { status: string; soft: Soft | null } {
  const w = (str(raw) ?? '').toLowerCase();
  if (w === 'completed') return { status: 'completed', soft: null };
  if (w === 'failed') return { status: 'failed', soft: null };
  if (w === 'cancelled' || w === 'canceled' || w === 'stopped')
    return { status: 'cancelled', soft: null };
  const known = NONTERMINAL_WORDS.has(w);
  return {
    status: s.nonTerminalStatus,
    soft: {
      code: known ? 'NONTERMINAL_AT_MIGRATION' : 'UNKNOWN_STATUS',
      reason: known
        ? `status "${w}" is not finished: imported as ${s.nonTerminalStatus} so that no scheduler or sender ever picks the campaign up`
        : `status "${w}" is not one of completed / failed / cancelled: imported as ${s.nonTerminalStatus}`,
      detail: str(raw),
    },
  };
}

export interface Schedule {
  type: 'now' | 'scheduled';
  date: string | null;
  time: string | null;
  timezone: string | null;
  instant: Date | null;
  soft: Soft[];
}

/** `scheduled_date_dt` (a Date) is preferred; `scheduled_date` is an ISO string on some documents. The clock is written in UTC. */
export function campaignSchedule(doc: Doc): Schedule {
  const had = present(doc.scheduled_date_dt) || present(doc.scheduled_date);
  const instant = utcDate(doc.scheduled_date_dt) ?? utcDate(doc.scheduled_date);
  const soft: Soft[] = [];
  if (had && !instant)
    soft.push({
      code: 'BAD_DATE',
      reason: 'scheduled_date is not a readable date: the campaign is imported as sent now',
      detail: String(doc.scheduled_date_dt ?? doc.scheduled_date),
    });
  if (!bool(doc.scheduled_now) && instant) {
    const t = instant.toISOString();
    return {
      type: 'scheduled',
      date: t.slice(0, 10),
      time: t.slice(11, 19),
      timezone: 'UTC',
      instant,
      soft,
    };
  }
  return { type: 'now', date: null, time: null, timezone: null, instant, soft };
}

// ------------------------------------------------------------------------------------------------------------------ recipients

export interface RecipientStatus {
  status: 'sent' | 'delivered' | 'read' | 'responded' | 'failed';
  /** A failed row carries NO timestamp but created_at / updated_at: the tiles count sent_at / delivered_at / read_at as sent. */
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  respondedAt: string | null;
  /** The newest status timestamp of any kind (failed included). */
  latest: string;
  conflict: boolean;
  soft: Soft[];
}

/**
 * Waboo keeps one Date per delivery step in `status` (sent, delivered, seen, replied, failed); a failed row also has `sent`. The row is
 * `failed` when a failure is not followed (or matched) by delivered / seen / replied, else the highest step wins. The iskm quirk of a
 * literal top-level key "status.sent" stands in for a missing `status.sent`. Null when there is no readable step at all.
 */
export function deriveStatus(doc: Doc): RecipientStatus | null {
  const T = isObj(doc.status) ? doc.status : {};
  const soft: Soft[] = [];
  const at = (k: string, v: unknown): Date | null => {
    if (!present(v)) return null;
    const d = utcDate(v);
    if (!d)
      soft.push({
        code: 'BAD_DATE',
        reason: `status.${k} is not a readable date and is ignored`,
        detail: String(v),
      });
    return d;
  };
  const sent = at('sent', T.sent) ?? at('sent', doc['status.sent']);
  const delivered = at('delivered', T.delivered);
  const seen = at('seen', T.seen);
  const replied = at('replied', T.replied);
  const failed = at('failed', T.failed);
  const all = [sent, delivered, seen, replied, failed].filter((d): d is Date => d !== null);
  if (all.length === 0) return null;
  const latest = new Date(Math.max(...all.map((d) => d.getTime()))).toISOString();
  const best = [delivered, seen, replied]
    .filter((d): d is Date => d !== null)
    .reduce<Date | null>((m, d) => (m === null || d > m ? d : m), null);
  const conflict = failed !== null && best !== null;
  if (conflict)
    soft.push({
      code: 'STATUS_CONFLICT',
      reason: 'the recipient has a failure and a delivered / seen / replied step',
    });
  const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
  if (failed && !(best && best.getTime() >= failed.getTime()))
    return {
      status: 'failed',
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      respondedAt: null,
      latest,
      conflict,
      soft,
    };
  const status = replied ? 'responded' : seen ? 'read' : delivered ? 'delivered' : 'sent';
  return {
    status,
    sentAt: iso(sent),
    deliveredAt: iso(delivered),
    readAt: iso(seen),
    respondedAt: iso(replied),
    latest,
    conflict,
    soft,
  };
}

/** The provider's message and the leading 3 to 6 digit code of it ("(#131049) ..."). UNVERIFIED format. */
export function errorParts(err: unknown): { message: string | null; code: string | null } {
  const message =
    typeof err === 'string'
      ? str(err)
      : err !== null && err !== undefined
        ? JSON.stringify(err).slice(0, 2000)
        : null;
  const code = message ? (/^\W{0,3}(\d{3,6})(?!\d)/.exec(message)?.[1] ?? null) : null;
  return { message, code };
}

export const rawPhoneOf = (doc: Doc): string | null =>
  str(doc.phone_no) ?? str(doc.mobile) ?? str(doc.mobile_phone_number);

export const nameOf = (doc: Doc): string | null => {
  const n = [str(doc.first_name), str(doc.last_name)].filter((x): x is string => Boolean(x));
  return n.length > 0 ? n.join(' ') : null;
};

export type RecipientVerdict =
  | { kind: 'exclude' | 'quarantine'; code: string; reason: string }
  | { kind: 'load'; campaign: CampaignEntry; st: RecipientStatus; rawPhone: string };

/** The decision for one recipient-log document. Everything the aggregate of its campaign depends on is decided here and nowhere else. */
export function classifyRecipient(
  doc: Doc,
  campaigns: Map<string, CampaignEntry>,
): RecipientVerdict {
  const bid = str(doc.broadcast_id);
  if ((str(doc.source) ?? '').toLowerCase() !== 'broadcast' || !bid)
    return {
      kind: 'exclude',
      code: 'NON_BROADCAST_SOURCE',
      reason:
        'a delivery / billing log row of an automation, inbox or test send (or a broadcast row with no broadcast_id): not a campaign recipient; the credits step owns it',
    };
  const camp = campaigns.get(bid);
  if (!camp)
    return {
      kind: 'quarantine',
      code: 'CAMPAIGN_MISSING',
      reason: 'broadcast_id matches no campaign in the dump',
    };
  if (camp.verdict === 'exclude')
    return {
      kind: 'exclude',
      code: 'CAMPAIGN_EXCLUDED',
      reason: `its campaign was excluded (${camp.code})`,
    };
  if (camp.verdict === 'quarantine')
    return {
      kind: 'quarantine',
      code: 'CAMPAIGN_MISSING',
      reason: `its campaign was quarantined (${camp.code})`,
    };
  const rawPhone = rawPhoneOf(doc);
  if (!rawPhone)
    return { kind: 'quarantine', code: 'NO_PHONE', reason: 'phone_no / mobile are all empty' };
  const st = deriveStatus(doc);
  if (!st)
    return {
      kind: 'quarantine',
      code: 'NO_STATUS',
      reason: 'status holds no readable sent / delivered / seen / replied / failed date',
    };
  return { kind: 'load', campaign: camp, st, rawPhone };
}
