/**
 * Saved customer profiles (WD-WABA-055, 056): a merchant pre-sets a customer's name, company and delivery address by phone, so the
 * WhatsApp ordering flow shows it and the customer only replies YES. Shapes between the API and the Customers screen.
 */
import { z } from 'zod';

/** `GET /v2/waba/customers`: name, phone or company contains `q` (wildcards in `q` are literal); 20 a page, name then phone. */
export const listCustomersQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** `PUT /v2/waba/customers`: the same form creates or updates, keyed by the phone's digits. */
export const saveCustomerInputSchema = z.object({
  phone: z.string().trim().min(1).max(32),
  name: optionalText(191),
  company: optionalText(191),
  address: optionalText(2000),
});
export type SaveCustomerInput = z.infer<typeof saveCustomerInputSchema>;

export const customerProfileSchema = z.object({
  id: z.string().uuid(),
  /** Digits only, country code included. */
  phone: z.string(),
  name: z.string().nullable(),
  company: z.string().nullable(),
  address: z.string().nullable(),
  updatedAt: z.string(),
});
export type CustomerProfile = z.infer<typeof customerProfileSchema>;

export const customerListSchema = z.object({
  items: z.array(customerProfileSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type CustomerList = z.infer<typeof customerListSchema>;
