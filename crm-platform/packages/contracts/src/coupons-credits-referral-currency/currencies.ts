import { z } from 'zod';
import { cursorSchema, pageInfoSchema } from '../common/pagination';
import { uuidSchema } from '../common/ids';

/**
 * The currency catalog (TW-CPN-018..024). `exchangeRate` is units of that currency per ONE US dollar (the UI and the arithmetic
 * agree on this; Reference's model comment says the opposite). Rates are decimal strings with at most 6 decimals.
 */
export const CURRENCY_LIMITS = { pageSize: 12, nameMax: 120, codeMax: 10, symbolMax: 20 } as const;

export const currencyItemSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  code: z.string(),
  symbol: z.string().nullable(),
  precision: z.number().int().min(0).max(6),
  exchangeRate: z.string(),
  isActive: z.boolean(),
  /** This is the platform default currency. */
  isDefault: z.boolean(),
  rowVersion: z.number().int(),
  updatedAt: z.string(),
});
export type CurrencyItem = z.infer<typeof currencyItemSchema>;

export const listCurrenciesQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(CURRENCY_LIMITS.pageSize),
  cursor: cursorSchema.optional(),
});
export type ListCurrenciesQuery = z.infer<typeof listCurrenciesQuerySchema>;

export const currencyOptionSchema = z.object({
  code: z.string(),
  name: z.string(),
  symbol: z.string().nullable(),
});
export type CurrencyOption = z.infer<typeof currencyOptionSchema>;

export const currencyListResponseSchema = z.object({
  data: z.array(currencyItemSchema),
  page: pageInfoSchema,
  /** Rows matching the search, over every page. */
  total: z.number().int(),
  stats: z.object({
    total: z.number().int(),
    active: z.number().int(),
    inactive: z.number().int(),
    /** The platform default's code ("USD" when nothing is saved). */
    defaultCode: z.string(),
  }),
  /** Every ACTIVE currency, for the default selector (not narrowed by search or page). */
  activeOptions: z.array(currencyOptionSchema),
});
export type CurrencyListResponse = z.infer<typeof currencyListResponseSchema>;

const rate = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,6})?$/, 'Enter a number such as 83.25')
  .refine((v) => Number(v) >= 0.000001, 'The rate must be at least 0.000001');

export const createCurrencyRequestSchema = z.object({
  name: z.string().trim().min(1).max(CURRENCY_LIMITS.nameMax),
  /** Letters (and digits for crypto tickers), upper-cased on save. */
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Use the 3-letter ISO code, e.g. CHF'),
  symbol: z
    .string()
    .trim()
    .max(CURRENCY_LIMITS.symbolMax)
    .optional()
    .transform((v) => (v ? v : null)),
  precision: z.number().int().min(0).max(6).default(2),
  exchangeRate: rate.default('1'),
  isActive: z.boolean().default(true),
});
export type CreateCurrencyRequest = z.infer<typeof createCurrencyRequestSchema>;

/** The code never changes once saved (everything priced in it would be orphaned, TW-CPN-020 rule 1). */
export const updateCurrencyRequestSchema = z.object({
  name: z.string().trim().min(1).max(CURRENCY_LIMITS.nameMax).optional(),
  symbol: z
    .union([z.string().trim().max(CURRENCY_LIMITS.symbolMax), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v)),
  precision: z.number().int().min(0).max(6).optional(),
  exchangeRate: rate.optional(),
  isActive: z.boolean().optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateCurrencyRequest = z.infer<typeof updateCurrencyRequestSchema>;

export const setCurrencyActiveRequestSchema = z.object({ value: z.boolean() });
export type SetCurrencyActiveRequest = z.infer<typeof setCurrencyActiveRequestSchema>;

export const setDefaultCurrencyRequestSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(CURRENCY_LIMITS.codeMax),
});
export type SetDefaultCurrencyRequest = z.infer<typeof setDefaultCurrencyRequestSchema>;

export const fetchRatesResponseSchema = z.object({
  /** How many catalog currencies the provider had a rate for. */
  updated: z.number().int(),
  provider: z.string(),
});
export type FetchRatesResponse = z.infer<typeof fetchRatesResponseSchema>;

/** A workspace's display currency (TW-CPN-027): null = follow the platform default. */
export const workspaceCurrencyResponseSchema = z.object({
  currency: z.string().nullable(),
  /** What money is shown in: the workspace's own, else the platform default. */
  effective: z.string(),
  platformDefault: z.string(),
  options: z.array(currencyOptionSchema),
});
export type WorkspaceCurrencyResponse = z.infer<typeof workspaceCurrencyResponseSchema>;

export const setWorkspaceCurrencyRequestSchema = z.object({
  currency: z
    .union([z.string().trim().toUpperCase().max(CURRENCY_LIMITS.codeMax), z.null()])
    .transform((v) => (v === '' ? null : v)),
});
export type SetWorkspaceCurrencyRequest = z.infer<typeof setWorkspaceCurrencyRequestSchema>;
