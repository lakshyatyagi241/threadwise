import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Outbox events of the conversation core that other domains consume (the outbox payload is a contract too).
 *
 * `message.received` is written in the ingest transaction next to the stored inbound message (BL-096, docs/specs/realtime-notifications.md
 * section 7.2). It carries ids and the few words a notification needs, never the message body: `preview` is the thread-list line cut to
 * 80 characters and `contactName` is the sender's own name (else a masked number). Imported history and outbound messages never emit it.
 */
export const MESSAGE_RECEIVED_EVENT = 'message.received';

/** The longest preview a notification shows (decision D4: contact name plus 80 characters). */
export const NOTIFICATION_PREVIEW_MAX = 80;

export const messageReceivedPayloadSchema = z.object({
  conversationId: uuidSchema,
  messageId: uuidSchema,
  channelId: uuidSchema,
  channelKind: z.string().min(1),
  /** True for the first message of a new thread or of a thread the message just reopened: the "new chat" moment. */
  firstInbound: z.boolean(),
  /** True when the thread is a group chat (the sender is one member of many). */
  group: z.boolean().default(false),
  preview: z.string().max(NOTIFICATION_PREVIEW_MAX),
  contactName: z.string().max(200).nullable(),
  /** When the message was stored (ISO). A consumer compares it with a person's last "read" moment. */
  at: z.string().datetime(),
});
export type MessageReceivedPayload = z.infer<typeof messageReceivedPayloadSchema>;
