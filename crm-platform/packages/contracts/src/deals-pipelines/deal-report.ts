import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { currencyCodeSchema } from './money';
import { dealTotalsSchema, dealUserRefSchema, dealDateSchema } from './deal';
import { stageKindSchema } from './pipeline';

/**
 * Deal reports (WD-DEAL-019, 020, 040). Every money figure is exact per currency: WaDesk summed raw minor units across currencies
 * and labelled the total with one symbol. Here a figure is a list of per-currency totals; pass `convertTo` to also get it in
 * one currency (rates from the currency table; a currency with no rate is named in `unconverted`, never guessed at 1.0).
 */

export const dealReportsQuerySchema = z
  .object({
    /** Omit for every pipeline of the workspace. */
    pipelineId: uuidSchema.optional(),
    ownerId: uuidSchema.optional(),
    /** Closed-deal metrics (won, lost, win rate, leaders, lost reasons) count deals closed in [from, to], in the workspace time zone. */
    from: dealDateSchema.optional(),
    to: dealDateSchema.optional(),
    convertTo: currencyCodeSchema.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'from must not be after to',
    path: ['to'],
  });
export type DealReportsQuery = z.infer<typeof dealReportsQuerySchema>;

export const dealReportsResponseSchema = z.object({
  /** The IANA zone "this month" and the monthly buckets are cut in (the workspace's, else UTC). */
  timezone: z.string(),
  convertedTo: z.string().nullable(),
  open: z.object({
    count: z.number().int(),
    value: dealTotalsSchema,
    /** Sum of value x stage probability over OPEN deals only (WaDesk's board also counted the won column). */
    forecast: dealTotalsSchema,
  }),
  won: z.object({
    count: z.number().int(),
    value: dealTotalsSchema,
    /** Deals won since the first of the current month in `timezone` (WaDesk labelled all-time value "this month"). */
    thisMonth: z.object({ count: z.number().int(), value: dealTotalsSchema }),
    /** Mean days from creation to won; null with no won deals. */
    avgDaysToClose: z.number().nullable(),
  }),
  lost: z.object({ count: z.number().int(), value: dealTotalsSchema }),
  /** Whole percent, won / (won + lost); 0 when nothing closed. */
  winRate: z.number().int(),
  byStage: z.array(
    z.object({
      stageId: uuidSchema,
      pipelineId: uuidSchema,
      name: z.string(),
      color: z.string(),
      kind: stageKindSchema,
      probability: z.number().int(),
      /** OPEN deals in the stage (a won or lost stage reports 0). */
      count: z.number().int(),
      value: dealTotalsSchema,
      weighted: dealTotalsSchema,
    }),
  ),
  /** The last six calendar months, oldest first, ending with the current one (or the month of `to`). */
  months: z.array(
    z.object({
      /** `YYYY-MM`. */
      month: z.string(),
      wonCount: z.number().int(),
      wonValue: dealTotalsSchema,
      lostCount: z.number().int(),
    }),
  ),
  /** Top ten owners of won deals. Ordered by converted value with `convertTo`, else by won count then first currency's value. */
  leaders: z.array(
    z.object({
      owner: dealUserRefSchema,
      wonCount: z.number().int(),
      value: dealTotalsSchema,
    }),
  ),
  lostReasons: z.array(z.object({ reason: z.string().nullable(), count: z.number().int() })),
});
export type DealReportsResponse = z.infer<typeof dealReportsResponseSchema>;
