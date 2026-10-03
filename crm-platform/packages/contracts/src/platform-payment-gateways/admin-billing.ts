import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paygwOrderStatusSchema } from './checkout';

/**
 * The operator console's billing screens (TW-PAYGW-037..046, 007): order history, billing history, invoices and the billing
 * settings. All of them read the `orders` table across workspaces. Money is a decimal string in ONE reporting currency
 * (converted with the platform's exchange rates); Reference added up unconverted amounts of different currencies.
 */

export const PAYGW_ADMIN_PAGE_SIZE = 12;

const pageSchema = z.coerce.number().int().min(1).max(100000).default(1);
const searchSchema = z.string().trim().max(120).optional();

export const adminMoneySchema = z.object({ currency: z.string(), amount: z.string() });
export type AdminMoney = z.infer<typeof adminMoneySchema>;

export const adminPagedSchema = z.object({
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

/** Where the buyer's workspace is shown. `slug` leads to the workspace screens. */
export const adminWorkspaceRefSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
});
export type AdminWorkspaceRef = z.infer<typeof adminWorkspaceRefSchema>;

// ---- order history (037, 038, 039, 040) -----------------------------------------------------------------------------------

export const orderWindowSchema = z.enum(['90d', 'this_year', 'all']);
export type OrderWindow = z.infer<typeof orderWindowSchema>;

/** A real order type, derived from the workspace's previous paid plan (Reference's pills and badges disagreed). */
export const adminOrderTypeSchema = z.enum([
  'new',
  'renewal',
  'upgrade',
  'downgrade',
  'addon',
  'wallet_topup',
  'manual',
]);
export type AdminOrderType = z.infer<typeof adminOrderTypeSchema>;

export const orderTypeFilterSchema = z.enum([
  'all',
  'new',
  'upgrade',
  'downgrade',
  'addon',
  'cancel',
]);
export type OrderTypeFilter = z.infer<typeof orderTypeFilterSchema>;

export const adminOrdersQuerySchema = z.object({
  window: orderWindowSchema.default('90d'),
  type: orderTypeFilterSchema.default('all'),
  q: searchSchema,
  page: pageSchema,
});
export type AdminOrdersQuery = z.infer<typeof adminOrdersQuerySchema>;

export const adminOrderRowSchema = z.object({
  id: uuidSchema,
  orderNumber: z.string(),
  createdAt: z.string(),
  workspace: adminWorkspaceRefSchema.nullable(),
  type: adminOrderTypeSchema,
  /** Plan or add-on name, "Wallet top-up", or the manual invoice description. */
  itemName: z.string().nullable(),
  /** `plan_<slug>` for plans, the gateway slug otherwise. */
  itemSub: z.string().nullable(),
  billingPeriod: z.enum(['monthly', 'yearly']).nullable(),
  status: paygwOrderStatusSchema,
  currency: z.string(),
  total: z.string(),
  gatewaySlug: z.string().nullable(),
  customerEmail: z.string().nullable(),
  awaitingApproval: z.boolean(),
});
export type AdminOrderRow = z.infer<typeof adminOrderRowSchema>;

export const awaitingApprovalRowSchema = z.object({
  id: uuidSchema,
  orderNumber: z.string(),
  workspaceName: z.string().nullable(),
  gatewaySlug: z.string().nullable(),
  currency: z.string(),
  total: z.string(),
  paymentReference: z.string().nullable(),
  proofNote: z.string().nullable(),
  hasProof: z.boolean(),
  proofSubmittedAt: z.string().nullable(),
});
export type AwaitingApprovalRow = z.infer<typeof awaitingApprovalRowSchema>;

export const adminOrdersResponseSchema = adminPagedSchema.extend({
  data: z.array(adminOrderRowSchema),
  awaiting: z.array(awaitingApprovalRowSchema),
  kpis: z.object({
    total: z.number().int(),
    /** Percent change against the previous window of the same length, one decimal. */
    totalDeltaPct: z.number(),
    upgrades: z.object({ count: z.number().int(), money: adminMoneySchema }),
    downgrades: z.object({ count: z.number().int(), money: adminMoneySchema }),
    addons: z.object({ count: z.number().int(), money: adminMoneySchema }),
    cancellations: z.object({ count: z.number().int(), money: adminMoneySchema }),
  }),
  reportingCurrency: z.string(),
});
export type AdminOrdersResponse = z.infer<typeof adminOrdersResponseSchema>;

