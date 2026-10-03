/**
 * The rules that gate a confirmation button, kept pure so they are tested and the dialogs only read them.
 * Lengths follow the contract: a kill reason is 5 to 300 characters, a rejection reason 5 to 500, an approval note up to 500
 * (the API trims before it counts, so the screen does too).
 */

export const KILL_REASON_MIN = 5;
export const KILL_REASON_MAX = 300;
export const REJECT_NOTE_MIN = 5;
export const REJECT_NOTE_MAX = 500;
export const APPROVE_NOTE_MAX = 500;
export const REQUEST_NOTE_MAX = 500;

export interface TextRule {
  /** Length after trimming, as the API counts it. */
  length: number;
  tooShort: boolean;
  tooLong: boolean;
  ok: boolean;
}

export function textRule(text: string, min: number, max: number): TextRule {
  const length = text.trim().length;
  const tooShort = length < min;
  const tooLong = length > max;
  return { length, tooShort, tooLong, ok: !tooShort && !tooLong };
}

export interface KillCheck {
  reason: TextRule;
  /** The typed text equals the listing's slug exactly (it is the machine id the operator reads off the page). */
  slugMatches: boolean;
  /** The red button is enabled only when both hold. */
  canKill: boolean;
}

export function killCheck(slug: string, typedSlug: string, reason: string): KillCheck {
  const r = textRule(reason, KILL_REASON_MIN, KILL_REASON_MAX);
  const slugMatches = slug !== '' && typedSlug.trim() === slug;
  return { reason: r, slugMatches, canKill: r.ok && slugMatches };
}

export const rejectCheck = (note: string): TextRule =>
  textRule(note, REJECT_NOTE_MIN, REJECT_NOTE_MAX);

/** An approval note is optional: empty is fine, too long is not. */
export const approveCheck = (note: string): TextRule => textRule(note, 0, APPROVE_NOTE_MAX);
