import { z } from 'zod';
import {
  agingResponseSchema,
  applyTaxPresetsResponseSchema,
  contactResponseSchema,
  creditNotePageSchema,
  creditNoteResponseSchema,
  invoiceCountsResponseSchema,
  invoiceEventsResponseSchema,
  invoiceFromOrderResponseSchema,
  invoiceGatewayResponseSchema,
  invoicePageResponseSchema,
  invoiceProfileSchema,
  invoiceResponseSchema,
  linkedInvoicesResponseSchema,
  outstandingResponseSchema,
  pageInfoSchema,
  paymentOutcomeSchema,
  paymentPageResponseSchema,
  paymentReceiptSchema,
  paymentResponseSchema,
  paymentSummaryResponseSchema,
  publicInvoiceSchema,
  publicPayResponseSchema,
  recurringInvoiceResponseSchema,
  recurringRunsResponseSchema,
  salesOrderCountsSchema,
  salesOrderPageSchema,
  salesOrderResponseSchema,
  taxPresetsResponseSchema,
  taxRateResponseSchema,
  taxRatesResponseSchema,
  type ApplyTaxPresetsInput,
  type CancelOrderInput,
  type CreateCreditNoteInput,
  type CreateInvoiceInput,
  type CreateRecurringInvoiceInput,
  type CreateSalesOrderInput,
  type CreateTaxRateInput,
  type FulfilOrderInput,
  type InvoiceFromOrderInput,
  type IssueInvoiceInput,
  type PublicLinkInput,
  type RecordPaymentInput,
  type RefundPaymentInput,
  type SendInvoiceInput,
  type UpdateCreditNoteInput,
  type UpdateInvoiceGatewayInput,
  type UpdateInvoiceInput,
  type UpdateInvoiceProfileInput,
  type UpdateRecurringInvoiceInput,
  type UpdateSalesOrderInput,
  type UpdateTaxRateInput,
} from '@crm/contracts';
import { call, callPublic } from './http';

/** What a query-string call takes: the client turns each value into text and drops the empty ones. */
export type Query = Record<string, string | number | boolean | undefined>;

/** A page of a cursor list, flattened out of `{ data, page }`. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

const pageOf = <T>(res: { data: T[]; page: { nextCursor: string | null; hasMore: boolean } }): Page<T> => ({
  items: res.data,
  nextCursor: res.page.nextCursor,
  hasMore: res.page.hasMore,
});

const recurringPageSchema = z.object({ data: z.array(recurringInvoiceResponseSchema), page: pageInfoSchema });
const contactHitSchema = contactResponseSchema.pick({
  id: true,
  name: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
});
const contactPageSchema = z.object({ data: z.array(contactHitSchema) });
export type ContactHit = z.infer<typeof contactHitSchema>;
export const contactLabel = (c: Pick<ContactHit, 'name' | 'firstName' | 'lastName' | 'phone'>): string =>
  c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.phone || '';

export type BulkAction = 'issue' | 'send' | 'void' | 'delete';
export interface BulkOutcome {
  changed: number;
  failed: number;
}

/** Runs `fn` over `rows` four at a time and counts what worked: the API has no bulk invoice route, so a bulk action is many calls. */
async function inBatches<T>(rows: readonly T[], fn: (row: T) => Promise<unknown>): Promise<BulkOutcome> {
  let changed = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += 4) {
    const settled = await Promise.allSettled(rows.slice(i, i + 4).map(fn));
    for (const s of settled) {
      if (s.status === 'fulfilled') changed++;
      else failed++;
    }
  }
  return { changed, failed };
}

/** The same-origin path of an invoice or credit note PDF (a download; the session cookie rides along on the proxy). */
export const invoicePdfPath = (id: string): string => `/api/v2/invoices/${id}/pdf`;
export const creditNotePdfPath = (id: string): string => `/api/v2/credit-notes/${id}/pdf`;

