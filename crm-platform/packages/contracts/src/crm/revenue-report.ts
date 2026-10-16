import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { dealDateSchema, dealTotalsSchema } from '../deals-pipelines/deal';
import { currencyCodeSchema } from '../deals-pipelines/money';
import { agingResponseSchema } from '../invoicing';

/**
 * The revenue report (`/crm/revenue`, TW-PAY-017). Reference's report was four counters summed in raw minor units under one
 * currency symbol, a six month bar chart, a receivables aging box and a flat CSV of the last 5,000 payments. This one answers the
 * same questions for a chosen period with a comparison, split by lead source, how the invoice was raised, product, owner or team:
 * what was invoiced, what of it is paid and still owed, and what cash came in. Every figure is a grouped query inside the
 * caller's `record.payments.read` scope; money is exact per currency and converted only when `convertTo` is given and every rate
 * is known (Reference summed currencies together and printed a warning).
 *
 * Two views sit side by side and are never mixed in one number:
 *  - the invoices ISSUED in the period (invoiced, credited, paid so far, outstanding now, overdue now), and
 *  - the money that CAME IN during the period (collected, refunded), whichever invoice it settled.
 */

export const REVENUE_RANGES = [
  'month',
  'lastMonth',
  '30d',
  '90d',
  'quarter',
  'year',
  'custom',
] as const;
export const revenueRangeSchema = z.enum(REVENUE_RANGES);
export type RevenueRange = z.infer<typeof revenueRangeSchema>;

/** `previous` is the window of the same length right before; `lastYear` the same dates one year earlier. */
export const REVENUE_COMPARES = ['previous', 'lastYear', 'none'] as const;
export const revenueCompareSchema = z.enum(REVENUE_COMPARES);
export type RevenueCompare = z.infer<typeof revenueCompareSchema>;
/** The comparison windows that exist (`none` has no window). */
export const revenueCompareModeSchema = revenueCompareSchema.exclude(['none']);
export type RevenueCompareMode = z.infer<typeof revenueCompareModeSchema>;

/**
 * How the table splits the numbers.
 * `source`  the lead source of the customer (contacts.source), none when the customer has none;
 * `origin`  how the invoice was raised (manual, quote, order, Shopify, ...);
 * `product` the invoice line (SKU, else the description); document discounts and shipping are spread over the lines pro rata;
 * `owner`   the invoice owner;
 * `team`    the owner's team (a person on two teams counts in both; no team is its own row).
 */
export const REVENUE_GROUPS = ['source', 'origin', 'product', 'owner', 'team'] as const;
export const revenueGroupSchema = z.enum(REVENUE_GROUPS);
export type RevenueGroup = z.infer<typeof revenueGroupSchema>;

/** Longest period, in days. */
export const REVENUE_MAX_DAYS = 366;
/** Rows of the table (biggest invoiced first); the response says when more existed. */
export const REVENUE_ROW_LIMIT = 50;

export const REVENUE_PERMISSIONS = {
  /** The report itself rides on the payments read capability: the record scope of that key cuts every number. */
  read: 'record.payments.read',
  export: 'record.payments.export',
} as const;

export const REVENUE_EXPORT_MODULE = 'revenue-report-exports';
export const REVENUE_EXPORT_TTL_DAYS = 7;
/** A ledger CSV stops past this many payments (the file is held in memory while it is built). */
export const REVENUE_EXPORT_MAX_ROWS = 200_000;

const filterFields = {
  /** `month` is the calendar month to date, `lastMonth` the whole previous month, `quarter` and `year` are to date. */
  range: revenueRangeSchema.default('month'),
  /** Custom period, inclusive, in the viewer's zone. A missing `to` is today; a missing `from` is 30 days before `to`. */
  from: dealDateSchema.optional(),
  to: dealDateSchema.optional(),
  compare: revenueCompareSchema.default('previous'),
  groupBy: revenueGroupSchema.default('source'),
  /** The invoice owner. */
  ownerId: uuidSchema.optional(),
  /** Everyone who is a member of this team. */
  teamId: uuidSchema.optional(),
  /** Only invoices and payments in this currency: the exact figures of a mixed-currency workspace. */
  currency: currencyCodeSchema.optional(),
  /** Show everything in one currency; a currency with no exchange rate is named and left out. */
  convertTo: currencyCodeSchema.optional(),
};

