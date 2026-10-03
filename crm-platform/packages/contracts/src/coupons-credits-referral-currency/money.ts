/**
 * Minor-unit money helpers (TW-CPN-028). Reference's `MoneyFormat` had two sources of truth for decimals (a hard-coded list and the
 * catalogue's `precision`) and its display helper divided by 100 whatever the currency. These take the number of decimals as an
 * argument, so the caller passes the catalogue's `precision` (or `currencyExponent(code)` when the catalogue has no row) and the
 * parse, the format and the storage always agree. Exact: bigint, no float.
 */

/**
 * "19.99" -> 1999n; "1,500.50" and "$19.99" parse too (Reference stripped everything but digits, the point and a minus). Extra digits
 * beyond `precision` are rounded half up. Null when nothing numeric is left.
 */
export function parseToMinor(input: string, precision: number): bigint | null {
  const cleaned = input.replace(/[^0-9.-]/g, '');
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!m || (m[2] === '' && !m[3])) return null;
  const sign = m[1] === '-' ? -1n : 1n;
  const whole = m[2] || '0';
  const frac = m[3] ?? '';
  const kept = frac.slice(0, precision).padEnd(precision, '0');
  let minor = BigInt(whole + kept);
  if (frac.length > precision && Number(frac[precision]) >= 5) minor += 1n;
  return sign * minor;
}

/** 150000n at 0 decimals -> "150,000"; 1500n at 3 -> "1.500"; thousands separated by `,`, no symbol. */
export function majorString(minor: bigint | number | string, precision: number): string {
  const n = typeof minor === 'bigint' ? minor : BigInt(minor);
  const neg = n < 0n;
  const abs = (neg ? -n : n).toString().padStart(precision + 1, '0');
  const whole = precision === 0 ? abs : abs.slice(0, abs.length - precision);
  const frac = precision === 0 ? '' : abs.slice(abs.length - precision);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}${precision === 0 ? '' : `.${frac}`}`;
}
