/** Every non-digit removed. How phones are compared everywhere in the shop (RTO history, recovery cancellation). */
export const digitsOnly = (s: string | null | undefined): string => (s ?? '').replace(/\D+/g, '');

/** What the order row stores: digits and a leading `+` kept, everything else removed (WaDesk `preg_replace('/[^\d+]/')`). */
export const storedPhone = (s: string | null | undefined): string =>
  (s ?? '').replace(/[^\d+]/g, '');

/** The shop refuses a phone with fewer digits than this (checkout and the abandoned-cart beacon). */
export const MIN_PHONE_DIGITS = 7;
export const hasValidPhone = (s: string | null | undefined): boolean =>
  digitsOnly(s).length >= MIN_PHONE_DIGITS;
