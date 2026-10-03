import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { productCurrencySchema } from '../catalog-products/product';

/**
 * The storefront of a workspace (TW-STORE-003..008, 022): the shop row, its settings and the shop wizard. Secrets (the
 * Razorpay key secret and webhook secret) are encrypted at rest and never come back: the response says only that one is set.
 */

/** The 8 themes (Reference keys and labels). The first is the default. */
export const STORE_THEMES = [
  { key: 'aurora', label: 'Aurora — minimal' },
  { key: 'meridian', label: 'Meridian — magazine' },
  { key: 'verdure', label: 'Verdure — organic' },
  { key: 'bazaar', label: 'Bazaar — colorful grid' },
  { key: 'noir', label: 'Noir — dark luxe' },
  { key: 'kraft', label: 'Kraft — handmade' },
  { key: 'mercato', label: 'Mercato — deli / cafe' },
  { key: 'studio', label: 'Studio — portfolio' },
] as const;
export const STORE_THEME_KEYS = STORE_THEMES.map((t) => t.key) as unknown as readonly [
  'aurora',
  'meridian',
  'verdure',
  'bazaar',
  'noir',
  'kraft',
  'mercato',
  'studio',
];
export const storeThemeSchema = z.enum(STORE_THEME_KEYS);
export type StoreTheme = z.infer<typeof storeThemeSchema>;
export const DEFAULT_STORE_THEME: StoreTheme = 'aurora';

/** How a buyer is told to pay. `razorpay_api` mints payment links with the merchant's own keys. */
export const PAYMENT_PROVIDERS = [
  'upi',
  'razorpay_link',
  'razorpay_api',
  'stripe_link',
  'paypal_me',
  'bank_transfer',
] as const;
export const paymentProviderSchema = z.enum(PAYMENT_PROVIDERS);
export type PaymentProvider = z.infer<typeof paymentProviderSchema>;

export const STORE_SLUG_MAX = 64;
export const STORE_BRAND_DEFAULT = '#075E54';

export const storefrontSettingsSchema = z.object({
  logoUrl: z.string().nullable(),
  brandColor: z.string().nullable(),
  heroText: z.string().nullable(),
  footerText: z.string().nullable(),
  cartRecoveryEnabled: z.boolean(),
  cartRecoveryDelayMin: z.number().int(),
  cartRecoveryMessage: z.string().nullable(),
});
export type StorefrontSettings = z.infer<typeof storefrontSettingsSchema>;

export const storefrontShippingSchema = z.object({
  /** Major units as a plain decimal string; empty when not set. */
  flat: z.string().nullable(),
  freeAbove: z.string().nullable(),
  note: z.string().nullable(),
});

export const storefrontResponseSchema = z.object({
  id: uuidSchema,
  shopName: z.string().nullable(),
  slug: z.string(),
  customDomain: z.string().nullable(),
  customDomainVerified: z.boolean(),
  themeKey: z.string(),
  enabled: z.boolean(),
  currencyCode: z.string(),
  deviceId: uuidSchema.nullable(),
  settings: storefrontSettingsSchema,
  shipping: storefrontShippingSchema,
  paymentProvider: z.string().nullable(),
  /** UPI id, payment-link URL, PayPal.me handle or bank text, when the provider is not the API one. */
  paymentHandle: z.string().nullable(),
  razorpay: z.object({
    keyId: z.string().nullable(),
    hasKeySecret: z.boolean(),
    hasWebhookSecret: z.boolean(),
  }),
  /** The address buyers use: the verified custom domain, else the subdomain host, else `/s/<slug>`. */
  publicUrl: z.string(),
  /** What a custom domain's CNAME must point at (shown before the first "Verify now"). */
  cnameTarget: z.string(),
  /** "+91 98…" of the bound device or the connected official number; null when nothing is connected. */
  sendingLabel: z.string().nullable(),
  /** A WhatsApp device is bound to the shop. */
  hasUsableConnection: z.boolean(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type StorefrontResponse = z.infer<typeof storefrontResponseSchema>;

const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d+(\.\d+)?$/, 'Enter a number'))
  .refine((v) => Number(v) <= 1_000_000, 'At most 1000000');

/** `PUT /store/storefront`: every field of the settings form. Blank optional fields arrive as null or absent. */
export const updateStorefrontSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(STORE_SLUG_MAX)
    .regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and dashes'),
  themeKey: storeThemeSchema,
  enabled: z.boolean().default(true),
  customDomain: z.string().trim().max(191).regex(DOMAIN_RE).nullish().or(z.literal('')),
  logoUrl: z.string().trim().url().max(1024).nullish().or(z.literal('')),
  brandColor: hexColor.nullish().or(z.literal('')),
  heroText: z.string().max(280).nullish(),
  footerText: z.string().max(280).nullish(),
  cartRecoveryEnabled: z.boolean().default(false),
  cartRecoveryDelayMin: z.number().int().min(5).max(1440).nullish(),
  cartRecoveryMessage: z.string().max(1024).nullish(),
  currencyCode: productCurrencySchema.nullish(),
  shippingFlat: money.nullish().or(z.literal('')),
  shippingFreeAbove: money.nullish().or(z.literal('')),
  shippingNote: z.string().max(160).nullish(),
  paymentProvider: paymentProviderSchema.nullish().or(z.literal('')),
  paymentHandle: z.string().max(255).nullish(),
  rzpKeyId: z.string().max(191).nullish(),
  rzpKeySecret: z.string().max(191).nullish(),
  rzpWebhookSecret: z.string().max(191).nullish(),
  rowVersion: z.number().int().min(1).optional(),
});
export type UpdateStorefrontInput = z.infer<typeof updateStorefrontSchema>;

