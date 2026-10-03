import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Telegram broadcasts (WD-TG-010 to 014). A bot cannot message anyone who has not written first, so the audience is the chats the
 * bot already carries: private threads, groups and channels. The recipient list is frozen when the broadcast is created.
 */

export const TG_BROADCAST_STATUSES = ['draft', 'sending', 'done', 'failed'] as const;
export const TG_RECIPIENT_STATUSES = ['pending', 'sent', 'failed', 'blocked'] as const;
export const TG_MEDIA_KINDS = ['image', 'animation', 'video', 'audio', 'document'] as const;

/** One chat a bot can message. */
export const telegramChatSchema = z.object({
  chatId: z.string(),
  title: z.string(),
  /** private, group or channel. */
  type: z.string(),
  lastMessageAt: z.string().datetime().nullable(),
  unread: z.number().int(),
});
export type TelegramChat = z.infer<typeof telegramChatSchema>;
export const telegramChatListSchema = z.object({ data: z.array(telegramChatSchema) });

export const tgTemplateSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  body: z.string(),
  buttons: z.unknown(),
});
export type TgTemplate = z.infer<typeof tgTemplateSchema>;

/** What the compose page opens with: the bots to send from and the Telegram templates. */
export const tgBroadcastComposeSchema = z.object({
  bots: z.array(
    z.object({
      id: uuidSchema,
      username: z.string().nullable(),
      name: z.string().nullable(),
      active: z.boolean(),
    }),
  ),
  templates: z.array(tgTemplateSchema),
});
export type TgBroadcastCompose = z.infer<typeof tgBroadcastComposeSchema>;

export const createTgBroadcastSchema = z.object({
  name: z.string().trim().min(1).max(191),
  botId: uuidSchema,
  templateId: uuidSchema.nullish(),
  /** Blank fills from the template. `{{name}}` becomes the chat's title. */
  body: z.string().trim().max(4096).optional(),
  chatIds: z.array(z.string().trim().min(1).max(32)).min(1).max(5000),
  /** One optional attachment, sent with the body as its caption: a public address. Uploading a file waits on the storage domain. */
  mediaUrl: z.string().trim().url().max(2048).optional(),
});
export type CreateTgBroadcastInput = z.infer<typeof createTgBroadcastSchema>;

export const tgBroadcastSchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  botId: uuidSchema,
  botUsername: z.string().nullable(),
  templateId: uuidSchema.nullable(),
  status: z.enum(TG_BROADCAST_STATUSES),
  total: z.number().int(),
  sent: z.number().int(),
  failed: z.number().int(),
  blocked: z.number().int(),
  /** Whole percent; blocked counts as done (nothing more can be done for them). */
  progress: z.number().int(),
  hasMedia: z.boolean(),
  lastError: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type TgBroadcast = z.infer<typeof tgBroadcastSchema>;

export const tgBroadcastListSchema = z.object({
  data: z.array(tgBroadcastSchema),
  /** Across every broadcast of the workspace, not only the 50 listed. */
  stats: z.object({
    total: z.number().int(),
    sent: z.number().int(),
    failed: z.number().int(),
    blocked: z.number().int(),
    audience: z.number().int(),
    sending: z.number().int(),
  }),
});
export type TgBroadcastList = z.infer<typeof tgBroadcastListSchema>;

export const retryTgBroadcastResponseSchema = z.object({ retried: z.number().int() });
