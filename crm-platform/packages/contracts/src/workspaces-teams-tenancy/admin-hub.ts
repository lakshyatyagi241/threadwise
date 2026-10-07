import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { cursorSchema, pageInfoSchema } from '../common/pagination';
import { planValiditySchema } from '../plans-subscriptions-trials/billing';

/**
 * The operator's Workspaces hub (WD-WSP-023/025/027/032/033): one list of every customer workspace with the facts an operator acts on,
 * and the row actions (dashboard, edit & change plan, login as owner, suspend, plan and limits, provider). The list reads cross-tenant
 * through the platform store; every action reuses the domain's own endpoint (plans, whatsapp-providers, wallet) except suspend and
 * impersonate, which live here.
 */

/** Hub-list columns the operator can show or hide. `workspace` is locked on in the UI. */
export const WORKSPACE_HUB_COLUMNS = [
  'workspace',
  'provider',
  'numbers',
  'plan',
  'state',
  'ends',
  'limits',
  'wallet',
  'owner',
  'mrr',
  'messages7d',
  'lastActive',
] as const;
export type WorkspaceHubColumn = (typeof WORKSPACE_HUB_COLUMNS)[number];

export const workspaceHubSortSchema = z.enum(['created', 'last_active', 'name']);
export type WorkspaceHubSort = z.infer<typeof workspaceHubSortSchema>;

export const workspaceHubStatusFilterSchema = z.enum(['all', 'active', 'suspended']);
export const workspaceHubStateFilterSchema = z.enum([
  'free_trial',
  'free',
  'paid_active',
  'paid_grace',
  'paid_lapsed',
  'custom_quote',
]);