export const orderActionRequestSchema = z.object({
  /** Reject only: why (kept on the order, 500 characters). */
  reviewNote: z.string().trim().max(500).optional(),
});
export type OrderActionRequest = z.infer<typeof orderActionRequestSchema>;

export const orderActionResponseSchema = z.object({
  orderNumber: z.string(),
  status: paygwOrderStatusSchema,
  /** True when nothing changed because the order was already in the target state. */
  unchanged: z.boolean(),
  message: z.string(),
});
export type OrderActionResponse = z.infer<typeof orderActionResponseSchema>;

// ---- billing history (041, 042) -------------------------------------------------------------------------------------------

export const billingWindowSchema = z.enum(['7d', '30d', '90d', '1y', 'all']);
export type BillingWindow = z.infer<typeof billingWindowSchema>;

export const billingStatusFilterSchema = z.enum(['all', 'paid', 'failed', 'refunded', 'pending']);
export type BillingStatusFilter = z.infer<typeof billingStatusFilterSchema>;

export const billingHistoryQuerySchema = z.object({
  window: billingWindowSchema.default('90d'),
  status: billingStatusFilterSchema.default('all'),
  gateway: z.string().trim().max(60).optional(),
  q: searchSchema,
  page: pageSchema,
});
export type BillingHistoryQuery = z.infer<typeof billingHistoryQuerySchema>;

export const trendSchema = z.object({
  labels: z.array(z.string()),
  charges: z.array(z.number()),
  refunds: z.array(z.number()),
  failed: z.array(z.number()).optional(),
});
export type Trend = z.infer<typeof trendSchema>;

export const billingEventRowSchema = z.object({
  id: uuidSchema,
  orderNumber: z.string(),
  createdAt: z.string(),
  workspace: adminWorkspaceRefSchema.nullable(),
  customerEmail: z.string().nullable(),
  customerName: z.string().nullable(),
  gatewaySlug: z.string().nullable(),
  planName: z.string().nullable(),
  status: paygwOrderStatusSchema,
  currency: z.string(),
  total: z.string(),
});
export type BillingEventRow = z.infer<typeof billingEventRowSchema>;

export const billingHistoryResponseSchema = adminPagedSchema.extend({
  data: z.array(billingEventRowSchema),
  gateways: z.array(z.string()),
  reportingCurrency: z.string(),
  kpis: z.object({
    gross: adminMoneySchema,
    grossDeltaPct: z.number(),
    charges: z.number().int(),
    failed: z.number().int(),
    successPct: z.number(),
    refunds: z.number().int(),
    refundsMoney: adminMoneySchema,
    chargebacks: z.number().int(),
    chargebacksMoney: adminMoneySchema,
  }),
  trend: trendSchema,
});
export type BillingHistoryResponse = z.infer<typeof billingHistoryResponseSchema>;

export const billingAnalyticsQuerySchema = z.object({ window: billingWindowSchema.default('90d') });
export type BillingAnalyticsQuery = z.infer<typeof billingAnalyticsQuerySchema>;

export const billingAnalyticsResponseSchema = z.object({
  reportingCurrency: z.string(),
  kpis: z.object({
    gross: adminMoneySchema,
    grossDeltaPct: z.number(),
    net: adminMoneySchema,
    netPct: z.number(),
    successPct: z.number(),
    totalCharges: z.number().int(),
    paidCount: z.number().int(),
    failed: adminMoneySchema,
    failedCount: z.number().int(),
    refunds: adminMoneySchema,
    refundsCount: z.number().int(),
    chargebacks: adminMoneySchema,
    chargebacksCount: z.number().int(),
  }),
  trend: trendSchema,
  gatewayMix: z.array(z.object({ label: z.string(), value: z.number() })),
  statusMix: z.array(z.object({ label: z.string(), value: z.number().int() })),
  topWorkspaces: z.array(
    z.object({
      workspace: adminWorkspaceRefSchema.nullable(),
      orders: z.number().int(),
      total: z.string(),
    }),
  ),
});
export type BillingAnalyticsResponse = z.infer<typeof billingAnalyticsResponseSchema>;

export const orderAnalyticsQuerySchema = z.object({ window: orderWindowSchema.default('90d') });
export type OrderAnalyticsQuery = z.infer<typeof orderAnalyticsQuerySchema>;

