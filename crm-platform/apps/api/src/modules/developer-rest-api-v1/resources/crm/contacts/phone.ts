import { canonicalizePhone } from '@crm/contracts';

/**
 * WaDesk's phone composition: the country code is put in front unless the phone string itself already starts with the country code
 * string as sent ("+91" against "+91 98765 43210"), then everything but digits goes and a `+` is put back. The check is on the text, not
 * on the digits: a national "9162915526" with "+91" is prefixed (the `+` is not in the number), where `canonicalizePhone` alone took its
 * leading "91" for the code and stored "+9162915526". A country code written without the plus ("91") is compared as written, so a
 * national number that begins with those digits is taken as already carrying it, as in WaDesk.
 * Returns null when nothing usable is left or the result is not a plausible E.164 number (so the caller answers 422).
 */
export function composeV1Phone(
  phone: string | null | undefined,
  countryCode: string | null | undefined,
): string | null {
  const text = (phone ?? '').trim();
  if (text === '') return null;
  const cc = (countryCode ?? '').trim();
  const composed = cc !== '' && !text.startsWith(cc) ? `${cc} ${text}` : text;
  const digits = composed.replace(/\D+/g, '');
  if (digits === '') return null;
  return canonicalizePhone({ number: `+${digits}` })?.e164 ?? null;
}
