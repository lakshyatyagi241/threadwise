import { z } from 'zod';

/**
 * growth (GRW): the pilot that turns what lead scoring knows (campaign receipts, chat readings, engagement) into things a team can act on.
 * Not a Reference feature. Offered to the pilot workspaces only; every route answers `GRW_NOT_AVAILABLE` to any other workspace.
 */

export const GROWTH_ERROR_CODES = {
  /** The workspace is not part of the growth pilot. 403. */
  GRW_NOT_AVAILABLE: 'GRW_NOT_AVAILABLE',
  /** That part of the pilot is switched off for the workspace. 422. */
  GRW_FEATURE_OFF: 'GRW_FEATURE_OFF',
  /** The action was already decided, replaced or expired. 409. */
  GRW_ACTION_GONE: 'GRW_ACTION_GONE',
  /** The AI assistant could not give a usable recommendation, or there is nothing to recommend from. 422 / 502. */
  GRW_ASSISTANT_FAILED: 'GRW_ASSISTANT_FAILED',
  /** The automatic stage change cannot be undone any more (the contact moved on, or it was already undone). 409. */
  GRW_UNDO_REFUSED: 'GRW_UNDO_REFUSED',
} as const;

// --- the parts of the pilot --------------------------------------------------------------------------------------------------

/** One switch per part. A key that is absent from the stored settings is off. */
export const GROWTH_FEATURES = [
  'campaign_response',
  'engagement_audiences',
  'engagement_stage_rules',
  'send_times',
  'intent_fields',
  'hot_lead_alerts',
  'unanswered_watch',
  'auto_notes',
  'handover_summary',
  'language_detect',
  'registration_check',
  'propensity',
  'status_reply',
  'service_rules',
  'purchase_routing',
  'broadcast_assistant',
  'auto_stage',
  'enrichment',
  'daily_digest',
  'quality',
  'optout_detection',
] as const;
export type GrowthFeature = (typeof GROWTH_FEATURES)[number];
export type GrowthFeatures = Record<GrowthFeature, boolean>;

/** A rule that finds contacts a date after something happened (a repair done, a purchase made): service reminders and follow-ups. */
export const serviceRuleSchema = z.object({
  /** Shown on the audience and in the group name. */
  label: z.string().trim().min(1).max(60),
  /** The contact property that holds the date (YYYY-MM-DD or an ISO date). */
  dateField: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9_]+$/i),
  /** Contacts whose date is this many days ago or more (and less than `untilDays`) are due. */
  afterDays: z.number().int().min(0).max(3650),
  untilDays: z.number().int().min(1).max(7300).optional(),
});
export type ServiceRule = z.infer<typeof serviceRuleSchema>;

export const customPhraseSchema = z.object({
  /** A word or a short phrase, matched as written (case blind, whole words). */
  phrase: z.string().trim().min(2).max(60),
  intent: z.enum([
    'ready_to_buy',
    'asking_price',
    'comparing',
    'registering',
    'needs_support',
    'post_purchase',
    'browsing',
    'not_interested',
  ]),
});
export type CustomPhrase = z.infer<typeof customPhraseSchema>;

/** Thresholds and rules of the pilot. The stored settings hold overrides; `GrowthConfig` is what is in force. */
export const growthConfigSchema = z.object({
  /** A reading this sure that the contact is ready to buy raises a hot-lead alert. */
  hotLeadConfidence: z.number().min(0.5).max(1),
  /** A buying or price question nobody answered for this many hours is flagged. */
  unansweredHours: z.number().int().min(1).max(168),
  /** A customer who opened or wrote nothing for this many days is lapsed. */
  lapsedDays: z.number().int().min(7).max(730),
  /** Campaigns opened in 30 days that make a contact "engaged". */
  engagedOpens: z.number().int().min(1).max(50),
  /** The stage rule: a contact in the first stage that opened this many campaigns in `windowDays`, and is in at least one group, may move on. */
  stageRule: z.object({
    minOpens: z.number().int().min(1).max(50),
    windowDays: z.number().int().min(1).max(180),
    requireGroup: z.boolean(),
  }),
  /** Guarded automatic stage changes. */
  autoStage: z.object({
    minConfidence: z.number().min(0.8).max(1),
    dailyCap: z.number().int().min(1).max(500),
  }),
  /** Contact property keys that hold a repair or order status; used to draft a status reply. */
  statusFields: z.array(z.string().trim().min(1).max(60)).max(10),
  serviceRules: z.array(serviceRuleSchema).max(10),
  /** The workspace's own button and keyword taps, added to the built-in phrase table. */
  customPhrases: z.array(customPhraseSchema).max(100),
  /** Words that are always masked in a chat before it is sent (a brand, an address, a person's name). */
  extraMaskTerms: z.array(z.string().trim().min(2).max(60)).max(100),
});
export type GrowthConfig = z.infer<typeof growthConfigSchema>;

