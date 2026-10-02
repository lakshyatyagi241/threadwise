import { COUNTRY_DIAL } from './country-dial';

/**
 * A WooCommerce phone number in E.164 digits, with no `+` (WD-ECOM-028).
 *
 * WooCommerce keeps whatever the customer typed at checkout, very often a LOCAL number with no country code ("08012345678").
 * Sent to WhatsApp as it stands that targets a non-existent international address: the message "sends" and never arrives. The
 * country comes from the order's billing or shipping country (an ISO-3166 alpha-2 code WooCommerce always includes) and its dialing
 * code is put in front.
 */

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (typeof x === 'object' && x !== null ? (x as Json) : {});
const str = (x: unknown): string | null =>
  typeof x === 'string' ? x : typeof x === 'number' ? String(x) : null;

const dialFor = (iso: string | null | undefined): string | null => {
  const k = (iso ?? '').trim().toLowerCase();
  return k.length === 2 ? (COUNTRY_DIAL[k] ?? null) : null;
};

/**
 * `rawPhone` exactly as WooCommerce stored it, `countryIso` the ISO-2 code when known. Null for an empty number.
 *
 * - A leading `+` (or `00`) means a full international number: its digits are trusted as they are.
 * - Otherwise, a number that already starts with the country's code and is long enough to be international (at least 8 digits more)
 *   is kept; one that merely starts with the same digits is a local number and is not mistaken for it.
 * - Any other number is local: its trunk zeros are dropped and the code is put in front.
 * - With no country and no `+` there is nothing to repair: the digits are returned as they are.
 */
export function e164(
  rawPhone: string | null | undefined,
  countryIso?: string | null,
): string | null {
  const raw = (rawPhone ?? '').trim();
  if (raw === '') return null;
  let hadPlus = raw.startsWith('+');
  let digits = raw.replace(/\D+/g, '');
  if (digits === '') return null;
  if (!hadPlus && digits.startsWith('00')) {
    digits = digits.slice(2).replace(/^0+/, '') || digits;
    hadPlus = true;
  }
  if (hadPlus) return digits;

  const dial = dialFor(countryIso);
  if (dial !== null) {
    if (digits.startsWith(dial) && digits.length >= dial.length + 8) return digits;
    return dial + digits.replace(/^0+/, '');
  }
  return digits;
}

/** The recipient of a WooCommerce order, customer or checkout payload: billing, then shipping, then the top-level fields (the first one filled in). */
export function wooPhoneOf(data: Json): string | null {
  const billing = obj(data.billing);
  const shipping = obj(data.shipping);
  const customer = obj(data.customer);
  // WooCommerce sends an empty string, not null, for a field the customer left blank, so each step takes the first FILLED value.
  // (WaDesk fell through only on null, so an empty billing phone hid a shipping phone that was there.)
  const filled = (...v: Array<string | null>) =>
    v.find((x) => x !== null && x.trim() !== '') ?? null;
  const phone = filled(
    str(billing.phone),
    str(shipping.phone),
    str(data.phone),
    str(customer.phone),
  );
  const iso = filled(
    str(billing.country),
    str(shipping.country),
    str(obj(customer.billing).country),
  );
  return e164(phone, iso);
}
