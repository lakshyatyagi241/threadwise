/**
 * Minor-unit money helpers (TW-CPN-028): Reference's `MoneyFormat`. The exponent table is Reference's own (it lists IDR, HUF, TWD and MGA
 * as whole-unit currencies, which is how its invoices were stored); the deals and checkout code keep their ISO table in
 * `currencyExponent`. Reference's `display` always divided by 100 whatever the currency, so a yen invoice stored as 1500 showed 15;
 * here `displayMinor` uses the same exponent as `toMinor`, the one intended difference.
 */
const ZERO_DECIMAL = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'IDR',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
  'HUF',
  'TWD',
]);
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

/** Digits after the point for a code; unknown or empty codes are 2. */
export function moneyExponent(currency: string | null | undefined): number {
  const c = (currency ?? '').trim().toUpperCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}

/** "1,500.50", "$19.99", "19,99 " -> 150050n / 1999n: everything but digits, the point and a minus sign is ignored, half-up rounding. */
export function toMinor(input: string | number, currency: string): bigint {
  const exp = moneyExponent(currency);
  const cleaned = String(input).replace(/[^0-9.-]/g, '');
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!m) return 0n;
  const sign = m[1] === '-' ? -1n : 1n;
  const whole = m[2] || '0';
  const frac = m[3] ?? '';
  const kept = frac.slice(0, exp).padEnd(exp, '0');
  let minor = BigInt(whole + kept);
  // Half-up on the first dropped digit.
  if (frac.length > exp && Number(frac[exp]) >= 5) minor += 1n;
  return sign * minor;
}

/** 150050n + "USD" -> "1,500.50"; 150000n + "IDR" (exponent 0 or 2 per the table) -> grouped with that many decimals; no symbol. */
export function majorString(minor: bigint | number | string, currency: string): string {
  const exp = moneyExponent(currency);
  const n = typeof minor === 'bigint' ? minor : BigInt(minor);
  const neg = n < 0n;
  const digits = (neg ? -n : n).toString().padStart(exp + 1, '0');
  const whole = exp === 0 ? digits : digits.slice(0, digits.length - exp);
  const frac = exp === 0 ? '' : digits.slice(digits.length - exp);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}${exp === 0 ? '' : `.${frac}`}`;
}

/** The symbols Reference's storefront formatter knew; any other code prints as itself. */
const DISPLAY_SYMBOLS: Readonly<Record<string, string>> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AED: 'AED ',
  KES: 'KSh ',
  NGN: '₦',
  CRC: '₡',
  BRL: 'R$',
  ZAR: 'R',
  PHP: '₱',
  IDR: 'Rp ',
  MXN: 'MX$',
  SGD: 'S$',
  MYR: 'RM ',
  THB: '฿',
  VND: '₫',
  EGP: 'E£',
  PKR: 'Rs ',
  BDT: '৳',
  LKR: 'Rs ',
};

/** Symbol + grouped major amount for a minor-unit value; unknown codes print `CODE `. */
export function displayMinor(minor: bigint | number | string, currency: string): string {
  const code = currency.trim().toUpperCase();
  return `${DISPLAY_SYMBOLS[code] ?? `${code} `}${majorString(minor, code)}`;
}