/** Every invoicing call, one function each, parsed at the boundary with the contracts' own schemas. */
export const invoicingApi = {
  // --- invoices ----------------------------------------------------------------------------------------------------------
  async list(query: Query, signal?: AbortSignal) {
    return pageOf(await call('/invoices', { query, schema: invoicePageResponseSchema, signal }));
  },
  counts: (query: Query, signal?: AbortSignal) =>
    call('/invoices/counts', { query, schema: invoiceCountsResponseSchema, signal }),
  get: (id: string, signal?: AbortSignal) => call(`/invoices/${id}`, { schema: invoiceResponseSchema, signal }),
  create: (input: CreateInvoiceInput) =>
    call('/invoices', { method: 'POST', body: input, schema: invoiceResponseSchema }),
  /** Needs the `rowVersion` that was read (409 = someone else changed it). A draft edits whole; an issued invoice only its open fields. */
  update: (id: string, rowVersion: number, input: Omit<UpdateInvoiceInput, 'rowVersion'>) =>
    call(`/invoices/${id}`, { method: 'PATCH', body: { ...input, rowVersion }, schema: invoiceResponseSchema }),
  remove: (id: string): Promise<void> => call(`/invoices/${id}`, { method: 'DELETE' }),
  /** Allocates the number, freezes the invoice, makes the public link live. */
  issue: (id: string, body: IssueInvoiceInput = {}) =>
    call(`/invoices/${id}/issue`, { method: 'POST', body, schema: invoiceResponseSchema }),
  /** `link` records that the staff member shared the link themselves; `email` and `whatsapp` raise the delivery event. */
  send: (id: string, body: Partial<SendInvoiceInput> = { channel: 'link' }) =>
    call(`/invoices/${id}/send`, { method: 'POST', body, schema: invoiceResponseSchema }),
  void: (id: string, reason: string, rowVersion?: number) =>
    call(`/invoices/${id}/void`, { method: 'POST', body: { reason, rowVersion }, schema: invoiceResponseSchema }),
  duplicate: (id: string) =>
    call(`/invoices/${id}/duplicate`, { method: 'POST', body: {}, schema: invoiceResponseSchema }),
  regenerateLink: (id: string, body: PublicLinkInput = {}) =>
    call(`/invoices/${id}/public-link/regenerate`, { method: 'POST', body, schema: invoiceResponseSchema }),
  revokeLink: (id: string) =>
    call(`/invoices/${id}/public-link/revoke`, { method: 'POST', body: {}, schema: invoiceResponseSchema }),
  events: async (id: string, signal?: AbortSignal) =>
    (await call(`/invoices/${id}/events`, { query: { limit: 100 }, schema: invoiceEventsResponseSchema, signal })).data,
  /** The invoices of one contact or deal, with the money rolled up per currency. */
  async linked(kind: 'contact' | 'deal', id: string, query: Query, signal?: AbortSignal) {
    const res = await call(`/${kind === 'contact' ? 'contacts' : 'deals'}/${id}/invoices`, {
      query,
      schema: linkedInvoicesResponseSchema,
      signal,
    });
    return { ...pageOf(res), totals: res.totals };
  },
  /** There is no bulk invoice route: each row is its own call, so a failure on one never undoes the others. */
  bulk(
    action: BulkAction,
    rows: ReadonlyArray<{ id: string; rowVersion?: number }>,
    opts: { reason?: string } = {},
  ): Promise<BulkOutcome> {
    return inBatches(rows, (r) => {
      switch (action) {
        case 'issue':
          return invoicingApi.issue(r.id, r.rowVersion ? { rowVersion: r.rowVersion } : {});
        case 'send':
          return invoicingApi.send(r.id, { channel: 'link' });
        case 'void':
          return invoicingApi.void(r.id, opts.reason ?? 'Voided', r.rowVersion);
        case 'delete':
          return invoicingApi.remove(r.id);
      }
    });
  },

  // --- payments ----------------------------------------------------------------------------------------------------------
  async payments(query: Query, signal?: AbortSignal) {
    return pageOf(await call('/payments', { query, schema: paymentPageResponseSchema, signal }));
  },
  payment: (id: string, signal?: AbortSignal) => call(`/payments/${id}`, { schema: paymentResponseSchema, signal }),
  receipt: (id: string, signal?: AbortSignal) =>
    call(`/payments/${id}/receipt`, { schema: paymentReceiptSchema, signal }),
  paymentSummary: (days: number, signal?: AbortSignal) =>
    call('/payments/summary', { query: { days }, schema: paymentSummaryResponseSchema, signal }),
  aging: (query: Query = {}, signal?: AbortSignal) =>
    call('/payments/aging', { query, schema: agingResponseSchema, signal }),
  async outstanding(query: Query = {}, signal?: AbortSignal) {
    return pageOf(await call('/payments/outstanding', { query, schema: outstandingResponseSchema, signal }));
  },
  /** Money received against an issued invoice. Returns the ledger entry and where it left the invoice. */
  recordPayment: (invoiceId: string, input: Partial<RecordPaymentInput> & { amount: string }) =>
    call(`/invoices/${invoiceId}/payments`, { method: 'POST', body: input, schema: paymentOutcomeSchema }),
  refund: (paymentId: string, input: RefundPaymentInput = {}) =>
    call(`/payments/${paymentId}/refund`, { method: 'POST', body: input, schema: paymentOutcomeSchema }),

  // --- tax rates ---------------------------------------------------------------------------------------------------------
  taxRates: async (query: Query = {}, signal?: AbortSignal) =>
    (await call('/tax-rates', { query, schema: taxRatesResponseSchema, signal })).data,
  createTaxRate: (input: CreateTaxRateInput) =>
    call('/tax-rates', { method: 'POST', body: input, schema: taxRateResponseSchema }),
  updateTaxRate: (id: string, rowVersion: number, patch: Omit<UpdateTaxRateInput, 'rowVersion'>) =>
    call(`/tax-rates/${id}`, { method: 'PATCH', body: { ...patch, rowVersion }, schema: taxRateResponseSchema }),
  setDefaultTaxRate: (id: string) =>
    call(`/tax-rates/${id}/default`, { method: 'POST', body: {}, schema: taxRateResponseSchema }),
  removeTaxRate: (id: string): Promise<void> => call(`/tax-rates/${id}`, { method: 'DELETE' }),
  /** A country's rates from the tax engine as ready-to-use rows (defaults to verify, not tax advice). */
  taxPresets: (query: Query & { country: string }, signal?: AbortSignal) =>
    call('/tax-rates/presets', { query, schema: taxPresetsResponseSchema, signal }),
  applyTaxPresets: (input: Partial<ApplyTaxPresetsInput> & { country: string }) =>
    call('/tax-rates/presets', { method: 'POST', body: input, schema: applyTaxPresetsResponseSchema }),

  // --- the business profile (invoicing settings) -------------------------------------------------------------------------
  settings: (signal?: AbortSignal) => call('/invoice-settings', { schema: invoiceProfileSchema, signal }),
  updateSettings: (input: UpdateInvoiceProfileInput) =>
    call('/invoice-settings', { method: 'PATCH', body: input, schema: invoiceProfileSchema }),
  gateway: (signal?: AbortSignal) =>
    call('/invoice-settings/gateway', { schema: invoiceGatewayResponseSchema, signal }),
  updateGateway: (input: UpdateInvoiceGatewayInput) =>
    call('/invoice-settings/gateway', { method: 'PUT', body: input, schema: invoiceGatewayResponseSchema }),

  // --- the buyer's page --------------------------------------------------------------------------------------------------
  publicInvoice: (token: string) => callPublic(token, publicInvoiceSchema),
  publicPay: (token: string, amount?: string) =>
    callPublic(token, publicPayResponseSchema, { method: 'POST', action: 'pay', body: amount ? { amount } : {} }),

  // --- recurring invoices ------------------------------------------------------------------------------------------------
  async recurringList(query: Query, signal?: AbortSignal) {
    return pageOf(await call('/recurring-invoices', { query, schema: recurringPageSchema, signal }));
  },
  recurring: (id: string, signal?: AbortSignal) =>
    call(`/recurring-invoices/${id}`, { schema: recurringInvoiceResponseSchema, signal }),
  createRecurring: (input: CreateRecurringInvoiceInput) =>
    call('/recurring-invoices', { method: 'POST', body: input, schema: recurringInvoiceResponseSchema }),
  updateRecurring: (id: string, rowVersion: number, patch: Omit<UpdateRecurringInvoiceInput, 'rowVersion'>) =>
    call(`/recurring-invoices/${id}`, {
      method: 'PATCH',
      body: { ...patch, rowVersion },
      schema: recurringInvoiceResponseSchema,
    }),
  pauseRecurring: (id: string) =>
    call(`/recurring-invoices/${id}/pause`, { method: 'POST', body: {}, schema: recurringInvoiceResponseSchema }),
  resumeRecurring: (id: string) =>
    call(`/recurring-invoices/${id}/resume`, { method: 'POST', body: {}, schema: recurringInvoiceResponseSchema }),
  /** Generates the next period now. */
  runRecurring: (id: string) =>
    call(`/recurring-invoices/${id}/run`, { method: 'POST', body: {}, schema: recurringInvoiceResponseSchema }),
  removeRecurring: (id: string): Promise<void> => call(`/recurring-invoices/${id}`, { method: 'DELETE' }),
  async recurringRuns(id: string, query: Query = {}, signal?: AbortSignal) {
    return pageOf(
      await call(`/recurring-invoices/${id}/runs`, { query, schema: recurringRunsResponseSchema, signal }),
    );
  },

  // --- credit notes ------------------------------------------------------------------------------------------------------
  async creditNotes(query: Query, signal?: AbortSignal) {
    return pageOf(await call('/credit-notes', { query, schema: creditNotePageSchema, signal }));
  },
  creditNote: (id: string, signal?: AbortSignal) =>
    call(`/credit-notes/${id}`, { schema: creditNoteResponseSchema, signal }),
  createCreditNote: (input: Partial<CreateCreditNoteInput> & Pick<CreateCreditNoteInput, 'invoiceId' | 'reason'>) =>
    call('/credit-notes', { method: 'POST', body: input, schema: creditNoteResponseSchema }),
  updateCreditNote: (id: string, rowVersion: number, patch: Omit<UpdateCreditNoteInput, 'rowVersion'>) =>
    call(`/credit-notes/${id}`, { method: 'PATCH', body: { ...patch, rowVersion }, schema: creditNoteResponseSchema }),
  issueCreditNote: (id: string, rowVersion?: number) =>
    call(`/credit-notes/${id}/issue`, {
      method: 'POST',
      body: rowVersion ? { rowVersion } : {},
      schema: creditNoteResponseSchema,
    }),
  voidCreditNote: (id: string, reason: string) =>
    call(`/credit-notes/${id}/void`, { method: 'POST', body: { reason }, schema: creditNoteResponseSchema }),
  removeCreditNote: (id: string): Promise<void> => call(`/credit-notes/${id}`, { method: 'DELETE' }),

  // --- sales orders ------------------------------------------------------------------------------------------------------
  async salesOrders(query: Query, signal?: AbortSignal) {
    return pageOf(await call('/sales-orders', { query, schema: salesOrderPageSchema, signal }));
  },
  salesOrderCounts: (signal?: AbortSignal) =>
    call('/sales-orders/counts', { schema: salesOrderCountsSchema, signal }),
  salesOrder: (id: string, signal?: AbortSignal) =>
    call(`/sales-orders/${id}`, { schema: salesOrderResponseSchema, signal }),
  createSalesOrder: (input: CreateSalesOrderInput) =>
    call('/sales-orders', { method: 'POST', body: input, schema: salesOrderResponseSchema }),
  updateSalesOrder: (id: string, rowVersion: number, patch: Omit<UpdateSalesOrderInput, 'rowVersion'>) =>
    call(`/sales-orders/${id}`, { method: 'PATCH', body: { ...patch, rowVersion }, schema: salesOrderResponseSchema }),
  confirmSalesOrder: (id: string) =>
    call(`/sales-orders/${id}/confirm`, { method: 'POST', body: {}, schema: salesOrderResponseSchema }),
  /** Bills part or all of the order; the result carries the draft (or issued) invoice and the order's new progress. */
  invoiceSalesOrder: (id: string, body: Partial<InvoiceFromOrderInput>) =>
    call(`/sales-orders/${id}/invoice`, { method: 'POST', body, schema: invoiceFromOrderResponseSchema }),
  fulfilSalesOrder: (id: string, body: Partial<FulfilOrderInput>) =>
    call(`/sales-orders/${id}/fulfil`, { method: 'POST', body, schema: salesOrderResponseSchema }),
  cancelSalesOrder: (id: string, body: CancelOrderInput) =>
    call(`/sales-orders/${id}/cancel`, { method: 'POST', body, schema: salesOrderResponseSchema }),
  removeSalesOrder: (id: string): Promise<void> => call(`/sales-orders/${id}`, { method: 'DELETE' }),

  /**
   * Turns an ACCEPTED proposal or estimate into a draft invoice on the server (one transaction, idempotent per document: a second
   * call returns the same invoice) and answers with the invoice's id. This is what `newInvoiceHref({ document })` leads to.
   */
  async convertSalesDoc(docId: string, signal?: AbortSignal): Promise<{ invoiceId: string }> {
    const doc = await call(`/sales-docs/${docId}/convert/invoice`, {
      method: 'POST',
      body: {},
      schema: z.object({ invoice: z.object({ id: z.string().uuid() }).nullable() }).passthrough(),
      signal,
    });
    if (!doc.invoice) throw new Error('convert answered without an invoice');
    return { invoiceId: doc.invoice.id };
  },

  // --- pickers -----------------------------------------------------------------------------------------------------------
  async searchContacts(q: string, signal?: AbortSignal): Promise<ContactHit[]> {
    return (
      await call('/contacts', { query: { q: q.trim() || undefined, limit: 15 }, schema: contactPageSchema, signal })
    ).data;
  },
  contactById: (id: string, signal?: AbortSignal) => call(`/contacts/${id}`, { schema: contactHitSchema, signal }),
  /** A deal's title and who it is with, to start an invoice from it (`?deal=`). */
  dealById: (id: string, signal?: AbortSignal) =>
    call(`/deals/${id}`, {
      schema: z.object({
        id: z.string().uuid(),
        title: z.string(),
        currency: z.string(),
        contact: z.object({ id: z.string().uuid(), name: z.string().nullable(), phone: z.string().nullable() }).passthrough().nullable(),
        company: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
      }),
      signal,
    }),
  /** The invoice an accepted proposal or estimate was already converted into (null when there is none). */
  async salesDocInvoiceId(docId: string, signal?: AbortSignal): Promise<string | null> {
    const doc = await call(`/sales-docs/${docId}`, {
      schema: z.object({ invoice: z.object({ id: z.string().uuid() }).nullable() }).passthrough(),
      signal,
    });
    return doc.invoice?.id ?? null;
  },
};

export type InvoiceSummaryRow = Awaited<ReturnType<typeof invoicingApi.list>>['items'][number];
