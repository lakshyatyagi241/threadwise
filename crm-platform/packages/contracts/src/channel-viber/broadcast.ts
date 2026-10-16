import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Viber broadcasts (TW-VIB-010 to 014). A bot may only message people who opened a chat with it, so the audience is the inbox threads the
 * channel already carries. The recipient list is frozen when the broadcast is created.
 */

export const VIB_BROADCAST_STATUSES = ['draft', 'sending', 'done', 'failed'] as const;
export const VIB_RECIPIENT_STATUSES = ['pending', 'sent', 'failed'] as const;
export const VIB_MEDIA_KINDS = ['image', 'video'] as const;
/** Viber's text limit, and Reference's compose limit. */
export const VIB_TEXT_MAX = 7000;
/** The attachment limit of Reference's compose screen (26 MB). */
export const VIB_MEDIA_MAX_BYTES = 26 * 1024 * 1024;
/** What Reference accepted as an attachment: pictures and mp4 video. */
export const VIB_MEDIA_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'mp4'] as const;

/** One user the channel can message. */
export const viberUserSchema = z.object({
  userId: z.string(),
  title: z.string(),
  lastMessageAt: z.string().datetime().nullable(),
});
export type ViberUser = z.infer<typeof viberUserSchema>;
export const viberUserListSchema = z.object({ data: z.array(viberUserSchema) });
export type ViberUserList = z.infer<typeof viberUserListSchema>;

export const vibTemplateSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  body: z.string(),
  buttons: z.unknown(),
});
export type VibTemplate = z.infer<typeof vibTemplateSchema>;

/** What the compose page opens with: the channels to send from and the Viber templates. */
export const vibBroadcastComposeSchema = z.object({
  channels: z.array(
    z.object({
      id: uuidSchema,
      name: z.string().nullable(),
      active: z.boolean(),
    }),
  ),
  templates: z.array(vibTemplateSchema),
});
export type VibBroadcastCompose = z.infer<typeof vibBroadcastComposeSchema>;

/** The extension of an address, lower case, ignoring the query string and the fragment. */
export function mediaExtension(url: string): string {
  const path = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '').split(/[?#]/)[0] ?? '';
  const file = path.split('/').pop() ?? '';
  return file.includes('.') ? (file.split('.').pop() ?? '').toLowerCase() : '';
}

export const createVibBroadcastSchema = z
  .object({
    name: z.string().trim().min(1).max(191),
    channelId: uuidSchema,
    templateId: uuidSchema.nullish(),
    /** Blank fills from the template. */
    body: z.string().trim().max(VIB_TEXT_MAX).optional(),
    userIds: z.array(z.string().trim().min(1).max(64)).min(1).max(5000),
    /** One optional attachment: a public address of a picture (jpg, png, gif) or an mp4 video, up to 26 MB. */
    mediaUrl: z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine((u) => (VIB_MEDIA_EXTENSIONS as readonly string[]).includes(mediaExtension(u)), {
        message: 'The attachment must be a jpg, png, gif or mp4 file.',
      })
      .optional(),
    /** The file's size in bytes when the page knows it (an upload); Viber needs it for a video. */
    mediaSize: z.number().int().positive().max(VIB_MEDIA_MAX_BYTES).optional(),
  })
  .strict();
export type CreateVibBroadcastInput = z.infer<typeof createVibBroadcastSchema>;

export const vibBroadcastSchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  channelId: uuidSchema,
  channelName: z.string().nullable(),
  templateId: uuidSchema.nullable(),
  status: z.enum(VIB_BROADCAST_STATUSES),
  total: z.number().int(),
  sent: z.number().int(),
  failed: z.number().int(),
  /** Receipts Viber reported for what was sent (a message token is kept on each recipient). */
  delivered: z.number().int(),
  seen: z.number().int(),
  /** Whole percent done: (sent + failed) of the total. */
  progress: z.number().int(),
  /** BL-191: users held for the workspace's quiet hours (still pending), and the first instant one of them may be messaged. */
  held: z.number().int(),
  heldUntil: z.string().datetime().nullable(),
  hasMedia: z.boolean(),
  lastError: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type VibBroadcast = z.infer<typeof vibBroadcastSchema>;

export const vibBroadcastListSchema = z.object({
  data: z.array(vibBroadcastSchema),
  /** Across every broadcast of the workspace, not only the 50 listed. */
  stats: z.object({
    total: z.number().int(),
    sent: z.number().int(),
    failed: z.number().int(),
    delivered: z.number().int(),
    seen: z.number().int(),
    audience: z.number().int(),
    sending: z.number().int(),
  }),
});
export type VibBroadcastList = z.infer<typeof vibBroadcastListSchema>;

export const retryVibBroadcastResponseSchema = z.object({ retried: z.number().int() });
export type RetryVibBroadcastResponse = z.infer<typeof retryVibBroadcastResponseSchema>;