export const verifyDomainResponseSchema = z.object({
  ok: z.boolean(),
  expected: z.string(),
  records: z.array(z.string()),
  message: z.string(),
});
export type VerifyDomainResponse = z.infer<typeof verifyDomainResponseSchema>;

/** The shop wizard (`/connect?platform=wa-store`): create or edit one shop. */
export const saveShopSchema = z.object({
  /** Present: edit that shop. Absent: create a new one. */
  shopId: uuidSchema.optional(),
  shopName: z.string().trim().min(1).max(191),
  customDomain: z
    .string()
    .trim()
    .max(191)
    .regex(DOMAIN_RE, "That doesn't look like a valid domain (e.g. shop.yourbiz.com).")
    .nullish()
    .or(z.literal('')),
  /** A connected device of this workspace; null for a store on the official API. */
  deviceId: uuidSchema.nullish(),
});
export type SaveShopInput = z.infer<typeof saveShopSchema>;

/** `confirm: 'yes'` is the gate Reference had on the hidden form field. No `shopId` clears every shop of the workspace. */
export const resetShopSchema = z.object({
  shopId: uuidSchema.optional(),
  confirm: z.literal('yes'),
});
export type ResetShopInput = z.infer<typeof resetShopSchema>;

export const wizardDeviceSchema = z.object({
  id: uuidSchema,
  label: z.string(),
  phone: z.string().nullable(),
});
export const wizardShopSchema = storefrontResponseSchema.pick({
  id: true,
  shopName: true,
  slug: true,
  customDomain: true,
  customDomainVerified: true,
  enabled: true,
  deviceId: true,
  publicUrl: true,
  sendingLabel: true,
  themeKey: true,
});

/** What the wizard page draws. `hasSender` is false until a WhatsApp number is connected ("Connect WhatsApp first"). */
export const wizardResponseSchema = z.object({
  shops: z.array(wizardShopSchema),
  devices: z.array(wizardDeviceSchema),
  hasSender: z.boolean(),
});
export type WizardResponse = z.infer<typeof wizardResponseSchema>;

/** `POST /store/shops` and `PUT /store/shops/:id`: the wizard form; the shop is named by the path, not the body. */
export const createShopSchema = saveShopSchema.omit({ shopId: true });
export type CreateShopInput = z.infer<typeof createShopSchema>;
export const editShopSchema = createShopSchema;
export type EditShopInput = CreateShopInput;

/**
 * `POST /store/shops/reset`: clears every shop, order and product of the workspace. `confirm` is read leniently so a missing or
 * wrong value answers 422 `STORE_RESET_NOT_CONFIRMED` (Reference's "Reset not confirmed.") and not a generic validation error.
 */
export const resetStoreSchema = z.object({ confirm: z.string().optional() });
export type ResetStoreInput = z.infer<typeof resetStoreSchema>;

export const resetStoreResponseSchema = z.object({
  shops: z.number().int(),
  orders: z.number().int(),
  products: z.number().int(),
});
export type ResetStoreResponse = z.infer<typeof resetStoreResponseSchema>;
