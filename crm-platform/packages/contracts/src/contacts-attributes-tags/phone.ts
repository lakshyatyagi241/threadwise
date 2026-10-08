/**
 * The ONE phone canonicaliser (TW-CON-013).
 *
 * Reference had two (one stripped a leading "00", the other did not), so the same
 * number was a duplicate to one code path and a stranger to another. Create,
 * import, dedupe and every "find the contact for this number" lookup call this
 * function and nothing else, so they cannot disagree.
 *
 * It is pure on purpose: the preview in the web app runs the very same code as
 * the importer on the server.
 *
 * Rules, in order:
 *   1. keep the digits of the number; no digits means no phone
 *   2. a leading "+" or a leading "00" means the number already carries its
 *      country code (the "00" is dropped)
 *   3. otherwise the country code (the row's own, else the caller's default) is
 *      put in front unless the digits already start with it; with no country
 *      code at all the digits are taken to include theirs, which is how bare
 *      "919812345678" exports from other tools arrive
 *   4. 7 to 15 digits, not starting with 0 (E.164)
 */
export const PHONE_MIN_DIGITS = 7;
export const PHONE_MAX_DIGITS = 15;

export interface CanonicalPhone {
  /** "+919812345678". What every identity, unique key and export carries. */
  e164: string;
  /** "919812345678". The matching key. */
  digits: string;
}

export interface PhoneInput {
  number: string | null | undefined;
  /** "+91", "91" or "0091". */
  countryCode?: string | null;
  /** Used when the row has no country code of its own. */
  defaultCountryCode?: string | null;
}

/** Digits of a country code, without the "+" or the "00" that some files carry. */
export function countryCodeDigits(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '').replace(/^0+/, '');
}

export function canonicalizePhone(input: PhoneInput): CanonicalPhone | null {
  const text = (input.number ?? '').trim();
  let digits = text.replace(/\D/g, '');
  if (digits.length === 0) return null;

  const international = text.startsWith('+') || (digits.length > 2 && digits.startsWith('00'));
  if (international) {
    digits = digits.replace(/^00/, '');
  } else {
    const cc = countryCodeDigits(input.countryCode) || countryCodeDigits(input.defaultCountryCode);
    if (cc && !digits.startsWith(cc)) digits = cc + digits;
  }

  if (digits.length < PHONE_MIN_DIGITS || digits.length > PHONE_MAX_DIGITS) return null;
  if (digits.startsWith('0')) return null;
  return { e164: `+${digits}`, digits };
}

/** A number written without a country code is at most this long (Reference's own threshold for "looks local"). */
export const LOCAL_PHONE_MAX_DIGITS = 10;

/**
 * A number as a person typed it (a checkout form, a lead form), as E.164, with the workspace's default country applied to a number that
 * does not announce its own. Built on `canonicalizePhone`, with the three things a typed number needs on top:
 *  - a `+` or `00` prefix is international: taken as written;
 *  - otherwise a local-looking number (10 digits or fewer, after a leading trunk `0` is dropped) gets the default country code. A number
 *    that carries its country code but no `+` ("919876543210", 12 digits) is not local and is left alone;
 *  - with no default country code, a number that does not announce its country (a bare 10 digits) cannot be read: `null`, never a guess.
 */
export function canonicalizeLocalPhone(
  raw: string | null | undefined,
  defaultCountryCode?: string | null,
): CanonicalPhone | null {
  const text = (raw ?? '').trim();
  if (text === '') return null;
  const digitsOnly = text.replace(/\D/g, '');
  if (digitsOnly === '') return null;

  if (text.startsWith('+') || text.startsWith('00')) return canonicalizePhone({ number: text });

  const cc = countryCodeDigits(defaultCountryCode);
  // "07700 900123" / "09876543210": the leading 0 is a national trunk prefix, not part of the number.
  const national = cc ? digitsOnly.replace(/^0+/, '') : digitsOnly;
  if (cc && national.length > 0 && national.length <= LOCAL_PHONE_MAX_DIGITS) {
    // Prefixed here, not through `defaultCountryCode`: that option skips a number that already starts with the code's digits, and a
    // local number may (an Indian mobile starting 91...), which would leave it one country short.
    return canonicalizePhone({ number: `+${cc}${national}` });
  }
  // No default country code and nothing that announces one: 10 digits or fewer is ambiguous.
  if (!cc && digitsOnly.length <= LOCAL_PHONE_MAX_DIGITS) return null;
  return canonicalizePhone({ number: `+${digitsOnly}` });
}

/** Same rule for code that only has the stored pieces of a contact. */
export function phoneKey(
  phone: string | null | undefined,
  countryCode?: string | null,
): string | null {
  return canonicalizePhone({ number: phone, countryCode })?.e164 ?? null;
}

/**
 * Display name (TW-CON-012). The name the caller typed wins; otherwise the
 * first and last name joined. The title is NEVER part of it: Reference's "Mr"
 * default turned every UI-created contact into "Mr Aarav" and every `{{name}}`
 * merge tag with it.
 */
export function composeDisplayName(parts: {
  name?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
}): string | null {
  const typed = parts.name?.trim();
  if (typed) return typed;
  const joined = [parts.firstName, parts.middleName, parts.lastName]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
    .join(' ');
  return joined || null;
}
