import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { pageInfoSchema } from '../common/pagination';
import { queryList } from '../contacts-attributes-tags/query-helpers';
import { createInvoiceSchema } from './invoice';

/**
 * Recurring invoices (owner direction; WaDesk had none, only platform subscriptions). A schedule plus a TEMPLATE: the buyer, the
 * links and the priced lines (with the tax each line carried when the schedule was made). A worker generates one invoice per
 * period, idempotently: the pair (schedule, period date) is unique in the run history, so a retried or concurrent run can never
 * produce two invoices for one period. A missed period (the worker was down) is caught up, one invoice per period, up to a cap.
 */
export const RECURRING_FREQUENCIES = ['day', 'week', 'month', 'year'] as const;
export const recurringFrequencySchema = z.enum(RECURRING_FREQUENCIES);
export type RecurringFrequency = z.infer<typeof recurringFrequencySchema>;

/** `draft`: leave each generated invoice a draft for review; `issue`: number it at once; `issue_send`: issue and raise invoice.sent. */
export const RECURRING_MODES = ['draft', 'issue', 'issue_send'] as const;
export const recurringModeSchema = z.enum(RECURRING_MODES);
export type RecurringMode = z.infer<typeof recurringModeSchema>;

export const RECURRING_STATUSES = ['active', 'paused', 'ended'] as const;
export const recurringStatusSchema = z.enum(RECURRING_STATUSES);
export type RecurringStatus = z.infer<typeof recurringStatusSchema>;

export const RECURRING_RUN_STATUSES = ['created', 'failed'] as const;

/** The most periods one worker pass catches up for one schedule. */
export const RECURRING_CATCH_UP_MAX = 12;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD');

// --- the schedule, as pure date maths (the worker and the preview use the same function) ------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * The date of the n-th period (n = 0 is `start`). Monthly and yearly periods keep the START day and clamp to the month's end, and
 * every period is computed from the start (not from the previous one), so a schedule that starts on 31 January goes
 * 31 Jan, 28 Feb, 31 Mar, 30 Apr and never drifts to the 28th.
 */
export function occurrenceDate(
  start: string,
  frequency: RecurringFrequency,
  interval: number,
  n: number,
): string {
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7));
  const d = Number(start.slice(8, 10));
  if (frequency === 'day' || frequency === 'week') {
    const step = frequency === 'day' ? interval : interval * 7;
    return new Date(Date.UTC(y, m - 1, d + step * n)).toISOString().slice(0, 10);
  }
  const months = frequency === 'month' ? interval * n : interval * n * 12;
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  return `${ty}-${pad(tm)}-${pad(Math.min(d, daysInMonth(ty, tm)))}`;
}

/** The next `count` run dates from period index `fromIndex`, stopping at the end date and the run cap. */
export function upcomingRuns(opts: {
  start: string;
  frequency: RecurringFrequency;
  interval: number;
  fromIndex: number;
  end?: string | null;
  maxRuns?: number | null;
  count: number;
}): Array<{ index: number; date: string }> {
  const out: Array<{ index: number; date: string }> = [];
  for (let i = opts.fromIndex; out.length < opts.count && i < opts.fromIndex + 1000; i++) {
    if (opts.maxRuns != null && i >= opts.maxRuns) break;
    const d = occurrenceDate(opts.start, opts.frequency, opts.interval, i);
    if (opts.end && d > opts.end) break;
    out.push({ index: i, date: d });
  }
  return out;
}

// --- wire ---------------------------------------------------------------------------------------------------------------------

/** The template is the body of a new invoice (so everything an invoice carries can recur) or an existing invoice to copy. */
const templateShape = createInvoiceSchema.omit({ issueDate: true, dueDate: true });

export const createRecurringInvoiceSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    frequency: recurringFrequencySchema,
    /** Every N days / weeks / months / years. */
    interval: z.number().int().min(1).max(365).default(1),
    /** The first period; not in the past by more than the catch-up window (the first run is then immediate). */
    startDate: date,
    endDate: date.nullish(),
    /** Stop after this many invoices. */
    maxRuns: z.number().int().min(1).max(1000).nullish(),
    mode: recurringModeSchema.default('draft'),
    /** Channel raised with `issue_send`. */
    sendChannel: z.enum(['link', 'email', 'whatsapp']).default('email'),
    /** Copy the content of this invoice instead of sending `template`. */
    fromInvoiceId: uuidSchema.nullish(),
    template: templateShape.optional(),
  })
  .refine((v) => (v.fromInvoiceId ? !v.template : !!v.template), {
    message: 'send either fromInvoiceId or template',
    path: ['template'],
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: 'the end date is before the start date',
    path: ['endDate'],
  });
export type CreateRecurringInvoiceInput = z.infer<typeof createRecurringInvoiceSchema>;

export const updateRecurringInvoiceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  interval: z.number().int().min(1).max(365).optional(),
  frequency: recurringFrequencySchema.optional(),
  endDate: date.nullish(),
  maxRuns: z.number().int().min(1).max(1000).nullish(),
  mode: recurringModeSchema.optional(),
  sendChannel: z.enum(['link', 'email', 'whatsapp']).optional(),
  /** Replaces the template for FUTURE invoices; those already generated are untouched. */
  template: templateShape.optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateRecurringInvoiceInput = z.infer<typeof updateRecurringInvoiceSchema>;

export const recurringInvoiceResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  status: recurringStatusSchema,
  frequency: recurringFrequencySchema,
  interval: z.number().int(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  maxRuns: z.number().int().nullable(),
  mode: recurringModeSchema,
  sendChannel: z.string(),
  /** The date of the next invoice; null when the schedule has ended or is paused with nothing due. */
  nextRunDate: z.string().nullable(),
  lastRunAt: z.string().datetime().nullable(),
  runCount: z.number().int(),
  failureCount: z.number().int(),
  /** The next five dates, for the schedule preview. */
  upcoming: z.array(z.string()),
  buyerName: z.string().nullable(),
  currency: z.string(),
  /** The total of the next invoice in major units (what the template prices to today). */
  amount: z.string(),
  contact: z.object({ id: uuidSchema, name: z.string().nullable() }).nullable(),
  lineCount: z.number().int(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RecurringInvoiceResponse = z.infer<typeof recurringInvoiceResponseSchema>;

export const listRecurringInvoicesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(512).optional(),
  status: queryList(recurringStatusSchema).optional(),
  contactId: uuidSchema.optional(),
});
export type ListRecurringInvoicesQuery = z.infer<typeof listRecurringInvoicesQuerySchema>;

export const recurringRunSchema = z.object({
  id: z.string(),
  periodIndex: z.number().int(),
  periodDate: z.string(),
  status: z.enum(RECURRING_RUN_STATUSES),
  invoice: z.object({ id: uuidSchema, number: z.string().nullable() }).nullable(),
  error: z.string().nullable(),
  at: z.string().datetime(),
});
export const recurringRunsResponseSchema = z.object({
  data: z.array(recurringRunSchema),
  page: pageInfoSchema,
});
export type RecurringRunsResponse = z.infer<typeof recurringRunsResponseSchema>;

export const listRecurringRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(512).optional(),
});
export type ListRecurringRunsQuery = z.infer<typeof listRecurringRunsQuerySchema>;
