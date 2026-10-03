import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema, pageResponseSchema } from '../common/pagination';
import { queryBoolean } from '../contacts-attributes-tags/query-helpers';
import { waString, waTag } from './text';

/**
 * Products (TW-CAT-019..026). Reference kept the money of a product in `price_minor`, always the major amount times 100 whatever
 * the currency; the same convention is kept here (the API answers both `priceMinor` and the readable `priceMajor`).
 */

/** The 21 currencies the product form offers (Reference validation list, same order). */
export const PRODUCT_CURRENCIES = [
  'INR',
  'USD',
  'EUR',
  'GBP',
  'AED',
  'KES',
  'NGN',
  'ZAR',
  'BRL',
  'MXN',
  'CRC',
  'PHP',
  'IDR',
  'SGD',
  'MYR',
  'THB',
  'VND',
  'EGP',
  'PKR',
  'BDT',
  'LKR',
] as const;
export const productCurrencySchema = z.enum(PRODUCT_CURRENCIES);
export type ProductCurrency = z.infer<typeof productCurrencySchema>;

const CURRENCY_SYMBOLS: Record<string, string> = {
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

/** The symbol of a currency; an unknown code is shown as itself so nothing renders blank. */
export function currencySymbol(code: string | null | undefined): string {
  return CURRENCY_SYMBOLS[code ?? ''] ?? code ?? '';
}

/**
 * "₹ 1,299" or "₹ 1,299.50": the symbol, a space, the major amount grouped with commas, two decimals only when the amount has
 * a fraction (Reference `formatCurrency`). `minor` is the price times 100.
 */
export function formatProductMoney(minor: number, code: string | null | undefined): string {
  const major = minor / 100;
  const whole = Number.isInteger(major);
  const text = major.toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
  return `${currencySymbol(code)} ${text}`;
}

export const PRODUCT_STATUSES = ['active', 'draft', 'archived'] as const;
export const productStatusSchema = z.enum(PRODUCT_STATUSES);
export type ProductStatus = z.infer<typeof productStatusSchema>;

export const PRODUCT_AVAILABILITIES = [
  'in stock',
  'out of stock',
  'available for order',
  'discontinued',
] as const;
export const productAvailabilitySchema = z.enum(PRODUCT_AVAILABILITIES);

export const PRODUCT_CONDITIONS = ['new', 'refurbished', 'used'] as const;
export const productConditionSchema = z.enum(PRODUCT_CONDITIONS);

/** The sync state of a product against the Meta catalog; null/absent means it was never pushed. */
export const META_SYNC_STATUSES = ['pending', 'synced', 'failed', 'error'] as const;

export const PRODUCT_NAME_MAX = 191;
export const PRODUCT_SKU_MAX = 96;
/** The tags box takes 1024 characters in all; one tag may use them all (Reference keeps what the box holds). */
export const PRODUCT_TAGS_MAX = 1024;
export const PRODUCT_DESCRIPTION_MAX = 2000;
export const PRODUCT_BODY_HTML_MAX = 65535;
export const PRODUCT_PRICE_MAX = 1_000_000;
export const PRODUCT_GALLERY_MAX = 12;
export const PRODUCTS_PAGE_SIZE = 25;
export const PRODUCT_PICKER_LIMIT = 120;

export const productResponseSchema = z.object({
  id: uuidSchema,
  sku: z.string().nullable(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  bodyHtml: z.string().nullable(),
  priceMinor: z.number().int(),
  /** `priceMinor / 100` as a plain decimal string ("1299" or "1299.5"), what the form shows back. */
  priceMajor: z.string(),
  priceDisplay: z.string(),
  comparePriceMinor: z.number().int().nullable(),
  comparePriceMajor: z.string().nullable(),
  comparePriceDisplay: z.string().nullable(),
  /** Compare price above the price. */
  onSale: z.boolean(),
  currencyCode: z.string(),
  imageUrl: z.string().nullable(),
  galleryUrls: z.array(z.string()),
  inStock: z.boolean(),
  /** Null means unlimited. */
  stockQty: z.number().int().nullable(),
  reservedQty: z.number().int(),
  /** `stockQty - reservedQty`, never below 0; null when stock is unlimited. */
  availableQty: z.number().int().nullable(),
  sortOrder: z.number().int(),
  status: productStatusSchema,
  weightGrams: z.number().int().nullable(),
  category: z.string().nullable(),
  tags: z.array(z.string()),
  aliases: z.array(z.string()),
  availability: z.string(),
  /** What Meta is told: the stored availability, else derived from status and stock. */
  effectiveAvailability: z.string(),
  condition: z.string(),
  brand: z.string().nullable(),
  productUrl: z.string().nullable(),
  googleProductCategory: z.string().nullable(),
  storefrontId: uuidSchema.nullable(),
  /** The id the product has on Meta and in a WhatsApp message: the stored one, else the SKU, else `wsn-<n>`. */
  retailerId: z.string(),
  metaRetailerId: z.string().nullable(),
  metaSyncStatus: z.string().nullable(),
  metaSyncedAt: z.string().datetime().nullable(),
  metaLastError: z.string().nullable(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProductResponse = z.infer<typeof productResponseSchema>;

/** "1299", "1299.5", "1299.50": a major amount as typed; rounded to the minor unit on the server like Reference. */
const majorAmount = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d+(\.\d+)?$/, 'Enter a number'))
  .refine((v) => Number(v) <= PRODUCT_PRICE_MAX, `At most ${PRODUCT_PRICE_MAX}`);

const optionalUrl = z.string().trim().url().max(1024);

/** A product as the form sends it (create and update share the fields). */
export const productFieldsSchema = z.object({
  name: waString(PRODUCT_NAME_MAX, 1),
  sku: waString(PRODUCT_SKU_MAX).nullish(),
  description: waString(PRODUCT_DESCRIPTION_MAX).nullish(),
  bodyHtml: waString(PRODUCT_BODY_HTML_MAX).nullish(),
  priceMajor: majorAmount,
  comparePriceMajor: majorAmount.nullish(),
  currencyCode: productCurrencySchema,
  inStock: z.boolean().default(true),
  stockQty: z.number().int().min(0).max(1_000_000).nullish(),
  sortOrder: z.number().int().min(0).max(9999).nullish(),
  status: productStatusSchema.default('active'),
  weightGrams: z.number().int().min(0).max(1_000_000).nullish(),
  category: waString(96).nullish(),
  /** Free tags; trimmed, de-duplicated, blanks dropped by the server. A tag may be as long as the whole tags box (1024). */
  tags: z.array(waTag(PRODUCT_TAGS_MAX)).max(512).default([]),
  /** Other names the order-text matcher knows the product by (TW-CAT-032); absent keeps what is stored. */
  aliases: z.array(z.string().trim().max(120)).max(50).optional(),
  imageUrl: optionalUrl.nullish(),
  galleryUrls: z
    .array(optionalUrl.or(z.literal('')))
    .max(PRODUCT_GALLERY_MAX)
    .default([]),
});

export const createProductSchema = productFieldsSchema;
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = productFieldsSchema.extend({
  rowVersion: z.number().int().min(1),
});
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const listProductsQuerySchema = paginationQuerySchema.omit({ order: true }).extend({
  limit: z.coerce.number().int().min(1).max(100).default(PRODUCTS_PAGE_SIZE),
  /** Case-insensitive substring of the name or the SKU. */
  q: z.string().trim().min(1).max(100).optional(),
  includeTotal: queryBoolean().default(false),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

export const listProductsResponseSchema = pageResponseSchema(productResponseSchema).extend({
  meta: z.object({ total: z.number().int() }).optional(),
});
export type ListProductsResponse = z.infer<typeof listProductsResponseSchema>;

/** The product picker used by the inbox, the chat and the send tab: active and in stock only. */
export const productPickerItemSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  sku: z.string().nullable(),
  imageUrl: z.string().nullable(),
  category: z.string().nullable(),
  priceMinor: z.number().int(),
  priceDisplay: z.string(),
  currency: z.string(),
  retailerId: z.string(),
  synced: z.boolean(),
  storefrontId: uuidSchema.nullable(),
});
export type ProductPickerItem = z.infer<typeof productPickerItemSchema>;

export const productPickerQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  shopId: uuidSchema.optional(),
});
export type ProductPickerQuery = z.infer<typeof productPickerQuerySchema>;
export const productPickerResponseSchema = z.object({ products: z.array(productPickerItemSchema) });
export type ProductPickerResponse = z.infer<typeof productPickerResponseSchema>;

export const productShareLinksSchema = z.object({
  /** The storefront page of the product; null when the workspace has no shop yet. */
  publicUrl: z.string().nullable(),
  /** `wa.me` link with a ready order text; null when no sender number is known. */
  waLink: z.string().nullable(),
  product: z.object({ id: uuidSchema, name: z.string(), image: z.string().nullable() }),
});
export type ProductShareLinks = z.infer<typeof productShareLinksSchema>;

export const sendProductSchema = z.object({
  phone: z.string().trim().min(1).max(32),
});
export type SendProductInput = z.infer<typeof sendProductSchema>;
export const sendProductResponseSchema = z.object({ message: z.string() });
export type SendProductResponse = z.infer<typeof sendProductResponseSchema>;
