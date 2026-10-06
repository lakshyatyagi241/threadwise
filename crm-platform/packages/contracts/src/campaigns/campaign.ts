import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { senderKeySchema } from '../broadcasts/broadcast';

/**
 * Campaigns (CAMP, Reference `wa-campaigns`): a bulk send of a custom message, a template or a flow, with A/B testing, a schedule,
 * Smart Delivery pacing and an end date. Field names keep Reference's meaning in camelCase, every id is a uuid.
 */

export const CAMPAIGN_TYPES = ['text', 'template', 'button', 'flow', 'media', 'custom'] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];
/** Types whose body is a typed message (Reference's "text" filter and the required-message rule). */
export const CUSTOM_BODY_TYPES = ['text', 'custom', 'button', 'media'] as const;

export const CAMPAIGN_STATUSES = [
  'draft',
  'scheduled',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
/** Only these can be edited (Reference: draft, scheduled or paused). */
export const EDITABLE_STATUSES = ['draft', 'paused', 'scheduled'] as const;
/** Only these can be resent. */
export const RESENDABLE_STATUSES = ['completed', 'failed', 'cancelled'] as const;

export const CAMPAIGN_SCHEDULE_TYPES = ['now', 'scheduled', 'recurring'] as const;
export const CAMPAIGN_REPEAT_INTERVALS = ['daily', 'weekly', 'monthly'] as const;
export const RESEND_SCOPES = ['failed', 'all', 'selected'] as const;

export const CAMPAIGN_RECIPIENT_STATUSES = [
  'queued',
  'pending',
  'sent',
  'delivered',
  'read',
  'responded',
  'failed',
  'unsubscribed',
  'skipped',
] as const;
export type CampaignRecipientStatus = (typeof CAMPAIGN_RECIPIENT_STATUSES)[number];

/** Reference's CSV upload limit, applied to the text of the file. */
export const CAMPAIGN_CSV_MAX_CHARS = 5_000_000;

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'is not a real date');
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:mm (24 hour)');
/** What a `datetime-local` input posts. Read in the campaign's time zone. */
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, 'must be YYYY-MM-DDTHH:mm');

const buttonSchema = z.record(z.unknown());

/** Everything a campaign carries apart from its audience. */
const campaignFields = {
  name: z.string().trim().min(1).max(191),
  /** `<engine>:<uuid>`. None picked leaves the campaign on the workspace's default engine. */
  senderKey: senderKeySchema.nullish(),
  type: z.enum(CAMPAIGN_TYPES),
  /** Only `draft` is accepted: Reference took any string and let a client start a campaign past the checks. */
  status: z.literal('draft').nullish(),
  abTesting: z.boolean().default(false),
  /** Percent sent variant A. */
  abSplit: z.number().int().min(0).max(100).default(50),
  customMessage: z.string().max(65_000).nullish(),
  customMessageB: z.string().max(65_000).nullish(),
  customHeader: z.string().max(255).nullish(),
  customFooter: z.string().max(255).nullish(),
  customButtons: z.array(buttonSchema).max(10).nullish(),
  customQuickReplies: z.array(buttonSchema).max(10).nullish(),
  /** Positional slot to attribute key, `{"1":"order_id"}`. */
  variableMap: z.record(z.string()).nullish(),
  /**
   * One public address for the message's media (image jpg, jpeg or png, video mp4, document pdf, doc or docx). Uploading a file
   * waits on the storage service.
   */
  mediaUrl: z.string().trim().url().max(2048).nullish(),
  templateId: uuidSchema.nullish(),
  templateIdA: uuidSchema.nullish(),
  templateIdB: uuidSchema.nullish(),
  templateOverrides: z.record(z.unknown()).nullish(),
  templateOverridesB: z.record(z.unknown()).nullish(),
  flowId: uuidSchema.nullish(),
  flowIdB: uuidSchema.nullish(),
  useAttributes: z.boolean().default(false),
  trackingEnabled: z.boolean().default(true),
  scheduleType: z.enum(CAMPAIGN_SCHEDULE_TYPES),
  sendDate: dateOnly.nullish(),
  sendTime: timeOfDay.nullish(),
  /** The hard end date, read in `timezone`. */
  expiresAt: localDateTime.nullish(),
  timezone: z.string().trim().min(1).max(64).nullish(),
  repeatInterval: z.enum(CAMPAIGN_REPEAT_INTERVALS).nullish(),
  repeatUntil: dateOnly.nullish(),
  throttleMinSec: z.number().int().min(0).max(3600).nullish(),
  throttleMaxSec: z.number().int().min(0).max(3600).nullish(),
  batchSize: z.number().int().min(1).max(10_000).nullish(),
  batchPauseMin: z.number().int().min(0).max(1440).nullish(),
  dailyLimit: z.number().int().min(1).max(100_000).nullish(),
  windowStart: timeOfDay.nullish(),
  windowEnd: timeOfDay.nullish(),
};

