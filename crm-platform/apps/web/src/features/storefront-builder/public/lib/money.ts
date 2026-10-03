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
