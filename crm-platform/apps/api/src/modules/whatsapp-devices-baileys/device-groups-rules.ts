import { HttpStatus } from '@nestjs/common';
import {
  ERROR_CODES,
  WA_DEVICE_GROUP_EVENTS,
  WA_DEVICE_GROUP_PREVIEW_MAX,
  WA_GROUP_INVITE_URL_PREFIX,
  type WaDeviceGroupEventType,
  type WaGroupParticipantResult,
  type WaGroupParticipantResults,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import {
  jidUser,
  participantOutcome,
  type DeviceCommandResult,
  type GroupParticipantStatus,
  type ParticipantChange,
} from '../node-bridge-runtime';

/**
 * Pure rules of the personal-number Groups API (no database, no socket): number handling, the per-person results, how a failed group command
 * becomes a problem+json error, and what a change to a group announces. The service loads the rows and calls these, so every rule is
 * unit-tested on its own.
 */

// --- numbers -------------------------------------------------------------------------------------------------------------------

/** `+919876543210` -> `919876543210`. */
export const digitsOf = (e164: string): string => e164.replace(/\D+/g, '');
/** The runtime speaks digits, the API speaks E.164. */
export const e164Of = (digits: string | null | undefined): string | null =>
  digits && /^\d{6,15}$/.test(digits) ? `+${digits}` : null;

export interface PersonRef {
  /** The number as sent (E.164). */
  number: string;
  digits: string;
  /** The id the group knows the person by when it is not the phone id (an anonymous `...@lid` member): what WhatsApp is asked about. */
  jid?: string;
}

/**
 * The people of one call: duplicates (the same digits typed twice) collapse, and the connected number itself is refused (WhatsApp adds the
 * creator by itself; adding yourself is an error, removing yourself is `leave`). Returns the invalid numbers instead of throwing so the
 * caller can say which ones.
 */
export function peopleOf(
  numbers: readonly string[],
  selfDigits: string | null,
): { people: PersonRef[]; invalid: string[] } {
  const seen = new Set<string>();
  const people: PersonRef[] = [];
  const invalid: string[] = [];
  for (const n of numbers) {
    const digits = digitsOf(n);
    if (selfDigits && digits === selfDigits) {
      invalid.push(n);
      continue;
    }
    if (seen.has(digits)) continue;
    seen.add(digits);
    people.push({ number: `+${digits}`, digits });
  }
  return { people, invalid };
}

/** `https://chat.whatsapp.com/<code>`. The code is a bearer secret: only the explicit invite-link response builds this. */
export const inviteUrlOf = (code: string): string => `${WA_GROUP_INVITE_URL_PREFIX}${code}`;

// --- per-person results --------------------------------------------------------------------------------------------------------

/**
 * One result per requested person, in the order asked. WhatsApp answers with the person's id and a status code; the id may be the
 * anonymous one in a LID group, so when no id matches and the answer has exactly as many entries as were asked, they pair by position.
 * A person WhatsApp said nothing about is `failed` (never silently `ok`).
 */
export function resultsFor(
  change: ParticipantChange,
  asked: readonly PersonRef[],
  statuses: readonly GroupParticipantStatus[],
): WaGroupParticipantResults {
  const byUser = new Map<string, GroupParticipantStatus>();
  for (const s of statuses) byUser.set(jidUser(s.jid).replace(/\D+/g, ''), s);
  const keys = (a: PersonRef) => [a.digits, a.jid ? jidUser(a.jid).replace(/\D+/g, '') : ''];
  const positional =
    statuses.length === asked.length && !asked.some((a) => keys(a).some((k) => byUser.has(k)));
  const results: WaGroupParticipantResult[] = asked.map((a, i) => {
    const s =
      keys(a)
        .map((k) => byUser.get(k))
        .find(Boolean) ?? (positional ? statuses[i] : undefined);
    if (!s) return { number: a.number, outcome: 'failed', code: null };
    return { number: a.number, outcome: participantOutcome(change, s.status), code: s.status };
  });
  return tally(results);
}

export function tally(results: WaGroupParticipantResult[]): WaGroupParticipantResults {
  const okCount = results.filter((r) => r.outcome === 'ok').length;
  return { okCount, failCount: results.length - okCount, results };
}

// --- failures -------------------------------------------------------------------------------------------------------------------

const RATE_MESSAGE: Record<string, string> = {
  cooldown:
    'This number is resting after WhatsApp refused a group request. Try again in a few minutes.',
  ops_minute: 'Too many group operations on this number this minute. Try again shortly.',
  ops_day: 'This number reached its daily limit of group operations. Try again tomorrow.',
  creates_day: 'This number reached its daily limit of new groups. Try again tomorrow.',
  join_link_day:
    'This number reached its daily limit of joining groups by link. Try again tomorrow.',
};

/**
 * The problem+json error of a command that did not succeed (the mapping the build plan fixes): the limiter's refusal is 429 with
 * `retryAfterS` and `scope` in `errors[]`; a missing worker is 503; no lease is 409; WhatsApp's own refusal is classified by the runtime.
 * `res` is anything but `{ ok: true, status: 'group' }`.
 */
export function groupFailure(res: DeviceCommandResult): AppError {
  if (res.ok) {
    return new AppError(
      ERROR_CODES.WA_GROUP_UNAVAILABLE,
      'WhatsApp answered something unexpected.',
      HttpStatus.BAD_GATEWAY,
    );
  }
  switch (res.status) {
    case 'rate_limited':
      return new AppError(
        ERROR_CODES.WA_GROUP_RATE_LIMITED,
        RATE_MESSAGE[res.scope] ?? res.message,
        HttpStatus.TOO_MANY_REQUESTS,
        [
          { path: 'retryAfterS', message: String(Math.max(1, Math.ceil(res.retryAfterSeconds))) },
          { path: 'scope', message: res.scope },
        ],
      );
    case 'disabled':
      return new AppError(
        ERROR_CODES.WA_GROUP_JOIN_BY_LINK_DISABLED,
        'Joining a group by invite link is switched off on this platform.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    case 'not_ready':
      return new AppError(
        ERROR_CODES.WA_GROUP_DEVICE_NOT_READY,
        'This number is not connected right now. Connect it, or wait for it to reconnect, and try again.',
        HttpStatus.CONFLICT,
      );
    case 'busy':
    case 'timeout':
      return new AppError(
        ERROR_CODES.WA_WORKER_UNAVAILABLE,
        'The connection service did not answer in time. Try again in a few minutes.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    case 'group_failed':
      return groupRefusal(res.reason);
    case 'error':
      // The runtime refused before WhatsApp (people per call), or no worker is running at all.
      return /worker is not running/i.test(res.message)
        ? new AppError(
            ERROR_CODES.WA_WORKER_UNAVAILABLE,
            'The connection service is not running. Try again in a few minutes.',
            HttpStatus.SERVICE_UNAVAILABLE,
          )
        : new AppError(ERROR_CODES.VALIDATION_FAILED, res.message, HttpStatus.UNPROCESSABLE_ENTITY);
    case 'not_found':
      return new AppError(
        ERROR_CODES.WA_GROUP_DEVICE_NOT_READY,
        'This number is not connected right now. Connect it and try again.',
        HttpStatus.CONFLICT,
      );
    default:
      return new AppError(
        ERROR_CODES.WA_GROUP_UNAVAILABLE,
        'WhatsApp could not do this right now. Try again later.',
        HttpStatus.BAD_GATEWAY,
      );
  }
}

/** WhatsApp said no. The message is operator wording, never the library's own text (it can carry ids). */
export function groupRefusal(reason: string): AppError {
  switch (reason) {
    case 'not_admin':
      return new AppError(
        ERROR_CODES.WA_GROUP_NOT_ADMIN,
        'This number is not an admin of the group, so WhatsApp refused.',
        HttpStatus.FORBIDDEN,
      );
    case 'not_found':
      return new AppError(
        ERROR_CODES.WA_GROUP_NOT_FOUND,
        'WhatsApp says this group no longer exists for this number.',
        HttpStatus.NOT_FOUND,
      );
    case 'limit_reached':
      return new AppError(
        ERROR_CODES.WA_GROUP_LIMIT_REACHED,
        'WhatsApp says the group is full, or this number cannot be in more groups.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    case 'bad_invite':
      return new AppError(
        ERROR_CODES.WA_GROUP_JOIN_LINK_INVALID,
        'This invite link is not valid any more (expired, revoked or the group is gone).',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    case 'whatsapp_rate_limited':
      return new AppError(
        ERROR_CODES.WA_GROUP_RATE_LIMITED,
        'WhatsApp is limiting this number. Group actions are paused for a while.',
        HttpStatus.TOO_MANY_REQUESTS,
        [{ path: 'scope', message: 'cooldown' }],
      );
    case 'forbidden':
      return new AppError(
        ERROR_CODES.WA_GROUP_UNAVAILABLE,
        'WhatsApp refused this request. If the number was removed from the group, refresh the list. Group actions are paused for a while.',
        HttpStatus.BAD_GATEWAY,
      );
    default:
      return new AppError(
        ERROR_CODES.WA_GROUP_UNAVAILABLE,
        'WhatsApp could not do this right now. Try again later.',
        HttpStatus.BAD_GATEWAY,
      );
  }
}

// --- what a change announces ----------------------------------------------------------------------------------------------------

/** The roster entry as stored (`wa_device_groups.participants`). */
export interface RosterEntry {
  jid: string;
  admin: 'superadmin' | 'admin' | null;
}

/** The visible facts of a group row, before or after a change. */
export interface GroupFacts {
  subject: string | null;
  description: string | null;
  size: number;
  isAdmin: boolean;
  announce: boolean;
  restrict: boolean;
  joinApproval: boolean;
  memberAddMode: string;
  left: boolean;
  roster: readonly RosterEntry[];
  pending: number;
}

export interface GroupEventDraft {
  type: WaDeviceGroupEventType;
  /** Merged into the payload next to the group's identifiers. Never a phone number, a subject or an invite code. */
  extra: Record<string, unknown>;
}

export type GroupChange = 'subject' | 'description' | 'settings' | 'admin' | 'rejoined';

/**
 * What changing one group row announces. `before` is null when the row did not exist.
 *  - created: the row appeared (or the number joined the group again);
 *  - updated: a visible fact moved (carries which: `changed`);
 *  - participants_changed: people came or went, or an admin role moved (counts only);
 *  - join_request: the queue grew (`pending`, `added`); a queue that shrank by itself announces `handled: 'revoked'`;
 *  - left: the number left, or was removed.
 */
export function eventsFor(
  before: GroupFacts | null,
  after: GroupFacts,
  opts: { removed?: boolean } = {},
): GroupEventDraft[] {
  const out: GroupEventDraft[] = [];
  if (!before) {
    out.push({ type: WA_DEVICE_GROUP_EVENTS.created, extra: {} });
    return out;
  }
  if (before.left && !after.left) {
    out.push({ type: WA_DEVICE_GROUP_EVENTS.created, extra: { changed: ['rejoined'] } });
    return out;
  }
  if (!before.left && after.left) {
    out.push({ type: WA_DEVICE_GROUP_EVENTS.left, extra: { removed: opts.removed === true } });
    return out;
  }
  const changed: GroupChange[] = [];
  if (before.subject !== after.subject) changed.push('subject');
  if (before.description !== after.description) changed.push('description');
  if (
    before.announce !== after.announce ||
    before.restrict !== after.restrict ||
    before.joinApproval !== after.joinApproval ||
    before.memberAddMode !== after.memberAddMode
  ) {
    changed.push('settings');
  }
  if (before.isAdmin !== after.isAdmin) changed.push('admin');
  if (changed.length > 0) out.push({ type: WA_DEVICE_GROUP_EVENTS.updated, extra: { changed } });

  const was = new Map(before.roster.map((r) => [r.jid, r.admin]));
  const now = new Map(after.roster.map((r) => [r.jid, r.admin]));
  const added = [...now.keys()].filter((j) => !was.has(j)).length;
  const removed = [...was.keys()].filter((j) => !now.has(j)).length;
  const roles = [...now.entries()].filter(([j, a]) => was.has(j) && was.get(j) !== a).length;
  if (added > 0 || removed > 0 || roles > 0 || before.size !== after.size) {
    out.push({
      type: WA_DEVICE_GROUP_EVENTS.participantsChanged,
      extra: { added, removed, roles, size: after.size },
    });
  }
  if (after.pending > before.pending) {
    out.push({
      type: WA_DEVICE_GROUP_EVENTS.joinRequest,
      extra: { handled: null, added: after.pending - before.pending, pending: after.pending },
    });
  } else if (after.pending < before.pending) {
    out.push({
      type: WA_DEVICE_GROUP_EVENTS.joinRequest,
      extra: { handled: 'settled', pending: after.pending },
    });
  }
  return out;
}

/** The part of the roster shown on a list row: names and roles only, admins first (never numbers). */
export function previewOf(
  roster: ReadonlyArray<{ name: string | null; admin: 'superadmin' | 'admin' | null }>,
): Array<{ name: string | null; admin: 'superadmin' | 'admin' | null }> {
  const rank = (a: 'superadmin' | 'admin' | null) =>
    a === 'superadmin' ? 0 : a === 'admin' ? 1 : 2;
  return [...roster]
    .sort((a, b) => rank(a.admin) - rank(b.admin))
    .slice(0, WA_DEVICE_GROUP_PREVIEW_MAX)
    .map((p) => ({ name: p.name, admin: p.admin }));
}

/** Magic bytes of the two picture types WhatsApp takes; the declared mime type is not trusted. */
export function pictureKind(buf: Buffer): 'image/jpeg' | 'image/png' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  return null;
}

// --- the roster after a change we made ------------------------------------------------------------------------------------------

export interface StoredMember {
  jid: string;
  phone: string | null;
  lid: string | null;
  name: string | null;
  admin: 'superadmin' | 'admin' | null;
}

/**
 * The cached roster after WhatsApp accepted a change for some people (`done` = the ones whose outcome was `ok`). A guess that is right for
 * what was asked: the re-read the runtime schedules after WhatsApp's own participants event brings names and anything it missed. A
 * superadmin is never demoted here (WhatsApp refuses that too).
 */
export function rosterAfter(
  roster: readonly StoredMember[],
  change: ParticipantChange,
  done: readonly PersonRef[],
): { roster: StoredMember[]; sizeDelta: number } {
  const next = roster.map((m) => ({ ...m }));
  let sizeDelta = 0;
  const find = (p: PersonRef) =>
    next.findIndex((m) => m.phone === p.digits || (p.jid !== undefined && m.jid === p.jid));
  for (const p of done) {
    const i = find(p);
    switch (change) {
      case 'add':
        if (i < 0) {
          next.push({
            jid: `${p.digits}@s.whatsapp.net`,
            phone: p.digits,
            lid: null,
            name: null,
            admin: null,
          });
          sizeDelta += 1;
        }
        break;
      case 'remove':
        if (i >= 0) {
          next.splice(i, 1);
          sizeDelta -= 1;
        }
        break;
      case 'promote':
        if (i >= 0 && next[i]!.admin === null) next[i]!.admin = 'admin';
        break;
      case 'demote':
        if (i >= 0 && next[i]!.admin === 'admin') next[i]!.admin = null;
        break;
    }
  }
  return { roster: next, sizeDelta };
}

/** The person each requested id stands for, looked up in the cached roster (a member known by an anonymous id is addressed by it). */
export function personRefs(
  people: ReadonlyArray<{ number: string; digits: string }>,
  roster: readonly StoredMember[],
): PersonRef[] {
  return people.map((p) => {
    const m = roster.find((r) => r.phone === p.digits);
    return m && !m.jid.endsWith('@s.whatsapp.net') ? { ...p, jid: m.jid } : { ...p };
  });
}
