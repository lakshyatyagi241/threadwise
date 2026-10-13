import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { dealDateSchema, dealTotalsSchema, dealUserRefSchema } from '../deals-pipelines/deal';
import { currencyCodeSchema } from '../deals-pipelines/money';
import { stageKindSchema } from '../deals-pipelines/pipeline';
import { agingResponseSchema } from '../invoicing';

/**
 * The CRM dashboard (`/crm`). Reference's page (CrmController@dashboard) was eight counters over the whole workspace, a receivables
 * aging box, the last payments and the next tasks, summed across currencies and cut in the server's zone. This one answers the same
 * questions for a chosen period, pipeline, owner and team: every figure is computed in SQL inside the caller's record scopes, money
 * is exact per currency (and converted only when `convertTo` is given and every rate is known), and the period is cut in the
 * viewer's own time zone.
 *
 * A section the caller may not read (no `record.tasks.read`, no `record.payments.read`, a plan without invoicing) is `null`, not
 * zero, so the page can leave it out instead of printing a number that is not theirs.
 */

export const CRM_DASH_RANGES = ['month', '7d', '30d', '90d', 'custom'] as const;
export const crmDashRangeSchema = z.enum(CRM_DASH_RANGES);
export type CrmDashRange = z.infer<typeof crmDashRangeSchema>;

/** Longest custom period, in days. */
export const CRM_DASH_MAX_DAYS = 366;

export const crmDashboardQuerySchema = z
  .object({
    /** `month` is the calendar month to date (Reference's "this month"). 7d/30d/90d end today and include it. */
    range: crmDashRangeSchema.default('month'),
    /** Custom period, inclusive, in the viewer's zone. A missing `to` is today; a missing `from` is 30 days before `to`. */
    from: dealDateSchema.optional(),
    to: dealDateSchema.optional(),
    /** Omit for every pipeline (the funnel then shows the default one). */
    pipelineId: uuidSchema.optional(),
    /** Deals' owner, tasks' assignee, contacts' owner. */
    ownerId: uuidSchema.optional(),
    /** Everyone who is a member of this team. */
    teamId: uuidSchema.optional(),
    convertTo: currencyCodeSchema.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'from must not be after to',
    path: ['to'],
  });
export type CrmDashboardQuery = z.infer<typeof crmDashboardQuerySchema>;

const countPairSchema = z.object({ current: z.number().int(), previous: z.number().int() });

