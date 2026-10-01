import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * What the compose page needs to open (WD-BCAST-004 to 006): the templates a broadcast may send and the numbers it may be sent
 * from. The audience comes from the contacts, groups and tags endpoints.
 */

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

export const broadcastComposeSchema = z.object({
  templates: z.array(composeTemplateSchema),
  senders: z.array(composeSenderSchema),
  /** A Twilio number is connected: the picker then marks each template "Twilio ready" or "plain text only". */
  twilioEnabled: z.boolean(),
});
export type BroadcastCompose = z.infer<typeof broadcastComposeSchema>;
