import type { FormDefinition } from '@crm/contracts';

/**
 * The consent line of a submission (docs/specs/forms-builder-app.md 9.5, decision D10). There is no consent table in the product, so the
 * evidence lives on the submission: the exact text the visitor saw, its version and the time. A ticked box that is marked `marketing`
 * subscribes the contact; an unticked box NEVER changes a subscription (it does not unsubscribe either).
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
}

export function resolveConsent(
  def: FormDefinition,
  input: { given: boolean; textVersion: number } | undefined,
  now: Date,
): ConsentOutcome {
  const c = def.consent;
  if (!c.enabled) return { stored: null, missing: false, marketingOptIn: false };
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
  };
}
