import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { pageResponseSchema } from '../common/pagination';

/**
 * Saved customers of the store (Reference /store/customers, WaCustomerProfile): a merchant pre-sets a buyer's name, company and delivery
 * address by phone so the WhatsApp ordering flow shows it. Here each customer also carries what they bought: orders matched by the
 * digits of the phone, and the CRM contact when the order flow linked one.
 */

export const listStoreCustomersQuerySchema = z.object({
  /** Name, phone or company, literal text (no wildcards). */
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
});
export type ListStoreCustomersQuery = z.infer<typeof listStoreCustomersQuerySchema>;

/** Totals per currency: summing minor units across currencies would be meaningless. Cancelled orders are not counted. */
export const storeCustomerTotalSchema = z.object({
  currencyCode: z.string(),
  totalMinor: z.number().int(),
  orders: z.number().int(),
});
export type StoreCustomerTotal = z.infer<typeof storeCustomerTotalSchema>;

export const storeCustomerSchema = z.object({
  id: uuidSchema,
  phone: z.string(),
  name: z.string().nullable(),
  company: z.string().nullable(),
  address: z.string().nullable(),
  /** Every order of this phone, any status. */
  orderCount: z.number().int(),
  lifetimeTotals: z.array(storeCustomerTotalSchema),
  lastOrderAt: z.string().datetime().nullable(),
  contactId: uuidSchema.nullable(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type StoreCustomer = z.infer<typeof storeCustomerSchema>;

export const storeCustomerListResponseSchema = pageResponseSchema(storeCustomerSchema);
export type StoreCustomerListResponse = z.infer<typeof storeCustomerListResponseSchema>;

export const storeCustomerDetailSchema = storeCustomerSchema.extend({
  recentOrders: z.array(
    z.object({
      id: uuidSchema,
      orderNo: z.number().int(),
      status: z.string(),
      totalMinor: z.number().int(),
      currencyCode: z.string(),
      createdAt: z.string().datetime(),
    }),
  ),
});
export type StoreCustomerDetail = z.infer<typeof storeCustomerDetailSchema>;

/** Reference saves by phone: the same form creates or updates (`phone` is reduced to digits, an empty result is refused). */
export const saveStoreCustomerSchema = z.object({
  phone: z.string().trim().min(1).max(32),
  name: z.string().trim().max(191).nullish(),
  company: z.string().trim().max(191).nullish(),
  address: z.string().trim().max(2000).nullish(),
});
export type SaveStoreCustomerInput = z.infer<typeof saveStoreCustomerSchema>;

/** Editing one customer: the phone is the key and stays; the rest is replaced. */
export const updateStoreCustomerSchema = z.object({
  name: z.string().trim().max(191).nullish(),
  company: z.string().trim().max(191).nullish(),
  address: z.string().trim().max(2000).nullish(),
  rowVersion: z.number().int().positive().optional(),
});
export type UpdateStoreCustomerInput = z.infer<typeof updateStoreCustomerSchema>;
