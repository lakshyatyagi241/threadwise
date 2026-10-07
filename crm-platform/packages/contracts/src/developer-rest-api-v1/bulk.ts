/**
 * developer-rest-api-v1 (API), group `bulk`: broadcasts, campaigns and scheduled messages (WD-API-080 to 095).
 * Field names are WaDesk's snake_case; ids are uuids (a sender is `<engine>:<uuid>`, or a bare uuid on the way in); timestamps are ISO-8601.
 */
import { z } from 'zod';

const uuid = z.string().uuid();

/** A plain refusal code of this group, the `error.code` the client reads. Merged into `ERROR_CODES` so `AppError` can carry them. */
export const V1_BULK_ERROR_CODES = {
  NOT_STOPPABLE: 'NOT_STOPPABLE',
  NOT_CANCELLABLE: 'NOT_CANCELLABLE',
  DELETE_FAILED: 'DELETE_FAILED',
  NO_RECIPIENTS: 'NO_RECIPIENTS',
  INVALID_TEMPLATE: 'INVALID_TEMPLATE',
  INVALID_GROUP: 'INVALID_GROUP',
  TEMPLATE_NOT_FOUND: 'TEMPLATE_NOT_FOUND',
  CREATE_FAILED: 'CREATE_FAILED',
  SCHEDULE_FAILED: 'SCHEDULE_FAILED',
} as const;

/** `true`, `false`, 1, 0 and their string forms: what a form-minded client sends for a flag. */
const boolish = z.preprocess((v) => {
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['1', 'true', 'on', 'yes'].includes(s)) return true;
    if (['0', 'false', 'off', 'no', ''].includes(s)) return false;
  }
  if (v === 1) return true;
  if (v === 0) return false;
  return v;
}, z.boolean());

const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date as YYYY-MM-DD');

// --- paging and filters -----------------------------------------------------------------------------------------------------------

export const v1BroadcastListFilterSchema = z.object({
  /** Exact match, not validated: an unknown status is an empty list (WaDesk). */
  status: z.string().trim().min(1).max(40).optional(),
});
export type V1BroadcastListFilter = z.infer<typeof v1BroadcastListFilterSchema>;

export const v1CampaignListFilterSchema = z.object({
  status: z.string().trim().min(1).max(40).optional(),
  campaign_type: z.string().trim().min(1).max(40).optional(),
  /** Case-insensitive substring of the name. */
  search: z.string().trim().min(1).max(100).optional(),
});
export type V1CampaignListFilter = z.infer<typeof v1CampaignListFilterSchema>;

// --- broadcasts (WD-API-080 to 084) -----------------------------------------------------------------------------------------------

export const v1CreateBroadcastSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    template_id: uuid,
    /** Contact ids. Ids that are not the workspace's are dropped without a word (WaDesk). */
    recipients: z.array(uuid).max(100_000).optional(),
    group_id: uuid.optional(),
    /** A sender: `<engine>:<uuid>` or a bare uuid. One that does not resolve is ignored (WaDesk). */
    device_id: z.string().trim().min(1).max(80).nullish(),
    /** Any parseable datetime. Only its wall-clock date and time are kept (WaDesk), read in `timezone`. */
    schedule_at: z.string().trim().min(1).max(64).nullish(),
    timezone: z.string().trim().min(1).max(64).nullish(),
  })
  .superRefine((v, ctx) => {
    if ((v.recipients?.length ?? 0) === 0 && !v.group_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['recipients'],
        message: 'recipients is required when group_id is not given',
      });
    }
  });
export type V1CreateBroadcast = z.infer<typeof v1CreateBroadcastSchema>;

const countsSchema = z.object({
  sent: z.number().int(),
  delivered: z.number().int(),
  read: z.number().int(),
  failed: z.number().int(),
  clicked: z.number().int(),
  pending: z.number().int(),
});

