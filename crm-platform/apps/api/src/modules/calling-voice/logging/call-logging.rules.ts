import {
  CALL_FUTURE_TOLERANCE_MINUTES,
  CALL_MAX_AGE_DAYS,
  CALL_NOTES_PREVIEW_MAX,
  canonicalizeLocalPhone,
  type CallNudge,
  type CallOutcome,
  type DeviceCallType,
  type TelephonyCallStatus,
} from '@crm/contracts';

/** Pure rules of the call logging framework: how a call reads, who may change it, how an outside report becomes an outcome. */

// --- words on the timeline -----------------------------------------------------------------------------------------------------

const OUTCOME_WORDS: Record<CallOutcome, string> = {
  connected: 'Connected',
  no_answer: 'No answer',
  busy: 'Busy',
  left_voicemail: 'Left voicemail',
  wrong_number: 'Wrong number',
  declined: 'Declined',
  failed: 'Failed',
};

export const outcomeWords = (o: CallOutcome): string => OUTCOME_WORDS[o];

/** "4 min", "45 sec", "1 h 5 min": the talk time as a person reads it. */
export function durationWords(sec: number): string {
  if (sec < 60) return `${sec} sec`;
  const minutes = Math.round(sec / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * The line a logged call writes on the contact's timeline: "Outbound call, Connected, 4 min, by Priya". The talk time is left out of a
 * call that did not connect and of a connected call whose length is not known; "by" is left out when nobody took the call.
 */
export function timelineTitle(c: {
  direction: 'inbound' | 'outbound';
  outcome: CallOutcome;
  durationSec: number;
  handlerName: string | null;
}): string {
  const parts = [
    `${c.direction === 'inbound' ? 'Inbound' : 'Outbound'} call`,
    outcomeWords(c.outcome),
    ...(c.outcome === 'connected' && c.durationSec > 0 ? [durationWords(c.durationSec)] : []),
  ];
  const name = c.handlerName?.trim();
  return name ? `${parts.join(', ')}, by ${name}` : parts.join(', ');
}

/** The timeline's activity type of an entry: one per source, so an icon can be picked from the type alone. */
export const activityTypeOf = (source: string): string => `call_${source}`;

/** The notes as the timeline and the list show them: one line, cut at a word. */
export function notesPreview(notes: string | null | undefined, max = CALL_NOTES_PREVIEW_MAX) {
  const flat = (notes ?? '').replace(/\s+/g, ' ').trim();
  if (flat === '') return null;
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// --- time ------------------------------------------------------------------------------------------------------------------------

/** The start time of a call, or why it cannot be: in the future (past the clock tolerance), or older than the limit. */
export function checkStartedAt(
  startedAt: Date,
  now: Date = new Date(),
): 'ok' | 'future' | 'too_old' {
  if (Number.isNaN(startedAt.getTime())) return 'too_old';
  if (startedAt.getTime() > now.getTime() + CALL_FUTURE_TOLERANCE_MINUTES * 60_000) return 'future';
  if (startedAt.getTime() < now.getTime() - CALL_MAX_AGE_DAYS * 86_400_000) return 'too_old';
  return 'ok';
}

/** When a call started that the person logged without saying when: it has just ended, so it started `durationSec` ago. */
export const defaultStartedAt = (durationSec: number, now: Date = new Date()): Date =>
  new Date(now.getTime() - durationSec * 1000);

// --- phone -----------------------------------------------------------------------------------------------------------------------

/** The number as E.164 with the plus, in the workspace's default country when it does not carry its own; null when it is not a number. */
export function e164Of(raw: string | null | undefined, defaultCountryCode: string | null) {
  return canonicalizeLocalPhone(raw, defaultCountryCode)?.e164 ?? null;
}

// --- who may change an entry ---------------------------------------------------------------------------------------------------

export type EditVerdict = 'allowed' | 'not_found' | 'not_editable' | 'window_closed';

/**
 * Who may edit or delete an entry. `call.logging.manage` may always. Anyone else only reaches the entry they logged themselves (any other
 * entry answers as if it did not exist), only while it is one typed by hand (a call a provider or a phone reported is a record of what
 * happened, not a note), and only while the workspace's window is open.
 */
export function editVerdict(e: {
  source: string;
  /** A telephony provider reported it. */
  reported?: boolean;
  createdById: number | null;
  createdAt: Date;
  viewerId: number | null;
  canManage: boolean;
  windowHours: number;
  now?: Date;
}): EditVerdict {
  if (e.canManage) return 'allowed';
  if (e.viewerId === null || e.createdById !== e.viewerId) return 'not_found';
  if (e.reported || (e.source !== 'manual' && e.source !== 'web_click_to_call')) {
    return 'not_editable';
  }
  const now = e.now ?? new Date();
  return now.getTime() - e.createdAt.getTime() <= e.windowHours * 3_600_000
    ? 'allowed'
    : 'window_closed';
}

// --- how an outside report becomes an outcome --------------------------------------------------------------------------------

/**
 * The outcome of a call from the phone's own call log (Android). Missed and rejected calls are inbound by nature. An outgoing call with no
 * talk time rang out; one with talk time was answered. A voicemail the customer left is an inbound call that was not answered. A blocked
 * call (the phone's spam filter) is not a conversation: null, the caller skips it.
 */
export function outcomeFromDevice(
  type: DeviceCallType | undefined,
  durationSec: number,
): CallOutcome | null {
  switch (type) {
    case 'blocked':
      return null;
    case 'missed':
    case 'voicemail':
      return 'no_answer';
    case 'rejected':
      return 'declined';
    case 'incoming':
    case 'outgoing':
    case undefined:
      return durationSec > 0 ? 'connected' : 'no_answer';
  }
}

/** The outcome of a provider's finished call. A cancelled call never rang through: it did not connect. */
export function outcomeFromTelephony(
  status: TelephonyCallStatus,
  durationSec: number,
): CallOutcome {
  switch (status) {
    case 'completed':
      return durationSec > 0 ? 'connected' : 'no_answer';
    case 'busy':
      return 'busy';
    case 'declined':
      return 'declined';
    case 'voicemail':
      return 'left_voicemail';
    case 'failed':
      return 'failed';
    case 'no_answer':
    case 'canceled':
      return 'no_answer';
  }
}

/** The key a report is stored under, so the same report again lands on the same row. */
export const mobileExternalId = (deviceId: string, deviceCallId: string): string =>
  `${deviceId}:${deviceCallId}`;
export const telephonyExternalId = (connectionUuid: string, callId: string): string =>
  `${connectionUuid}:${callId}`;

// --- the lifecycle nudge ---------------------------------------------------------------------------------------------------------

/**
 * A suggestion, never an action: a call that connected with a contact still at the first stage of the workspace's lifecycle suggests the
 * next stage. `stages` are the workspace's active stages in their order, `lost` and `won` the ones that end the story (never suggested).
 */
export function stageNudge(
  outcome: CallOutcome,
  current: string,
  stages: ReadonlyArray<{ value: string; label: string | null; isWon: boolean; isLost: boolean }>,
): CallNudge | null {
  if (outcome !== 'connected') return null;
  const open = stages.filter((s) => !s.isLost);
  const first = open[0];
  if (!first || first.value !== current) return null;
  const next = open.slice(1).find((s) => !s.isWon);
  return next
    ? { kind: 'lifecycle_stage', current, suggested: next.value, suggestedLabel: next.label }
    : null;
}

// --- the cursor of a unified list ------------------------------------------------------------------------------------------------

export interface LogCursor {
  /** ISO time with the database's microseconds. */
  startedAt: string;
  uuid: string;
}

export const encodeLogCursor = (c: LogCursor): string =>
  Buffer.from(`${c.startedAt}|${c.uuid}`, 'utf8').toString('base64url');

export function decodeLogCursor(raw: string): LogCursor | null {
  try {
    const [startedAt, uuid] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
    if (!startedAt || !uuid || Number.isNaN(new Date(startedAt).getTime())) return null;
    if (!/^[0-9a-f-]{36}$/i.test(uuid)) return null;
    return { startedAt, uuid };
  } catch {
    return null;
  }
}
