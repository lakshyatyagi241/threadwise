/**
 * Money at the Meta boundary (TW-CAT-026).
 *
 * `price_minor` is always the major amount times 100, for every currency, zero- and three-decimal ones included. Meta wants
 * the amount in the currency's OWN minor unit, so the conversion happens only here, in both directions.
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

export type CurrencyDecimals = 0 | 2 | 3;

export function currencyDecimals(currency: string | null | undefined): CurrencyDecimals {
  const cur = (currency ?? '').toUpperCase();
  if (ZERO_DECIMAL.has(cur)) return 0;
  if (THREE_DECIMAL.has(cur)) return 3;
  return 2;
}

/**
 * Our `price_minor` to the integer Meta's `items_batch` expects.
 * Zero-decimal (IDR, JPY...): strip our x100. Three-decimal (KWD...): x10. Everything else is already right.
 * Without the first rule an IDR 395,000 item was shown on Meta as 39,500,000.
 */
export function metaCatalogPrice(priceMinor: number, currency: string | null | undefined): number {
  const decimals = currencyDecimals(currency || 'INR');
  if (decimals === 0) return Math.trunc(priceMinor / 100);
  if (decimals === 3) return priceMinor * 10;
  return priceMinor;
}

/** Digits of a run of digits as a minor amount (x100) rounded half up on the third decimal, exactly (no float). */
function majorToMinor(intPart: string, fracPart: string): number | null {
  const whole = intPart === '' ? '0' : intPart;
  const frac = `${fracPart}000`;
  let minor = BigInt(whole) * 100n + BigInt(frac.slice(0, 2));
  if (frac.charCodeAt(2) >= 53 /* '5' */) minor += 1n;
  return minor > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(minor);
}

/**
 * Meta's catalog price back to our `price_minor` (TW-CAT-011): the inverse of {@link metaCatalogPrice}.
 *
 * - null or empty: no price.
 * - a bare integer is already in the currency's own minor unit: zero-decimal x100, three-decimal /10, two-decimal as is.
 * - a formatted string keeps digits, dots and commas. With both separators the rightmost is the decimal point
 *   ("1,234.56" and "1.234,56"). With one kind it is a decimal point only when the currency has decimals, it occurs once and
 *   exactly `decimals` digits follow; otherwise every separator groups thousands ("Rp33.900.000" is 33,900,000).
 */
export function parseMetaPriceMinor(
  raw: number | string | null | undefined,
  currency: string | null | undefined,
): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const decimals = currencyDecimals(currency);

  if (typeof raw === 'number' && Number.isInteger(raw)) {
    if (decimals === 0) return raw * 100;
    if (decimals === 3) return Math.trunc(raw / 10);
    return raw;
  }

  const s = String(raw).replace(/[^0-9.,]/g, '');
  if (s === '') return null;

  const dot = s.lastIndexOf('.');
  const comma = s.lastIndexOf(',');
  let decSep: '.' | ',' | null = null;
  if (dot !== -1 && comma !== -1) {
    decSep = dot > comma ? '.' : ',';
  } else if (dot !== -1 || comma !== -1) {
    const sep = dot !== -1 ? '.' : ',';
    const pos = dot !== -1 ? dot : comma;
    const trailing = s.length - pos - 1;
    const occurrences = s.split(sep).length - 1;
    if (decimals > 0 && occurrences === 1 && trailing === decimals) decSep = sep;
  }

  if (decSep !== null) {
    const cut = s.lastIndexOf(decSep);
    return majorToMinor(s.slice(0, cut).replace(/\D+/g, ''), s.slice(cut + 1).replace(/\D+/g, ''));
  }
  return majorToMinor(s.replace(/\D+/g, ''), '');
}

/** A typed major amount ("1299", "1299.5") to `price_minor`: x100 rounded half up, exactly. */
export function majorStringToMinor(major: string): number {
  const [intPart = '', fracPart = ''] = major.trim().split('.');
  return majorToMinor(intPart.replace(/\D+/g, ''), fracPart.replace(/\D+/g, '')) ?? 0;
}

/** `price_minor` as the plain decimal the form shows back: 129900 is "1299", 129950 is "1299.5". */
export function minorToMajorString(minor: number): string {
  const whole = Math.trunc(minor / 100);
  const cents = Math.abs(minor % 100);
  if (cents === 0) return String(whole);
  return `${minor < 0 && whole === 0 ? '-' : ''}${whole}.${String(cents).padStart(2, '0').replace(/0$/, '')}`;
}