export const revenueReportQuerySchema = z
  .object(filterFields)
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'from must not be after to',
    path: ['to'],
  });
export type RevenueReportQuery = z.infer<typeof revenueReportQuerySchema>;

// --- response ------------------------------------------------------------------------------------------------------------------

/** One figure for the period and, when a comparison was asked for, for the comparison window. */
const periodMoneySchema = z.object({
  current: dealTotalsSchema,
  previous: dealTotalsSchema.nullable(),
});
export type RevenuePeriodMoney = z.infer<typeof periodMoneySchema>;

const periodCountSchema = z.object({
  current: z.number().int(),
  previous: z.number().int().nullable(),
});

/**
 * invoiced     total of the invoices issued in the period (drafts, voided and proforma left out)
 * credited     credit notes against those invoices
 * paid         what has been received against them so far, net of refunds
 * outstanding  what they still owe now (invoiced - credited - paid, never below 0 per invoice)
 * overdue      the part of outstanding whose due date has passed
 * collected    payments received in the period, on any invoice (or none)
 * refunded     refunds paid out in the period, as a positive amount
 */
export const revenueMetricsSchema = z.object({
  invoiced: periodMoneySchema,
  credited: periodMoneySchema,
  paid: periodMoneySchema,
  outstanding: periodMoneySchema,
  overdue: periodMoneySchema,
  collected: periodMoneySchema,
  refunded: periodMoneySchema,
});
export type RevenueMetrics = z.infer<typeof revenueMetricsSchema>;

export const revenueRowSchema = z.object({
  /** Stable within one response: the source text, the invoice origin, the product SKU or description, a user or team uuid. Empty for the rows that have no value (no source, unassigned, no team, no line items). */
  key: z.string(),
  /** What to print: the source text, the product description, a person or team name. Null: the row has no value (none, unassigned). */
  label: z.string().nullable(),
  /** A user (owner) or team uuid, so the row can link to its record. */
  id: uuidSchema.nullable(),
  invoices: periodCountSchema,
  metrics: revenueMetricsSchema,
});
export type RevenueRow = z.infer<typeof revenueRowSchema>;

export const revenueReportResponseSchema = z.object({
  period: z.object({
    range: revenueRangeSchema,
    /** The viewer's IANA zone: their profile zone, else the workspace's, else UTC. */
    timezone: z.string(),
    /** `YYYY-MM-DD`, inclusive, in `timezone`. */
    fromDate: z.string(),
    toDate: z.string(),
    days: z.number().int(),
    today: z.string(),
  }),
  comparison: z
    .object({ mode: revenueCompareModeSchema, fromDate: z.string(), toDate: z.string() })
    .nullable(),
  convertedTo: z.string().nullable(),
  /** Currencies present in the viewer's scope (invoices and payments), sorted. */
  currencies: z.array(z.string()),
  /** More than one currency and no `convertTo` or `currency`: totals are then listed per currency, never added. */
  mixedCurrency: z.boolean(),

  summary: z.object({
    metrics: revenueMetricsSchema,
    /** Tax on invoices that became fully paid in the period. */
    taxCollected: periodMoneySchema,
    invoices: z.object({
      issued: periodCountSchema,
      /** Invoices that became fully paid in the period. */
      paidInFull: periodCountSchema,
    }),
    /** Reference's "Outstanding": every issued invoice not fully paid, as of today, whatever the period (the aging adds up to it). */
    receivables: z.object({
      outstanding: dealTotalsSchema,
      overdue: dealTotalsSchema,
      invoices: z.number().int(),
    }),
    /** Everything ever collected inside the scope (Reference's "Collected (all)"). */
    collectedAllTime: dealTotalsSchema,
  }),

  rows: z.object({
    groupBy: revenueGroupSchema,
    items: z.array(revenueRowSchema),
    /** True when more rows existed than REVENUE_ROW_LIMIT. */
    truncated: z.boolean(),
  }),

  trend: z.object({
    bucket: z.enum(['day', 'week', 'month']),
    points: z.array(
      z.object({
        /** `YYYY-MM-DD` of the first day of the bucket in the viewer's zone. */
        start: z.string(),
        invoiced: dealTotalsSchema,
        collected: dealTotalsSchema,
      }),
    ),
  }),

  /** Receivables as of today, per currency, over the same scope and owner/team filters. */
  aging: z.object({ asOf: z.string(), currencies: agingResponseSchema.shape.currencies }),
});
export type RevenueReportResponse = z.infer<typeof revenueReportResponseSchema>;