export const listWorkspaceHubQuerySchema = z.object({
  /** Workspace name, slug, or the owner's name or email. */
  q: z.string().trim().min(1).max(120).optional(),
  status: workspaceHubStatusFilterSchema.default('all'),
  /** Plan slug. */
  plan: z.string().trim().min(1).max(80).optional(),
  /** Plan validity state (trial, paid, grace, lapsed...). */
  state: workspaceHubStateFilterSchema.optional(),
  /** Effective WhatsApp provider key. */
  provider: z.string().trim().min(1).max(80).optional(),
  lowBalanceOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  sort: workspaceHubSortSchema.default('created'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: cursorSchema.optional(),
});
export type ListWorkspaceHubQuery = z.infer<typeof listWorkspaceHubQuerySchema>;

export const workspaceHubHealthSchema = z.enum([
  'suspended',
  'good',
  'active',
  'low',
  'new',
  'idle',
]);
export type WorkspaceHubHealth = z.infer<typeof workspaceHubHealthSchema>;

/** Effective cap of the workspace (plan merged with its override). `null` = unlimited. */
export const workspaceHubLimitsSchema = z.object({
  monthlyMessages: z.number().int().nullable(),
  users: z.number().int().nullable(),
  contacts: z.number().int().nullable(),
  devices: z.number().int().nullable(),
  /** The workspace carries a per-workspace override on at least one limit or feature. */
  overridden: z.boolean(),
});

export const workspaceHubRowSchema = z.object({
  workspaceId: uuidSchema,
  name: z.string(),
  slug: z.string(),
  /** organizations.status: active | suspended. */
  status: z.string(),
  /** Active frozen / tos_violation / fraud flags that hold the workspace suspended. */
  suspendedBy: z.array(z.string()),
  createdAt: z.string().datetime(),
  provider: z.object({
    key: z.string(),
    name: z.string().nullable(),
    source: z.enum(['override', 'default', 'platform_setting']),
  }),
  /** Connected WhatsApp numbers (official connections). */
  numbers: z.number().int().nonnegative(),
  plan: z.object({
    slug: z.string(),
    name: z.string().nullable(),
    known: z.boolean(),
    platformOwned: z.boolean(),
  }),
  validity: planValiditySchema,
  limits: workspaceHubLimitsSchema,
  /** Wallet balance in minor units of the workspace's billing currency. */
  wallet: z.object({
    currency: z.string(),
    balanceMinor: z.string(),
    low: z.boolean(),
  }),
  owner: z
    .object({
      userId: uuidSchema,
      name: z.string().nullable(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
    })
    .nullable(),
  /** Monthly recurring revenue in the platform base currency, decimal string. */
  mrr: z.string(),
  messages7d: z.number().int().nonnegative(),
  lastActiveAt: z.string().datetime().nullable(),
  health: workspaceHubHealthSchema,
});
export type WorkspaceHubRow = z.infer<typeof workspaceHubRowSchema>;

export const workspaceHubKpisSchema = z.object({
  total: z.number().int(),
  active: z.number().int(),
  suspended: z.number().int(),
  trial: z.number().int(),
  newThisMonth: z.number().int(),
  lowBalance: z.number().int(),
  mrr: z.string(),
  currency: z.string(),
});
export type WorkspaceHubKpis = z.infer<typeof workspaceHubKpisSchema>;

export const workspaceHubListResponseSchema = z.object({
  data: z.array(workspaceHubRowSchema),
  page: pageInfoSchema,
  kpis: workspaceHubKpisSchema,
  /** Plans and providers for the filter dropdowns. */
  filters: z.object({
    plans: z.array(z.object({ slug: z.string(), name: z.string() })),
    providers: z.array(z.object({ key: z.string(), name: z.string() })),
  }),
});
export type WorkspaceHubListResponse = z.infer<typeof workspaceHubListResponseSchema>;

/** Dashboard of one workspace (the row plus the figures a support person needs). */
export const workspaceHubDetailSchema = z.object({
  row: workspaceHubRowSchema,
  members: z.number().int().nonnegative(),
  contacts: z.number().int().nonnegative(),
  openTickets: z.number().int().nonnegative(),
  messages30d: z.array(
    z.object({ day: z.string(), sent: z.number().int(), delivered: z.number().int() }),
  ),
  deliveredPct: z.number().nullable(),
  adminNote: z.string().nullable(),
  /** Caller may impersonate / suspend (platform permission map). */
  can: z.object({
    suspend: z.boolean(),
    unsuspend: z.boolean(),
    impersonate: z.boolean(),
    editPlan: z.boolean(),
    manageProvider: z.boolean(),
    adjustWallet: z.boolean(),
  }),
});
export type WorkspaceHubDetail = z.infer<typeof workspaceHubDetailSchema>;

export const suspendWorkspaceHubRequestSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type SuspendWorkspaceHubRequest = z.infer<typeof suspendWorkspaceHubRequestSchema>;

// --- impersonation (WD-WSP-032/033) ---------------------------------------------------------------------------------------------

/** Minutes an impersonation lasts at most; the token is never renewed. */
export const IMPERSONATION_MAX_MINUTES = 60;

export const startImpersonationRequestSchema = z.object({
  /** Why the operator is entering the workspace; kept in the audit trail. */
  reason: z.string().trim().min(8).max(500),
  /** Read-only: the session can look but every write is refused. */
  readOnly: z.boolean().default(false),
});
export type StartImpersonationRequest = z.infer<typeof startImpersonationRequestSchema>;

export const startImpersonationResponseSchema = z.object({
  sessionId: uuidSchema,
  workspaceId: uuidSchema,
  workspaceName: z.string(),
  /** The workspace app URL that consumes the one-time handoff code. */
  handoffUrl: z.string(),
  expiresAt: z.string().datetime(),
});
export type StartImpersonationResponse = z.infer<typeof startImpersonationResponseSchema>;

/** What the workspace app shows in its impersonation banner. */
export const impersonationStatusSchema = z.object({
  active: z.boolean(),
  sessionId: uuidSchema.nullable(),
  operatorName: z.string().nullable(),
  reason: z.string().nullable(),
  readOnly: z.boolean(),
  expiresAt: z.string().datetime().nullable(),
});
export type ImpersonationStatus = z.infer<typeof impersonationStatusSchema>;

/** The one-time handoff code is 43 characters of base64url (256 bits); the workspace app passes it through `?code=` untouched. */
export const IMPERSONATION_HANDOFF_SECONDS = 60;

export const redeemImpersonationRequestSchema = z.object({
  code: z.string().trim().min(20).max(128),
});
export type RedeemImpersonationRequest = z.infer<typeof redeemImpersonationRequestSchema>;

/**
 * What the workspace app's handoff route receives. The access token is the act-as token: it has no refresh token, so the cookie it
 * becomes ends at `expiresAt` at the latest. Server-to-server only; the page JavaScript never sees it.
 */
export const redeemImpersonationResponseSchema = z.object({
  accessToken: z.string(),
  /** Seconds the access token lives (never longer than the session). */
  expiresIn: z.number().int().positive(),
  expiresAt: z.string().datetime(),
  workspaceSlug: z.string(),
});
export type RedeemImpersonationResponse = z.infer<typeof redeemImpersonationResponseSchema>;

export const stopImpersonationResponseSchema = z.object({
  /** Where the web app sends the operator next: the console's workspace list. */
  returnUrl: z.string(),
});
export type StopImpersonationResponse = z.infer<typeof stopImpersonationResponseSchema>;
