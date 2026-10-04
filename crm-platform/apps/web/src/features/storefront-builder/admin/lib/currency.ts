import { PRODUCT_CURRENCIES, currencySymbol } from '@crm/contracts';

/** English names of the 21 currencies the storefront offers (WaDesk's list and order). */
const NAMES: Record<(typeof PRODUCT_CURRENCIES)[number], string> = {
  INR: 'Indian Rupee',
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  AED: 'UAE Dirham',
  KES: 'Kenyan Shilling',
  NGN: 'Nigerian Naira',
  ZAR: 'South African Rand',
  BRL: 'Brazilian Real',
  MXN: 'Mexican Peso',
  CRC: 'Costa Rican Colón',
  PHP: 'Philippine Peso',
  IDR: 'Indonesian Rupiah',
  SGD: 'Singapore Dollar',
  MYR: 'Malaysian Ringgit',
  THB: 'Thai Baht',
  VND: 'Vietnamese Đồng',
  EGP: 'Egyptian Pound',
  PKR: 'Pakistani Rupee',
  BDT: 'Bangladeshi Taka',
  LKR: 'Sri Lankan Rupee',
};

/** "₹ INR · Indian Rupee", the label of one currency option. */
export const CURRENCY_OPTIONS = PRODUCT_CURRENCIES.map((code) => ({
  code,
  label: `${currencySymbol(code)} ${code} · ${NAMES[code]}`,
}));
