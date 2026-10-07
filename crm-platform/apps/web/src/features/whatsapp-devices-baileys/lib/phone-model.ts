import { DEVICE_PAIRING_MIN_DIGITS } from '@crm/contracts';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** A pairing code is requested for a number of at least this many digits, country code included (spec 10.2, runtime guard). */
export const PAIRING_CODE_MIN_DIGITS: number = DEVICE_PAIRING_MIN_DIGITS;

export type DevicePhone =
  | {
      ok: true;
      e164: string;
      /** Country code and number, digits only. */
      digits: string;
      /** Dial code without the plus ("91"). */
      callingCode: string;
      /** The number without the dial code, digits only. */
      nationalDigits: string;
      /** Two-letter region when libphonenumber could tell, else null. */
      region: string | null;
    }
  | { ok: false; problem: 'empty' | 'invalid' };

/**
 * Reads the E.164 value the phone field produced. The field already validated it per country (libphonenumber); this splits it
 * into what the API wants and what the pairing step needs. `null` or blank is `empty` (the number is required here).
 */
export function readDevicePhone(e164: string | null | undefined): DevicePhone {
  if (!e164 || !e164.trim()) return { ok: false, problem: 'empty' };
  const parsed = parsePhoneNumberFromString(e164.trim());
  if (!parsed || !parsed.isValid()) return { ok: false, problem: 'invalid' };
  return {
    ok: true,
    e164: parsed.number,
    digits: `${parsed.countryCallingCode}${parsed.nationalNumber}`,
    callingCode: String(parsed.countryCallingCode),
    nationalDigits: String(parsed.nationalNumber),
    region: parsed.country ?? null,
  };
}

/** Whether the number is long enough for a pairing code (the "add the country code" refusal is shown before the call). */
export function canUsePairingCode(phone: DevicePhone): boolean {
  return phone.ok && phone.digits.length >= PAIRING_CODE_MIN_DIGITS;
}

/** The 8-character code as shown to the person: `XXXX-XXXX`. Anything of another length is shown as given. */
export function formatPairingCode(code: string): string {
  const clean = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : code;
}
