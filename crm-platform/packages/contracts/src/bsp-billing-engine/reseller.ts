import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { cursorSchema, pageInfoSchema } from '../common/pagination';

/**
 * Meta only accepts these ISO codes as the currency of a shared credit line, and the currency is locked once attached
 * (WD-BSP-006 rule 5). WaDesk offered every currency in its table and let Meta reject the rest; here the rest are refused up front.
 */
export const BSP_CREDIT_CURRENCIES = ['AUD', 'EUR', 'GBP', 'IDR', 'INR', 'USD'] as const;
export type BspCreditCurrency = (typeof BSP_CREDIT_CURRENCIES)[number];

export const BSP_DEFAULT_GRAPH_VERSION = 'v26.0';
export const BSP_DEFAULT_BASE_CURRENCY = 'USD';
const GRAPH_VERSION = /^v\d{1,2}\.\d{1,2}$/;
/** The token is sent to this address, so plain http is refused (WaDesk sent it anywhere). */
const HTTPS_URL = /^https:\/\/[^\s/?#]+[^\s]*$/i;

export function isCreditCurrency(code: string): code is BspCreditCurrency {
  return (BSP_CREDIT_CURRENCIES as readonly string[]).includes(code);
}

/** What the "Bill in" field stores: letters only, upper-case, at most 8; nothing left means "Auto" (WD-BSP-004 rule 4). */
export function normalizeCurrencyInput(raw: string | null | undefined): string {
  return (raw ?? '')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase()
    .slice(0, 8);
}

/** The version the credit line talks to; blank means the default. Anything else must look like `v26.0`. */
export function normalizeGraphVersion(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v) return BSP_DEFAULT_GRAPH_VERSION;
  return GRAPH_VERSION.test(v) ? v : null;
}

export const bspAllocationStatusSchema = z.enum(['attached', 'revoked', 'failed']);
export type BspAllocationStatus = z.infer<typeof bspAllocationStatusSchema>;

export const bspBillingModeSchema = z.enum(['meta_direct', 'reseller']);
export type BspBillingMode = z.infer<typeof bspBillingModeSchema>;

// --- connection settings (WD-BSP-003, -004) --------------------------------------------------------------------------------

export const bspSettingsResponseSchema = z.object({
  businessId: z.string(),
  extendedCreditId: z.string(),
  /** Whether a token is stored. The token itself never leaves the server. */
  tokenSet: z.boolean(),
  graphVersion: z.string(),
  ratesEndpoint: z.string(),
  autoAttach: z.boolean(),
  /** Blank = "Auto": the base currency. */
  autoAttachCurrency: z.string(),
  baseCurrency: z.string(),
  /** Token and business id both present. It does not mean Meta accepted them. */
  configured: z.boolean(),
  creditCurrencies: z.array(z.string()),
});
export type BspSettingsResponse = z.infer<typeof bspSettingsResponseSchema>;

const trimmed = (max: number) => z.string().trim().max(max);

export const updateBspSettingsSchema = z
  .object({
    /** Blank clears the value (WD-BSP-004 rule 1). */
    businessId: trimmed(64),
    extendedCreditId: trimmed(64),
    /** Written only when non-blank; to remove a stored token send `clearToken`. */
    systemUserToken: z.string().trim().max(1000).optional(),
    clearToken: z.boolean().optional(),
    graphVersion: trimmed(12).optional(),
    /** Blank clears. Must be https: the token is sent to it. */
    ratesEndpoint: trimmed(500),
    autoAttach: z.boolean(),
    autoAttachCurrency: z.string().max(40).optional(),
    baseCurrency: z.string().max(40).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.graphVersion && normalizeGraphVersion(v.graphVersion) === null) {
      ctx.addIssue({ code: 'custom', path: ['graphVersion'], message: 'Use the form v26.0' });
    }
    if (v.ratesEndpoint && !HTTPS_URL.test(v.ratesEndpoint)) {
      ctx.addIssue({ code: 'custom', path: ['ratesEndpoint'], message: 'Enter an https URL' });
    }
    if (v.systemUserToken && v.clearToken) {
      ctx.addIssue({
        code: 'custom',
        path: ['clearToken'],
        message: 'Send a new token or clear it, not both',
      });
    }
    const auto = normalizeCurrencyInput(v.autoAttachCurrency);
    if (auto && !isCreditCurrency(auto)) {
      ctx.addIssue({
        code: 'custom',
        path: ['autoAttachCurrency'],
        message: `Meta accepts only ${BSP_CREDIT_CURRENCIES.join(', ')}`,
      });
    }
    if (v.baseCurrency !== undefined && normalizeCurrencyInput(v.baseCurrency).length !== 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseCurrency'],
        message: 'Use a three letter currency code',
      });
    }
  });
export type UpdateBspSettingsInput = z.infer<typeof updateBspSettingsSchema>;

// --- allocation register (WD-BSP-006, -007, -009, -010) --------------------------------------------------------------------

export const bspAllocationSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  workspaceName: z.string(),
  /** The workspace's own billing mode, so a revoked line on a reseller workspace is visible (WD-BSP-009 rule 3). */
  workspaceBillingMode: bspBillingModeSchema,
  wabaId: z.string(),
  allocationConfigId: z.string().nullable(),
  creditSource: z.string().nullable(),
  currency: z.string(),
  status: bspAllocationStatusSchema,
  lastError: z.string().nullable(),
  attachedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  rowVersion: z.number().int(),
});
export type BspAllocation = z.infer<typeof bspAllocationSchema>;

