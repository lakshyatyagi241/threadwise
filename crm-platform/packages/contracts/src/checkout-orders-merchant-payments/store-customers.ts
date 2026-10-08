import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { pageResponseSchema } from '../common/pagination';

/**
 * Customers of the store. Reference's /store/customers (WaCustomerProfile) lists SAVED customers only: a merchant pre-sets a buyer's name,
 * company and delivery address by phone so the WhatsApp ordering flow shows it. Here the list is every buyer: the saved customers
 * (profiles) plus everyone who placed an order without one, grouped by their normalised phone (the platform's default country is put
 * in front of a bare local number, so "7999834066" and "+91 79998 34066" are one buyer). Each row carries what the buyer bought and the
 * CRM contact the order flow linked.
 *
 * A row's `id` is the profile's uuid when the buyer has a saved profile, else `phone:<normalised digits>` (an order-only buyer). The
 * detail and edit endpoints take either form; editing an order-only buyer creates their profile (saved by phone, as Reference does) and
 * answers with the new profile's uuid.
 */

/** `phone:<digits>`: an order-only buyer. */
export const STORE_CUSTOMER_PHONE_ID = /^phone:(\d{1,32})$/;
const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const storeCustomerIdSchema = z
  .string()
  .refine((v) => UUID_ID.test(v) || STORE_CUSTOMER_PHONE_ID.test(v), 'Not a customer id');
export const isOrderOnlyCustomerId = (id: string): boolean => STORE_CUSTOMER_PHONE_ID.test(id);

export const listStoreCustomersQuerySchema = z.object({
  /** Name, phone or company, literal text (no wildcards). */
  q: z.string().trim().max(120).optional(),
  /** Only buyers who ordered from this shop (saved customers without an order there are left out). */
  storefrontId: uuidSchema.optional(),
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
  /** Profile uuid, or `phone:<digits>` for a buyer who has orders but no saved profile. */
  id: storeCustomerIdSchema,
  /** Digits, normalised (a bare local number carries the default country code). */
  phone: z.string(),
  /** The profile's name, else the name on the buyer's latest order. */
  name: z.string().nullable(),
  /** From the saved profile only. */
  company: z.string().nullable(),
  /** The saved delivery address (profile only; the address on an order is on the order). */
  address: z.string().nullable(),
  /** The buyer has a saved profile (an editable, deletable row). False: known from orders only. */
  hasProfile: z.boolean(),
  /** The profile has a delivery address. False for an order-only buyer and for a profile without one. */
  hasSavedAddress: z.boolean(),
  /** Every order of this buyer's phone, any status. */
  orderCount: z.number().int(),
  lifetimeTotals: z.array(storeCustomerTotalSchema),
  lastOrderAt: z.string().datetime().nullable(),
  /** The profile's CRM contact, else the one on the buyer's latest linked order. */
  contactId: uuidSchema.nullable(),
  /** 0 for an order-only buyer (nothing to guard: editing creates the profile). */
  rowVersion: z.number().int(),
  /** The profile's creation, else the buyer's first order. */
  createdAt: z.string().datetime(),
  /** The later of the profile's last change and the buyer's latest order. */
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

/** Editing one customer: the phone is the key and stays; the rest is replaced. For an order-only buyer this creates the profile. */
export const updateStoreCustomerSchema = z.object({
  name: z.string().trim().max(191).nullish(),
  company: z.string().trim().max(191).nullish(),
  address: z.string().trim().max(2000).nullish(),
  rowVersion: z.number().int().positive().optional(),
});
export type UpdateStoreCustomerInput = z.infer<typeof updateStoreCustomerSchema>;
