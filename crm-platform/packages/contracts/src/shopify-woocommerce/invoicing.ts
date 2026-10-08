import { z } from 'zod';

/**
 * A store's invoicing policy (TW-ECOM-035): whether its orders are invoiced on their own, and on which event. It lives in the
 * workspace's invoice settings (one pair per source) and is edited from the store's Invoices tab. The invoices themselves are
 * listed by the invoicing API (`GET /v2/invoices?source=shopify`).
 */

/** The event that invoices an order: placed (any new order), paid (the default) or fulfilled (shipped or completed). */
export const ECOM_INVOICE_TRIGGERS = ['on_placed', 'on_paid', 'on_fulfilled'] as const;
export const ecomInvoiceTriggerSchema = z.enum(ECOM_INVOICE_TRIGGERS);
export type EcomInvoiceTrigger = z.infer<typeof ecomInvoiceTriggerSchema>;

export const ecomInvoicePolicySchema = z.object({
  /**
   * Invoice the store's orders automatically and queue each invoice for the buyer (WhatsApp, else email). Off by default: no
   * order is invoiced until the workspace asks for it.
   */
  autoInvoice: z.boolean(),
  trigger: ecomInvoiceTriggerSchema,
});
export type EcomInvoicePolicy = z.infer<typeof ecomInvoicePolicySchema>;

export const updateEcomInvoicePolicySchema = z
  .object({
    autoInvoice: z.boolean().optional(),
    trigger: ecomInvoiceTriggerSchema.optional(),
  })
  .strict()
  .refine((v) => v.autoInvoice !== undefined || v.trigger !== undefined, {
    message: 'send autoInvoice, trigger or both',
  });
export type UpdateEcomInvoicePolicyInput = z.infer<typeof updateEcomInvoicePolicySchema>;