export const orderAnalyticsResponseSchema = z.object({
  reportingCurrency: z.string(),
  kpis: z.object({
    total: z.number().int(),
    totalDeltaPct: z.number(),
    newMrr: z.string(),
    paidCount: z.number().int(),
    lostMrr: z.string(),
    cancels: z.number().int(),
    avgOrderValue: z.string(),
    attachPct: z.number(),
    addons: z.number().int(),
    conversionPct: z.number(),
    signups: z.number().int(),
  }),
  motion: z.object({
    labels: z.array(z.string()),
    paid: z.array(z.number().int()),
    cancelled: z.array(z.number().int()),
  }),
  typeMix: z.array(z.object({ label: z.string(), value: z.number().int() })),
  addons: z.array(z.object({ label: z.string(), count: z.number().int(), total: z.string() })),
  /** Real counts only; Reference invented visits, trials and active-in-trial from fixed ratios. */
  funnel: z.array(z.object({ label: z.string(), count: z.number().int() })),
  /** Paid orders by the billing country the buyer entered at checkout (Reference read a users.country_code column that is empty in practice). */
  byCountry: z.array(z.object({ country: z.string(), count: z.number().int() })),
  cohorts: z.array(
    z.object({
      label: z.string(),
      size: z.number().int(),
      cells: z.array(z.number().int().nullable()),
    }),
  ),
});
export type OrderAnalyticsResponse = z.infer<typeof orderAnalyticsResponseSchema>;

// ---- invoices (043..046) --------------------------------------------------------------------------------------------------

export const invoiceWindowSchema = z.enum([
  'all',
  'this_month',
  'last_month',
  'this_quarter',
  'this_year',
]);
export type InvoiceWindow = z.infer<typeof invoiceWindowSchema>;

export const invoiceStatusFilterSchema = z.enum([
  'all',
  'paid',
  'outstanding',
  'overdue',
  'refunded',
  'void',
]);
export type InvoiceStatusFilter = z.infer<typeof invoiceStatusFilterSchema>;

export const invoiceBadgeSchema = z.enum(['paid', 'outstanding', 'overdue', 'refunded', 'void']);
export type InvoiceBadge = z.infer<typeof invoiceBadgeSchema>;

export const invoicesQuerySchema = z.object({
  status: invoiceStatusFilterSchema.default('all'),
  window: invoiceWindowSchema.default('all'),
  q: searchSchema,
  page: pageSchema,
});
export type InvoicesQuery = z.infer<typeof invoicesQuerySchema>;

export const invoiceRowSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  issuedAt: z.string(),
  /** Reference repeats the issue date; here it is the issue date plus the payment terms. */
  dueAt: z.string(),
  workspace: adminWorkspaceRefSchema.nullable(),
  ownerName: z.string().nullable(),
  ownerEmail: z.string().nullable(),
  itemName: z.string(),
  itemUnit: z.string().nullable(),
  /** Drives the service period shown under the item (issue date to one month or one year later). */
  billingPeriod: z.enum(['monthly', 'yearly']).nullable(),
  currency: z.string(),
  total: z.string(),
  badge: invoiceBadgeSchema,
  /** Days past due for an overdue invoice (counted from the due date, not from creation). */
  daysLate: z.number().int(),
  manual: z.boolean(),
});
export type InvoiceRow = z.infer<typeof invoiceRowSchema>;

export const invoicesResponseSchema = adminPagedSchema.extend({
  data: z.array(invoiceRowSchema),
  reportingCurrency: z.string(),
  kpis: z.object({
    total: z.number().int(),
    paid: z.number().int(),
    paidPct: z.number(),
    outstanding: z.number().int(),
    outstandingMoney: adminMoneySchema,
    overdue: z.number().int(),
    thisMonth: adminMoneySchema,
    thisMonthDeltaPct: z.number(),
  }),
  /** For the manual invoice dialog. */
  workspaces: z.array(adminWorkspaceRefSchema),
});
export type InvoicesResponse = z.infer<typeof invoicesResponseSchema>;

export const manualInvoiceRequestSchema = z.object({
  workspaceId: uuidSchema,
  customerName: z.string().trim().max(191).optional(),
  customerEmail: z.string().trim().email().max(191).optional().or(z.literal('')),
  description: z.string().trim().min(1).max(500),
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,7}(\.\d{1,2})?$/, 'Enter an amount such as 250 or 250.00.')
    .refine((v) => Number(v) >= 0.01, 'The amount must be at least 0.01.'),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  status: z.enum(['pending', 'paid']),
  /** ISO date (YYYY-MM-DD); back-dating is allowed. */
  issuedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type ManualInvoiceRequest = z.infer<typeof manualInvoiceRequestSchema>;

