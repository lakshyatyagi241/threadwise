import { z } from 'zod';
import { uuidSchema } from '../common/ids';

export const SALES_ITEM_KINDS = ['product', 'service'] as const;
export const salesItemKindSchema = z.enum(SALES_ITEM_KINDS);
export type SalesItemKind = z.infer<typeof salesItemKindSchema>;

export const SALES_ITEM_NAME_MAX = 191;
export const SALES_ITEM_SKU_MAX = 64;
export const SALES_ITEM_UNIT_MAX = 24;
export const SALES_ITEM_DESCRIPTION_MAX = 2000;
/** The largest unit price, in minor units (a hundred billion major units is far beyond any real price and well inside a safe integer). */
export const SALES_ITEM_PRICE_MAX_MINOR = 99_999_999_999_999;

/** A short text a person typed: trimmed, and empty means "none". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const taxRateSchema = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === 'number' ? v : Number(v.trim())))
  .refine((n) => Number.isFinite(n) && n >= 0 && n <= 100, 'a percentage from 0 to 100')
  .nullable()
  .optional();

const priceShape = {
  unitPriceMinor: z.number().int().min(0).max(SALES_ITEM_PRICE_MAX_MINOR),
  currency: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{3}$/, 'a three-letter currency code')),
};

export const salesItemSchema = z.object({
  id: uuidSchema,
  kind: salesItemKindSchema,
  name: z.string(),
  sku: z.string().nullable(),
  description: z.string().nullable(),
  unit: z.string().nullable(),
  unitPriceMinor: z.number().int(),
  currency: z.string(),
  /** The tax a new line starts with, in percent; null when none. */
  taxRatePercent: z.number().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  rowVersion: z.number().int(),
});
export type SalesItem = z.infer<typeof salesItemSchema>;

export const createSalesItemSchema = z.object({
  kind: salesItemKindSchema.default('product'),
  name: z.string().trim().min(1).max(SALES_ITEM_NAME_MAX),
  sku: optionalText(SALES_ITEM_SKU_MAX),
  description: optionalText(SALES_ITEM_DESCRIPTION_MAX),
  unit: optionalText(SALES_ITEM_UNIT_MAX),
  taxRatePercent: taxRateSchema,
  isActive: z.boolean().default(true),
  ...priceShape,
});
export type CreateSalesItemInput = z.infer<typeof createSalesItemSchema>;

/** A change: any field, and the `rowVersion` that was read (409 when the item changed since). */
export const updateSalesItemSchema = z
  .object({
    kind: salesItemKindSchema,
    name: z.string().trim().min(1).max(SALES_ITEM_NAME_MAX),
    sku: optionalText(SALES_ITEM_SKU_MAX),
    description: optionalText(SALES_ITEM_DESCRIPTION_MAX),
    unit: optionalText(SALES_ITEM_UNIT_MAX),
    taxRatePercent: taxRateSchema,
    isActive: z.boolean(),
    ...priceShape,
  })
  .partial()
  .extend({ rowVersion: z.number().int().min(1) });
export type UpdateSalesItemInput = z.infer<typeof updateSalesItemSchema>;

export const listSalesItemsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Part of the name or the SKU, without regard to case. */
  q: z.string().trim().max(100).optional(),
  kind: salesItemKindSchema.optional(),
  status: z.enum(['active', 'inactive', 'all']).default('all'),
});
export type ListSalesItemsQuery = z.infer<typeof listSalesItemsQuerySchema>;

export const listSalesItemsResponseSchema = z.object({
  data: z.array(salesItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
  /** Counts over the whole price list, whatever the filters, for the tabs. */
  counts: z.object({ all: z.number().int(), active: z.number().int(), inactive: z.number().int() }),
});
export type ListSalesItemsResponse = z.infer<typeof listSalesItemsResponseSchema>;
