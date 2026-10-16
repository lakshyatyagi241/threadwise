import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Speed-to-lead (BL-014, spec L-16): an optional first message sent by itself when a NEW lead becomes a contact. It is a setting of a
 * lead source (`defaults.speedToLead`), off by default, and it never sends anything of its own accord: the message goes through the
 * same dispatchers as every other business-started message, so the ConsentGate, quiet hours, the plan's limits and the wallet decide
 * whether it leaves. What happened to it is recorded per lead (`LeadFirstReply`) and shown on the lead and on the contact's timeline.
 */

export const SPEED_TO_LEAD_CHANNELS = ['whatsapp', 'sms', 'email'] as const;
export const speedToLeadChannelSchema = z.enum(SPEED_TO_LEAD_CHANNELS);
export type SpeedToLeadChannel = z.infer<typeof speedToLeadChannelSchema>;

/** How long after the lead arrives the message may go: 0 is at once, at most an hour (a longer wait is a follow-up, not speed). */
export const SPEED_TO_LEAD_MAX_DELAY_MINUTES = 60;

/**
 * A lead older than this when it reaches the pipeline gets no first message by default. "Speed to lead" is about the person who just
 * asked; a backfill, a retry of an old lead or a sweep that finds a lead late must not message someone days after they filled a form.
 */
export const SPEED_TO_LEAD_DEFAULT_MAX_LEAD_AGE_MINUTES = 60;
/** The most a workspace may raise it to: a lead is kept about 90 days by the providers that keep them at all. */
export const SPEED_TO_LEAD_MAX_LEAD_AGE_LIMIT_MINUTES = 90 * 24 * 60;

export const speedToLeadSchema = z.object({
  /** Off until the admin turns it on. */
  enabled: z.boolean().default(false),
  channel: speedToLeadChannelSchema.default('whatsapp'),
  /**
   * What is sent. WhatsApp: an approved WhatsApp template of the workspace (its number sends it). SMS: an approved SMS template. Email: a
   * shared email template (a personal one belongs to its author, not to the workspace). Required once `enabled`; the API checks it
   * against the workspace (422 `LEAD_DEFAULTS_INVALID`).
   */
  templateId: uuidSchema.nullish(),
  /**
   * SMS and email: the sender to use (an SMS number, a shared mailbox) as the broadcast composer names them: the uuid after `sms:` or
   * `email:`. Omit for the workspace's oldest connected one. WhatsApp ignores it: the template's own number sends.
   */
  senderId: uuidSchema.nullish(),
  delayMinutes: z.number().int().min(0).max(SPEED_TO_LEAD_MAX_DELAY_MINUTES).default(0),
  /** Wait for the workspace's business hours (Settings > Business hours) instead of messaging a lead at night. */
  businessHoursOnly: z.boolean().default(false),
  /**
   * The oldest a lead may be (minutes since it was submitted at the provider) and still get the first message. Default one hour: a lead
   * pulled in by a backfill, a retry or a late sweep is older than that, so it is stored and assigned but not messaged. Raise it to
   * message older leads on purpose; the consent rules still apply to every message.
   */
  maxLeadAgeMinutes: z
    .number()
    .int()
    .min(1)
    .max(SPEED_TO_LEAD_MAX_LEAD_AGE_LIMIT_MINUTES)
    .default(SPEED_TO_LEAD_DEFAULT_MAX_LEAD_AGE_MINUTES),
});
export type SpeedToLead = z.infer<typeof speedToLeadSchema>;

/** The setting of a source that never configured it. */
export const SPEED_TO_LEAD_OFF: SpeedToLead = {
  enabled: false,
  channel: 'whatsapp',
  templateId: null,
  senderId: null,
  delayMinutes: 0,
  businessHoursOnly: false,
  maxLeadAgeMinutes: SPEED_TO_LEAD_DEFAULT_MAX_LEAD_AGE_MINUTES,
};

