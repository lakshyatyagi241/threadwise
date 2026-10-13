import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * What the compose page needs to open (TW-BCAST-004 to 006): the templates a broadcast may send and the numbers it may be sent
 * from. The audience comes from the contacts, groups and tags endpoints.
 */

/**
 * `channel=sms` scopes the composer to the SMS channel (TW-SMS-016): only SMS senders and SMS templates, and only while the platform
 * switch is on. Without it the composer is the WhatsApp one and never lists an SMS sender.
 */
export const broadcastComposeQuerySchema = z.object({ channel: z.enum(['sms']).optional() });
export type BroadcastComposeQuery = z.infer<typeof broadcastComposeQuerySchema>;

export const composeTemplateSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  /** Header text, empty when the header is media. */
  header: z.string().nullable(),
  body: z.string(),
  footer: z.string().nullable(),
  /** meta_category, else category when it is a WhatsApp category, else `utility`. */
  category: z.string(),
  type: z.string(),
  /** Which engine the template targets: baileys, waba or twilio. Twilio sends a template by its Content SID, so its media and buttons cannot be changed at send time. */
  engine: z.string(),
  language: z.string(),
  buttons: z.unknown(),
  variableMap: z.unknown(),
  attachmentType: z.string().nullable(),
  /** Public URL of the header media; null when there is none or the storage layer cannot say. */
  attachmentUrl: z.string().nullable(),
  /** The WABA number the template lives on, shown next to its name when the workspace has several. */
  senderLabel: z.string().nullable(),
  /** Twilio sends need a Content SID per template; without one the send degrades to plain text. */
  twilioReady: z.boolean(),
});
export type ComposeTemplate = z.infer<typeof composeTemplateSchema>;

export const composeSenderSchema = z.object({
  /** `<engine>:<uuid>`, what `senderKeys` takes. */
  key: z.string(),
  label: z.string(),
  phone: z.string(),
  engine: z.string(),
  engineLabel: z.string(),
  isDefault: z.boolean(),
});
export type ComposeSender = z.infer<typeof composeSenderSchema>;

/**
 * Why a number the workspace has is not in the sender list. `unofficial_disabled`: a personal (QR) number while the platform switch or
 * the workspace's allow-list keeps that engine off. `not_connected`: a number that is disconnected or inactive. `pending`: a Meta or
 * Twilio number whose connection is not finished. `error`: a number whose connection failed.
 */
export const SENDER_HIDDEN_REASONS = [
  'unofficial_disabled',
  'not_connected',
  'pending',
  'error',
] as const;
export const senderHiddenReasonSchema = z.enum(SENDER_HIDDEN_REASONS);
export type SenderHiddenReason = z.infer<typeof senderHiddenReasonSchema>;

/** A count of numbers left out of the list for one reason on one engine. Never a number, label or secret. */
export const senderHiddenSchema = z.object({
  engine: z.string(),
  reason: senderHiddenReasonSchema,
  count: z.number().int().positive(),
});
export type SenderHidden = z.infer<typeof senderHiddenSchema>;

export const broadcastComposeSchema = z.object({
  templates: z.array(composeTemplateSchema),
  senders: z.array(composeSenderSchema),
  /** The numbers the workspace has that are not in `senders`, by engine and reason, so an empty list can say why. */
  hidden: z.array(senderHiddenSchema),
  /** A Twilio number is connected: the picker then marks each template "Twilio ready" or "plain text only". */
  twilioEnabled: z.boolean(),
});
export type BroadcastCompose = z.infer<typeof broadcastComposeSchema>;
