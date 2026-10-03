import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * The platform currency catalogue (TW-CPN-018..025). Global to the platform. `exchangeRate` means "units of this currency per
 * one USD" (the Reference UI and math; its model comment says the opposite). Rates are decimal strings with six decimals.
 */

export const CURRENCY_PAGE_SIZE = 12;

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

/** ISO 4217 shape. Reference accepted any ten characters; a three-letter code is what every gateway and money helper expects. */
export const currencyCatalogCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use a three-letter ISO code such as USD.');

export const exchangeRateSchema = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,6})?$/, 'Enter a rate such as 83.25.')
  .refine((v) => Number(v) >= 0.000001, 'The rate must be at least 0.000001.');

const currencyFieldsShape = {
  name: z.string().trim().min(1).max(120),
  code: currencyCatalogCodeSchema,
  symbol: z.preprocess(blankToNull, z.string().trim().max(20).nullable()).default(null),
  precision: z.number().int().min(0).max(6).default(2),
  exchangeRate: exchangeRateSchema.default('1'),
  isActive: z.boolean().default(true),
};

export const createCurrencyRequestSchema = z.object(currencyFieldsShape);
export type CreateCurrencyRequest = z.input<typeof createCurrencyRequestSchema>;
export type CreateCurrencyPayload = z.output<typeof createCurrencyRequestSchema>;

/** The code never changes once a currency exists: plans, orders and packages name it. */
export const updateCurrencyRequestSchema = z
  .object({
    name: currencyFieldsShape.name,
    symbol: currencyFieldsShape.symbol,
    precision: currencyFieldsShape.precision,
    exchangeRate: currencyFieldsShape.exchangeRate,
    isActive: currencyFieldsShape.isActive,
  })
  .partial()
  .extend({ rowVersion: z.number().int().positive() });
export type UpdateCurrencyRequest = z.input<typeof updateCurrencyRequestSchema>;
export type UpdateCurrencyPayload = z.output<typeof updateCurrencyRequestSchema>;

export const setCurrencyActiveRequestSchema = z.object({ isActive: z.boolean() });
export type SetCurrencyActiveRequest = z.infer<typeof setCurrencyActiveRequestSchema>;

export const setDefaultCurrencyRequestSchema = z.object({ code: currencyCatalogCodeSchema });
export type SetDefaultCurrencyRequest = z.infer<typeof setDefaultCurrencyRequestSchema>;

export const currencyListQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
  page: z.coerce.number().int().min(1).max(100_000).catch(1).default(1),
});
export type CurrencyListQuery = z.infer<typeof currencyListQuerySchema>;

export const currencyItemSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: z.string(),
  symbol: z.string().nullable(),
  precision: z.number().int(),
  exchangeRate: z.string(),
  isActive: z.boolean(),
  isDefault: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  rowVersion: z.number().int(),
});
export type CurrencyItem = z.infer<typeof currencyItemSchema>;

const count = z.number().int().nonnegative();

export const currencyListResponseSchema = z.object({
  data: z.array(currencyItemSchema),
  /** The four KPI cards. `defaultCode` is the platform default (USD until one is set). */
  summary: z.object({ total: count, active: count, inactive: count, defaultCode: z.string() }),
  /** Every ACTIVE currency, for the "System default" selector. */
  defaultChoices: z.array(
    z.object({ code: z.string(), name: z.string(), symbol: z.string().nullable() }),
  ),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: count,
  pageCount: count,
  from: count,
  to: count,
});
export type CurrencyListResponse = z.infer<typeof currencyListResponseSchema>;

export const setDefaultCurrencyResponseSchema = z.object({ defaultCode: z.string() });

export const fetchRatesResponseSchema = z.object({
  /** How many catalog currencies had their rate replaced. */
  updated: count,
  provider: z.string(),
});
export type FetchRatesResponse = z.infer<typeof fetchRatesResponseSchema>;

/** Reference's starter set (TW-CPN-025): code, name, symbol, decimals and the static rate per 1 USD. */
export const STARTER_CURRENCIES: ReadonlyArray<{
  code: string;
  name: string;
  symbol: string;
  precision: number;
  rate: string;
}> = [
  { code: 'USD', name: 'US Dollar', symbol: '$', precision: 2, rate: '1' },
  { code: 'EUR', name: 'Euro', symbol: '€', precision: 2, rate: '0.92' },
  { code: 'GBP', name: 'British Pound', symbol: '£', precision: 2, rate: '0.79' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', precision: 2, rate: '83.25' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', precision: 2, rate: '3.673' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼', precision: 2, rate: '3.75' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', precision: 2, rate: '1.36' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', precision: 2, rate: '1.53' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', precision: 0, rate: '149' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', precision: 2, rate: '7.25' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', precision: 2, rate: '7.82' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', precision: 2, rate: '1.35' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', precision: 2, rate: '4.70' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', precision: 0, rate: '15700' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿', precision: 2, rate: '36.2' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱', precision: 2, rate: '56.5' },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫', precision: 0, rate: '24500' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', precision: 0, rate: '1350' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺', precision: 2, rate: '32.5' },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£', precision: 2, rate: '47.5' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', precision: 2, rate: '18.5' },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', precision: 2, rate: '1600' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', precision: 2, rate: '129' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', precision: 2, rate: '5.10' },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$', precision: 2, rate: '17.3' },
  { code: 'ARS', name: 'Argentine Peso', symbol: 'AR$', precision: 2, rate: '950' },
  { code: 'CLP', name: 'Chilean Peso', symbol: 'CLP$', precision: 0, rate: '920' },
  { code: 'COP', name: 'Colombian Peso', symbol: 'CO$', precision: 0, rate: '4000' },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨', precision: 2, rate: '278' },
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳', precision: 2, rate: '110' },
];
