import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { pageResponseSchema } from '../common/pagination';

/**
 * The workspace payment gateway (our design; WaDesk keeps one gateway list for the store and another per feature). One row per
 * (scope, gateway): scope `workspace` is the default for the whole workspace (Store checkout and Sales invoices both read it), scope
 * `store` is an override for one shop. Credentials are encrypted at rest and NEVER come back: a field carries `hasValue` and a mask.
 */

export const STORE_GATEWAY_MODES = ['live', 'test'] as const;
export const storeGatewayModeSchema = z.enum(STORE_GATEWAY_MODES);
export type StoreGatewayMode = z.infer<typeof storeGatewayModeSchema>;

/** Where the gateway a checkout or invoice uses came from, strongest first. */
export const STORE_GATEWAY_SOURCES = [
  'store_override',
  'workspace_default',
  'legacy_storefront',
] as const;
export const storeGatewaySourceSchema = z.enum(STORE_GATEWAY_SOURCES);
export type StoreGatewaySource = z.infer<typeof storeGatewaySourceSchema>;

export const storeGatewaySlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_-]{1,64}$/);

export const storeGatewayFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'password', 'textarea', 'select']),
  required: z.boolean(),
  hint: z.string().nullable(),
  options: z.array(z.string()).nullable(),
  /** A value here authenticates provider notifications (the gateway's webhook secret). */
  webhook: z.boolean(),
});
export type StoreGatewayField = z.infer<typeof storeGatewayFieldSchema>;

/** One entry of the driver catalogue. `available: false` is "not available yet": it can be listed but not saved or activated. */
export const storeGatewayDriverSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  regions: z.array(z.string()),
  currencies: z.array(z.string()),
  /** A driver exists in this build, so the gateway can take a payment. */
  available: z.boolean(),
  /** The gateway can mint a hosted link a buyer opens from WhatsApp (offline and bank transfer cannot). */
  supportsPaymentLinks: z.boolean(),
  fields: z.array(storeGatewayFieldSchema),
});
export type StoreGatewayDriver = z.infer<typeof storeGatewayDriverSchema>;
export const storeGatewayDriverListResponseSchema = pageResponseSchema(storeGatewayDriverSchema);
export type StoreGatewayDriverListResponse = z.infer<typeof storeGatewayDriverListResponseSchema>;

/** A credential as the screen sees it: whether it is set and a mask of it, never the value. */
export const storeGatewayCredentialSchema = z.object({
  key: z.string(),
  hasValue: z.boolean(),
  /** Bullets, plus the last four characters of a long value. Null when nothing is saved. */
  masked: z.string().nullable(),
});
export type StoreGatewayCredential = z.infer<typeof storeGatewayCredentialSchema>;

export const storeGatewaySchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  name: z.string(),
  scope: z.enum(['workspace', 'store']),
  storefrontId: uuidSchema.nullable(),
  storefrontName: z.string().nullable(),
  mode: storeGatewayModeSchema,
  active: z.boolean(),
  isDefault: z.boolean(),
  /** Every required field holds a value, so the gateway can be used. */
  configured: z.boolean(),
  credentials: z.array(storeGatewayCredentialSchema),
  /** The gateway declares signing fields but none holds a value: notifications are refused until one is set. */
  webhookSecretMissing: z.boolean(),
  /** Paste this address into the provider's dashboard. */
  webhookUrl: z.string(),
  /** Copied from the shop's own Razorpay keys by the data migration, not yet re-saved here. */
  migratedFromStorefront: z.boolean(),
  sortOrder: z.number().int(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type StoreGateway = z.infer<typeof storeGatewaySchema>;
export const storeGatewayListResponseSchema = pageResponseSchema(storeGatewaySchema);
export type StoreGatewayListResponse = z.infer<typeof storeGatewayListResponseSchema>;

export const listStoreGatewaysQuerySchema = z.object({
  /** Only the overrides of this shop (plus the workspace ones when `includeWorkspace`). */
  storefrontId: uuidSchema.optional(),
});
export type ListStoreGatewaysQuery = z.infer<typeof listStoreGatewaysQuerySchema>;

/** Which row a call is about: the workspace one (no `storefrontId`) or one shop's override. */
export const storeGatewayScopeQuerySchema = z.object({ storefrontId: uuidSchema.optional() });
export type StoreGatewayScopeQuery = z.infer<typeof storeGatewayScopeQuerySchema>;

/**
 * Saving creates the row or changes it (WaDesk `save`). A blank credential keeps what is stored; `clear` names fields to remove
 * (explicit, never by leaving a box empty). Unknown field keys are refused. A new row is active unless told otherwise.
 */
export const saveStoreGatewaySchema = z.object({
  storefrontId: uuidSchema.nullish(),
  mode: storeGatewayModeSchema.optional(),
  active: z.boolean().optional(),
  credentials: z.record(z.string().max(80), z.string().max(4000)).optional(),
  clear: z.array(z.string().max(80)).max(40).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  rowVersion: z.number().int().positive().optional(),
});
export type SaveStoreGatewayInput = z.infer<typeof saveStoreGatewaySchema>;

export const storeGatewayTestSchema = z.object({
  /** `verified`: the provider accepted the keys. `fields`: only the required fields were checked (this gateway has no cheap auth call). */
  ok: z.boolean(),
  level: z.enum(['verified', 'fields']),
  message: z.string(),
  missing: z.array(z.string()),
});
export type StoreGatewayTestResult = z.infer<typeof storeGatewayTestSchema>;

/** What a checkout or an invoice would use right now, with no secret. */
export const storeResolvedGatewaySchema = z.object({
  resolved: z
    .object({
      slug: z.string(),
      name: z.string(),
      source: storeGatewaySourceSchema,
      mode: storeGatewayModeSchema,
      storefrontId: uuidSchema.nullable(),
      id: uuidSchema.nullable(),
    })
    .nullable(),
});
export type StoreResolvedGateway = z.infer<typeof storeResolvedGatewaySchema>;
