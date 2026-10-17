import { addMinutes } from './meeting-inline';
import { isoToZonedLocal, zonedLocalToIso } from './meeting-time';

/**
 * "Log a call" on the contact page: the form's values become the request of `POST /v2/calls/log`, and the "How did the call go?"
 * prompt that follows a click on a phone number is decided here. Pure, so each rule is tested without a browser.
 *
 * The vocabulary and limits are those of the call logging framework (docs/specs/call-logging.md on the branch
 * `lakshya/next/call-logging-framework`); see `api/call-log.ts` for why they are named here and not imported yet.
 */

export const CALL_DIRECTIONS = ['outbound', 'inbound'] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

/** The five outcomes the form offers, most common first (the framework also has `declined` and `failed`, which phones and providers report). */
export const CALL_OUTCOMES = [
  'connected',
  'no_answer',
  'busy',
  'left_voicemail',
  'wrong_number',
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const CALL_NOTES_MAX = 2000;
/** The longest call the API takes: a day. */
export const CALL_MAX_DURATION_SEC = 86_400;
/** A call may not start later than this many minutes from now (clocks differ). */
export const CALL_FUTURE_TOLERANCE_MINUTES = 5;

export interface CallDraft {
  direction: CallDirection;
  outcome: CallOutcome;
  /** `YYYY-MM-DDTHH:mm` in the viewer's zone. */
  when: string;
  /** Minutes as typed (decimals allowed); empty is "not known". */
  minutes: string;
  notes: string;
  /** Make a follow-up task together with the call. */
  followUp: boolean;
  /** The follow-up's due date, `YYYY-MM-DDTHH:mm`. */
  due: string;
}

export type CallProblem = 'badWhen' | 'futureWhen' | 'badMinutes' | 'noDue' | 'badDue';

/** Tomorrow at nine on the viewer's clock: where a follow-up starts. */
export function tomorrowMorning(now: Date, timeZone?: string): string {
  const today = isoToZonedLocal(now.toISOString(), timeZone).slice(0, 10);
  return addMinutes(`${today}T09:00`, 24 * 60);
}

/** A fresh form: an outgoing call that happened just now and connected (what is logged most often), nothing else filled. */
export function emptyCallDraft(now: Date, timeZone?: string): CallDraft {
  return {
    direction: 'outbound',
    outcome: 'connected',
    when: isoToZonedLocal(now.toISOString(), timeZone),
    minutes: '',
    notes: '',
    followUp: false,
    due: tomorrowMorning(now, timeZone),
  };
}

/** The request body the form stands for (the shape of the framework's `logCallInputSchema`). */
export interface LogCallRequest {
  contactId: string;
  direction: CallDirection;
  outcome: CallOutcome;
  startedAt: string;
  durationSec: number;
  notes?: string;
  source: 'manual' | 'web_click_to_call';
  followUp?: { dueAt: string };
  suggestStageNudge: false;
}

/**
 * The request for a contact's draft, or the first thing that is wrong with it (a stable key the screen words). The call may not start
 * in the future, the length is optional, and a follow-up needs its due date.
 */
export function buildLogCallRequest(
  contactId: string,
  draft: CallDraft,
  opts: { now: Date; timeZone?: string; source?: LogCallRequest['source'] },
): { ok: true; input: LogCallRequest } | { ok: false; problem: CallProblem } {
  const startedAt = zonedLocalToIso(draft.when, opts.timeZone);
  if (!startedAt) return { ok: false, problem: 'badWhen' };
  if (Date.parse(startedAt) > opts.now.getTime() + CALL_FUTURE_TOLERANCE_MINUTES * 60_000) {
    return { ok: false, problem: 'futureWhen' };
  }

  let durationSec = 0;
  if (draft.minutes.trim() !== '') {
    const minutes = Number(draft.minutes.replace(',', '.'));
    if (!Number.isFinite(minutes) || minutes < 0 || minutes * 60 > CALL_MAX_DURATION_SEC) {
      return { ok: false, problem: 'badMinutes' };
    }
    durationSec = Math.round(minutes * 60);
  }

  let followUp: LogCallRequest['followUp'];
  if (draft.followUp) {
    if (draft.due.trim() === '') return { ok: false, problem: 'noDue' };
    const dueAt = zonedLocalToIso(draft.due, opts.timeZone);
    if (!dueAt) return { ok: false, problem: 'badDue' };
    followUp = { dueAt };
  }

  const notes = draft.notes.trim().slice(0, CALL_NOTES_MAX);
  return {
    ok: true,
    input: {
      contactId,
      direction: draft.direction,
      outcome: draft.outcome,
      startedAt,
      durationSec,
      ...(notes ? { notes } : {}),
      source: opts.source ?? 'manual',
      ...(followUp ? { followUp } : {}),
      suggestStageNudge: false,
    },
  };
}

// --- "How did the call go?" ---------------------------------------------------------------------------------------------

/** What the prompt waits for, as the framework's spec says (a `tel:` link click cannot be told apart from a dialled call). */
export const CALL_NUDGE = {
  /** The tab was away at least this long before it counts as "went to make the call". */
  minAwaySeconds: 15,
  /** A tab that never went away still asks this long after the click. */
  idleSeconds: 30,
  /** Nothing is asked about a click older than this. */
  maxAgeMinutes: 30,
} as const;

/** A click on a phone number, remembered until the prompt has been answered or dismissed. */
export interface PendingCall {
  contactId: string;
  /** Epoch milliseconds of the click. */
  clickedAt: number;
}

const PENDING_KEY = 'crm.call.pending';
const DISMISSED_KEY = 'crm.call.dismissed';

interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

function readMap(store: Store, key: string): Record<string, number> {
  return safe(() => {
    const raw = store.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (typeof parsed !== 'object' || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)),
    ) as Record<string, number>;
  }, {});
}