export const GROWTH_CONFIG_DEFAULTS: GrowthConfig = {
  hotLeadConfidence: 0.8,
  unansweredHours: 4,
  lapsedDays: 60,
  engagedOpens: 3,
  stageRule: { minOpens: 2, windowDays: 30, requireGroup: true },
  autoStage: { minConfidence: 0.9, dailyCap: 20 },
  statusFields: [],
  serviceRules: [],
  customPhrases: [],
  extraMaskTerms: [],
};

export const updateGrowthSettingsSchema = z
  .object({
    features: z.record(z.enum(GROWTH_FEATURES), z.boolean()).optional(),
    config: growthConfigSchema.partial().optional(),
    rowVersion: z.number().int().positive().optional(),
  })
  .refine((v) => v.features !== undefined || v.config !== undefined, {
    message: 'Nothing to change.',
  });
export type UpdateGrowthSettingsInput = z.infer<typeof updateGrowthSettingsSchema>;

export interface GrowthSettings {
  /** Is the workspace part of the pilot at all. When false the rest is empty and every other route is refused. */
  available: boolean;
  features: GrowthFeatures;
  config: GrowthConfig;
  rowVersion: number | null;
  /** Is an enrichment provider configured on the server (no key: the enrichment switch has no effect). */
  enrichmentConfigured: boolean;
}

// --- the Growth inbox ----------------------------------------------------------------------------------------------------------

export const GROWTH_ACTION_TYPES = [
  'hot_lead',
  'unanswered_intent',
  'registration_issue',
  'purchase_route',
  'opt_out',
  'lapsed',
  'service_due',
  'status_reply',
] as const;
export type GrowthActionType = (typeof GROWTH_ACTION_TYPES)[number];
export const GROWTH_ACTION_STATUSES = ['open', 'done', 'dismissed', 'expired'] as const;
export type GrowthActionStatus = (typeof GROWTH_ACTION_STATUSES)[number];

export interface GrowthAction {
  id: string;
  type: GrowthActionType;
  severity: 'info' | 'attention' | 'urgent';
  contactId: string;
  contactName: string | null;
  conversationId: string | null;
  title: string;
  detail: string | null;
  /** Type specific facts: the suggested assignee for purchase_route, the reply to send for status_reply, the days since for lapsed... */
  payload: Record<string, unknown>;
  status: GrowthActionStatus;
  createdAt: string;
  decidedAt: string | null;
}

