/** The send-to-a-customer box of the share modal (TW-CAT-023). */

export const digitsOf = (value: string): string => value.replace(/\D/g, '');

/** Reference's check before posting: at least 7 digits (the country code and the number). */
export const isValidPhone = (value: string): boolean => digitsOf(value).length >= 7;
