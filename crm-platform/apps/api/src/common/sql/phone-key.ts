import { sql, type SQL } from 'drizzle-orm';
import { countryCodeDigits, LOCAL_PHONE_MAX_DIGITS } from '@crm/contracts';

/**
 * The digits a buyer's phone is matched on, in SQL: `canonicalizeLocalPhone` (contracts) written as an expression, so a column of
 * phones as people typed them ("7999834066", "+91 79998 34066", "917999834066") groups to one key ("917999834066").
 *
 *  - a `+` or `00` prefix: international, the digits as written (a leading `00` dropped);
 *  - otherwise, with a default country code (`ccDigits`, "91"), a local number (10 digits or fewer after the trunk `0`) gets it in front;
 *  - anything longer is taken to carry its country code already; with no default country code a short number stays as its digits
 *    (the application layer refuses to GUESS a country, a list may still show the number).
 *
 * Empty string when there are no digits. `ccDigits` is "" when there is no default country. Keep in step with `canonicalizeLocalPhone`:
 * `phone-key.spec.ts` and the store customers e2e compare the two.
 */
export function phoneKeySql(column: SQL, ccDigits: string): SQL {
  const digits = sql`regexp_replace(coalesce(${column}, ''), '[^0-9]', '', 'g')`;
  const national = sql`ltrim(${digits}, '0')`;
  return sql`(CASE
    WHEN coalesce(${column}, '') ~ '^\\s*(\\+|00)' THEN regexp_replace(${digits}, '^00', '')
    WHEN ${ccDigits}::text <> '' AND length(${national}) BETWEEN 1 AND 10 THEN ${ccDigits}::text || ${national}
    ELSE ${digits}
  END)`;
}

/**
 * The same key in TypeScript (for a phone that is not in a column yet), step for step what `phoneKeySql` computes, so a saved phone and a
 * listed one meet on the same digits. For any number `canonicalizeLocalPhone` accepts it IS that number's digits; a number it refuses
 * (too short, too long) still gets a stable key, so it groups and lists but is never linked to a contact.
 */
export function phoneKey(
  raw: string | null | undefined,
  defaultCountryCode: string | null,
): string {
  const text = raw ?? '';
  const digits = text.replace(/\D+/g, '');
  if (/^\s*(\+|00)/.test(text)) return digits.replace(/^00/, '');
  const cc = countryCodeDigits(defaultCountryCode);
  const national = digits.replace(/^0+/, '');
  if (cc && national.length >= 1 && national.length <= LOCAL_PHONE_MAX_DIGITS) return cc + national;
  return digits;
}
