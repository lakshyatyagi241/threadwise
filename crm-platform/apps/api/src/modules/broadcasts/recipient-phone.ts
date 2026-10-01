/**
 * The number a recipient is sent to, as digits (WD-BCAST-016 rule 4).
 *
 * WaDesk joined the country-code digits and the local digits unless the local number already began with the country code.
 * Contacts here keep an E.164 `phone` and an optional `country_code`, so a number written with a leading `+` is already whole.
 */
const digits = (s: string | null | undefined) => (s ?? '').replace(/\D+/g, '');

export function assemblePhone(
  phone: string | null | undefined,
  countryCode: string | null | undefined,
): string {
  const local = digits(phone);
  if (local === '') return '';
  if ((phone ?? '').trim().startsWith('+')) return local;
  const cc = digits(countryCode);
  return cc !== '' && !local.startsWith(cc) ? `${cc}${local}` : local;
}

/** A sender's own number, same rule: country-code digits + local digits unless already whole. */
export const senderDigits = (
  countryCode: string | null | undefined,
  phone: string | null | undefined,
) => assemblePhone(phone, countryCode);
