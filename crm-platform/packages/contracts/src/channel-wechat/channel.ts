import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * WeChat Official Account channels (WECH). A channel is connected by pasting the AppID, the AppSecret and a server Token chosen in
 * the WeChat console (plus an EncodingAESKey when messages are encrypted). WeChat has no API to set the webhook, so the person pastes
 * our address and the Token into the console by hand. The AppSecret, the EncodingAESKey and the cached access token are never returned.
 */

export const WECHAT_ENC_MODES = ['plain', 'compat', 'safe'] as const;
export type WechatEncMode = (typeof WECHAT_ENC_MODES)[number];

export const WECHAT_AES_KEY_LENGTH = 43;

/** A blank optional field from a form is the same as an absent one. */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

export const connectWechatChannelSchema = z
  .object({
    appId: z.string().trim().min(1, 'Paste the AppID.').max(64),
    appSecret: z.string().trim().min(1, 'Paste the AppSecret.').max(128),
    /** The server Token set in the WeChat console (Settings and development, Basic configuration). */
    verifyToken: z.string().trim().min(1, 'Enter the server Token.').max(128),
    encodingAesKey: z.preprocess(
      blankToUndefined,
      z
        .string()
        .trim()
        .length(WECHAT_AES_KEY_LENGTH, `The EncodingAESKey is ${WECHAT_AES_KEY_LENGTH} characters.`)
        .optional(),
    ),
    encMode: z.enum(WECHAT_ENC_MODES).default('compat'),
    accountName: z.preprocess(blankToUndefined, z.string().trim().max(191).optional()),
  })
  .refine((v) => v.encMode !== 'safe' || v.encodingAesKey !== undefined, {
    path: ['encodingAesKey'],
    message: 'Safe mode needs the EncodingAESKey.',
  });
export type ConnectWechatChannelInput = z.infer<typeof connectWechatChannelSchema>;

export const wechatChannelSchema = z.object({
  id: uuidSchema,
  appId: z.string().nullable(),
  /** The Official Account's own id, learnt from the first inbound message. */
  wxId: z.string().nullable(),
  accountName: z.string().nullable(),
  encMode: z.enum(WECHAT_ENC_MODES),
  hasEncodingAesKey: z.boolean(),
  active: z.boolean(),
  connectedAt: z.string().datetime().nullable(),
  lastInboundAt: z.string().datetime().nullable(),
  /** Why the credentials or the last token refresh failed; null when healthy. */
  lastError: z.string().nullable(),
  /** The address to paste into the WeChat console as Server address (URL). Always https. */
  webhookUrl: z.string(),
  rowVersion: z.number().int(),
});
export type WechatChannel = z.infer<typeof wechatChannelSchema>;

/**
 * Whether WeChat may be used by this workspace at all, decided by its country (WeChat is not allowed in India). When `available`
 * is false the workspace cannot connect a channel, start a broadcast or send to WeChat; existing channel rows are kept.
 */
export const wechatAvailabilitySchema = z.object({
  available: z.boolean(),
  /** The country the decision was made on (ISO 3166-1 alpha-2), or null when the workspace has not saved one. */
  country: z.string().nullable(),
});
export type WechatAvailability = z.infer<typeof wechatAvailabilitySchema>;

export const wechatChannelListSchema = z.object({
  data: z.array(wechatChannelSchema),
  availability: wechatAvailabilitySchema,
});
export type WechatChannelList = z.infer<typeof wechatChannelListSchema>;

/** The two values the person pastes into the WeChat console. The Token is the one they chose, shown back to those who manage the channel. */
export const wechatServerConfigSchema = z.object({
  webhookUrl: z.string(),
  verifyToken: z.string(),
});
export type WechatServerConfig = z.infer<typeof wechatServerConfigSchema>;

/** "Re-check": the channel as it is now, and why WeChat refused the credentials when it did. */
export const recheckWechatChannelResponseSchema = z.object({
  channel: wechatChannelSchema,
  checkError: z.string().nullable(),
});
export type RecheckWechatChannelResponse = z.infer<typeof recheckWechatChannelResponseSchema>;
