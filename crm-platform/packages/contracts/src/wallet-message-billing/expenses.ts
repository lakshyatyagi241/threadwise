import { z } from 'zod';
import { timeZoneSchema } from '../appointments/booking-type';
import { pageInfoSchema } from '../common/pagination';
import { exactAmountSchema, walletBillingModeSchema } from './wallet';

/**
 * The message expense log: one row per billable message, with the template, the channel and what the message cost. It reads the
 * same charges as the statement, so a row here and the statement line for it always agree. Channel, template and category are plain
 * dimensions, not WhatsApp screens, so an SMS or email channel adds rows here without a new page.
 */

/** `charged` = the message was billed and not reversed; `refunded` = billed, then reversed (the provider reported it failed); `free` = not billed. */
export const expenseStatusSchema = z.enum(['charged', 'free', 'refunded']);
export type ExpenseStatus = z.infer<typeof expenseStatusSchema>;

export const expenseFreeReasonSchema = z.enum([
  'rate_is_zero',
  'within_plan_free_quota',
  'no_wallet_owner',
  'wallet_empty',
]);
export type ExpenseFreeReason = z.infer<typeof expenseFreeReasonSchema>;

/** The dimensions the summary can group by. */
export const expenseGroupBySchema = z.enum(['template', 'source', 'category', 'country']);
export type ExpenseGroupBy = z.infer<typeof expenseGroupBySchema>;

/** A calendar day, `YYYY-MM-DD`. */
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** `all` plus the three statuses: what the status filter takes. */
export const expenseStatusFilterSchema = z.enum(['all', 'charged', 'free', 'refunded']);
export type ExpenseStatusFilter = z.infer<typeof expenseStatusFilterSchema>;

/** The filters shared by the log, the summary and the day log. `source` and `category` take any value the charge carries, not only today's list. `from` and `to` are calendar days in `timeZone`, so a day is the same day the viewer sees on each message. */
export const expenseFilterSchema = z.object({
  status: expenseStatusFilterSchema.default('all'),
  from: isoDay.optional(),
  to: isoDay.optional(),
  timeZone: timeZoneSchema.default('UTC'),
  template: z.string().trim().max(512).optional(),
  source: z.string().trim().max(24).optional(),
  category: z.string().trim().max(24).optional(),
});
export type ExpenseFilter = z.infer<typeof expenseFilterSchema>;

export const expenseListQuerySchema = expenseFilterSchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(512).optional(),
});
export type ExpenseListQuery = z.infer<typeof expenseListQuerySchema>;

export const expenseSummaryQuerySchema = expenseFilterSchema.extend({
  groupBy: expenseGroupBySchema.default('template'),
});
export type ExpenseSummaryQuery = z.infer<typeof expenseSummaryQuerySchema>;

/** The day log pages by day, not by row: a day's groups always arrive together. `cursor` is the last day of the previous page. */
export const expenseDaysQuerySchema = expenseFilterSchema.extend({
  limit: z.coerce.number().int().min(1).max(31).default(14),
  cursor: isoDay.optional(),
});
export type ExpenseDaysQuery = z.infer<typeof expenseDaysQuerySchema>;

export const expenseEventSchema = z.object({
  /** The provider's message id: the one WhatsApp shows for the message. Not an internal id. */
  id: z.string().min(1).max(191),
  createdAt: z.string(),
  status: expenseStatusSchema,
  billingMode: walletBillingModeSchema,
  /** Why the message was not billed; null for a billed message. */
  freeReason: expenseFreeReasonSchema.nullable(),
  /** The channel that sent it: campaign, broadcast, scheduled, flow, auto_reply, chat, inbox or api. */
  source: z.string().nullable(),
  /** The provider: waba, baileys or twilio. */
  engine: z.string().nullable(),
  country: z.string().nullable(),
  category: z.string().nullable(),
  template: z.string().nullable(),
  subjectName: z.string().nullable(),
  /** What the wallet took for this message, in hundredths, and to the ledger's exact precision. */
  chargedMinor: z.number().int(),
  chargedExact: exactAmountSchema.optional(),
  /** What came back when the message failed. */
  refundedMinor: z.number().int(),
  refundedExact: exactAmountSchema.optional(),
  /** Charged minus refunded: what this message cost in the end. */
  netMinor: z.number().int(),
  netExact: exactAmountSchema.optional(),
  /** Part of the price the balance could not cover (it ran out mid-message). */
  uncollectedMinor: z.number().int(),
  refundedAt: z.string().nullable(),
});
export type ExpenseEvent = z.infer<typeof expenseEventSchema>;

export const expenseListResponseSchema = z.object({
  currency: z.string(),
  data: z.array(expenseEventSchema),
  page: pageInfoSchema,
});
export type ExpenseListResponse = z.infer<typeof expenseListResponseSchema>;

/** One line of the summary: the totals of the messages that share one value of the grouped dimension. `key` null = not recorded. */
export const expenseGroupSchema = z.object({
  key: z.string().nullable(),
  messages: z.number().int(),
  /** Messages that were billed at some point (`charged` and `refunded`). */
  charged: z.number().int(),
  /** Billed messages that were reversed. */
  refunded: z.number().int(),
  /** Messages the plan or the wallet did not bill. */
  free: z.number().int(),
  chargedMinor: z.number().int(),
  chargedExact: exactAmountSchema.optional(),
  refundedMinor: z.number().int(),
  refundedExact: exactAmountSchema.optional(),
  netMinor: z.number().int(),
  netExact: exactAmountSchema.optional(),
});
export type ExpenseGroup = z.infer<typeof expenseGroupSchema>;

export const expenseSummaryResponseSchema = z.object({
  currency: z.string(),
  groupBy: expenseGroupBySchema,
  /** Over the WHOLE filtered set, not only the groups shown. */
  totals: expenseGroupSchema.omit({ key: true }),
  groups: z.array(expenseGroupSchema),
  /** True when there were more groups than the response carries (largest first). */
  truncated: z.boolean(),
});
export type ExpenseSummaryResponse = z.infer<typeof expenseSummaryResponseSchema>;

/** One line of the day log: the messages of one calendar day (in the viewer's time zone) with one status, channel and category. `source` and `category` null = not recorded. */
export const expenseDayGroupSchema = z.object({
  day: isoDay,
  status: expenseStatusSchema,
  source: z.string().nullable(),
  category: z.string().nullable(),
  messages: z.number().int(),
  chargedMinor: z.number().int(),
  chargedExact: exactAmountSchema.optional(),
  refundedMinor: z.number().int(),
  refundedExact: exactAmountSchema.optional(),
  netMinor: z.number().int(),
  netExact: exactAmountSchema.optional(),
});
export type ExpenseDayGroup = z.infer<typeof expenseDayGroupSchema>;

export const expenseDaysResponseSchema = z.object({
  currency: z.string(),
  data: z.array(expenseDayGroupSchema),
  /** `nextCursor` is the day to pass as `cursor` for the next page: the days after it are the older ones. */
  page: pageInfoSchema,
});
export type ExpenseDaysResponse = z.infer<typeof expenseDaysResponseSchema>;
