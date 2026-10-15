import type { PrivacyFlagKind, PrivacyFlagSource } from '@crm/contracts';

/**
 * The pure rules of the contact privacy flags (BL-180). The database layer only stores what these decide, so the truth table is unit
 * tested without a database (the same split as `consent.rules.ts` and `consent-gate.rules.ts`).
 */

/** The current value of each flag of one contact (a `contact_privacy_flags` row, or all false when the contact has none). */
export interface FlagsState {
  isMinor: boolean;
  minorSince: string | null;
  minorSource: PrivacyFlagSource | null;
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
  | {
      ok: true;
      /** The state after the change. */
      next: FlagsState;
      /** The requested flag really changes value. */
      changed: boolean;
      /** The history lines to append, in order. Never empty for `ok`. */
      steps: FlagStep[];
    };

/**
 * What turning one flag on or off does to the state.
 *
 *  - A guardian agrees FOR a minor, so guardian consent can only be turned on while the contact is a minor.
 *  - Clearing the minor flag (the person came of age, or was flagged by mistake) also clears guardian consent, as a second history line,
 *    so the state never says "guardian agreed" for an adult.
 *  - Turning a flag on records when and from where; turning it off forgets both (the history keeps them).
 *
 * Nothing here ever creates a marketing grant: the consent ledger is the only place a grant is written.
 */
export function planFlagChange(
  prior: FlagsState,
  kind: PrivacyFlagKind,
  value: boolean,
  source: PrivacyFlagSource,
  at: Date,
): FlagPlan {
  const iso = at.toISOString();
  const next: FlagsState = { ...prior };
  const steps: FlagStep[] = [{ kind, value }];
  let changed: boolean;

  switch (kind) {
    case 'minor':
      changed = prior.isMinor !== value;
      next.isMinor = value;
      next.minorSince = value ? (prior.isMinor ? prior.minorSince : iso) : null;
      next.minorSource = value ? (prior.isMinor ? prior.minorSource : source) : null;
      if (!value && prior.guardianConsent) {
        next.guardianConsent = false;
        next.guardianSince = null;
        steps.push({ kind: 'guardian_consent', value: false });
      }
      break;
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
