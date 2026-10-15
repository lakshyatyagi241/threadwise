import { consentChannels, type FormConsentChannel, type FormDefinition } from '@crm/contracts';

/**
 * The consent line of a submission (docs/specs/forms-builder-app.md 9.5, decision D10). There is no consent table in the product, so the
 * evidence lives on the submission: the exact text the visitor saw, its version and the time. A ticked box that is marked `marketing`
 * subscribes the contact; an unticked box NEVER changes a subscription (it does not unsubscribe either).
 *
 * BL-171 (privacy spec 4.3.2): the line is also evidence in the consent ledger, and what it records depends on what the person agreed to.
 * A ticked MARKETING line is a marketing grant (WhatsApp, email, and SMS when the wording covers it). A ticked line that is NOT marketing
 * ("I agree to be contacted about my request") is a record of agreement to service messages only: purpose `utility`, never a marketing
 * grant. An unticked line is not an agreement, so it records nothing in the ledger (the submission keeps what was shown and that it was
 * left unticked).
 */

export interface StoredConsent {
  given: boolean;
  /** The text of the version this submission was validated against. */
  text: string;
  /** The version of that text. */
  version: number;
  /** The version the visitor's page said it showed (a stale page after a republish differs). */
  shownVersion: number | null;
  at: string;
}

export interface ConsentOutcome {
  /** `null` when the form has no consent line. */
  stored: StoredConsent | null;
  /** The visitor must tick the box and did not. */
  missing: boolean;
  /** Subscribe the contact (a ticked marketing box). */
  marketingOptIn: boolean;
  /** A ticked box that is not marketing: the person agreed to be contacted about their request (service messages only). */
  serviceAgreed: boolean;
  /** The channels the wording covers (chosen on the form); a ticked box subscribes only these. */
  channels: FormConsentChannel[];
}

export function resolveConsent(
  def: FormDefinition,
  input: { given: boolean; textVersion: number } | undefined,
  now: Date,
): ConsentOutcome {
  const c = def.consent;
  if (!c.enabled) {
    return {
      stored: null,
      missing: false,
      marketingOptIn: false,
      serviceAgreed: false,
      channels: [],
    };
  }
  const given = input?.given === true;
  return {
    stored: {
      given,
      text: c.text,
      version: c.version,
      shownVersion: input?.textVersion ?? null,
      at: now.toISOString(),
    },
    missing: c.required && !given,
    marketingOptIn: given && c.marketing,
    serviceAgreed: given && !c.marketing,
    channels: consentChannels(c),
  };
}