export const v1BroadcastSchema = z.object({
  id: uuid,
  name: z.string(),
  status: z.string(),
  template_id: uuid.nullable(),
  device_id: z.string().nullable(),
  total_recipients: z.number().int(),
  counts: countsSchema,
  scheduled_at: z.string().datetime().nullable(),
  completed_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type V1Broadcast = z.infer<typeof v1BroadcastSchema>;

export const v1BroadcastRecipientSchema = z.object({
  contact_id: uuid,
  status: z.string(),
  error: z.string().nullable(),
  wa_message_id: z.string().nullable(),
  sent_at: z.string().datetime().nullable(),
  delivered_at: z.string().datetime().nullable(),
  read_at: z.string().datetime().nullable(),
});
export type V1BroadcastRecipient = z.infer<typeof v1BroadcastRecipientSchema>;

// --- campaigns (WD-API-085 to 090, 095) -------------------------------------------------------------------------------------------

export const V1_CAMPAIGN_TYPES = ['custom', 'template', 'flow'] as const;
export const V1_CAMPAIGN_SCHEDULE_TYPES = ['now', 'later', 'recurring'] as const;

export const v1CreateCampaignSchema = z
  .object({
    campaign_name: z.string().trim().min(1).max(255),
    /** The sender: `<engine>:<uuid>` or a bare uuid (WaDesk: an integer id or `cfg_<n>`). */
    device_id: z.string().trim().min(1).max(80),
    campaign_type: z.enum(V1_CAMPAIGN_TYPES),
    schedule_type: z.enum(V1_CAMPAIGN_SCHEDULE_TYPES),
    template_id: uuid.nullish(),
    template_id_a: uuid.nullish(),
    template_id_b: uuid.nullish(),
    flow_id: uuid.nullish(),
    custom_message: z.string().max(4096).nullish(),
    send_date: dateOnly.nullish(),
    /** `HH:mm` (24 hour) or `h:mm AM`. */
    send_time: z
      .string()
      .trim()
      .max(16)
      .regex(/^\d{1,2}:\d{2}\s*([AaPp][Mm])?$/, 'must be a time such as 14:30 or 2:30 PM')
      .nullish(),
    timezone: z.string().trim().min(1).max(64).nullish(),
    ab_testing: boolish.nullish(),
    ab_split: z.coerce.number().int().min(10).max(90).nullish(),
    /** Phone numbers, any formatting. Fewer than 8 digits are dropped; the rest become contacts (WD-API-095). */
    contacts: z.array(z.string().max(32)).min(1).max(100_000),
  })
  .superRefine((v, ctx) => {
    const need = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (v.campaign_type === 'custom' && !v.custom_message?.trim()) {
      need('custom_message', 'custom_message is required for a custom campaign');
    }
    if (v.schedule_type === 'later') {
      if (!v.send_date) need('send_date', 'send_date is required to schedule');
      if (!v.send_time) need('send_time', 'send_time is required to schedule');
    }
  });
export type V1CreateCampaign = z.infer<typeof v1CreateCampaignSchema>;

const campaignCountsSchema = z.object({
  total_recipients: z.number().int(),
  sent: z.number().int(),
  delivered: z.number().int(),
  read: z.number().int(),
  failed: z.number().int(),
  clicked: z.number().int(),
  responded: z.number().int(),
});
const campaignMetricsSchema = z.object({
  delivery_rate: z.number(),
  read_rate: z.number(),
  click_rate: z.number(),
  response_rate: z.number(),
});

export const v1CampaignSchema = z.object({
  id: uuid,
  name: z.string(),
  type: z.string(),
  status: z.string(),
  device_id: z.string().nullable(),
  template_id: uuid.nullable(),
  flow_id: uuid.nullable(),
  ab_testing: z.boolean(),
  ab_split: z.number().int(),
  counts: campaignCountsSchema,
  metrics: campaignMetricsSchema,
  schedule_type: z.string(),
  scheduled_for: z.string().datetime().nullable(),
  timezone: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
});
export type V1Campaign = z.infer<typeof v1CampaignSchema>;

export const v1CampaignStatisticsSchema = z.object({
  campaigns: z.object({
    total: z.number().int(),
    active: z.number().int(),
    completed: z.number().int(),
    scheduled: z.number().int(),
    failed: z.number().int(),
  }),
  messages: campaignCountsSchema.extend({}),
  rates: campaignMetricsSchema,
});
export type V1CampaignStatistics = z.infer<typeof v1CampaignStatisticsSchema>;

// --- scheduled messages (WD-API-091 to 094) ---------------------------------------------------------------------------------------

export const v1CreateScheduledSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    message: z.string().max(4096).nullish(),
    template_id: uuid.nullish(),
    /** The sender: `<engine>:<uuid>` or a bare uuid. Omitted: the most recent connected device. */
    device_id: z.string().trim().min(1).max(80).nullish(),
    /** Phone numbers, any formatting; reduced to digits. */
    recipients: z.array(z.string().max(32)).min(1).max(5000),
    /** A date and time; read in `timezone` unless it carries its own offset. At least two minutes ahead. */
    run_at: z.string().trim().min(1).max(64),
    timezone: z.string().trim().min(1).max(64).nullish(),
  })
  .superRefine((v, ctx) => {
    if (!v.template_id && !v.message?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['message'],
        message: 'message is required when template_id is not given',
      });
    }
  });
export type V1CreateScheduled = z.infer<typeof v1CreateScheduledSchema>;

export const v1ScheduledSchema = z.object({
  id: uuid,
  name: z.string(),
  type: z.string(),
  status: z.string(),
  message: z.string().nullable(),
  template_id: uuid.nullable(),
  device_id: z.string().nullable(),
  recipient_count: z.number().int(),
  run_at: z.string().datetime(),
  next_run_at: z.string().datetime().nullable(),
  timezone: z.string(),
  total_sent: z.number().int(),
  total_delivered: z.number().int(),
  total_failed: z.number().int(),
  created_at: z.string().datetime(),
});
export type V1Scheduled = z.infer<typeof v1ScheduledSchema>;
