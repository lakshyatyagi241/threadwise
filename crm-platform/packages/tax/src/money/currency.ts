/**
 * ISO 4217 minor-unit exponents. Everything not listed has 2. This is the one table; `Intl` is never trusted for the exponent
 * (ICU and ISO disagree for a few currencies), so formatting always passes the exponent explicitly.
 *
 *  - 0: no minor unit (JPY, KRW, VND, ...). ISK and UGX are 0 in ISO 4217 today.
 *  - 3: BHD, IQD, JOD, KWD, LYD, OMR, TND.
 *  - 4: CLF and UYW (unidades de fomento / indexed units; special).
 *  - HUF, TWD and IDR are 2 in ISO 4217 even though cash is practically whole units; they stay 2 here.
 */
const EXPONENT_0 = [
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'PYG',
  'RWF',
  'UGX',
  'UYI',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
] as const;
const EXPONENT_3 = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'] as const;
const EXPONENT_4 = ['CLF', 'UYW'] as const;

const EXPONENTS = new Map<string, number>();
for (const c of EXPONENT_0) EXPONENTS.set(c, 0);
for (const c of EXPONENT_3) EXPONENTS.set(c, 3);
for (const c of EXPONENT_4) EXPONENTS.set(c, 4);

/** Active ISO 4217 codes this engine accepts for validation. */
export const KNOWN_CURRENCIES: readonly string[] = [
  'AED',
  'AFN',
  'ALL',
  'AMD',
  'ANG',
  'AOA',
  'ARS',
  'AUD',
  'AWG',
  'AZN',
  'BAM',
  'BBD',
  'BDT',
  'BGN',
  'BHD',
  'BIF',
  'BMD',
  'BND',
  'BOB',
  'BRL',
  'BSD',
  'BTN',
  'BWP',
  'BYN',
  'BZD',
  'CAD',
  'CDF',
  'CHF',
  'CLF',
  'CLP',
  'CNY',
  'COP',
  'CRC',
  'CUP',
  'CVE',
  'CZK',
  'DJF',
  'DKK',
  'DOP',
  'DZD',
  'EGP',
  'ERN',
  'ETB',
  'EUR',
  'FJD',
  'FKP',
  'GBP',
  'GEL',
  'GHS',
  'GIP',
  'GMD',
  'GNF',
  'GTQ',
  'GYD',
  'HKD',
  'HNL',
  'HTG',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'IQD',
  'IRR',
  'ISK',
  'JMD',
  'JOD',
  'JPY',
  'KES',
  'KGS',
  'KHR',
  'KMF',
  'KPW',
  'KRW',
  'KWD',
  'KYD',
  'KZT',
  'LAK',
  'LBP',
  'LKR',
  'LRD',
  'LSL',
  'LYD',
  'MAD',
  'MDL',
  'MGA',
  'MKD',
  'MMK',
  'MNT',
  'MOP',
  'MRU',
  'MUR',
  'MVR',
  'MWK',
  'MXN',
  'MYR',
  'MZN',
  'NAD',
  'NGN',
  'NIO',
  'NOK',
  'NPR',
  'NZD',
  'OMR',
  'PAB',
  'PEN',
  'PGK',
  'PHP',
  'PKR',
  'PLN',
  'PYG',
  'QAR',
  'RON',
  'RSD',
  'RUB',
  'RWF',
  'SAR',
  'SBD',
  'SCR',
  'SDG',
  'SEK',
  'SGD',
  'SHP',
  'SLE',
  'SOS',
  'SRD',
  'SSP',
  'STN',
  'SVC',
  'SYP',
  'SZL',
  'THB',
  'TJS',
  'TMT',
  'TND',
  'TOP',
  'TRY',
  'TTD',
  'TWD',
  'TZS',
  'UAH',
  'UGX',
  'USD',
  'UYI',
  'UYU',
  'UYW',
  'UZS',
  'VES',
  'VND',
  'VUV',
  'WST',
  'XAF',
  'XCD',
  'XOF',
  'XPF',
  'YER',
  'ZAR',
  'ZMW',
  'ZWL',
];
const KNOWN = new Set(KNOWN_CURRENCIES);

export function isKnownCurrency(code: string): boolean {
  return KNOWN.has(code.toUpperCase());
}

/** Digits after the decimal point for `code` (case-insensitive). Unknown three-letter codes default to 2. */
export function currencyExponent(code: string): number {
  return EXPONENTS.get(code.toUpperCase()) ?? 2;
}

/** 10^exponent as a bigint: how many minor units make one major unit. */
export function minorPerMajor(code: string): bigint {
  return 10n ** BigInt(currencyExponent(code));
}

/**
 * Smallest cash denomination per currency, in minor units, where cash is rounded to a coarser step than the minor unit.
 * (The legal rule is about CASH payments; invoices usually round only when the seller opts in.) Verify for your market.
 */
export const CASH_ROUNDING_INCREMENT_MINOR: Readonly<Record<string, bigint>> = {
  CHF: 5n, // 0.05
  AUD: 5n, // 0.05 (1c and 2c coins withdrawn)
  NZD: 10n, // 0.10 (5c coin withdrawn 2023)
  CAD: 5n, // 0.05 (penny withdrawn 2013)
  SGD: 5n, // 0.05
  MYR: 5n, // 0.05 (Bank Negara rounding mechanism)
  SEK: 100n, // 1 krona (oere withdrawn)
  NOK: 100n, // 1 krone
  DKK: 50n, // 0.50
  HKD: 10n, // 0.10
  EUR: 5n, // only where the member state applies it (NL, BE, FI, IE, IT, SK ...): opt in
};
