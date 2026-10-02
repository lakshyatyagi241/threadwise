import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { pageInfoSchema, paginationQuerySchema } from '../common/pagination';
import { queryBoolean } from '../contacts-attributes-tags/query-helpers';
import { currencyCodeSchema, dealValueSchema, moneyTotalSchema } from './money';
import { stageKindSchema } from './pipeline';

/**
 * Deals (WD-DEAL-003..016). A deal sits in exactly one stage of one pipeline; its status (`open|won|lost`) and its won/lost
 * stamps are derived from the stage and never sent by a client.
 */
export const DEAL_TITLE_MAX = 191;
export const DEAL_NOTES_MAX = 5000;

export const dealStatusSchema = z.enum(['open', 'won', 'lost']);
export type DealStatus = z.infer<typeof dealStatusSchema>;

/**
 * Where a deal came from. Staff-created deals are `manual`; the others are stamped by the writer (the public API, the AI
 * copilot, flows, the inbox, orders, Messenger, and the commerce integrations). `shopify`, `woo` and `form` are reserved
 * for integrations not ported yet.
 */
export const DEAL_SOURCES = [
  'manual',
  'inbox',
  'order',
  'shopify',
  'woo',
  'form',
  'api',
  'flow',
  'facebook',
  'ai',
] as const;
export const dealSourceSchema = z.enum(DEAL_SOURCES);
export type DealSource = z.infer<typeof dealSourceSchema>;

export const dealContactRefSchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
});
export type DealContactRef = z.infer<typeof dealContactRefSchema>;

export const dealCompanyRefSchema = z.object({ id: uuidSchema, name: z.string() });
export type DealCompanyRef = z.infer<typeof dealCompanyRefSchema>;

export const dealUserRefSchema = z.object({ id: uuidSchema, name: z.string() });
export type DealUserRef = z.infer<typeof dealUserRefSchema>;

export const dealStageRefSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  color: z.string(),
  probability: z.number().int(),
  kind: stageKindSchema,
});
export type DealStageRef = z.infer<typeof dealStageRefSchema>;