export const crmDashboardResponseSchema = z.object({
  period: z.object({
    range: crmDashRangeSchema,
    /** The viewer's IANA zone: their profile zone, else the workspace's, else UTC. */
    timezone: z.string(),
    /** `YYYY-MM-DD`, inclusive, in `timezone`. */
    fromDate: z.string(),
    toDate: z.string(),
    days: z.number().int(),
    /** The window of the same length right before, used for the "vs previous" figures. */
    previous: z.object({ fromDate: z.string(), toDate: z.string() }),
    /** The day "today" is in `timezone`. */
    today: z.string(),
  }),
  convertedTo: z.string().nullable(),

  deals: z
    .object({
      open: z.object({
        count: z.number().int(),
        value: dealTotalsSchema,
        /** Value x stage probability over OPEN deals. */
        forecast: dealTotalsSchema,
      }),
      won: z.object({
        count: z.number().int(),
        value: dealTotalsSchema,
        previousCount: z.number().int(),
        previousValue: dealTotalsSchema,
        /** Mean won value per deal, per currency (and converted: converted total / count). Empty with no won deals. */
        averageSize: dealTotalsSchema,
        /** Mean days from creation to won, over the deals won in the period; null with none. */
        averageCycleDays: z.number().nullable(),
      }),
      lost: z.object({ count: z.number().int(), previousCount: z.number().int() }),
      /** Whole percent, won / (won + lost) over deals closed in the period; 0 when nothing closed. */
      winRate: z.number().int(),
      previousWinRate: z.number().int(),
      /** Open deals whose expected close date is before today. */
      overdueCloseCount: z.number().int(),
      funnel: z.object({
        pipeline: z.object({ id: uuidSchema, name: z.string(), currency: z.string() }).nullable(),
        /** What `reached` counts: deals CREATED in the period in that pipeline (and in scope / filters). */
        cohortSize: z.number().int(),
        stages: z.array(
          z.object({
            id: uuidSchema,
            name: z.string(),
            color: z.string(),
            kind: stageKindSchema,
            probability: z.number().int(),
            /** Cohort deals that reached this stage or a later non-lost one. Never rises from one stage to the next. */
            reached: z.number().int(),
            reachedValue: dealTotalsSchema,
            /** reached / reached of the previous stage, whole percent; null for the first stage or when the previous is 0. */
            conversionFromPrevious: z.number().int().nullable(),
            /** Open deals sitting in the stage now (the live snapshot the drill-down opens). */
            openCount: z.number().int(),
            openValue: dealTotalsSchema,
          }),
        ),
      }),
      trend: z.object({
        bucket: z.enum(['day', 'week', 'month']),
        points: z.array(
          z.object({
            /** `YYYY-MM-DD` of the first day of the bucket in the viewer's zone. */
            start: z.string(),
            wonCount: z.number().int(),
            wonValue: dealTotalsSchema,
            lostCount: z.number().int(),
          }),
        ),
      }),
      leaderboard: z.array(
        z.object({
          /** Null: deals nobody owns. */
          owner: dealUserRefSchema.nullable(),
          wonCount: z.number().int(),
          wonValue: dealTotalsSchema,
          lostCount: z.number().int(),
          openCount: z.number().int(),
          /** Notes, calls, emails, meetings and tasks logged by the person in the period (stage moves are not counted). */
          activities: z.number().int(),
        }),
      ),
    })
    .nullable(),

  contacts: z
    .object({
      newContacts: countPairSchema,
      /** New contacts that arrived with a source (a form, an ad, a webhook, an import, a marketplace). */
      newLeads: countPairSchema,
      sources: z.array(
        z.object({
          /** The source label; null groups the contacts that have none. */
          source: z.string().nullable(),
          leads: z.number().int(),
          /** Leads with at least one deal (inside the caller's deal scope). */
          withDeal: z.number().int(),
          withWonDeal: z.number().int(),
          /** Whole percent of `leads`. */
          dealRate: z.number().int(),
          wonRate: z.number().int(),
          wonValue: dealTotalsSchema,
        }),
      ),
    })
    .nullable(),

  tasks: z
    .object({
      open: z.number().int(),
      overdue: z.number().int(),
      dueToday: z.number().int(),
      byAssignee: z.array(
        z.object({
          /** Null: unassigned. */
          assignee: dealUserRefSchema.nullable(),
          open: z.number().int(),
          overdue: z.number().int(),
          dueToday: z.number().int(),
        }),
      ),
      /** The next open tasks by due date (Reference: six). */
      upcoming: z.array(
        z.object({
          id: uuidSchema,
          title: z.string(),
          dueAt: z.string().datetime(),
          overdue: z.boolean(),
          assignee: dealUserRefSchema.nullable(),
        }),
      ),
    })
    .nullable(),

  invoices: z
    .object({
      /** Issued invoices not fully paid, as of now. */
      outstanding: dealTotalsSchema,
      overdue: dealTotalsSchema,
      openInvoices: z.number().int(),
      /** Collected (payments less nothing: refunds are not netted) in the period. */
      collected: dealTotalsSchema,
      previousCollected: dealTotalsSchema,
      /** Invoices that became paid in the period. */
      paidInvoices: z.number().int(),
      aging: agingResponseSchema.shape.currencies,
      recentPayments: z.array(
        z.object({
          id: uuidSchema,
          amount: z.string(),
          currency: z.string(),
          paidAt: z.string().datetime(),
          contact: z.object({ id: uuidSchema, name: z.string().nullable() }).nullable(),
        }),
      ),
    })
    .nullable(),

  activity: z
    .array(
      z.object({
        kind: z.enum(['deal', 'contact']),
        type: z.string(),
        at: z.string().datetime(),
        /** The deal title or the contact's name. */
        subject: z.string().nullable(),
        subjectId: uuidSchema,
        actor: dealUserRefSchema.nullable(),
        /** `stage_change` rows: the stage names, kept with the row. */
        stageChange: z
          .object({ from: z.string().nullable(), to: z.string().nullable() })
          .nullable(),
      }),
    )
    .nullable(),
});
export type CrmDashboardResponse = z.infer<typeof crmDashboardResponseSchema>;
