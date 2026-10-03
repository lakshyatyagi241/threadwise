import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Credit packages (WD-CPN-009..013): curated "this price buys this many credits" bundles. Global to the platform, edited
 * by operators. The price is typed in major units and stored as integer minor units of the package currency, using that
 * currency's own number of decimals (WaDesk always multiplied by 100: see the parity doc).
 */

export const CREDIT_PACKAGE_PRICE_MAX_MAJOR = 10_000_000;
export const CREDIT_PACKAGE_CREDITS_MAX = 100_000_000;
export const CREDIT_PACKAGE_SORT_MAX = 9999;

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable());

/** alpha_dash, as WaDesk validated it: letters, digits, dash and underscore. */
export const creditPackageSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(96)
  .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, dashes and underscores only.');

const creditPackageFieldsShape = {
  name: z.string().trim().min(1).max(96),
  /** Blank = derived from the name (slugified, `-2`, `-3`... until unique). */
  slug: z.preprocess(blankToNull, creditPackageSlugSchema.nullable()).default(null),
  /** Major units, as typed: "499.50". */
  price: z
    .string()
    .trim()
    .regex(/^\d{1,8}(\.\d{1,4})?$/, 'Enter an amount such as 100 or 499.50.')
    .refine((v) => Number(v) <= CREDIT_PACKAGE_PRICE_MAX_MAJOR, 'The price is too large.'),
  currencyCode: z
    .string()
    .trim()
    .length(3)
    .transform((v) => v.toUpperCase()),
  credits: z.number().int().min(1).max(CREDIT_PACKAGE_CREDITS_MAX),
  badge: optionalText(32).default(null),
  description: optionalText(500).default(null),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(CREDIT_PACKAGE_SORT_MAX).default(0),
};

export const createCreditPackageRequestSchema = z.object(creditPackageFieldsShape);
export type CreateCreditPackageRequest = z.input<typeof createCreditPackageRequestSchema>;
export type CreateCreditPackagePayload = z.output<typeof createCreditPackageRequestSchema>;

export const updateCreditPackageRequestSchema = z
  .object(creditPackageFieldsShape)
  .partial()
  .extend({ rowVersion: z.number().int().positive() });
export type UpdateCreditPackageRequest = z.input<typeof updateCreditPackageRequestSchema>;
export type UpdateCreditPackagePayload = z.output<typeof updateCreditPackageRequestSchema>;

export const setCreditPackageActiveRequestSchema = z.object({
  isActive: z.boolean(),
  rowVersion: z.number().int().positive().optional(),
});
export type SetCreditPackageActiveRequest = z.infer<typeof setCreditPackageActiveRequestSchema>;

export const creditPackageItemSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  /** Major units with the currency's decimals: "499.50", "1500". */
  price: z.string(),
  priceMinor: z.number().int().nonnegative(),
  /** The price shown in the platform default currency, converted at the stored rates and formatted ("$6.00"). */
  priceDisplay: z.string(),
  currencyCode: z.string(),
  credits: z.number().int().positive(),
  /** Credits per one major unit of the package currency, one decimal ("55.0"); "0.0" for a free package. */
  creditsPerMajor: z.string(),
  badge: z.string().nullable(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  isFeatured: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  rowVersion: z.number().int(),
});
export type CreditPackageItem = z.infer<typeof creditPackageItemSchema>;

/** Every package in display order (`sort_order`, then id); no filters, no paging, as in WaDesk. */
export const creditPackageListResponseSchema = z.object({
  data: z.array(creditPackageItemSchema),
  /** The symbol (or code) of the platform default currency: the "Per $1" column header. */
  defaultSymbol: z.string(),
});
export type CreditPackageListResponse = z.infer<typeof creditPackageListResponseSchema>;

/** The slug WaDesk would derive from a name: lowercase words joined by dashes, `package` when nothing is left. */
export function slugifyPackageName(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'package';
}
