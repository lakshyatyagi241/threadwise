import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { FB_PAGE_STATUSES } from '../channel-facebook/page';

/**
 * Meta lead ads: the native door from Facebook and Instagram lead forms into the lead pipeline (spec L-06, BL-011).
 *
 * A workspace connects a Facebook Page once (the Facebook channel), turns lead sync on for it (the Page is subscribed to Meta's `leadgen`
 * webhook field), then picks the lead forms to bring in. Each picked form becomes a lead source of kind `meta_lead_ads`, so its field
 * mapping, owner rule, deal and notification settings are the same as any other source's (`/lead-sources`).
 *
 * Nothing here carries a token or the app secret. The Page's token stays sealed in the Facebook channel.
 */

/**
 * The permissions lead retrieval needs on top of what the Facebook channel asks for at login. `leads_retrieval` reads the leads,
 * `pages_manage_ads` lets the Page token reach the lead forms, `pages_read_engagement` is the read side of the Page.
 */
export const META_LEAD_REQUIRED_SCOPES = [
  'leads_retrieval',
  'pages_manage_ads',
  'pages_read_engagement',
] as const;

/** The Webhooks field a Page is subscribed to for new leads. */
export const META_LEADGEN_FIELD = 'leadgen';

/** The platform label of a lead and its source (`contacts.source`, attribution). Instagram placements arrive through the same Page. */
export const META_LEAD_PLATFORM_FACEBOOK = 'Facebook';
export const META_LEAD_PLATFORM_INSTAGRAM = 'Instagram';

/** Lead sources made by this door carry this prefix in their `external_ref`; the rest of it is `<pageId>:<formId>`. */
export const META_LEAD_SOURCE_REF_PREFIX = 'meta_lead_form:';

// --- pages ----------------------------------------------------------------------------------------------------------------------

export const META_LEAD_ACCESS = ['granted', 'missing'] as const;
export const metaLeadAccessSchema = z.enum(META_LEAD_ACCESS);
export type MetaLeadAccess = z.infer<typeof metaLeadAccessSchema>;

/**
 * off: lead sync is not switched on for the Page. subscribed: switched on and Meta delivers. needs_lead_access: switched on, but the
 * Page lacks a lead permission (re-consent). needs_reconnect: the Page's token is no longer valid. error: Meta refused something else.
 */
export const META_LEAD_SYNC_STATES = [
  'off',
  'subscribed',
  'needs_lead_access',
  'needs_reconnect',
  'error',
] as const;
export const metaLeadSyncStateSchema = z.enum(META_LEAD_SYNC_STATES);
export type MetaLeadSyncState = z.infer<typeof metaLeadSyncStateSchema>;

export const metaLeadSyncSchema = z.object({
  enabled: z.boolean(),
  state: metaLeadSyncStateSchema,
  subscribedAt: z.string().datetime().nullable(),
  /** When the last lead of this Page arrived (webhook or sweep). */
  lastLeadAt: z.string().datetime().nullable(),
  /** When the reconciliation sweep last read this Page's forms to the end. */
  lastSweepAt: z.string().datetime().nullable(),
  /** The last thing Meta refused, in words; cleared by the next success. */
  lastError: z.string().nullable(),
  formsConnected: z.number().int().min(0),
});
export type MetaLeadSync = z.infer<typeof metaLeadSyncSchema>;

export const metaLeadPageSchema = z.object({
  /** The Facebook channel's Page id (uuid): what `/facebook/pages` calls `id`. */
  id: uuidSchema,
  /** Meta's Page id. */
  pageId: z.string(),
  name: z.string().nullable(),
  pictureUrl: z.string().nullable(),
  pageStatus: z.enum(FB_PAGE_STATUSES),
  leadAccess: metaLeadAccessSchema,
  /** The lead permissions this Page's connection lacks (empty when `leadAccess` is granted). */
  missingScopes: z.array(z.string()),
  sync: metaLeadSyncSchema,
});
export type MetaLeadPage = z.infer<typeof metaLeadPageSchema>;

export const metaLeadAdsOverviewSchema = z.object({
  /** False when no Meta app (id and secret) is set on this install. */
  configured: z.boolean(),
  /** The address to register as the app's Page webhook callback (the same one the Facebook channel uses). */
  webhookUrl: z.string(),
  /** Whether the webhook verify token is set (its value is never returned). */
  verifyTokenConfigured: z.boolean(),
  graphVersion: z.string(),
  requiredScopes: z.array(z.string()),
  /** True when a Login-for-Business configuration drives the login: the permissions then come from that configuration, not from us. */
  usesLoginConfiguration: z.boolean(),
  pages: z.array(metaLeadPageSchema),
});
export type MetaLeadAdsOverview = z.infer<typeof metaLeadAdsOverviewSchema>;

