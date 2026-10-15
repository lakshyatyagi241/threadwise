import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * LINE broadcasts. An Official Account cannot message anyone who has not added it as a friend, so the audience is the direct-user
 * threads the channel already carries (a LINE user id starts with `U`; groups and rooms are left out). The recipient list is frozen
 * when the broadcast is created. Each recipient gets one push message of up to five message objects.
 */

export const LINE_BROADCAST_STATUSES = ['draft', 'sending', 'done', 'failed'] as const;
export const LINE_RECIPIENT_STATUSES = ['pending', 'sent', 'failed', 'blocked'] as const;
export const LINE_MEDIA_KINDS = ['image', 'video', 'audio'] as const;

/** One person a channel can message. */
export const lineAudienceUserSchema = z.object({
  userId: z.string(),
  title: z.string(),
  lastMessageAt: z.string().datetime().nullable(),
  unread: z.number().int(),
});
export type LineAudienceUser = z.infer<typeof lineAudienceUserSchema>;
export const lineAudienceListSchema = z.object({ data: z.array(lineAudienceUserSchema) });
export type LineAudienceList = z.infer<typeof lineAudienceListSchema>;

export const lineTemplateSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  body: z.string(),
  buttons: z.unknown(),
});
export type LineTemplate = z.infer<typeof lineTemplateSchema>;

/** What the compose page opens with: the channels to send from and the LINE templates. */
export const lineBroadcastComposeSchema = z.object({
  channels: z.array(
    z.object({
      id: uuidSchema,
      displayName: z.string().nullable(),
      basicId: z.string().nullable(),
      active: z.boolean(),
    }),
  ),
  templates: z.array(lineTemplateSchema),
});
export type LineBroadcastCompose = z.infer<typeof lineBroadcastComposeSchema>;

export const createLineBroadcastSchema = z.object({
  name: z.string().trim().min(1).max(191),
  channelId: uuidSchema,
  templateId: uuidSchema.nullish(),
  /** Blank fills from the template. `{{name}}` becomes the person's LINE display name. */
  body: z.string().trim().max(5000).optional(),
  userIds: z.array(z.string().trim().min(1).max(64)).min(1).max(5000),
  /** One optional attachment sent as its own bubble before the message: a public address (LINE fetches it over https). */
  mediaUrl: z.string().trim().url().max(2048).optional(),
});
export type CreateLineBroadcastInput = z.infer<typeof createLineBroadcastSchema>;

export const lineBroadcastSchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  channelId: uuidSchema,
  channelName: z.string().nullable(),
  templateId: uuidSchema.nullable(),
  status: z.enum(LINE_BROADCAST_STATUSES),
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
export type LineBroadcast = z.infer<typeof lineBroadcastSchema>;

export const lineBroadcastListSchema = z.object({
  data: z.array(lineBroadcastSchema),
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
export type LineBroadcastList = z.infer<typeof lineBroadcastListSchema>;

export const retryLineBroadcastResponseSchema = z.object({ retried: z.number().int() });