export const listBspAllocationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: cursorSchema.optional(),
  status: bspAllocationStatusSchema.optional(),
});
export type ListBspAllocationsQuery = z.infer<typeof listBspAllocationsQuerySchema>;

export const bspAllocationListSchema = z.object({
  data: z.array(bspAllocationSchema),
  page: pageInfoSchema,
});
export type BspAllocationList = z.infer<typeof bspAllocationListSchema>;

export const bspWabaCandidateSchema = z.object({
  workspaceId: uuidSchema,
  workspaceName: z.string(),
  phone: z.string().nullable(),
  displayLabel: z.string().nullable(),
  wabaId: z.string(),
  /** An allocation already exists for the pair (any status). */
  allocationStatus: bspAllocationStatusSchema.nullable(),
  /** The workspace's own currency, offered as the default for its credit line. */
  workspaceCurrency: z.string().nullable(),
});
export type BspWabaCandidate = z.infer<typeof bspWabaCandidateSchema>;

export const bspWabaCandidateListSchema = z.object({ data: z.array(bspWabaCandidateSchema) });
export type BspWabaCandidateList = z.infer<typeof bspWabaCandidateListSchema>;

export const attachCreditSchema = z.object({
  workspaceId: uuidSchema,
  wabaId: z.string().trim().min(1).max(64),
  currency: z.string().trim().min(1).max(8),
});
export type AttachCreditInput = z.infer<typeof attachCreditSchema>;

export const attachAllResultSchema = z.object({
  attached: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  /** Connected WABAs not yet looked at because the batch limit was reached: run it again. */
  remaining: z.number().int(),
});
export type AttachAllResult = z.infer<typeof attachAllResultSchema>;

export const revokeResultSchema = z.object({
  allocation: bspAllocationSchema,
  /** The workspace is still in reseller mode: Meta stops billing the platform, the wallet keeps charging (WD-BSP-009 rule 3). */
  workspaceStillReseller: z.boolean(),
});
export type RevokeResult = z.infer<typeof revokeResultSchema>;

// --- reseller P&L (WD-BSP-014, -015) -----------------------------------------------------------------------------------------

export const bspDashboardQuerySchema = z.object({
  /** `YYYY-MM`, defaults to the current month. */
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type BspDashboardQuery = z.infer<typeof bspDashboardQuerySchema>;

/** Money is a decimal string in the base currency's major unit ("100.00"), never a number. */
const money = z.string().regex(/^-?\d+(\.\d+)?$/);

export const bspDashboardTotalsSchema = z.object({
  /** Billed (status `charged`) messages in the month. */
  billedMessages: z.number().int(),
  freeMessages: z.number().int(),
  revenue: money,
  metaCost: money,
  margin: money,
  /** Billed messages whose Meta cost is unknown: margin counts them as pure revenue (WD-BSP-014 rule 3). */
  unpricedMessages: z.number().int(),
  /** Money held in customer wallets in the base currency, across every workspace. */
  walletFloat: money,
});

export const bspDashboardWorkspaceSchema = z.object({
  workspaceId: uuidSchema,
  workspaceName: z.string(),
  billedMessages: z.number().int(),
  revenue: money,
  metaCost: money,
  margin: money,
  walletBalance: money,
});

export const bspDashboardSchema = z.object({
  month: z.string(),
  from: z.string().datetime(),
  to: z.string().datetime(),
  currency: z.string(),
  totals: bspDashboardTotalsSchema,
  workspaces: z.array(bspDashboardWorkspaceSchema),
  hasMoreWorkspaces: z.boolean(),
});
export type BspDashboard = z.infer<typeof bspDashboardSchema>;

export const bspStatusSchema = z.object({
  ok: z.literal(true),
  module: z.literal('bsp'),
  configured: z.boolean(),
  graphVersion: z.string(),
  allocations: z.number().int(),
});
export type BspStatus = z.infer<typeof bspStatusSchema>;

// --- the customer's choice (WD-BSP-011) ----------------------------------------------------------------------------------------

export const bspBillingAccountSchema = z.object({
  wabaId: z.string(),
  phone: z.string().nullable(),
  displayLabel: z.string().nullable(),
  allocationStatus: bspAllocationStatusSchema.nullable(),
  currency: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type BspBillingAccount = z.infer<typeof bspBillingAccountSchema>;

export const bspBillingModeResponseSchema = z.object({
  mode: bspBillingModeSchema,
  /** The platform's Meta credit line is set up, so "Bill me through us" can be chosen. */
  resellerAvailable: z.boolean(),
  accounts: z.array(bspBillingAccountSchema),
});
export type BspBillingModeResponse = z.infer<typeof bspBillingModeResponseSchema>;

export const setBillingModeSchema = z.object({ mode: bspBillingModeSchema });
export type SetBillingModeInput = z.infer<typeof setBillingModeSchema>;

export const setBillingModeResponseSchema = bspBillingModeResponseSchema.extend({
  attach: attachAllResultSchema.optional(),
});
export type SetBillingModeResponse = z.infer<typeof setBillingModeResponseSchema>;