/** Remembers that the person clicked to call this contact (per browser tab: a second tab does not ask about it). */
export function rememberCallClick(store: Store, contactId: string, now: number): void {
  safe(() => {
    store.setItem(
      PENDING_KEY,
      JSON.stringify({ ...readMap(store, PENDING_KEY), [contactId]: now }),
    );
  }, undefined);
}

/** The click waiting to be asked about, if it is still fresh and the person has not dismissed that click. */
export function pendingCall(
  pending: Store,
  dismissed: Store,
  contactId: string,
  now: number,
): PendingCall | null {
  const clickedAt = readMap(pending, PENDING_KEY)[contactId];
  if (clickedAt === undefined) return null;
  if (now - clickedAt > CALL_NUDGE.maxAgeMinutes * 60_000 || clickedAt > now + 60_000) return null;
  const seen = readMap(dismissed, DISMISSED_KEY)[contactId];
  if (seen !== undefined && seen >= clickedAt) return null;
  return { contactId, clickedAt };
}

/** The prompt was answered or dismissed: it is not asked again about this click (a later click asks again). */
export function dismissCallPrompt(pending: Store, dismissed: Store, call: PendingCall): void {
  safe(() => {
    dismissed.setItem(
      DISMISSED_KEY,
      JSON.stringify({ ...readMap(dismissed, DISMISSED_KEY), [call.contactId]: call.clickedAt }),
    );
    const rest = readMap(pending, PENDING_KEY);
    delete rest[call.contactId];
    pending.setItem(PENDING_KEY, JSON.stringify(rest));
  }, undefined);
}

/**
 * Whether to ask now. `awayMs` is how long the tab was hidden before it came back (0 when it never left), `sinceClickMs` how long ago
 * the click was. Coming back after a real absence asks at once; a tab that never left asks once `idleSeconds` have passed.
 */
export function shouldAsk(awayMs: number, sinceClickMs: number): boolean {
  if (sinceClickMs > CALL_NUDGE.maxAgeMinutes * 60_000 || sinceClickMs < 0) return false;
  if (awayMs >= CALL_NUDGE.minAwaySeconds * 1000) return true;
  return sinceClickMs >= CALL_NUDGE.idleSeconds * 1000;
}
