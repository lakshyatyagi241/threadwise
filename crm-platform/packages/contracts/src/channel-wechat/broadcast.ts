import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * WeChat broadcasts (WECH). WeChat's mass send is ONE call to an audience: every follower, a tag, or a list of at least two OpenIDs
 * picked from the inbox. Text only, up to 2000 characters. A Service Account may mass-send about four times a month: that is WeChat's
 * rule, the screens say so and the app enforces nothing it cannot verify.
 */

export const WECHAT_BROADCAST_STATUSES = ['draft', 'sending', 'done', 'failed'] as const;
export const WECHAT_AUDIENCES = ['all', 'tag', 'list'] as const;
export type WechatAudience = (typeof WECHAT_AUDIENCES)[number];

export const WECHAT_BODY_MAX = 2000;
/** An OpenID mass send needs at least two recipients; WeChat accepts at most 10000. */
export const WECHAT_LIST_MIN = 2;
export const WECHAT_LIST_MAX = 1000;

/** One follower the channel can message: a thread already in the inbox. */
export const wechatChatSchema = z.object({
  openid: z.string(),
  title: z.string(),
  lastMessageAt: z.string().datetime().nullable(),
});
export type WechatChat = z.infer<typeof wechatChatSchema>;
export const wechatChatListSchema = z.object({ data: z.array(wechatChatSchema) });

export const wechatTemplateSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  body: z.string(),
});
export type WechatTemplate = z.infer<typeof wechatTemplateSchema>;

/** What the compose page opens with: the channels to send from and the WeChat templates. */
export const wechatBroadcastComposeSchema = z.object({
  channels: z.array(
    z.object({
      id: uuidSchema,
      accountName: z.string().nullable(),
      appId: z.string().nullable(),
      active: z.boolean(),
    }),
  ),
  templates: z.array(wechatTemplateSchema),
});
export type WechatBroadcastCompose = z.infer<typeof wechatBroadcastComposeSchema>;

export const createWechatBroadcastSchema = z
  .object({
    name: z.string().trim().min(1).max(191),
    channelId: uuidSchema,
    templateId: uuidSchema.nullish(),
    body: z.string().trim().min(1).max(WECHAT_BODY_MAX),
    audience: z.enum(WECHAT_AUDIENCES),
    /** The WeChat tag (group) id for the `tag` audience; digits only. */
    tagId: z
      .string()
      .trim()
      .regex(/^\d{1,10}$/, 'The tag ID is a number.')
      .optional(),
    /** The OpenIDs picked from the channel's inbox threads, for the `list` audience. */
    openids: z.array(z.string().trim().min(1).max(64)).max(WECHAT_LIST_MAX).optional(),
  })
  .refine((v) => v.audience !== 'tag' || v.tagId !== undefined, {
    path: ['tagId'],
    message: 'Enter the tag ID.',
  });
export type CreateWechatBroadcastInput = z.infer<typeof createWechatBroadcastSchema>;

export const wechatBroadcastSchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  channelId: uuidSchema,
  channelName: z.string().nullable(),
  audience: z.enum(WECHAT_AUDIENCES),
  tagId: z.string().nullable(),
  /** WeChat's id for the mass send, once it accepted it. */
  massMsgId: z.string().nullable(),
  status: z.enum(WECHAT_BROADCAST_STATUSES),
  /** The picked recipients for a `list` audience; 0 for all followers and a tag (WeChat does not say how many). */
  total: z.number().int(),
  sent: z.number().int(),
  failed: z.number().int(),
  lastError: z.string().nullable(),
  /** Send can be tried again: the last attempt failed, or a worker died while sending and left it stuck. */
  canRetry: z.boolean(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type WechatBroadcast = z.infer<typeof wechatBroadcastSchema>;

export const wechatBroadcastListSchema = z.object({ data: z.array(wechatBroadcastSchema) });
export type WechatBroadcastList = z.infer<typeof wechatBroadcastListSchema>;
