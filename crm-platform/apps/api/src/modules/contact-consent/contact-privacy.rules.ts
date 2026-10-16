import type { PrivacyFlagKind, PrivacyFlagSource } from '@crm/contracts';

/**
 * The pure rules of the contact privacy flags (BL-180, BL-211). The database layer only stores what these decide, so the truth table is
 * unit tested without a database (the same split as `consent.rules.ts` and `consent-gate.rules.ts`).
 */

/** The current value of each flag of one contact (a `contact_privacy_flags` row, or all false when the contact has none). */
export interface FlagsState {
  isMinor: boolean;
  minorSince: string | null;
  minorSource: PrivacyFlagSource | null;
  /** The day a flag set from a date of birth (or an age) lapses by itself. Only ever set while `minorSource` is `dob`. */
  minorUntil: string | null;
  /** A person cleared the minor flag while the date of birth still said minor: the date they reviewed. */
  dobOverrideFor: string | null;
  guardianConsent: boolean;
  guardianSince: string | null;
  doNotSellShare: boolean;
  doNotSellShareSince: string | null;
  doNotSellShareSource: PrivacyFlagSource | null;
}

export const NO_FLAGS: FlagsState = {
  isMinor: false,
  minorSince: null,
  minorSource: null,
  minorUntil: null,
  dobOverrideFor: null,
  guardianConsent: false,
  guardianSince: null,
  doNotSellShare: false,
  doNotSellShareSince: null,
  doNotSellShareSource: null,
};

/** One flag change that must be appended to the history: the one asked for, plus the guardian flag when a minor is cleared. */
export interface FlagStep {
  kind: PrivacyFlagKind;
  value: boolean;
}

export type FlagPlan =
  /** Guardian consent was asked for a contact that is not flagged as a minor. */
  | { ok: false; reason: 'not_minor' }
  /** The system (source `dob`) tried to change a flag that a person, the API, an import or a flow set: a decision stays until a person clears it. */
  | { ok: false; reason: 'person_flag' }
  | {
      ok: true;
      /** The state after the change. */
      next: FlagsState;
      /** The requested flag really changes value. */
      changed: boolean;
      /** The history lines to append, in order. Never empty for `ok`. */
      steps: FlagStep[];
    };

export interface PlanOptions {
  /** `minor` on, source `dob`: the day the flag lapses (a birthday, or the latest day an age answer can last). */
  minorUntil?: string | null;
  /**
   * `minor` off by a person: the contact's date of birth when it still says minor. The flag is not set again from that date until it
   * changes (a person who clears a flag meant it).
   */
  dobSaysMinorFor?: string | null;
}

/**
 * What turning one flag on or off does to the state.
 *
 *  - A guardian agrees FOR a minor, so guardian consent can only be turned on while the contact is a minor.
 *  - Clearing the minor flag (the person came of age, or was flagged by mistake) also clears guardian consent, as a second history line,
 *    so the state never says "guardian agreed" for an adult.
 *  - Turning a flag on records when and from where; turning it off forgets both (the history keeps them).
 *  - The system (source `dob`) never overrides a person: it can neither clear nor take over a flag that a person, the API, an import or a
 *    flow set. A person who flags a contact the system had flagged takes the flag over (the source becomes theirs and it no longer lapses).
 *
 * Nothing here ever creates a marketing grant: the consent ledger is the only place a grant is written.
 */
export function planFlagChange(
  prior: FlagsState,
  kind: PrivacyFlagKind,
  value: boolean,
  source: PrivacyFlagSource,
  at: Date,
  opts: PlanOptions = {},
): FlagPlan {
  const iso = at.toISOString();
  const next: FlagsState = { ...prior };
  const steps: FlagStep[] = [{ kind, value }];
  let changed: boolean;

  switch (kind) {
    case 'minor': {
      if (source === 'dob' && prior.isMinor && prior.minorSource !== 'dob') {
        return { ok: false, reason: 'person_flag' };
      }
      changed = prior.isMinor !== value;
      if (value) {
        const takeOver = prior.isMinor && prior.minorSource === 'dob' && source !== 'dob';
        next.isMinor = true;
        next.minorSince = prior.isMinor ? prior.minorSince : iso;
        next.minorSource = prior.isMinor && !takeOver ? prior.minorSource : source;
        next.minorUntil = next.minorSource === 'dob' ? (opts.minorUntil ?? prior.minorUntil) : null;
        next.dobOverrideFor = null;
      } else {
        next.isMinor = false;
        next.minorSince = null;
        next.minorSource = null;
        next.minorUntil = null;
        // A person who clears the flag while the date still says minor is not overruled by the next sweep.
        next.dobOverrideFor =
          source !== 'dob' && opts.dobSaysMinorFor ? opts.dobSaysMinorFor : null;
        if (prior.guardianConsent) {
          next.guardianConsent = false;
          next.guardianSince = null;
          steps.push({ kind: 'guardian_consent', value: false });
        }
      }
      break;
    }
    case 'guardian_consent':
      if (value && !prior.isMinor) return { ok: false, reason: 'not_minor' };
      changed = prior.guardianConsent !== value;
      next.guardianConsent = value;
      next.guardianSince = value ? (prior.guardianConsent ? prior.guardianSince : iso) : null;
      break;
    case 'sale_share_opt_out':
      changed = prior.doNotSellShare !== value;
      next.doNotSellShare = value;
      next.doNotSellShareSince = value
        ? prior.doNotSellShare
          ? prior.doNotSellShareSince
          : iso
        : null;
      next.doNotSellShareSource = value
        ? prior.doNotSellShare
          ? prior.doNotSellShareSource
          : source
        : null;
      break;
  }
  return { ok: true, next, changed, steps };
}

/**
 * Whether a Global Privacy Control signal is on. The specification defines exactly one value: the header `Sec-GPC` with the value `1`.
 * Anything else (absent, `0`, `true`, a list) is NOT a signal.
 */
export function isGpcSignal(header: string | string[] | undefined): boolean {
  const v = Array.isArray(header) ? header[0] : header;
  return typeof v === 'string' && v.trim() === '1';
}
