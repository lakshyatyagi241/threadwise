/**
 * Platform defaults of the coupons / credit packages / currencies domain (TW-CPN-025 and the installer's checkout defaults).
 * Data only: the installer (through the API's database connection) and the development seed (through `pg`) each write it with
 * their own client, always `ON CONFLICT DO NOTHING`, so running either twice never duplicates a row and never overwrites what an
 * operator edited (Reference's seeder reset every rate and re-activated every currency on each run).
 */

export interface SeedCurrency {
  code: string;
  name: string;
  symbol: string;
  precision: number;
  /** Units per 1 USD, a decimal string with up to 6 places. */
  rate: string;
}

/** The 30 common currencies Reference ships; rates are a static starting point the operator refreshes with "Fetch live rates". */
export const CPN_CURRENCIES: readonly SeedCurrency[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$', precision: 2, rate: '1.000000' },
  { code: 'EUR', name: 'Euro', symbol: '€', precision: 2, rate: '0.920000' },
  { code: 'GBP', name: 'British Pound', symbol: '£', precision: 2, rate: '0.790000' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', precision: 2, rate: '83.250000' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', precision: 2, rate: '3.673000' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼', precision: 2, rate: '3.750000' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', precision: 2, rate: '1.360000' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', precision: 2, rate: '1.530000' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', precision: 0, rate: '149.000000' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', precision: 2, rate: '7.250000' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', precision: 2, rate: '7.820000' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', precision: 2, rate: '1.350000' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', precision: 2, rate: '4.700000' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', precision: 0, rate: '15700.000000' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿', precision: 2, rate: '36.200000' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱', precision: 2, rate: '56.500000' },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫', precision: 0, rate: '24500.000000' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', precision: 0, rate: '1350.000000' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺', precision: 2, rate: '32.500000' },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£', precision: 2, rate: '47.500000' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', precision: 2, rate: '18.500000' },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', precision: 2, rate: '1600.000000' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', precision: 2, rate: '129.000000' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', precision: 2, rate: '5.100000' },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$', precision: 2, rate: '17.300000' },
  { code: 'ARS', name: 'Argentine Peso', symbol: 'AR$', precision: 2, rate: '950.000000' },
  { code: 'CLP', name: 'Chilean Peso', symbol: 'CLP$', precision: 0, rate: '920.000000' },
  { code: 'COP', name: 'Colombian Peso', symbol: 'CO$', precision: 0, rate: '4000.000000' },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨', precision: 2, rate: '278.000000' },
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳', precision: 2, rate: '110.000000' },
];

export interface SeedCoupon {
  code: string;
  description: string;
  type: 'percent' | 'fixed';
  amount: string;
}

/** The two coupons Reference's installer creates when the table is empty. */
export const CPN_DEMO_COUPONS: readonly SeedCoupon[] = [
  {
    code: 'WELCOME10',
    description: '10% off your first plan purchase',
    type: 'percent',
    amount: '10',
  },
  { code: 'SAVE20', description: '20% off any plan', type: 'percent', amount: '20' },
];

export interface SeedCreditPackage {
  name: string;
  slug: string;
  priceMinor: number;
  currencyCode: string;
  credits: number;
  badge: string | null;
  isFeatured: boolean;
  sortOrder: number;
}

/** The three bundles Reference's migration creates (price in hundredths of the currency). */
export const CPN_CREDIT_PACKAGES: readonly SeedCreditPackage[] = [
  {
    name: 'Starter',
    slug: 'starter',
    priceMinor: 10_000,
    currencyCode: 'INR',
    credits: 5_000,
    badge: null,
    isFeatured: false,
    sortOrder: 10,
  },
  {
    name: 'Growth',
    slug: 'growth',
    priceMinor: 50_000,
    currencyCode: 'INR',
    credits: 27_500,
    badge: 'Most popular',
    isFeatured: true,
    sortOrder: 20,
  },
  {
    name: 'Scale',
    slug: 'scale',
    priceMinor: 100_000,
    currencyCode: 'INR',
    credits: 60_000,
    badge: 'Best value',
    isFeatured: false,
    sortOrder: 30,
  },
];