/**
 * Where one lead's first message stands.
 *
 *  scheduled  waiting for its time (the delay)
 *  sending    claimed by a worker right now
 *  held       waiting for a window to open (quiet hours, business hours) or for a channel that is down; it goes by itself
 *  sent       handed to the dispatcher (WhatsApp: queued on the conversation, where delivery shows; SMS and email: accepted by the provider)
 *  blocked    the ConsentGate, the plan or the wallet said no; nothing was sent and nothing will be
 *  skipped    there was nothing to send (no phone or email, no sender, the template is gone, the setting was switched off, the lead too old)
 *  failed     the send itself failed, or it was interrupted
 */
export const LEAD_FIRST_REPLY_STATUSES = [
  'scheduled',
  'sending',
  'held',
  'sent',
  'blocked',
  'skipped',
  'failed',
] as const;
export const leadFirstReplyStatusSchema = z.enum(LEAD_FIRST_REPLY_STATUSES);
export type LeadFirstReplyStatus = z.infer<typeof leadFirstReplyStatusSchema>;

/** The statuses nothing happens after. */
export const LEAD_FIRST_REPLY_FINAL: readonly LeadFirstReplyStatus[] = [
  'sent',
  'blocked',
  'skipped',
  'failed',
];

/**
 * Why a first message is held, blocked, skipped or failed (`reason`). Held ones go by themselves when the cause passes: the quiet hours
 * or the business hours open, the channel is connected again, the wallet is topped up, the emergency halt is lifted.
 */
export const LEAD_FIRST_REPLY_REASONS = [
  // held
  'quiet_hours',
  'outside_business_hours',
  'channel_unavailable',
  'wallet_empty',
  'send_halted',
  // blocked
  'opted_out',
  'no_consent',
  'minor',
  'plan_limit',
  // skipped
  'disabled',
  'source_paused',
  'no_contact_point',
  'no_sender',
  'template_unavailable',
  'missing_value',
  'lead_too_old',
  // failed
  'provider_error',
  'interrupted',
  'expired',
  'internal_error',
] as const;
export type LeadFirstReplyReason = (typeof LEAD_FIRST_REPLY_REASONS)[number];

export const leadFirstReplyResponseSchema = z.object({
  channel: speedToLeadChannelSchema,
  status: leadFirstReplyStatusSchema,
  reason: z.string().nullable(),
  /** When it is due (scheduled) or next due (held). */
  dueAt: z.string().datetime(),
  sentAt: z.string().datetime().nullable(),
  attempts: z.number().int().min(0),
});
export type LeadFirstReplyResponse = z.infer<typeof leadFirstReplyResponseSchema>;

/**
 * What the speed-to-lead setting can choose from, for one channel (`GET /lead-sources/speed-to-lead/options`): the templates this channel
 * can really send and the senders that are connected. Read by the source screen's pickers with the lead manage permission alone, so a
 * person who manages lead sources does not also need the template, SMS and mailbox permissions to fill in this one setting.
 */
export const speedToLeadOptionsQuerySchema = z.object({ channel: speedToLeadChannelSchema });
export type SpeedToLeadOptionsQuery = z.infer<typeof speedToLeadOptionsQuerySchema>;

export const speedToLeadOptionsResponseSchema = z.object({
  /** Approved WhatsApp templates the contact alone can fill; approved SMS templates; shared email templates. Newest or A to Z, at most 100. */
  templates: z.array(
    z.object({
      id: uuidSchema,
      name: z.string(),
      /** A line of the body (WhatsApp, SMS) or the subject (email), to tell templates apart. Never a contact's data. */
      preview: z.string(),
    }),
  ),
  /** SMS numbers or shared mailboxes. Empty for WhatsApp: the template's own number sends. */
  senders: z.array(z.object({ id: uuidSchema, label: z.string() })),
});
export type SpeedToLeadOptionsResponse = z.infer<typeof speedToLeadOptionsResponseSchema>;