const audienceFields = {
  contactIds: z.array(uuidSchema).max(100_000).default([]),
  groupIds: z.array(uuidSchema).max(1_000).default([]),
  tagIds: z.array(uuidSchema).max(1_000).default([]),
  /** One per line, or separated by commas or semicolons. */
  manualNumbers: z.string().max(500_000).default(''),
  /** The text of an uploaded CSV (`name,country_code,phone` plus any attribute columns). */
  csvText: z.string().max(CAMPAIGN_CSV_MAX_CHARS).default(''),
};

type Shape = {
  type?: CampaignType;
  customMessage?: string | null;
  scheduleType?: (typeof CAMPAIGN_SCHEDULE_TYPES)[number];
  sendDate?: string | null;
  sendTime?: string | null;
  throttleMinSec?: number | null;
  throttleMaxSec?: number | null;
};

/** The cross-field rules shared by create and update. */
function refine(v: Shape, ctx: z.RefinementCtx) {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });
  if (
    v.type &&
    (CUSTOM_BODY_TYPES as readonly string[]).includes(v.type) &&
    !v.customMessage?.trim()
  ) {
    issue('customMessage', 'A message is required for this campaign type');
  }
  if (v.scheduleType && v.scheduleType !== 'now') {
    if (!v.sendDate) issue('sendDate', 'sendDate is required to schedule');
    if (!v.sendTime) issue('sendTime', 'sendTime is required to schedule');
  }
  if (v.throttleMinSec != null && v.throttleMaxSec != null && v.throttleMaxSec < v.throttleMinSec) {
    issue('throttleMaxSec', 'must be at least throttleMinSec');
  }
}

export const createCampaignSchema = z
  .object({ ...campaignFields, ...audienceFields })
  .superRefine(refine);
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

/**
 * Editing sends the whole form again. The audience is optional: left out, the recipients stay; sent (and not empty), the
 * recipient rows are rebuilt from it.
 */
export const updateCampaignSchema = z
  .object({
    ...campaignFields,
    contactIds: audienceFields.contactIds.optional(),
    groupIds: audienceFields.groupIds.optional(),
    tagIds: audienceFields.tagIds.optional(),
    manualNumbers: audienceFields.manualNumbers.optional(),
    csvText: audienceFields.csvText.optional(),
  })
  .superRefine(refine);
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

export const resendCampaignSchema = z
  .object({
    scope: z.enum(RESEND_SCOPES).default('failed'),
    /** Contact uuids, for scope `selected`. */
    contactIds: z.array(uuidSchema).max(100_000).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.scope === 'selected' && v.contactIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['contactIds'],
        message: 'Pick at least one recipient to resend to.',
      });
    }
  });
export type ResendCampaignInput = z.infer<typeof resendCampaignSchema>;

export const bulkDeleteCampaignsSchema = z.object({
  ids: z.array(uuidSchema).min(1).max(500),
});
export type BulkDeleteCampaignsInput = z.infer<typeof bulkDeleteCampaignsSchema>;

