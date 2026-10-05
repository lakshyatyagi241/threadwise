import { canonicalizePhone, countryCodeDigits } from '@crm/contracts';

export interface LeadPhone {
  /** "+919876543210": what a contact's identity key carries. */
  e164: string;
  digits: string;
}

/** A number written without a country code is at most this long (Reference's own threshold for "looks local"). */
const LOCAL_MAX_DIGITS = 10;

/**
 * A phone number as a lead form wrote it, as E.164 (spec open question 12).
 *
 * Built on the one canonicaliser every contact writer uses (`canonicalizePhone`), with the three things a lead form needs on top:
 *  - a `+` or `00` prefix is international: taken as written;
 *  - otherwise a local-looking number (10 digits or fewer, after a leading trunk `0` is dropped) gets the source's default country code,
 *    which Reference's webhook applied too. A form that sends the number with its country code but no `+` ("919876543210", 12 digits) is
 *    not local and is left alone;
 *  - with no default country code, a number that does not announce its country (a bare 10 digits) cannot be read: `null`, never a guess.
 *
 * `null` means "not a usable number": the caller decides whether the lead is still usable through its email.
 */
export function normaliseLeadPhone(
  raw: string | null | undefined,
  defaultCountryCode?: string | null,
): LeadPhone | null {
  const text = (raw ?? '').trim();
  if (text === '') return null;
  const digitsOnly = text.replace(/\D/g, '');
  if (digitsOnly === '') return null;

  if (text.startsWith('+') || text.startsWith('00')) return canonicalizePhone({ number: text });

  const cc = countryCodeDigits(defaultCountryCode);
  // "07700 900123" / "09876543210": the leading 0 is a national trunk prefix, not part of the number.
  const national = cc ? digitsOnly.replace(/^0+/, '') : digitsOnly;
  if (cc && national.length > 0 && national.length <= LOCAL_MAX_DIGITS) {
    // Prefixed here, not through `defaultCountryCode`: that option skips a number that already starts with the code's digits, and a
    // local number may (an Indian mobile starting 91...), which would leave it one country short.
    return canonicalizePhone({ number: `+${cc}${national}` });
  }
  // No default country code and nothing that announces one: 10 digits or fewer is ambiguous.
  if (!cc && digitsOnly.length <= LOCAL_MAX_DIGITS) return null;
  return canonicalizePhone({ number: `+${digitsOnly}` });
}
