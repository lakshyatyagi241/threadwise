import { z } from 'zod';
import { invoiceViewSchema } from './admin-billing';

/**
 * The buyer's printable invoice for one order (WD-PAYGW-036). The same document the operator prints, minus what a buyer must not
 * see: the workspace reference, the gateway behind the payment (WaDesk hides it on purpose) and the manual-invoice flag.
 */
export const paygwBuyerInvoiceSchema = invoiceViewSchema
  .omit({ workspace: true, gatewaySlug: true, manual: true, payment: true })
  .extend({
    payment: z.object({
      reference: z.string().nullable(),
      paidAt: z.string().nullable(),
      couponCode: z.string().nullable(),
    }),
    /** The footer line "for support or refunds within N days": `null` when the operator turned the refund promise off. */
    refundDays: z.number().int().nullable(),
  });
export type PaygwBuyerInvoice = z.infer<typeof paygwBuyerInvoiceSchema>;
