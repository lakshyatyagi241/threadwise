import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { waString } from './text';

/**
 * Product variants: a product sells in more than one form (Size XS..XL, Colour, Material, Pack size, anything a store has).
 * Reference has no variants; this is an owner-approved extension (docs/threadwise-port/parity/catalog-products.md).
 *
 * A product names up to 3 options with their values; every sellable combination is one variant with its own SKU, optional
 * price, stock and image. A product with variants keeps its own `priceMinor` (lowest variant price) and `stockQty` (sum of the
 * variants, null when any variant is unlimited) as the aggregate every older reader keeps using.
 */

export const PRODUCT_OPTIONS_MAX = 3;
export const PRODUCT_OPTION_VALUES_MAX = 50;
export const PRODUCT_VARIANTS_MAX = 100;
export const OPTION_NAME_MAX = 40;
export const OPTION_VALUE_MAX = 60;

export const productOptionSchema = z.object({
  name: waString(OPTION_NAME_MAX, 1),
  values: z.array(waString(OPTION_VALUE_MAX, 1)).min(1).max(PRODUCT_OPTION_VALUES_MAX),
});
export type ProductOption = z.infer<typeof productOptionSchema>;

/** "1299", "1299.5": a major amount as typed, like the product form. */
const optionalMajor = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d+(\.\d+)?$/, 'Enter a number'))
  .refine((v) => Number(v) <= 1_000_000, 'At most 1000000');

/** One variant as the form sends it. `id` present = keep and update that variant; absent = a new one. */
export const productVariantInputSchema = z.object({
  id: uuidSchema.optional(),
  /** One value per product option, in option order. */
  optionValues: z.array(waString(OPTION_VALUE_MAX, 1)).min(1).max(PRODUCT_OPTIONS_MAX),
  sku: waString(96).nullish(),
  /** Absent or null: the variant sells at the product price. */
  priceMajor: optionalMajor.nullish(),
  comparePriceMajor: optionalMajor.nullish(),
  imageUrl: z.string().trim().url().max(1024).nullish(),
  weightGrams: z.number().int().min(0).max(1_000_000).nullish(),
  /** Null or absent means unlimited. */
  stockQty: z.number().int().min(0).max(1_000_000).nullish(),
  /** An inactive variant is kept but cannot be bought. */
  active: z.boolean().default(true),
});
export type ProductVariantInput = z.infer<typeof productVariantInputSchema>;

/** The option and variant part of the create/update body. Both absent keeps what is stored; `options: []` removes all variants. */
export const productVariantsFieldsSchema = z
  .object({
    options: z.array(productOptionSchema).max(PRODUCT_OPTIONS_MAX).optional(),
    variants: z.array(productVariantInputSchema).max(PRODUCT_VARIANTS_MAX).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.options) {
      if (v.variants && v.variants.length > 0)
        ctx.addIssue({ code: 'custom', path: ['options'], message: 'Variants need options' });
      return;
    }
    const names = new Set<string>();
    v.options.forEach((o, i) => {
      const key = o.name.toLowerCase();
      if (names.has(key))
        ctx.addIssue({
          code: 'custom',
          path: ['options', i, 'name'],
          message: 'Duplicate option name',
        });
      names.add(key);
      const values = new Set<string>();
      o.values.forEach((val, j) => {
        const k = val.toLowerCase();
        if (values.has(k))
          ctx.addIssue({
            code: 'custom',
            path: ['options', i, 'values', j],
            message: 'Duplicate option value',
          });
        values.add(k);
      });
    });
    const combos = new Set<string>();
    (v.variants ?? []).forEach((variant, i) => {
      if (variant.optionValues.length !== v.options!.length)
        ctx.addIssue({
          code: 'custom',
          path: ['variants', i, 'optionValues'],
          message: 'One value per option',
        });
      variant.optionValues.forEach((val, k) => {
        if (v.options![k] && !v.options![k]!.values.includes(val))
          ctx.addIssue({
            code: 'custom',
            path: ['variants', i, 'optionValues', k],
            message: 'Not a value of this option',
          });
      });
      const key = variant.optionValues.map((s) => s.toLowerCase()).join('\u0000');
      if (combos.has(key))
        ctx.addIssue({ code: 'custom', path: ['variants', i], message: 'Duplicate variant' });
      combos.add(key);
    });
    if (v.options.length > 0 && (v.variants ?? []).length === 0 && v.variants !== undefined)
      ctx.addIssue({ code: 'custom', path: ['variants'], message: 'Add at least one variant' });
  });

export const productVariantResponseSchema = z.object({
  id: uuidSchema,
  optionValues: z.array(z.string()),
  /** "M / Red". */
  title: z.string(),
  sku: z.string().nullable(),
  /** The variant's own price; the product price when the variant has none. Always set. */
  priceMinor: z.number().int(),
  priceMajor: z.string(),
  priceDisplay: z.string(),
  /** The override as typed (null = follows the product). */
  priceOverrideMajor: z.string().nullable(),
  comparePriceMinor: z.number().int().nullable(),
  comparePriceMajor: z.string().nullable(),
  comparePriceDisplay: z.string().nullable(),
  imageUrl: z.string().nullable(),
  weightGrams: z.number().int().nullable(),
  stockQty: z.number().int().nullable(),
  reservedQty: z.number().int(),
  availableQty: z.number().int().nullable(),
  active: z.boolean(),
  position: z.number().int(),
  /** The id the variant has on Meta and in a WhatsApp message: stored one, else the SKU, else `<product retailer id>-<n>`. */
  retailerId: z.string(),
  rowVersion: z.number().int(),
});
export type ProductVariantResponse = z.infer<typeof productVariantResponseSchema>;

/** The part added to the product response. */
/** The response side of an option: plain strings, so the parsed type stays exact inside page schemas. */
const productOptionResponseSchema = z.object({ name: z.string(), values: z.array(z.string()) });

export const productVariantsResponseSchema = z.object({
  options: z.array(productOptionResponseSchema),
  variants: z.array(productVariantResponseSchema),
  hasVariants: z.boolean(),
});

/** Cartesian product of the option values, first option varying slowest ("XS/Red", "XS/Blue", "S/Red", ...). */
export function combineOptionValues(
  options: ReadonlyArray<{ values: readonly string[] }>,
): string[][] {
  if (options.length === 0) return [];
  return options.reduce<string[][]>(
    (acc, o) => acc.flatMap((prefix) => o.values.map((v) => [...prefix, v])),
    [[]],
  );
}

export const variantTitle = (optionValues: readonly string[]): string => optionValues.join(' / ');
