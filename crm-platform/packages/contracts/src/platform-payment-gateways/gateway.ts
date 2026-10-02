import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { PAYGW_FIELD_TYPES, PAYGW_REGIONS, paygwModeSchema } from './catalogue';

/**
 * Operator-facing gateway shapes (WD-PAYGW-002..005). Secrets never leave the API: a credential field is reported as
 * `hasValue` and replaced by sending a new value; blank keeps the stored one and `clear` removes it explicitly.
 */
export const paygwCredentialFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(PAYGW_FIELD_TYPES),
  required: z.boolean(),
  hint: z.string().nullable(),
  options: z.array(z.string()).nullable(),
  hasValue: z.boolean(),
});
export type PaygwCredentialField = z.infer<typeof paygwCredentialFieldSchema>;

export const paygwGatewayItemSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  regions: z.array(z.enum(PAYGW_REGIONS)),
  isActive: z.boolean(),
  mode: paygwModeSchema,
  sortOrder: z.number().int(),
  /** Empty = the gateway accepts every currency. */
  supportedCurrencies: z.array(z.string()),
  fields: z.array(paygwCredentialFieldSchema),
  keysSaved: z.boolean(),
  /** false = the catalogue lists it but no driver is built yet: it can be configured, not activated. */
  driverAvailable: z.boolean(),
  /** Webhook endpoint the operator pastes into the provider dashboard. */
  webhookUrl: z.string(),
  rowVersion: z.number().int(),
  updatedAt: z.string(),
});
export type PaygwGatewayItem = z.infer<typeof paygwGatewayItemSchema>;

export const paygwGatewayListResponseSchema = z.object({
  data: z.array(paygwGatewayItemSchema),
  summary: z.object({
    total: z.number().int(),
    active: z.number().int(),
    india: z.number().int(),
    crypto: z.number().int(),
  }),
});
export type PaygwGatewayListResponse = z.infer<typeof paygwGatewayListResponseSchema>;

const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3,5}$/, 'Use an ISO currency code such as USD.');

export const updatePaygwGatewayRequestSchema = z.object({
  mode: paygwModeSchema,
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  /** Omitted = keep the stored list; [] = accept every currency. */
  supportedCurrencies: z.array(currencyCode).max(60).optional(),
  /** key -> new value. Blank values are ignored; keys the gateway does not declare are ignored. */
  credentials: z.record(z.string(), z.string().max(4000)).optional(),
  /** Explicitly remove these stored credential keys. */
  clearCredentials: z.array(z.string()).max(40).optional(),
  rowVersion: z.number().int().min(1),
});
export type UpdatePaygwGatewayRequest = z.infer<typeof updatePaygwGatewayRequestSchema>;

export const setPaygwGatewayActiveRequestSchema = z.object({
  isActive: z.boolean(),
  rowVersion: z.number().int().min(1),
});
export type SetPaygwGatewayActiveRequest = z.infer<typeof setPaygwGatewayActiveRequestSchema>;
