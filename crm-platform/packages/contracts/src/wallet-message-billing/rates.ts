import { z } from 'zod';
import { WALLET_LIMITS } from './money';

/** The four categories Meta prices a message by (TW-WALLET-004). Blank = "any category". */
export const WALLET_CATEGORIES = ['marketing', 'utility', 'authentication', 'service'] as const;
export type WalletCategory = (typeof WALLET_CATEGORIES)[number];

/** Anything outside the four becomes "" (matches an any-category row), exactly as Reference's resolver did. */
export function normalizeWalletCategory(raw: string | null | undefined): '' | WalletCategory {
  const c = (raw ?? '').trim().toLowerCase();
  return (WALLET_CATEGORIES as readonly string[]).includes(c) ? (c as WalletCategory) : '';
}

/** ISO alpha-2 upper-case or "" (any country). */
export function normalizeWalletCountry(raw: string | null | undefined): string {
  const c = (raw ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : '';
}

export const rateCategorySchema = z.enum(['', ...WALLET_CATEGORIES]);

/** One row of the per-country x category rate card as the grid shows it. */
export const rateRowSchema = z.object({
  id: z.string().uuid(),
  countryCode: z.string(),
  /** Display name of the country; empty for the any-country row. */
  countryName: z.string(),
  category: rateCategorySchema,
  /** What the customer is charged per message, hundredths of the currency unit. */
  priceMinor: z.number().int().nonnegative(),
  /** What Meta charges the platform, as a decimal string with up to 6 decimals; null = unknown. */
  metaCost: z.string().nullable(),
  /** Customer price minus Meta cost, hundredths, when both are known. */
  marginMinor: z.number().nullable(),
  currency: z.string().nullable(),
  isActive: z.boolean(),
  rowVersion: z.number().int(),
  updatedAt: z.string(),
});
export type RateRow = z.infer<typeof rateRowSchema>;

export const ratesResponseSchema = z.object({
  currency: z.string(),
  perCountryEnabled: z.boolean(),
  data: z.array(rateRowSchema),
  /** Every country the picker offers (ISO code and name), so the grid can add any of them. */
  countries: z.array(z.object({ code: z.string(), name: z.string() })),
});
export type RatesResponse = z.infer<typeof ratesResponseSchema>;

/**
 * Saving one grid row (TW-WALLET-005). The shape is checked here; whether the text is a price, a cost or a country is decided by the
 * server row by row, so one bad row is reported with its reason instead of failing the whole save (Reference skipped it silently).
 * A blank price leaves the stored price untouched; a row with neither a price nor a cost is skipped.
 */
export const upsertRateSchema = z.object({
  countryCode: z.string().trim().max(8).default(''),
  category: rateCategorySchema.default(''),
  price: z.string().trim().max(20).optional(),
  metaCost: z.string().trim().max(20).optional(),
  currency: z.string().trim().toUpperCase().max(8).optional(),
});
export type UpsertRateInput = z.infer<typeof upsertRateSchema>;

export const saveRatesSchema = z.object({
  rows: z.array(upsertRateSchema).min(1).max(500),
});
export type SaveRatesInput = z.infer<typeof saveRatesSchema>;

export const saveRatesResultSchema = z.object({
  saved: z.number().int(),
  /** Per input row (same order): null when saved, otherwise why it was skipped. */
  skipped: z.array(z.object({ index: z.number().int(), reason: z.string() })),
});
export type SaveRatesResult = z.infer<typeof saveRatesResultSchema>;

export const importRatesSchema = z.object({
  /** The file's text. At most 4 MB, the limit Reference put on the upload. */
  csv: z
    .string()
    .min(1)
    .max(4 * 1024 * 1024),
  /** True reads the file and reports what would change without writing anything. */
  dryRun: z.boolean().default(false),
});
export type ImportRatesInput = z.infer<typeof importRatesSchema>;

export const importRatesResultSchema = z.object({
  dryRun: z.boolean(),
  shape: z.enum(['wide', 'long']),
  added: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  currency: z.string(),
  /** The first rows that were skipped and why, so a bad file can be fixed. */
  problems: z.array(z.object({ line: z.number().int(), reason: z.string() })),
});
export type ImportRatesResult = z.infer<typeof importRatesResultSchema>;

export const syncMetaSchema = z.object({ dryRun: z.boolean().default(false) });
export type SyncMetaInput = z.infer<typeof syncMetaSchema>;

export const syncMetaResultSchema = z.object({
  dryRun: z.boolean(),
  source: z.enum(['live', 'card', 'bundled']),
  sourceLabel: z.string(),
  version: z.string().nullable(),
  currency: z.string(),
  added: z.number().int(),
  updated: z.number().int(),
});
export type SyncMetaResult = z.infer<typeof syncMetaResultSchema>;

export const seedRatesResultSchema = z.object({ upserted: z.number().int() });

export const deleteRateResultSchema = z.object({ deleted: z.boolean() });

/** The customer's price panel (TW-WALLET-024). */
export const messagePricingSchema = z.object({
  /** Whether the panel is shown at all: only a workspace that pays per message sees prices. */
  billingMode: z.enum(['wallet', 'plan']),
  perCountryEnabled: z.boolean(),
  currency: z.string(),
  /** The base price of each category for the selected country (or any country), hundredths. */
  categories: z.array(
    z.object({
      category: z.enum(WALLET_CATEGORIES),
      priceMinor: z.number().int(),
      free: z.boolean(),
    }),
  ),
  country: z.string().nullable(),
});
export type MessagePricing = z.infer<typeof messagePricingSchema>;

export const messagePricingQuerySchema = z.object({
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .optional(),
});

export { WALLET_LIMITS };
