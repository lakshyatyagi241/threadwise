import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * LINE channels. A channel is a LINE Official Account (Messaging API channel), connected by pasting its Channel access token and its
 * Channel secret. Neither is ever returned; the secret signs every inbound delivery and the token sends. A channel can optionally
 * rotate its token (a v2.1 token issued from an Assertion Signing Key); the key is never returned either, only that rotation is on.
 */

/** Reference's bounds: a long-lived token is a long string, the secret is 32 characters in practice. */
export const connectLineChannelSchema = z.object({
  channelAccessToken: z
    .string()
    .trim()
    .min(20, 'That does not look like a LINE channel access token. Copy the whole value.')
    .max(1000),
  channelSecret: z
    .string()
    .trim()
    .min(16, 'That does not look like a LINE channel secret. It is 32 characters.')
    .max(255),
});
export type ConnectLineChannelInput = z.infer<typeof connectLineChannelSchema>;

/**
 * Token rotation. Blank `assertionKid` or `assertionPrivateKey` turns rotation off and goes back to the pasted long-lived token.
 * `channelId` is the numeric Channel ID of the LINE console; the signed assertion names it, and the bot info LINE returns on connect
 * does not carry it (Reference sent the bot's user id there, which LINE rejects), so it is asked for when the channel has none yet.
 */
export const saveLineRotationSchema = z.object({
  assertionKid: z.string().trim().max(128).optional(),
  assertionPrivateKey: z.string().trim().max(8000).optional(),
  channelId: z
    .string()
    .trim()
    .regex(/^\d{1,20}$/, 'The Channel ID is the number shown in the LINE console.')
    .optional(),
});
export type SaveLineRotationInput = z.infer<typeof saveLineRotationSchema>;

export const lineChannelResponseSchema = z.object({
  id: uuidSchema,
  /** The bot's user id LINE reports (starts with U), or the numeric Channel ID once rotation was set up. */
  lineChannelId: z.string().nullable(),
  basicId: z.string().nullable(),
  displayName: z.string().nullable(),
  pictureUrl: z.string().nullable(),
  active: z.boolean(),
  connectedAt: z.string().datetime().nullable(),
  lastInboundAt: z.string().datetime().nullable(),
  /** Why the webhook, a token renewal or the last send failed; null when healthy. */
  lastError: z.string().nullable(),
  /** The Assertion Signing Key's id (not a secret), shown back so it can be edited. */
  assertionKid: z.string().nullable(),
  rotationEnabled: z.boolean(),
  /** When the current rotated token lapses; null when rotation is off or no token was issued yet. */
  rotationExpiresAt: z.string().datetime().nullable(),
  /** The address LINE pushes to for this channel (always https). */
  webhookUrl: z.string(),
  rowVersion: z.number().int(),
});
export type LineChannelResponse = z.infer<typeof lineChannelResponseSchema>;

export const connectLineChannelResponseSchema = lineChannelResponseSchema.extend({
  /** LINE refused the webhook: the channel is saved and shows "needs attention"; this says why and how to fix it. */
  webhookError: z.string().nullable(),
});
export type ConnectLineChannelResponse = z.infer<typeof connectLineChannelResponseSchema>;

export const lineChannelListResponseSchema = z.object({ data: z.array(lineChannelResponseSchema) });
export type LineChannelListResponse = z.infer<typeof lineChannelListResponseSchema>;