// --- forms ----------------------------------------------------------------------------------------------------------------------

/** The contact fields a form question maps onto by itself (the rest are custom properties the admin picks). */
export const META_QUESTION_TARGETS = ['name', 'firstName', 'lastName', 'email', 'phone'] as const;
export const metaQuestionTargetSchema = z.enum(META_QUESTION_TARGETS);
export type MetaQuestionTarget = z.infer<typeof metaQuestionTargetSchema>;

export const metaLeadQuestionSchema = z.object({
  /** The key Meta files the answer under (`full_name`, `phone_number`, `what_is_your_budget`): the path a mapping points at. */
  key: z.string(),
  label: z.string(),
  /** Meta's question type (`FULL_NAME`, `EMAIL`, `PHONE`, `CUSTOM`, ...). */
  type: z.string(),
  /** The contact field this question maps onto by itself, when its type says so. */
  suggestedTarget: metaQuestionTargetSchema.nullable(),
});
export type MetaLeadQuestion = z.infer<typeof metaLeadQuestionSchema>;

export const metaLeadFormSchema = z.object({
  /** Meta's form id. */
  formId: z.string(),
  name: z.string(),
  /** Meta's status: ACTIVE, ARCHIVED, DELETED or DRAFT. */
  status: z.string().nullable(),
  locale: z.string().nullable(),
  leadsCount: z.number().int().min(0).nullable(),
  createdTime: z.string().datetime().nullable(),
  questions: z.array(metaLeadQuestionSchema),
  /** The form carries a consent checkbox with wording of its own: a ticked one is recorded as proof of consent. */
  hasConsentCheckbox: z.boolean(),
  connected: z.boolean(),
  /** The lead source this form feeds (`/lead-sources/:id`), once connected. */
  sourceId: uuidSchema.nullable(),
  lastLeadAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
});
export type MetaLeadForm = z.infer<typeof metaLeadFormSchema>;

export const metaLeadFormListSchema = z.object({
  page: metaLeadPageSchema,
  data: z.array(metaLeadFormSchema),
});
export type MetaLeadFormList = z.infer<typeof metaLeadFormListSchema>;

export const metaLeadFormIdSchema = z
  .string()
  .trim()
  .regex(/^\d{5,32}$/, 'a Meta form id is a number');

// --- source health --------------------------------------------------------------------------------------------------------------

/** Health of one form source, for the source's own screen. `connected: false` means the source is not a Meta lead form. */
export const metaLeadSourceHealthSchema = z.object({
  connected: z.boolean(),
  pageId: z.string().nullable(),
  pageName: z.string().nullable(),
  formId: z.string().nullable(),
  formName: z.string().nullable(),
  /** The Facebook channel's Page id (uuid), so the screen can link to the Page's lead forms. */
  pageRef: uuidSchema.nullable(),
  leadAccess: metaLeadAccessSchema.nullable(),
  state: metaLeadSyncStateSchema.nullable(),
  subscribed: z.boolean(),
  lastLeadAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
});
export type MetaLeadSourceHealth = z.infer<typeof metaLeadSourceHealthSchema>;

export const metaLeadConnectStartSchema = z.object({ url: z.string().url() });
export type MetaLeadConnectStart = z.infer<typeof metaLeadConnectStartSchema>;

// --- the queue between the Facebook webhook and the lead worker -----------------------------------------------------------------

/** One `leadgen` event of a Page's webhook, queued for the worker. Ids only: the lead itself is fetched from Meta by the worker. */
export const META_LEADGEN_JOB = 'leadgen.received';
export const metaLeadgenJobSchema = z.object({
  orgId: z.number().int().positive(),
  /** Meta's Page id. */
  pageId: z.string().min(1),
  /** Meta's lead id: the idempotency key. */
  leadgenId: z.string().min(1).max(64),
  formId: z.string().nullable(),
  adId: z.string().nullable(),
});
export type MetaLeadgenJob = z.infer<typeof metaLeadgenJobSchema>;

/** One Page's reconciliation sweep. */
export const META_LEAD_SWEEP_JOB = 'lead-sweep.page';
export const metaLeadSweepJobSchema = z.object({
  orgId: z.number().int().positive(),
  pageId: z.string().min(1),
});
export type MetaLeadSweepJob = z.infer<typeof metaLeadSweepJobSchema>;