export const dealResponseSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  pipeline: z.object({ id: uuidSchema, name: z.string() }),
  stage: dealStageRefSchema,
  status: dealStatusSchema,
  /** Major units as a decimal string, in `currency` ("100.50"). */
  value: z.string(),
  currency: z.string(),
  owner: dealUserRefSchema.nullable(),
  contact: dealContactRefSchema.nullable(),
  company: dealCompanyRefSchema.nullable(),
  /** `YYYY-MM-DD`; informational, not cleared when the deal closes. */
  expectedCloseDate: z.string().nullable(),
  source: dealSourceSchema,
  /** The reason text kept with the deal (the catalogue name at the time, or free text from the API). */
  lostReason: z.string().nullable(),
  lostReasonId: uuidSchema.nullable(),
  notes: z.string().nullable(),
  wonAt: z.string().datetime().nullable(),
  lostAt: z.string().datetime().nullable(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DealResponse = z.infer<typeof dealResponseSchema>;

/** A real calendar day as `YYYY-MM-DD`: `2026-02-31` matches the shape but is not a day (the database would refuse it with a 500). */
export function isRealCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

export const dealDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .refine(isRealCalendarDate, 'date is not a real calendar day');

export const createDealSchema = z.object({
  title: z.string().trim().min(1).max(DEAL_TITLE_MAX),
  /** Omit for the workspace default pipeline. */
  pipelineId: uuidSchema.optional(),
  /** Must belong to the pipeline (422 DEAL_STAGE_MISMATCH otherwise). Omit for the pipeline's first stage. */
  stageId: uuidSchema.optional(),
  value: dealValueSchema.optional(),
  /** Omit for the pipeline's currency. Never converted or relabelled afterwards. */
  currency: currencyCodeSchema.optional(),
  /** A member of this workspace. Omit for the caller; `null` for no owner. */
  ownerId: uuidSchema.nullish(),
  contactId: uuidSchema.nullish(),
  /** Omit to inherit the contact's company. */
  companyId: uuidSchema.nullish(),
  expectedCloseDate: dealDateSchema.nullish(),
  notes: z.string().trim().max(DEAL_NOTES_MAX).nullish(),
});
export type CreateDealInput = z.infer<typeof createDealSchema>;

/** Absent keeps, `null` clears (where the field can be empty). The stage moves through its own routes. */
export const updateDealSchema = z.object({
  title: z.string().trim().min(1).max(DEAL_TITLE_MAX).optional(),
  value: dealValueSchema.optional(),
  currency: currencyCodeSchema.optional(),
  ownerId: uuidSchema.nullish(),
  contactId: uuidSchema.nullish(),
  companyId: uuidSchema.nullish(),
  expectedCloseDate: dealDateSchema.nullish(),
  notes: z.string().trim().max(DEAL_NOTES_MAX).nullish(),
  rowVersion: z.number().int().positive(),
});
export type UpdateDealInput = z.infer<typeof updateDealSchema>;

const dealFilterFields = {
  q: z.string().trim().min(1).max(100).optional(),
  ownerId: uuidSchema.optional(),
  /** Deals with no owner. Not together with `ownerId`. */
  unassigned: queryBoolean().optional(),
  contactId: uuidSchema.optional(),
  companyId: uuidSchema.optional(),
  source: dealSourceSchema.optional(),
};

export const listDealsQuerySchema = paginationQuerySchema
  .extend({
    ...dealFilterFields,
    pipelineId: uuidSchema.optional(),
    stageId: uuidSchema.optional(),
    status: dealStatusSchema.optional(),
    currency: currencyCodeSchema.optional(),
  })
  .refine((q) => !(q.ownerId && q.unassigned), {
    message: 'ownerId and unassigned cannot be combined',
    path: ['unassigned'],
  });
export type ListDealsQuery = z.infer<typeof listDealsQuerySchema>;

/**
 * Drop the card between two others to keep the order inside a column (WD-DEAL-007, D-07). Give at most one: `beforeDealId` puts
 * the deal directly above that card, `afterDealId` directly below it; neither puts it on top of the column.
 */
export const moveDealStageSchema = z
  .object({
    stageId: uuidSchema,
    beforeDealId: uuidSchema.optional(),
    afterDealId: uuidSchema.optional(),
    /** For a move into a lost stage: the catalogue reason, and/or free text. */
    lostReasonId: uuidSchema.optional(),
    lostReason: z.string().trim().min(1).max(191).optional(),
    /** Optional; when sent, a stale value is 409 ROW_VERSION_CONFLICT. */
    rowVersion: z.number().int().positive().optional(),
  })
  .refine((v) => !(v.beforeDealId && v.afterDealId), {
    message: 'give beforeDealId or afterDealId, not both',
    path: ['afterDealId'],
  });
export type MoveDealStageInput = z.infer<typeof moveDealStageSchema>;

export const markDealWonSchema = z.object({ rowVersion: z.number().int().positive().optional() });
export type MarkDealWonInput = z.infer<typeof markDealWonSchema>;

export const markDealLostSchema = z.object({
  lostReasonId: uuidSchema.optional(),
  /** Free text; with `lostReasonId` the catalogue name wins. A workspace can require one of the two. */
  reason: z.string().trim().min(1).max(191).optional(),
  rowVersion: z.number().int().positive().optional(),
});
export type MarkDealLostInput = z.infer<typeof markDealLostSchema>;

export const reopenDealSchema = z.object({
  /** An open stage of the deal's pipeline; omit for its first open stage. */
  stageId: uuidSchema.optional(),
  rowVersion: z.number().int().positive().optional(),
});
export type ReopenDealInput = z.infer<typeof reopenDealSchema>;

// --- board (WD-DEAL-003..005) ---------------------------------------------------------------------------------------------

export const BOARD_PAGE_DEFAULT = 25;

export const boardQuerySchema = z
  .object({
    /** Omit for the default pipeline. */
    pipelineId: uuidSchema.optional(),
    ...dealFilterFields,
    /** Cards per column on the first page. */
    limit: z.coerce.number().int().min(1).max(100).default(BOARD_PAGE_DEFAULT),
    /** Report each column's total converted to this currency too (rates from the currency table). */
    convertTo: currencyCodeSchema.optional(),
  })
  .refine((q) => !(q.ownerId && q.unassigned), {
    message: 'ownerId and unassigned cannot be combined',
    path: ['unassigned'],
  });
export type BoardQuery = z.infer<typeof boardQuerySchema>;

export const boardStageQuerySchema = z
  .object({
    ...dealFilterFields,
    limit: z.coerce.number().int().min(1).max(100).default(BOARD_PAGE_DEFAULT),
    cursor: z.string().min(1).max(512).optional(),
  })
  .refine((q) => !(q.ownerId && q.unassigned), {
    message: 'ownerId and unassigned cannot be combined',
    path: ['unassigned'],
  });
export type BoardStageQuery = z.infer<typeof boardStageQuerySchema>;

/** A sum that is exact per currency, and converted into one currency when asked and every rate is known. */
export const dealTotalsSchema = z.object({
  /** One entry per currency present, never a mix. */
  byCurrency: z.array(moneyTotalSchema),
  /** Present with `convertTo`: the sum in that currency, or null when a currency in it has no exchange rate. */
  converted: moneyTotalSchema.nullable().optional(),
  /** With `convertTo`: currencies that have no rate and so are missing from `converted`. */
  unconverted: z.array(z.string()).optional(),
});
export type DealTotals = z.infer<typeof dealTotalsSchema>;

export const boardStageResponseSchema = z.object({
  stage: dealStageRefSchema.extend({ sortOrder: z.number().int() }),
  /** Deals in the column after the board filters. */
  count: z.number().int(),
  /** Value of those deals. */
  total: dealTotalsSchema,
  /** Probability-weighted value of an OPEN column's deals (empty for won and lost columns). */
  weighted: dealTotalsSchema,
  /** The first page of cards, in the column's manual order (newest on top until a card is moved). */
  deals: z.array(dealResponseSchema),
  page: pageInfoSchema,
});
export type BoardStageResponse = z.infer<typeof boardStageResponseSchema>;

/** The KPI strip. Filter-independent (a filter never changes the KPIs) and counts OPEN deals only for the forecast (D-04). */
export const boardKpisSchema = z.object({
  openCount: z.number().int(),
  openValue: dealTotalsSchema,
  forecast: dealTotalsSchema,
  wonThisMonthCount: z.number().int(),
  wonThisMonthValue: dealTotalsSchema,
  /** Whole percent over won and lost deals of the pipeline, all time; 0 when none closed. */
  winRate: z.number().int(),
});
export type BoardKpis = z.infer<typeof boardKpisSchema>;

export const boardResponseSchema = z.object({
  pipeline: z.object({
    id: uuidSchema,
    name: z.string(),
    currency: z.string(),
    isDefault: z.boolean(),
  }),
  stages: z.array(boardStageResponseSchema),
  kpis: boardKpisSchema,
});
export type BoardResponse = z.infer<typeof boardResponseSchema>;

export const boardStagePageResponseSchema = z.object({
  data: z.array(dealResponseSchema),
  page: pageInfoSchema,
});
export type BoardStagePageResponse = z.infer<typeof boardStagePageResponseSchema>;

// --- one contact's deals (WD-DEAL-037) ------------------------------------------------------------------------------------

export const contactDealsResponseSchema = z.object({
  /** Open first, then newest; at most 50. */
  deals: z.array(dealResponseSchema),
  rollup: z.object({
    openCount: z.number().int(),
    openValue: z.array(moneyTotalSchema),
    wonCount: z.number().int(),
    wonValue: z.array(moneyTotalSchema),
  }),
});
export type ContactDealsResponse = z.infer<typeof contactDealsResponseSchema>;
