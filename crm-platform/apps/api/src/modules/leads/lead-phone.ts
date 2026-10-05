import { canonicalizeLocalPhone } from '@crm/contracts';

export interface LeadPhone {
  /** "+919876543210": what a contact's identity key carries. */
  e164: string;
  digits: string;
}

/**
 * A phone number as a lead form wrote it, as E.164 (spec open question 12): the one rule `canonicalizeLocalPhone` (contracts) applies
 * to every typed number, with the source's default country code. `null` means "not a usable number": the caller decides whether the
 * lead is still usable through its email.
 */
export function normaliseLeadPhone(
  raw: string | null | undefined,
  defaultCountryCode?: string | null,
): LeadPhone | null {
  return canonicalizeLocalPhone(raw, defaultCountryCode);
}