export const growthActionsQuerySchema = z.object({
  status: z.enum(GROWTH_ACTION_STATUSES).default('open'),
  type: z.enum(GROWTH_ACTION_TYPES).optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type GrowthActionsQuery = z.infer<typeof growthActionsQuerySchema>;

export interface GrowthActionsResponse {
  data: GrowthAction[];
  /** Open actions by type, for the tabs. */
  openByType: Record<GrowthActionType, number>;
  page: { nextCursor: string | null; hasMore: boolean; limit: number };
}

export const growthActionDecisionSchema = z.object({
  action: z.enum(['accept', 'dismiss']),
  ids: z.array(z.string().uuid()).min(1).max(100),
});
export type GrowthActionDecisionInput = z.infer<typeof growthActionDecisionSchema>;
export interface GrowthActionDecisionResult {
  done: number;
  failed: Array<{ id: string; code: string }>;
}

// --- campaigns: the replies that really happened ----------------------------------------------------------------------------

export interface GrowthCampaignRow {
  id: string;
  name: string;
  templateName: string | null;
  sentAt: string | null;
  sent: number;
  delivered: number;
  read: number;
  /** Recipients that wrote to us within 24 hours / 72 hours of the send. */
  replied24h: number;
  replied72h: number;
  /** What the campaign itself recorded (usually near zero: nothing writes it from the inbox). */
  recordedResponses: number;
  readRate: number;
  replyRate24h: number;
}

export interface GrowthCampaignReport {
  data: GrowthCampaignRow[];
  totals: {
    sent: number;
    read: number;
    replied24h: number;
    replied72h: number;
    recordedResponses: number;
  };
}

export interface GrowthStampResult {
  /** Recipient rows that got a response time. */
  stamped: number;
  campaignsRecounted: number;
}

// --- audiences ----------------------------------------------------------------------------------------------------------------

export const GROWTH_AUDIENCES = [
  'engaged',
  'silent',
  'lapsed',
  'hot_chat',
  'high_propensity',
  'service_due',
] as const;
export type GrowthAudienceKind = (typeof GROWTH_AUDIENCES)[number];

export interface GrowthAudience {
  /** `engaged`, or `service_due:<index of the rule>` for a service rule. */
  key: string;
  kind: GrowthAudienceKind;
  label: string;
  description: string;
  count: number;
  /** The contact group that holds this audience once it was synced, with the time of the last sync. */
  groupId: string | null;
  groupName: string;
  syncedAt: string | null;
}

export interface GrowthAudiencesResponse {
  data: GrowthAudience[];
}

export const syncAudienceSchema = z.object({
  key: z.string().trim().min(1).max(80),
});
export type SyncAudienceInput = z.infer<typeof syncAudienceSchema>;
export interface SyncAudienceResult {
  key: string;
  groupId: string;
  groupName: string;
  members: number;
  added: number;
  removed: number;
}

// --- send times ----------------------------------------------------------------------------------------------------------------

export interface GrowthSendTimes {
  timezone: string;
  /** Messages the contacts wrote and campaign messages they opened, by hour of the day (0 to 23) in the workspace time zone. */
  inboundByHour: number[];
  readByHour: number[];
  /** The three best hours to send (most reads and replies), best first. */
  bestHours: number[];
  /** Hours with almost no activity (the quiet tail), where a send is wasted. */
  quietHours: number[];
  sampleSize: number;
}

// --- propensity ----------------------------------------------------------------------------------------------------------------

export interface GrowthPropensityModel {
  /** False while there are too few converted contacts to learn from (a fixed-weight model is used then). */
  trained: boolean;
  positives: number;
  contacts: number;
  /** Area under the ROC curve on a held-out part, 0.5 = no better than chance; null when it could not be measured. */
  auc: number | null;
  /** Share of all converted contacts that sit in the top tenth by score. */
  topDecileCapture: number | null;
  computedAt: string | null;
  /** The weight of each feature, largest first, so a person can see what drives the score. */
  weights: Array<{ feature: string; weight: number }>;
}

// --- the assistant --------------------------------------------------------------------------------------------------------------

export const broadcastAssistantSchema = z.object({
  goal: z.string().trim().min(5).max(500),
});
export type BroadcastAssistantInput = z.infer<typeof broadcastAssistantSchema>;

export interface BroadcastRecommendation {
  /** An audience (contact group) and an approved template, both chosen from what the workspace has. */
  audience: { groupId: string; name: string; size: number };
  template: { id: string; name: string; category: string | null; replyRate24h: number | null };
  sendHour: number | null;
  subject: string;
  reasons: string[];
  /** The candidates the choice was made from, so a person can see what else was considered. */
  considered: { audiences: number; templates: number };
}

// --- quality -------------------------------------------------------------------------------------------------------------------

export interface GrowthQuality {
  windowDays: number;
  suggestions: {
    chat: { accepted: number; dismissed: number; pending: number; expired: number };
    engagement: { accepted: number; dismissed: number; pending: number; expired: number };
    autoApplied: number;
    undone: number;
  };
  actions: Array<{ type: GrowthActionType; done: number; dismissed: number; open: number }>;
  /** How well the lead score separates converted contacts from the rest (AUC), and over how many. */
  scoreAuc: number | null;
  scoredContacts: number;
  convertedContacts: number;
  cost: { calls: number; costUsd: string; avgCostUsd: string | null };
}

// --- the daily digest ------------------------------------------------------------------------------------------------------------

export interface GrowthDailyDigest {
  day: string;
  hotLeads: number;
  unanswered: number;
  optOuts: number;
  suggestionsPending: number;
  actionsOpen: number;
  newChats: number;
  campaigns: { sent: number; read: number; replied24h: number };
  lapsed: number;
  topPropensity: number;
  /** Plain sentences, in order of importance, for the top of the screen. */
  highlights: Array<{ key: string; count: number }>;
}

// --- automatic stage changes ------------------------------------------------------------------------------------------------------

export interface GrowthAutoStageRow {
  id: string;
  contactId: string;
  contactName: string | null;
  fromStageLabel: string;
  toStageLabel: string;
  confidence: number;
  appliedAt: string;
  status: 'auto_applied' | 'undone';
}

export interface GrowthAutoStageResponse {
  data: GrowthAutoStageRow[];
  appliedToday: number;
  dailyCap: number;
}

export interface GrowthEnrichmentStatus {
  configured: boolean;
  provider: string | null;
  found: number;
  notFound: number;
  failed: number;
}

/** Everything the overview shows at once. */
export interface GrowthOverview {
  settings: GrowthSettings;
  digest: GrowthDailyDigest | null;
}