export const invoiceActionResponseSchema = z.object({
  number: z.string(),
  badge: invoiceBadgeSchema.nullable(),
  message: z.string(),
});
export type InvoiceActionResponse = z.infer<typeof invoiceActionResponseSchema>;

export const invoiceMarkPaidRequestSchema = z.object({
  /** Run the plan, add-on or wallet fulfilment too (what Order history's "Mark paid" does). Reference's invoice menu did not. */
  applyFulfilment: z.boolean().default(false),
});
export type InvoiceMarkPaidRequest = z.infer<typeof invoiceMarkPaidRequestSchema>;

export const invoiceBillingBlockSchema = z.object({
  company: z.string(),
  address: z.string(),
  taxId: z.string(),
  regNo: z.string(),
  email: z.string(),
  phone: z.string(),
  hasLogo: z.boolean(),
  logoUrl: z.string().nullable(),
});
export type InvoiceBillingBlock = z.infer<typeof invoiceBillingBlockSchema>;

export const invoiceViewSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  issuedAt: z.string(),
  paidAt: z.string().nullable(),
  badge: invoiceBadgeSchema,
  status: paygwOrderStatusSchema,
  workspace: adminWorkspaceRefSchema.nullable(),
  billTo: z.object({
    name: z.string().nullable(),
    email: z.string().nullable(),
    addressLines: z.array(z.string()),
    taxId: z.string().nullable(),
  }),
  payment: z.object({
    method: z.string(),
    reference: z.string().nullable(),
    paidAt: z.string().nullable(),
    currency: z.string(),
    couponCode: z.string().nullable(),
  }),
  line: z.object({
    description: z.string(),
    reference: z.string(),
    unit: z.string().nullable(),
  }),
  currency: z.string(),
  subtotal: z.string(),
  discount: z.string(),
  taxRate: z.string(),
  taxAmount: z.string(),
  total: z.string(),
  amountPaid: z.string(),
  balanceDue: z.string(),
  taxLabel: z.string(),
  gatewaySlug: z.string().nullable(),
  billing: invoiceBillingBlockSchema,
  manual: z.boolean(),
});
export type InvoiceView = z.infer<typeof invoiceViewSchema>;

// ---- CSV export -----------------------------------------------------------------------------------------------------------

export const exportResponseSchema = z.object({
  filename: z.string(),
  csv: z.string(),
  rows: z.number().int(),
  /** True when the export stopped at the row cap. */
  truncated: z.boolean(),
});
export type ExportResponse = z.infer<typeof exportResponseSchema>;

// ---- billing settings (007) -----------------------------------------------------------------------------------------------

export const billingSettingsSchema = z.object({
  taxEnabled: z.boolean(),
  /** Whole percent 0..100 (Reference's form takes an integer). */
  taxRate: z.number().int().min(0).max(100),
  taxLabel: z.string().trim().min(1).max(32),
  refundEnabled: z.boolean(),
  refundDays: z.number().int().min(0).max(365),
  yearlyToggleEnabled: z.boolean(),
  yearlyDiscountPct: z.number().int().min(0).max(100),
  recurringEnabled: z.boolean(),
  /** One country per line in the form; a de-duplicated list here. */
  countries: z.array(z.string().trim().min(1).max(100)).max(300),
  companyName: z.string().trim().max(160),
  companyAddress: z.string().trim().max(500),
  companyTaxId: z.string().trim().max(64),
  companyRegNo: z.string().trim().max(64),
  companyEmail: z.string().trim().email().max(160).or(z.literal('')),
  companyPhone: z.string().trim().max(40),
});
export type BillingSettings = z.infer<typeof billingSettingsSchema>;

export const billingSettingsResponseSchema = billingSettingsSchema.extend({
  hasInvoiceLogo: z.boolean(),
  /** Same-origin URL of the logo invoices print (own logo), or null. The site brand logo fallback is shown by the invoice itself. */
  invoiceLogoUrl: z.string().nullable(),
  /** Optimistic lock: send it back on save. */
  version: z.string(),
  couponCount: z.number().int().nullable(),
  faqCount: z.number().int().nullable(),
});
export type BillingSettingsResponse = z.infer<typeof billingSettingsResponseSchema>;

export const saveBillingSettingsRequestSchema = billingSettingsSchema.extend({
  version: z.string(),
});
export type SaveBillingSettingsRequest = z.infer<typeof saveBillingSettingsRequestSchema>;

export const INVOICE_LOGO_MAX_KB = 1024;