/** The five counters of a campaign, always derived from its recipient rows. */
export const campaignCountsSchema = z.object({
  recipients: z.number().int(),
  sent: z.number().int(),
  delivered: z.number().int(),
  read: z.number().int(),
  replies: z.number().int(),
  clicks: z.number().int(),
  failed: z.number().int(),
});
export type CampaignCounts = z.infer<typeof campaignCountsSchema>;

/** A campaign as the list shows it. */
export const campaignSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  type: z.enum(CAMPAIGN_TYPES),
  status: z.enum(CAMPAIGN_STATUSES),
  provider: z.string().nullable(),
  abTesting: z.boolean(),
  /** Made by the "Create broadcast" wizard (a draft of it resumes there, not in the classic builder). */
  wizard: z.boolean().default(false),
  scheduleType: z.enum(CAMPAIGN_SCHEDULE_TYPES),
  sendDate: z.string().nullable(),
  sendTime: z.string().nullable(),
  timezone: z.string().nullable(),
  repeatInterval: z.enum(CAMPAIGN_REPEAT_INTERVALS).nullable(),
  expiresAt: z.string().datetime().nullable(),
  templateId: uuidSchema.nullable(),
  templateName: z.string().nullable(),
  counts: campaignCountsSchema,
  lastRunAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  rowVersion: z.number().int(),
});
export type Campaign = z.infer<typeof campaignSchema>;

/** Everything the edit form needs: the whole configuration and who is on the list. */
export const campaignConfigSchema = campaignSchema.extend({
  senderKey: z.string().nullable(),
  abSplit: z.number().int(),
  customMessage: z.string().nullable(),
  customMessageB: z.string().nullable(),
  customHeader: z.string().nullable(),
  customFooter: z.string().nullable(),
  customButtons: z.array(buttonSchema).nullable(),
  customQuickReplies: z.array(buttonSchema).nullable(),
  variableMap: z.record(z.string()).nullable(),
  mediaUrl: z.string().nullable(),
  templateIdA: uuidSchema.nullable(),
  templateIdB: uuidSchema.nullable(),
  templateOverrides: z.record(z.unknown()).nullable(),
  templateOverridesB: z.record(z.unknown()).nullable(),
  flowId: uuidSchema.nullable(),
  flowIdB: uuidSchema.nullable(),
  useAttributes: z.boolean(),
  trackingEnabled: z.boolean(),
  /** As typed in the form: `YYYY-MM-DDTHH:mm` in the campaign's time zone. */
  expiresAtLocal: z.string().nullable(),
  repeatUntil: z.string().nullable(),
  throttleMinSec: z.number().int().nullable(),
  throttleMaxSec: z.number().int().nullable(),
  batchSize: z.number().int().nullable(),
  batchPauseMin: z.number().int().nullable(),
  dailyLimit: z.number().int().nullable(),
  windowStart: z.string().nullable(),
  windowEnd: z.string().nullable(),
  recipientContactIds: z.array(uuidSchema),
});
export type CampaignConfig = z.infer<typeof campaignConfigSchema>;

export const campaignActionResponseSchema = z.object({
  id: uuidSchema,
  status: z.enum(CAMPAIGN_STATUSES),
  message: z.string(),
});
export type CampaignActionResponse = z.infer<typeof campaignActionResponseSchema>;

export const resendCampaignResponseSchema = campaignActionResponseSchema.extend({
  scope: z.enum(RESEND_SCOPES),
  recipients: z.number().int(),
});
export type ResendCampaignResponse = z.infer<typeof resendCampaignResponseSchema>;

export const bulkDeleteCampaignsResponseSchema = z.object({
  ids: z.array(uuidSchema),
  message: z.string(),
});
export type BulkDeleteCampaignsResponse = z.infer<typeof bulkDeleteCampaignsResponseSchema>;
