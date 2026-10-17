import { CALL_CLICK_NUDGE, type CallOutcome } from '@crm/contracts';

/**
 * The compose box's "Log a call" and the "How did the call go?" line that follows a click on a phone number. The request is built by
 * the framework's own form rules (`buildLogCallInput` of the calling-voice domain, the Log a call dialog's too); what is decided here is
 * which outcomes the inline form offers and when the prompt is asked. Pure, so each rule is tested without a browser.
 */

/** The five outcomes the inline form offers, most common first (the framework also has `declined` and `failed`, which phones and providers report). */
export const FORM_OUTCOMES = [
  'connected',
  'no_answer',
  'busy',
  'left_voicemail',
  'wrong_number',
] as const satisfies readonly CallOutcome[];

// --- "How did the call go?" ---------------------------------------------------------------------------------------------

/**
 * What the prompt waits for. The away time and the age limit are the framework's (`CALL_CLICK_NUDGE`: a `tel:` click cannot be told
 * apart from a dialled call); a tab that never went away asks `idleSeconds` after the click, which the framework leaves to the screen.
 */
export const CALL_NUDGE = { ...CALL_CLICK_NUDGE, idleSeconds: 30 } as const;

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
