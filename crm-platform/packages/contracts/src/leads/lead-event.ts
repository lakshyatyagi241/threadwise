import { z } from 'zod';
import { cursorSchema, pageInfoSchema } from '../common/pagination';
import { uuidSchema } from '../common/ids';
import { leadFirstReplyResponseSchema } from './speed-to-lead';

/**
 * Lead events: every delivery a lead source received, with what the pipeline did with it. A lead is never dropped: one that cannot
 * become a contact is `needs_review` (fix the mapping, then retry) and one that hit an error is `failed`.
 */

/** `received` only exists while a lead is being processed. `duplicate` is what a repeat delivery is answered with. */
export const LEAD_EVENT_STATUSES = [
  'received',
  'created',
  'updated',
  'duplicate',
  'needs_review',
  'failed',
] as const;
export const leadEventStatusSchema = z.enum(LEAD_EVENT_STATUSES);
export type LeadEventStatus = z.infer<typeof leadEventStatusSchema>;

/** The statuses a lead ends in, as the pipeline's port answers them. */
export const LEAD_RESULT_STATUSES = [
  'created',
  'updated',
  'duplicate',
  'needs_review',
  'failed',
] as const;

/** Why a lead is `needs_review` or `failed` (`reason` on the event). */
export const LEAD_REASONS = [
  /** Neither a usable email address nor a usable phone number. */
  'no_contact_point',
  /** A phone number was sent but cannot be read as one, and there is no email. */
  'invalid_phone',
  /** The workspace's plan caps contacts and the cap is reached. */
  'plan_limit_reached',
  /** The source is paused. */
  'source_paused',
  /** The pipeline hit an unexpected error (the event's `error` holds the message). */
  'internal_error',
  /** The lead became a contact, but its phone or email already belongs to another contact: that identity was not moved. */
  'identity_conflict',
] as const;
export type LeadReason = (typeof LEAD_REASONS)[number];

export const listLeadEventsQuerySchema = z.object({
  status: leadEventStatusSchema.optional(),
  /** `true` for test leads only, `false` to hide them. Omit for both. */
  isTest: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: cursorSchema.optional(),
});
export type ListLeadEventsQuery = z.infer<typeof listLeadEventsQuerySchema>;

export const leadEventResponseSchema = z.object({
  id: uuidSchema,
  sourceId: uuidSchema,
  externalId: z.string(),
  status: leadEventStatusSchema,
  reason: z.string().nullable(),
  error: z.string().nullable(),
  isTest: z.boolean(),
  /** The contact the lead became (or matched). Null while it needs review, and after the contact was deleted. */
  contactId: uuidSchema.nullable(),
  dealId: uuidSchema.nullable(),
  /** The raw payload is kept for the source's retention period, then purged: `false` after that. */
  hasPayload: z.boolean(),
  payloadExpiresAt: z.string().datetime().nullable(),
  attempts: z.number().int(),
  /** How many times the same lead was delivered again and acknowledged without writing anything. */
  duplicateCount: z.number().int(),
  receivedAt: z.string().datetime(),
  processedAt: z.string().datetime().nullable(),
  /** The automatic first message of this lead and where it stands; null when the source sends none (or it was switched off at the time). */
  firstReply: leadFirstReplyResponseSchema.nullable(),
});
export type LeadEventResponse = z.infer<typeof leadEventResponseSchema>;

export const leadEventListResponseSchema = z.object({
  data: z.array(leadEventResponseSchema),
  page: pageInfoSchema,
});
export type LeadEventListResponse = z.infer<typeof leadEventListResponseSchema>;

/** One event with its stored payload. Opening it is audited: the payload is personal data. */
export const leadEventDetailResponseSchema = leadEventResponseSchema.extend({
  payload: z.record(z.unknown()).nullable(),
});
export type LeadEventDetailResponse = z.infer<typeof leadEventDetailResponseSchema>;

/** The answer to a test lead: what the pipeline did with it, as a normal lead would have been treated (except it did not notify). */
export const sendTestLeadResponseSchema = z.object({
  event: leadEventResponseSchema,
});
export type SendTestLeadResponse = z.infer<typeof sendTestLeadResponseSchema>;

// --- contact attribution --------------------------------------------------------------------------------------------------------

export const attributionTouchSchema = z.object({
  id: uuidSchema,
  platform: z.string().nullable(),
  /** What `contacts.source` was given for this touch. */
  sourceLabel: z.string(),
  campaign: z.string().nullable(),
  adset: z.string().nullable(),
  ad: z.string().nullable(),
  form: z.string().nullable(),
  /** The channel and module type the touch carried (a migrated Waboo touch keeps them; other touches have none). */
  channel: z.string().nullable().optional(),
  moduleType: z.string().nullable().optional(),
  /** The lead source it came through; null once that source was deleted. */
  leadSourceId: uuidSchema.nullable(),
  capturedAt: z.string().datetime(),
});
export type AttributionTouch = z.infer<typeof attributionTouchSchema>;

export const contactAttributionResponseSchema = z.object({
  /** The earliest touch: where the person first came from. */
  first: attributionTouchSchema.nullable(),
  /** The newest touch. The same row as `first` when there is only one. */
  latest: attributionTouchSchema.nullable(),
  /** Every touch, newest first (at most 50). */
  touches: z.array(attributionTouchSchema),
  total: z.number().int().min(0),
});
export type ContactAttributionResponse = z.infer<typeof contactAttributionResponseSchema>;
