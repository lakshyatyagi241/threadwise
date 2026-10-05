import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { pageResponseSchema } from '../common/pagination';
import { storePaymentStatusSchema } from './store-orders';

/**
 * The store's Payments screen (Reference /store/payments is Meta's WhatsApp Pay page): the money side of store orders, read only, and the
 * WhatsApp Pay configurations the merchant names after the "Direct Pay Method" made in WhatsApp Manager.
 */

export const listStorePaymentsQuerySchema = z.object({
  status: storePaymentStatusSchema.optional(),
  /** `prepaid`, `cod` or a gateway slug. */
  method: z.string().trim().max(64).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(512).optional(),
});
export type ListStorePaymentsQuery = z.infer<typeof listStorePaymentsQuerySchema>;

export const storePaymentRecordSchema = z.object({
  orderId: uuidSchema,
  orderNo: z.number().int(),
  customerName: z.string().nullable(),
  customerPhone: z.string().nullable(),
  status: storePaymentStatusSchema,
  method: z.string(),
  /** How the money arrived: `razorpay_link`, a gateway slug, `whatsapp_pay`, or null while unpaid. */
  paidVia: z.string().nullable(),
  /** The provider's payment id when a webhook recorded one. */
  reference: z.string().nullable(),
  waPaymentStatus: z.string().nullable(),
  paymentLink: z.string().nullable(),
  amountMinor: z.number().int(),
  currencyCode: z.string(),
  storefrontName: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type StorePaymentRecord = z.infer<typeof storePaymentRecordSchema>;
export const storePaymentListResponseSchema = pageResponseSchema(storePaymentRecordSchema);
export type StorePaymentListResponse = z.infer<typeof storePaymentListResponseSchema>;

export const storePaymentSummarySchema = z.object({
  paid: z.number().int(),
  awaiting: z.number().int(),
  cod: z.number().int(),
  unpaid: z.number().int(),
  /** Collected money, per currency. */
  collected: z.array(z.object({ currencyCode: z.string(), totalMinor: z.number().int() })),
});
export type StorePaymentSummary = z.infer<typeof storePaymentSummarySchema>;

/** Reference `WorkspacePaymentConfig::PAYMENT_TYPES`. */
export const WHATSAPP_PAY_TYPES = ['razorpay', 'payu', 'billdesk', 'zaakpay'] as const;
export const whatsappPayTypeSchema = z.enum(WHATSAPP_PAY_TYPES);

export const whatsappPayConfigSchema = z.object({
  id: uuidSchema,
  configName: z.string(),
  paymentType: z.string(),
  country: z.string(),
  currency: z.string(),
  isActive: z.boolean(),
  autoCharge: z.boolean(),
  rowVersion: z.number().int(),
  updatedAt: z.string().datetime(),
});
export type WhatsappPayConfig = z.infer<typeof whatsappPayConfigSchema>;
export const whatsappPayListResponseSchema = pageResponseSchema(whatsappPayConfigSchema);
export type WhatsappPayListResponse = z.infer<typeof whatsappPayListResponseSchema>;

/** Reference `store`: create or update by name; country and currency are fixed to India (the only supported market). */
export const saveWhatsappPayConfigSchema = z.object({
  configName: z.string().trim().min(1).max(60),
  paymentType: whatsappPayTypeSchema,
  isActive: z.boolean().default(true),
  autoCharge: z.boolean().default(false),
});
export type SaveWhatsappPayConfigInput = z.infer<typeof saveWhatsappPayConfigSchema>;
