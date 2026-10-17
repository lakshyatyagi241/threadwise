import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Messenger broadcasts (TW-FB-012 to 014). Meta lets a Page message only someone who wrote to it in the last 24 hours, so the
 * audience is the Page's Messenger threads inside that window, and the recipient list is frozen when the broadcast is created.
 */

export const FB_BROADCAST_STATUSES = ['draft', 'sending', 'done', 'failed'] as const;
export const FB_RECIPIENT_STATUSES = ['pending', 'sent', 'failed', 'blocked'] as const;

/** One person a Page can message right now. */
export const fbAudienceMemberSchema = z.object({
  psid: z.string(),
  title: z.string(),
  /** When they last wrote: the 24 hours run from here. */
  lastInboundAt: z.string().datetime(),
});
export type FbAudienceMember = z.infer<typeof fbAudienceMemberSchema>;

export const fbTemplateSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  body: z.string(),
  buttons: z.unknown(),
});
export type FbTemplate = z.infer<typeof fbTemplateSchema>;

/** What the compose form opens with: each connected Page with its reachable audience, and the Facebook templates. */
export const fbBroadcastComposeSchema = z.object({
  pages: z.array(
    z.object({
      id: uuidSchema,
      pageId: z.string(),
      name: z.string().nullable(),
      audience: z.array(fbAudienceMemberSchema),
    }),
  ),
  templates: z.array(fbTemplateSchema),
});
export type FbBroadcastCompose = z.infer<typeof fbBroadcastComposeSchema>;

export const createFbBroadcastSchema = z.object({
  name: z.string().trim().min(1).max(191),
  pageId: uuidSchema,
  /** Blank, unknown or not a Facebook template of this workspace means no template (Reference ignored it). */
  templateId: uuidSchema.nullish(),
  /** Blank fills from the template. `{{name}}` and `{name}` become the person's name. */
  body: z.string().trim().max(2000).optional(),
  psids: z.array(z.string().trim().min(1).max(64)).min(1).max(5000),
});
export type CreateFbBroadcastInput = z.infer<typeof createFbBroadcastSchema>;

export const fbBroadcastSchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  pageId: uuidSchema,
  pageName: z.string().nullable(),
  templateId: uuidSchema.nullable(),
  status: z.enum(FB_BROADCAST_STATUSES),
  total: z.number().int(),
  sent: z.number().int(),
  failed: z.number().int(),
  blocked: z.number().int(),
  /** Whole percent; blocked counts as done (nothing more can be done for them). */
  progress: z.number().int(),
  /** BL-191: people held for the workspace's quiet hours (still pending), and the first instant one of them may be messaged. */
  held: z.number().int(),
  heldUntil: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type FbBroadcast = z.infer<typeof fbBroadcastSchema>;

export const fbBroadcastListSchema = z.object({
  data: z.array(fbBroadcastSchema),
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
export type FbBroadcastList = z.infer<typeof fbBroadcastListSchema>;

export const retryFbBroadcastResponseSchema = z.object({ retried: z.number().int() });
export type RetryFbBroadcastResponse = z.infer<typeof retryFbBroadcastResponseSchema>;
