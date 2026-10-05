import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * A store order as a contact's detail page lists it (WaDesk kept store customers apart from contacts; the owner decided on 2026-10-05
 * to link them). Read-only: the order itself is edited in the store's Orders screen, this is the contact-side view of it.
 */
export const contactStoreOrderSchema = z.object({
  /** The order's uuid (`wa_orders.uuid`). */
  id: uuidSchema,
  /** The number the buyer was shown ("Store order #12"). */
  orderNo: z.number().int().positive(),
  source: z.string(),
  status: z.string(),
  paymentMethod: z.string(),
  currency: z.string(),
  /** Major units of `currency`, as text (money is never a JS number). */
  total: z.string(),
  itemCount: z.number().int().nonnegative(),
  placedAt: z.string().datetime(),
  salesOrder: z.object({ id: uuidSchema, number: z.string() }).nullable(),
  invoice: z
    .object({
      id: uuidSchema,
      number: z.string().nullable(),
      docType: z.enum(['tax_invoice', 'proforma', 'receipt']),
    })
    .nullable(),
});
export type ContactStoreOrder = z.infer<typeof contactStoreOrderSchema>;

export const contactStoreOrdersResponseSchema = z.object({
  data: z.array(contactStoreOrderSchema),
  /** True when the contact has more store orders than were returned. */
  hasMore: z.boolean(),
});
export type ContactStoreOrdersResponse = z.infer<typeof contactStoreOrdersResponseSchema>;

/** `GET /v2/contacts/:contactId/store-orders`: newest first, at most `limit` (default 20, cap 50). */
export const listContactStoreOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListContactStoreOrdersQuery = z.infer<typeof listContactStoreOrdersQuerySchema>;
