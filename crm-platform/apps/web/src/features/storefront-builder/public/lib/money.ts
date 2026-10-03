/** Currency symbols of the 21 currencies a shop can use (TW-STORE-006). An unknown code is shown as the code and a space. */
const SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AED: 'د.إ',
  KES: 'KSh',
  NGN: '₦',
  CRC: '₡',
  BRL: 'R$',
  ZAR: 'R',
  PHP: '₱',
  IDR: 'Rp',
  MXN: '$',
  SGD: 'S$',
  MYR: 'RM',
  THB: '฿',
  VND: '₫',
  EGP: 'E£',
  PKR: '₨',
  BDT: '৳',
  LKR: 'Rs',
};

export const currencySymbol = (code: string): string => SYMBOLS[code] ?? code;

/** Minor units to text: symbol, a space, then the value without decimals when whole, else two decimals. */
export function formatMinor(minor: number, code: string): string {
  const whole = minor % 100 === 0;
  return `${currencySymbol(code)} ${(minor / 100).toFixed(whole ? 0 : 2)}`;
}

/**
 * Reference's `FormatSettings::formatIn`: symbol (or the code and a space) glued to the amount with the currency's two decimals and
 * thousands separators. The filter's "Range" hint and the free-shipping copy use it; prices on cards use `formatMinor`.
 */
export function formatIn(minor: number, code: string): string {
  const text = (minor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${SYMBOLS[code] ?? `${code} `}${text}`;
}

/**
 * QUIRK (Reference): the shipping tab and the footer's Shipping dialog read `shipping_json.free_threshold`, a key nothing writes,
 * so they always say "free above 999.00" in the shop's currency whatever the real free-above rule is.
 */
export const LEGACY_FREE_THRESHOLD_MINOR = 99900;

/** Reference's `WaOrder::total_display`: INR, USD, EUR and GBP have a symbol, any other currency shows its code; always two decimals. */
export function totalDisplay(minor: number, code: string): string {
  const symbol =
    ({ INR: '₹', USD: '$', EUR: '€', GBP: '£' } as Record<string, string>)[code] ?? code;
  const text = (minor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol} ${text}`;
}