// --- export --------------------------------------------------------------------------------------------------------------------

export const REVENUE_EXPORT_FORMATS = ['csv', 'pdf'] as const;
export const revenueExportFormatSchema = z.enum(REVENUE_EXPORT_FORMATS);
export type RevenueExportFormat = z.infer<typeof revenueExportFormatSchema>;

/**
 * `payments` is Reference's file: one line per payment (and refund) of the period with its Date, Amount, Currency, Method, Source,
 * Invoice, Contact, Company and Reference columns first. `summary` is the table on screen (the grouping and the totals).
 */
export const REVENUE_CSV_KINDS = ['payments', 'summary'] as const;
export const revenueCsvKindSchema = z.enum(REVENUE_CSV_KINDS);
export type RevenueCsvKind = z.infer<typeof revenueCsvKindSchema>;

export const revenueExportStatusSchema = z.enum([
  'queued',
  'running',
  'ready',
  'failed',
  'expired',
]);
export type RevenueExportStatus = z.infer<typeof revenueExportStatusSchema>;

/** `POST /v2/crm/revenue/exports`: the filters on screen plus the file wanted. */
export const requestRevenueExportSchema = z
  .object({
    ...filterFields,
    format: revenueExportFormatSchema,
    csvKind: revenueCsvKindSchema.default('payments'),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'from must not be after to',
    path: ['to'],
  });
export type RequestRevenueExport = z.infer<typeof requestRevenueExportSchema>;

/**
 * What an export was built with: the window and its comparison are fixed to dates when the export is asked for, so "this month"
 * means the month of the click, not of the moment the worker gets to it.
 */
export const revenueExportFiltersSchema = z.object({
  range: revenueRangeSchema,
  fromDate: z.string(),
  toDate: z.string(),
  timezone: z.string(),
  compare: z
    .object({ mode: revenueCompareModeSchema, fromDate: z.string(), toDate: z.string() })
    .nullable(),
  groupBy: revenueGroupSchema,
  ownerId: uuidSchema.nullable(),
  teamId: uuidSchema.nullable(),
  currency: z.string().nullable(),
  convertTo: z.string().nullable(),
});
export type RevenueExportFilters = z.infer<typeof revenueExportFiltersSchema>;

export const revenueExportSchema = z.object({
  id: uuidSchema,
  format: revenueExportFormatSchema,
  csvKind: revenueCsvKindSchema.nullable(),
  status: revenueExportStatusSchema,
  rowCount: z.number().int().nonnegative().nullable(),
  fileBytes: z.number().int().nonnegative().nullable(),
  error: z.string().nullable(),
  requestedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  emailedTo: z.string().nullable(),
  filters: revenueExportFiltersSchema,
});
export type RevenueExport = z.infer<typeof revenueExportSchema>;

export const revenueExportListSchema = z.object({ data: z.array(revenueExportSchema) });
export type RevenueExportList = z.infer<typeof revenueExportListSchema>;

export const REVENUE_ERROR_CODES = {
  /** An export of the revenue report is already being prepared for this person. 409. */
  REVENUE_EXPORT_IN_PROGRESS: 'REVENUE_EXPORT_IN_PROGRESS',
  REVENUE_EXPORT_NOT_FOUND: 'REVENUE_EXPORT_NOT_FOUND',
  /** The export is not ready (still building, failed) or its file has expired. 409. */
  REVENUE_EXPORT_NOT_READY: 'REVENUE_EXPORT_NOT_READY',
} as const;
